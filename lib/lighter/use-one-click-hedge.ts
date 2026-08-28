"use client";

// The one-click hedge, wired to the wallets the app already holds.
//
// The panel's job is to render a decision; this hook's job is to turn that
// decision into signatures. It exists mainly so runOneClickHedge stays a pure
// orchestrator that a script can drive, and so the two Privy wallets are
// resolved in exactly one place.
//
// Two wallets are involved and they do different work. The Solana wallet signs
// the borrow and the transfer, which is where all the money moves. The EVM
// wallet only ever produces a personal_sign for Lighter's trading key: no gas,
// no chain switch, no transaction. Anything that made the EVM wallet sign a
// transaction would need gas the embedded wallet is born without, which is the
// reason every funding road in borrow-funding.ts is shaped to avoid it.

import { useCallback, useMemo, useState } from "react";

import { borrowRouteFor } from "@/lib/borrow/route";
import { XSTOCK_BORROW_VAULTS } from "@/lib/jupiter/borrow";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import { useEmbeddedSolanaWallet } from "@/lib/privy/solana";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";

import { chooseFundingRoute } from "./borrow-funding";
import {
  defaultBorrowRatioFor,
  planBorrowHedge,
  type BorrowHedgePlan,
} from "./borrow-hedge";
import type { HedgeRoute } from "./hedge";
import {
  runFundAndHedge,
  runOneClickHedge,
  type OneClickOutcome,
  type OneClickProgress,
} from "./one-click";
import type { LighterMarket } from "./types";

export type OneClickState =
  | { kind: "idle" }
  | { kind: "running"; progress: OneClickProgress }
  | { kind: "done"; outcome: OneClickOutcome };

export interface UseOneClickHedge {
  // The plan for this holding, or null when nothing lends against it. Null is
  // the common case rather than an error: only four xStocks currently have a
  // Jupiter Lend vault, which is the one venue the executor is wired to.
  plan: BorrowHedgePlan | null;
  // Set when an earlier run borrowed and stalled: collateral is in the vault,
  // the borrowed USDC is in the wallet, and the way out is the remaining legs,
  // never a second borrow. Sized on the total exposure.
  resumePlan: BorrowHedgePlan | null;
  state: OneClickState;
  // False while a wallet is still provisioning, or when there is nothing to run.
  ready: boolean;
  resumeReady: boolean;
  run: () => Promise<void>;
  // Fund the margin from the wallet's USDC and open the short. No borrow.
  resume: () => Promise<void>;
  reset: () => void;
}

// Runs in flight, keyed by wallet:mint. Module level deliberately: the row
// that started a run can unmount and remount while the promise keeps working,
// and a fresh hook instance must still know the run exists. Without this, the
// resume button could race an invisible original and fund the margin twice.
const RUNS_IN_FLIGHT = new Set<string>();

