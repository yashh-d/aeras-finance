"use client";

// Posting margin to Lighter from inside the app.
//
// This replaces the copy-this-address instruction the panel used to show, and
// then the move-it-to-Solana-yourself instruction that replaced it. Neither was
// something the user should have to do: the wallets are connected, Lighter's
// address is known, and Trustware routes between them. The card offers every
// USDC balance the user holds and the app takes it from there.
//
// The wallets are resolved here rather than passed in. Both are the same ones
// the rest of the app signs with, and threading their addresses through the
// panel would only give a caller the chance to pass a different one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchLighterAccountState } from "./client";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import { useEmbeddedSolanaWallet } from "@/lib/privy/solana";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { USDC_MINT } from "@/lib/jupiter/constants";

import type { AccountBalances } from "@/lib/solana/balances";
import type { ConversionProgress } from "@/lib/trustware/execute";
import { nativeUiAmount } from "@/lib/trustware/native";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";

import { fundLighterMargin, MarginFundError } from "./margin-fund";
import {
  bestMarginSource,
  marginBlock,
  resolveMarginSources,
  totalMarginableUsd,
  type MarginBlock,
  type MarginSource,
} from "./margin-sources";

export type DepositStatus =
  | { kind: "idle" }
  | { kind: "sending"; progress?: ConversionProgress }
  // The source leg landed. Lighter credits the L2 balance separately, which is
  // why this is not called "done": the margin has not appeared yet.
  //
  // Carries the collateral reading from just before the deposit and the amount
  // sent, because those two are what the credit poll below compares against.
  // Held on the status rather than in a ref so the poll is a pure function of
  // it and cannot read a baseline belonging to an earlier deposit.
  | {
      kind: "sent";
      sourceTx: string;
      source: MarginSource;
      baselineUsd: number;
      amountUsd: number;
    }
  // `signed` distinguishes a failure that cost nothing from one where a
  // transaction is already in flight. The card must not invite a retry on the
  // second kind: the same margin could be paid twice.
  | { kind: "error"; message: string; signed: boolean };

// Whether the deposit has shown up on Lighter yet.
//
// Separate from DepositStatus because it describes a different actor. The
// status is about our transaction; this is about Lighter's ledger, and the two
// resolve minutes apart. Collapsing them would mean either calling the send
// "done" while the margin is still missing, or leaving it "sending" long after
// the user's part is finished.
export type CreditState =
  | { kind: "idle" }
  | { kind: "waiting" }
  // Lighter's collateral rose past the threshold. `amountUsd` is the observed
  // increase, which is the delivered figure after bridge costs rather than what
  // was sent.
  | { kind: "credited"; amountUsd: number }
  // Stopped looking. NOT a failed deposit: bridges and sequencers run late, and
  // the money is not lost because we gave up watching. The copy has to say so.
  | { kind: "timeout" };

// Past the 8s server snapshot TTL and the 4s client one, so every poll is a
// genuine upstream read rather than the same cached body returned faster.
const CREDIT_POLL_MS = 12_000;

// How long to keep watching, as a multiple of the road's own upper estimate.
// Three times gives a bridge that is running late room to land while still
// ending, and the cap keeps the slowest road (CCTP, 20 minutes) from holding a
// poll open for an hour.
const CREDIT_TIMEOUT_MULTIPLE = 3;
const CREDIT_TIMEOUT_CAP_MS = 30 * 60_000;

// A credit is only believed once collateral rises by at least half of what was
// sent. Funding payments and realized fills move collateral by cents while a
// deposit is in flight, and a bare "greater than baseline" test reads one of
// those as the deposit landing and tells the user their margin is there when it
// is not. Half is comfortably below the delivered amount: the worst measured
// road gives up 63 bps, not 50 percent.
const CREDIT_CONFIRM_FRACTION = 0.5;

export interface UseMarginFunding {
  sources: MarginSource[];
  selected: MarginSource | undefined;
  select: (id: string) => void;
  block: MarginBlock;
  status: DepositStatus;
  // Whether Lighter has credited the deposit yet. Driven by a poll that starts
  // when the source leg lands.
  credit: CreditState;
  // Every USDC balance the user holds, counted once per wallet.
  totalUsd: number;
  // Spendable on the currently selected road.
  availableUsd: number;
  minimumUsd: number;
  ready: boolean;
  deposit: (amountUsdc: string) => Promise<void>;
  reset: () => void;
}

