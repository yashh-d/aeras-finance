import { NextResponse } from "next/server";

import {
  mergeEquivalentBalances,
  selectHeldEquivalents,
  type EquivalentBalances,
} from "@/lib/trustware/balances";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import { isSupportedAddress, trustwareBalances } from "@/lib/trustware/server";
import {
  isAddressIncompatible,
  type TrustwareBalancesResponse,
} from "@/lib/trustware/types";
import { selectNativeHoldings, type NativeHolding } from "@/lib/trustware/native";
import { selectStableHoldings, type StableHolding } from "@/lib/trustware/stables";
import {
  selectOndoHoldings,
  type OndoWalletHolding,
} from "@/lib/trustware/ondo-holdings";
import {
  selectGoldHoldings,
  type GoldHolding,
} from "@/lib/trustware/gold-holdings";

export const dynamic = "force-dynamic";

const EMPTY: EquivalentBalances = { held: [], unreadableChains: [] };

// The scan already covers every chain, so the native balances come back in the
// same response the equivalents are selected from. Returning them here avoids a
// second round trip for the wallet panel.
//
// Stables ride along for the same reason. Lighter margin is USDC only, so the
// hedge surface has to know where the user's USDC already sits before it can
// offer to move any of it.
//
// Ondo collateral rides along too. Those are the tokens a Perps withdrawal
// leaves in the user's Ethereum wallet, and they cannot come back through the
// equivalents selector: that one resolves against a registry keyed to Jupiter
// Lend borrow vaults, and most Ondo collateral has no such vault. Without this
// a completed withdrawal is real on chain and shown nowhere.
//
// Gold rides along for the same reason, and deliberately overlaps with `ondo`:
// GLDon on Ethereum is both a token a withdrawal left behind and gold that can
// collateralise a Morpho position. Consumers pick the list that answers their
// question, so a wallet total must read `ondo` and a funding picker `gold`, or
// the holding is counted twice.
interface ScanResult {
  equivalents: EquivalentBalances;
  native: NativeHolding[];
  stables: StableHolding[];
  ondo: OndoWalletHolding[];
  gold: GoldHolding[];
}

// Which registry equivalents the user actually holds, across every chain
// Trustware can see. Read-only: this signs nothing and moves nothing, and the
// API key is injected server-side so the browser never sees it.
//
// Takes both of the user's addresses because Trustware scans by address format:
// the EVM address covers Ethereum and BNB Chain, the Solana address covers
// Solana. Either may be omitted (a user with no embedded EVM wallet still has
// Solana-native Ondo holdings to convert).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const solana = params.get("solana")?.trim() || undefined;
  const evm = params.get("evm")?.trim() || undefined;

  if (!solana && !evm) {
    return NextResponse.json(
      { error: "at least one of solana or evm is required" },
      { status: 400 },
    );
  }
  for (const [label, address] of [
    ["solana", solana],
    ["evm", evm],
  ] as const) {
    if (address && !isSupportedAddress(address)) {
      return NextResponse.json(
        { error: `${label} address is malformed` },
        { status: 400 },
      );
    }
  }

  // Scan both addresses concurrently, and let one side fail without taking the
  // other's holdings with it. A failure is reported as an unreadable chain
  // rather than an empty wallet.
  const [solanaPart, evmPart] = await Promise.all([
    scan(solana, "solana-mainnet-beta"),
    scan(evm, "evm"),
  ]);

  const merged = mergeEquivalentBalances(
    solanaPart.equivalents,
    evmPart.equivalents,
  );
  return NextResponse.json({
    ...merged,
    native: [...solanaPart.native, ...evmPart.native],
    stables: [...solanaPart.stables, ...evmPart.stables],
    ondo: [...solanaPart.ondo, ...evmPart.ondo],
    gold: [...solanaPart.gold, ...evmPart.gold],
  });
}

// Every chain one of the selectors above reads. A failure on any other chain
// in Trustware's 129-chain sweep is noise; a failure on one of these is a
// hole in the wallet.
const WATCHED_CHAINS = new Set(["1", "56", "8453", TRUSTWARE_SOLANA_CHAIN]);

// Trustware reads Ethereum through Alchemy, and on 2026-09-22 two of eight
// scans answered chain 1 with "alchemy failed: indexer unavailable; fallback
// failed: context deadline exceeded" while the next scan was clean. One scan
// costs about 2.3 seconds, so a scan with a watched chain missing is asked
// again, twice at most, and the answer with the fewest holes is served.
const SCAN_RETRY_DELAYS_MS = [300, 900];

function watchedChainErrors(
  raw: TrustwareBalancesResponse,
): { chain: string; error: string }[] {
  const out: { chain: string; error: string }[] = [];
  for (const result of raw.results ?? []) {
    const chain = result.chain_id;
    if (!chain || !WATCHED_CHAINS.has(chain)) continue;
    if (result.error && !isAddressIncompatible(result.error)) {
      out.push({ chain, error: result.error });
    }
  }
  return out;
}

function select(raw: TrustwareBalancesResponse): ScanResult {
  const equivalents = selectHeldEquivalents(raw);
  // The equivalents selector reports only the registry chains it reads. The
  // native and stable rows come from Base too, so a failed Base read has to be
  // named here or the wallet hook cannot tell "no ETH on Base" from "could not
  // look".
  const named = new Set(equivalents.unreadableChains.map((u) => u.chain));
  for (const failed of watchedChainErrors(raw)) {
    if (!named.has(failed.chain)) {
      equivalents.unreadableChains.push(failed);
      named.add(failed.chain);
    }
  }
  return {
    equivalents,
    native: selectNativeHoldings(raw),
    stables: selectStableHoldings(raw),
    ondo: selectOndoHoldings(raw),
    gold: selectGoldHoldings(raw),
  };
}

async function scan(
  address: string | undefined,
  label: string,
): Promise<ScanResult> {
  if (!address) {
    return { equivalents: EMPTY, native: [], stables: [], ondo: [], gold: [] };
  }
  let best: ScanResult | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= SCAN_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, SCAN_RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const result = select(await trustwareBalances(address));
      const holes = result.equivalents.unreadableChains.length;
      if (holes === 0) return result;
      if (!best || holes < best.equivalents.unreadableChains.length) best = result;
    } catch (err) {
      lastErr = err;
    }
  }
  if (best) return best;
  {
    const err = lastErr;
    return {
      equivalents: {
        held: [],
        unreadableChains: [
          { chain: label, error: err instanceof Error ? err.message : String(err) },
        ],
      },
      native: [],
      stables: [],
      ondo: [],
      gold: [],
    };
  }
}