export function useOneClickHedge(params: {
  xstockSymbol: string;
  mint: string;
  // Wallet stock only: what a NEW borrow can post as collateral.
  quantity: string;
  // Wallet plus vault collateral: the exposure a resumed short must offset.
  // When it exceeds `quantity`, an earlier run has already posted collateral,
  // and the remaining work is funding margin and shorting, not borrowing.
  totalQuantity?: string;
  tokenPriceUsd: number;
  market: LighterMarket | null;
  hedgeRoute: HedgeRoute;
  depositAddress: string | undefined;
  // Existing Jupiter borrow position on this vault, or 0 to open one.
  positionId?: number;
  borrowRatio?: number;
  onSettled?: () => void;
  // Fired once, the moment the borrow has landed and the run moves on. The
  // panel uses it to make the new vault collateral visible synchronously, so
  // the balance poll zeroing the wallet cannot unmount the row mid-run.
  onBorrowed?: () => void;
}): UseOneClickHedge {
  // Signs, broadcasts through sendAndConfirm, and resolves with a landed
  // signature. Never Privy's own signAndSendTransaction: that path simulates
  // upstream and reports failures as a bare "Transaction simulation failed"
  // with no logs, and it skips the rebroadcast behaviour every other Solana
  // transaction in this app gets from lib/solana/send-confirm.ts.
  const sendTxBase64 = useSendSolanaTxBase64();
  const { wallet: solanaWallet, address: solanaAddress } =
    useEmbeddedSolanaWallet();
  const evm = useEmbeddedEvmWallet();
  const [state, setState] = useState<OneClickState>({ kind: "idle" });

  const borrowRoute = useMemo(
    () => borrowRouteFor(params.mint),
    [params.mint],
  );

  // Only the Jupiter vaults can execute today. A Kamino-only asset still plans,
  // so the surface can say what the hedge would look like, but must not offer a
  // button that cannot run.
  const vault = useMemo(
    () => XSTOCK_BORROW_VAULTS.find((v) => v.collateralMint === params.mint),
    [params.mint],
  );

  const plan = useMemo<BorrowHedgePlan | null>(() => {
    // No plan without a Jupiter vault, even where Kamino would lend: the
    // executor is wired to one venue, and a plan the button cannot run is a
    // promise the surface cannot keep. Kamino assets join when the executor
    // does.
    if (!borrowRoute || !vault || !params.market) return null;
    const ratio = params.borrowRatio ?? defaultBorrowRatioFor(borrowRoute);
    // The road is chosen for the margin this ratio implies, not for the holding,
    // because minimums and the bridge auction both key off the transfer size.
    const road = chooseFundingRoute(
      { hasBuilderKey: false, trustwareChains: ["base", "arbitrum"] },
      params.tokenPriceUsd * Number(params.quantity) * ratio,
    );
    if (!road) return null;
    return planBorrowHedge({
      xstockSymbol: params.xstockSymbol,
      quantity: params.quantity,
      tokenPriceUsd: String(params.tokenPriceUsd),
      borrowRoute,
      hedgeRoute: params.hedgeRoute,
      market: params.market,
      funding: road,
      borrowRatio: ratio,
    });
  }, [
    borrowRoute,
    vault,
    params.market,
    params.borrowRatio,
    params.quantity,
    params.tokenPriceUsd,
    params.xstockSymbol,
    params.hedgeRoute,
  ]);

  const resumePlan = useMemo<BorrowHedgePlan | null>(() => {
    if (!borrowRoute || !vault || !params.market) return null;
    const total = params.totalQuantity ?? params.quantity;
    // Resume exists only when the vault holds collateral the wallet does not:
    // the signature of a run that borrowed and stopped.
    if (Number(total) <= Number(params.quantity)) return null;
    const ratio = params.borrowRatio ?? defaultBorrowRatioFor(borrowRoute);
    const road = chooseFundingRoute(
      { hasBuilderKey: false, trustwareChains: ["base", "arbitrum"] },
      params.tokenPriceUsd * Number(total) * ratio,
    );
    if (!road) return null;
    return planBorrowHedge({
      xstockSymbol: params.xstockSymbol,
      quantity: total,
      tokenPriceUsd: String(params.tokenPriceUsd),
      borrowRoute,
      hedgeRoute: params.hedgeRoute,
      market: params.market,
      funding: road,
      borrowRatio: ratio,
    });
  }, [
    borrowRoute,
    vault,
    params.market,
    params.borrowRatio,
    params.quantity,
    params.totalQuantity,
    params.tokenPriceUsd,
    params.xstockSymbol,
    params.hedgeRoute,
  ]);

  const ready = Boolean(
    plan?.kind === "ok" &&
      vault &&
      solanaAddress &&
      solanaWallet &&
      evm.address &&
      params.depositAddress,
  );

  const run = useCallback(async () => {
    if (!ready || plan?.kind !== "ok" || !vault || !solanaWallet) return;
    const runKey = `${solanaAddress}:${params.mint}`;
    if (RUNS_IN_FLIGHT.has(runKey)) return;
    RUNS_IN_FLIGHT.add(runKey);

    setState({
      kind: "running",
      progress: { step: "borrowing", message: "Preparing." },
    });
    try {
      const provider = await evm.getProvider();
      const road = chooseFundingRoute(
        { hasBuilderKey: false, trustwareChains: ["base", "arbitrum"] },
        plan.marginUsd,
      );
      if (!road) {
        setState({
          kind: "done",
          outcome: {
            kind: "blocked",
            message: "No funding road is available for this amount.",
          },
        });
        return;
      }

      const outcome = await runOneClickHedge({
        plan,
        market: params.market as LighterMarket,
        route: road,
        vault,
        positionId: params.positionId ?? 0,
        collateralAmount: params.quantity,
        solana: {
          address: solanaAddress as string,
          signAndSendBase64: (base64Tx) => sendTxBase64(base64Tx),
          signAndSendBytes: (tx) => sendTxBase64(bytesToBase64(tx)),
        },
        evmProvider: provider,
        l1Address: evm.address as string,
        // The Solana intent address the panel already fetched: the terminal
        // fallback every run must be able to pay. Bridge addresses are fetched
        // per chain at pay time, because the Base intent address is not the
        // Arbitrum one and only the orchestrator knows which road won.
        solanaDepositAddress: params.depositAddress as string,
        fetchBridgeDepositAddress: (chain) =>
          fetchIntentAddress(evm.address as string, chain),
        onBorrowed: params.onBorrowed,
        onProgress: (progress) => setState({ kind: "running", progress }),
      });

      setState({ kind: "done", outcome });
    } catch (err) {
      // Anything reaching here threw before or between the orchestrator's own
      // guards, so nothing is known to have moved. Reported as blocked rather
      // than as a partial state, which would misrepresent what exists.
      setState({
        kind: "done",
        outcome: {
          kind: "blocked",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      RUNS_IN_FLIGHT.delete(runKey);
      params.onSettled?.();
    }
  }, [
    ready,
    plan,
    vault,
    solanaWallet,
    solanaAddress,
    evm,
    sendTxBase64,
    params,
  ]);

  const resumeReady = Boolean(
    resumePlan?.kind === "ok" &&
      solanaAddress &&
      solanaWallet &&
      evm.address &&
      params.depositAddress,
  );

  const resume = useCallback(async () => {
    if (!resumeReady || resumePlan?.kind !== "ok" || !solanaWallet) return;
    const runKey = `${solanaAddress}:${params.mint}`;
    if (RUNS_IN_FLIGHT.has(runKey)) return;
    RUNS_IN_FLIGHT.add(runKey);

    setState({
      kind: "running",
      progress: { step: "funding", message: "Preparing." },
    });

    try {
      const provider = await evm.getProvider();
      const road = chooseFundingRoute(
        { hasBuilderKey: false, trustwareChains: ["base", "arbitrum"] },
        resumePlan.marginUsd,
      );
      if (!road) {
        setState({
          kind: "done",
          outcome: {
            kind: "blocked",
            message: "No funding road is available for this amount.",
          },
        });
        return;
      }
      const outcome = await runFundAndHedge({
        plan: resumePlan,
        market: params.market as LighterMarket,
        route: road,
        hedgeQuantity: params.totalQuantity ?? params.quantity,
        solana: {
          address: solanaAddress as string,
          signAndSendBase64: (base64Tx) => sendTxBase64(base64Tx),
          signAndSendBytes: (tx) => sendTxBase64(bytesToBase64(tx)),
        },
        evmProvider: provider,
        l1Address: evm.address as string,
        solanaDepositAddress: params.depositAddress as string,
        fetchBridgeDepositAddress: (chain) =>
          fetchIntentAddress(evm.address as string, chain),
        onProgress: (progress) => setState({ kind: "running", progress }),
      });
      setState({ kind: "done", outcome });
    } catch (err) {
      setState({
        kind: "done",
        outcome: {
          kind: "blocked",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      RUNS_IN_FLIGHT.delete(runKey);
      params.onSettled?.();
    }
  }, [
    resumeReady,
    resumePlan,
    solanaWallet,
    solanaAddress,
    evm,
    sendTxBase64,
    params,
  ]);

  return {
    plan,
    resumePlan,
    state,
    ready,
    resumeReady,
    run,
    resume,
    reset: useCallback(() => setState({ kind: "idle" }), []),
  };
}

// btoa over a binary string rather than Buffer, matching lib/privy/sign.ts:
// this file ships to the browser, where Buffer exists only if a polyfill
// happens to be loaded.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// The deposit address for one chain, from our own account route, which gets it
// from Lighter. Never cached across calls: it is derived from the L1 address so
// it is stable, but a fetch per run is cheap and a stale closure over a payout
// address is not a risk worth taking for it.
async function fetchIntentAddress(
  l1Address: string,
  intentChain: string,
): Promise<string> {
  const res = await fetch(
    `/api/lighter/account?l1Address=${l1Address}&intentChain=${intentChain}`,
  );
  if (!res.ok) {
    throw new Error(`Could not fetch the ${intentChain} deposit address.`);
  }
  const body = (await res.json()) as { depositAddress?: string };
  if (!body.depositAddress) {
    throw new Error(`Lighter returned no ${intentChain} deposit address.`);
  }
  return body.depositAddress;
}