// Native balance below which an EVM source cannot be signed. Deliberately crude:
// this is a gate on "can the wallet pay for an approve and a bridge at all",
// not a gas estimate. Ethereum mainnet at 0.0004 ETH is already marginal, and
// the route itself reports the real cost at signing time.
const MIN_GAS_NATIVE: Record<string, number> = {
  "1": 0.0004,
  "8453": 0.00002,
};

export function useMarginFunding(params: {
  balances: AccountBalances | null;
  scan: WalletScan;
  // Kept for the callers that already pass it. The Solana intent address is
  // fetched inside margin-fund.ts now, per chain and per road, so this is no
  // longer what the deposit is addressed to.
  depositAddress?: string | undefined;
  // Fired once Lighter's collateral actually rises. The caller refreshes its
  // own account read from here, which is what puts the margin on screen.
  onCredited?: () => void;
}): UseMarginFunding {
  const { balances, scan } = params;

  const sendTxBase64 = useSendSolanaTxBase64();
  const { address: solanaAddress } = useEmbeddedSolanaWallet();
  const evm = useEmbeddedEvmWallet();
  const [status, setStatus] = useState<DepositStatus>({ kind: "idle" });
  const [credit, setCredit] = useState<CreditState>({ kind: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Held in a ref so a caller passing an inline arrow does not re-run the poll
  // effect on every render, which would restart the deposit watch from zero
  // each time the parent re-rendered and mean it never reached its deadline.
  const onCreditedRef = useRef(params.onCredited);
  useEffect(() => {
    onCreditedRef.current = params.onCredited;
  });

  const sources = useMemo(
    () =>
      resolveMarginSources({
        // Atomic, not the float field: a rounded-up balance sizes a transfer the
        // wallet cannot cover and the whole deposit fails on chain.
        solanaUsdcAtomic: balances?.usdcAtomic ?? "0",
        solanaUsdcMint: USDC_MINT,
        stables: scan.stables,
      }),
    [balances, scan.stables],
  );

  // Which EVM chains the wallet can actually sign on. An EVM road offered
  // without gas is a dead end the user only discovers after choosing it.
  const gasReadyChains = useMemo(() => {
    const ready = new Set<string>();
    for (const holding of scan.native) {
      const floor = MIN_GAS_NATIVE[holding.chain];
      if (floor != null && nativeUiAmount(holding) >= floor) {
        ready.add(holding.chain);
      }
    }
    return ready;
  }, [scan.native]);

  const selected = useMemo(() => {
    if (selectedId) {
      const hit = sources.find((s) => s.id === selectedId);
      if (hit) return hit;
    }
    // Default to the cheapest road the wallet can actually sign on, not simply
    // the cheapest road. Ranking already puts Solana first; this skips an EVM
    // source the wallet has no gas for rather than defaulting onto it.
    return (
      sources.find(
        (s) =>
          s.usable &&
          (s.signing === "solana-only" || gasReadyChains.has(s.chain)),
      ) ?? sources[0]
    );
  }, [selectedId, sources, gasReadyChains]);

  const deposit = useCallback(
    async (amountUsdc: string) => {
      const l1Address = evm.address;
      if (!l1Address) {
        setStatus({
          kind: "error",
          message: "Your Lighter account wallet is still being set up.",
          signed: false,
        });
        return;
      }
      // Size can change which road is cheapest, and the chosen one may not be
      // able to carry this amount. Re-pick within the user's chosen wallet.
      const source =
        selected && amountUsdc && Number(amountUsdc) <= selected.amountUsd
          ? selected
          : bestMarginSource(sources, Number(amountUsdc));
      if (!source) {
        setStatus({
          kind: "error",
          message: "No wallet holds enough USDC to fund this deposit.",
          signed: false,
        });
        return;
      }

      // What Lighter says the account holds BEFORE anything moves. The credit
      // poll needs a floor to compare against, and reading it afterwards would
      // race the very deposit it is trying to detect. A read failure is not
      // fatal: zero is the safe floor, because it can only make the poll wait
      // for a larger rise, never declare a credit that did not happen.
      const before = await fetchLighterAccountState(l1Address).catch(() => null);
      const baselineUsd = Number(before?.detail?.collateralUsd ?? "0");

      setStatus({ kind: "sending" });
      setCredit({ kind: "idle" });
      try {
        const result = await fundLighterMargin({
          source,
          amountUsdc,
          solanaAddress,
          signAndSendSolana: (tx) =>
            typeof tx === "string"
              ? sendTxBase64(tx)
              : sendTxBase64(bytesToBase64(tx)),
          // Narrowed to the EvmSigner shape: `l1Address` is this same wallet's
          // address, already checked non-null above, so the cast is the check.
          evm:
            source.signing === "evm-approve-and-send"
              ? { ...evm, address: l1Address }
              : undefined,
          l1Address,
          onProgress: (progress) => setStatus({ kind: "sending", progress }),
        });
        setStatus({
          kind: "sent",
          sourceTx: result.sourceTx,
          source,
          baselineUsd,
          amountUsd: Number(amountUsdc),
        });
        // Set here rather than in the poll effect below. The source leg landing
        // IS the moment the wait starts, and doing it in the effect body is a
        // synchronous setState during render commit, which cascades a second
        // render for a value already known here.
        setCredit({ kind: "waiting" });
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
          signed: err instanceof MarginFundError ? err.signed : true,
        });
      }
    },
    [selected, sources, solanaAddress, evm, sendTxBase64],
  );

  // Watch Lighter until the deposit shows up.
  //
  // This is the whole reason a deposit used to feel slower than it was. The
  // source leg lands in seconds, the bridge and Lighter's sequencer take
  // minutes, and nothing here ever looked again: the account state loads once
  // on mount and has no interval, so a deposit that credited at two minutes
  // stayed invisible until the user happened to press Refresh. The wait was
  // real, but the tail of it was ours.
  //
  // Depends on `status` alone, whose "sent" object is set exactly once per
  // deposit, so the poll starts once and is torn down when the status moves on.
  const l1Address = evm.address;
  useEffect(() => {
    if (status.kind !== "sent" || !l1Address) return;

    let cancelled = false;
    const threshold =
      status.baselineUsd + status.amountUsd * CREDIT_CONFIRM_FRACTION;
    const deadline =
      Date.now() +
      Math.min(
        status.source.etaMinutes * CREDIT_TIMEOUT_MULTIPLE * 60_000,
        CREDIT_TIMEOUT_CAP_MS,
      );

    void (async () => {
      while (!cancelled && Date.now() < deadline) {
        await sleep(CREDIT_POLL_MS);
        if (cancelled) return;
        try {
          const state = await fetchLighterAccountState(l1Address);
          const collateral = Number(state.detail?.collateralUsd ?? "0");
          if (collateral >= threshold) {
            if (cancelled) return;
            setCredit({
              kind: "credited",
              amountUsd: collateral - status.baselineUsd,
            });
            onCreditedRef.current?.();
            return;
          }
        } catch {
          // A read that failed is not a deposit that failed. Keep polling: the
          // alternative is telling someone their money is missing because one
          // request timed out.
        }
      }
      if (!cancelled) setCredit({ kind: "timeout" });
    })();

    return () => {
      cancelled = true;
    };
  }, [status, l1Address]);

  return {
    sources,
    selected,
    select: useCallback((id: string) => setSelectedId(id), []),
    block: useMemo(
      () => marginBlock(sources, gasReadyChains),
      [sources, gasReadyChains],
    ),
    status,
    credit,
    totalUsd: useMemo(() => totalMarginableUsd(sources), [sources]),
    availableUsd: selected?.amountUsd ?? 0,
    minimumUsd: selected?.minimumUsd ?? 0,
    ready: Boolean(evm.address && sources.length > 0),
    deposit,
    reset: useCallback(() => {
      setStatus({ kind: "idle" });
      setCredit({ kind: "idle" });
    }, []),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
