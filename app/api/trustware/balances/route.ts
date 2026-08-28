import { NextResponse } from "next/server";

import {
  mergeEquivalentBalances,
  selectHeldEquivalents,
  type EquivalentBalances,
} from "@/lib/trustware/balances";
import { isSupportedAddress, trustwareBalances } from "@/lib/trustware/server";
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

async function scan(
  address: string | undefined,
  label: string,
): Promise<ScanResult> {
  if (!address) {
    return { equivalents: EMPTY, native: [], stables: [], ondo: [], gold: [] };
  }
  try {
    const raw = await trustwareBalances(address);
    return {
      equivalents: selectHeldEquivalents(raw),
      native: selectNativeHoldings(raw),
      stables: selectStableHoldings(raw),
      ondo: selectOndoHoldings(raw),
      gold: selectGoldHoldings(raw),
    };
  } catch (err) {
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
