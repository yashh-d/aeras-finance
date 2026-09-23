"use client";

// The step between a click and a signature when the wallet cannot pay for
// the transaction. Three things a user can do about it and nothing else:
// cancel, use a little of what they are already moving, or add gas from
// outside.
//
// Opens only when the wallet is actually short. It replaced
// FirstPositionSheet, which opened on every first position to explain
// Solana rent, for a cost of a few dollars that nobody wanted a dialog
// about. The rent items are still priced and still recorded in the setup
// log; here they sit behind a Details toggle.
//
// Both in-app routes go out gaslessly through Jupiter Ultra, so they work
// from a wallet holding no SOL at all, which is exactly the wallet reading
// this. See lib/borrow/fund-setup.ts for what that rests on.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useFundWallet } from "@privy-io/react-auth/solana";

import { BORROW_PILL_CLASS } from "@/components/BorrowMarketDetail";
import {
  formatSol,
  formatSolUsd,
  lamportsToSol,
  type SetupCost,
} from "@/lib/borrow/setup-cost";
import {
  awaitLamports,
  executeSetupFunding,
  quoteSetupFunding,
  sourceCanCover,
  usdNeededFor,
  type FundingSource,
  type SetupFundingPlan,
} from "@/lib/borrow/fund-setup";
import { getConnection } from "@/lib/solana/balances";

type Phase =
  | { kind: "idle" }
  | { kind: "quoting" }
  // The quote came back larger than the button promised, or not gasless, so
  // the user sees it before anything is signed.
  | { kind: "confirming"; plan: SetupFundingPlan }
  | { kind: "buying" }
  | { kind: "onramp" }
  | { kind: "awaiting" }
  | { kind: "settling" }
  | { kind: "error"; message: string };

// Which of Privy's funding methods the user actually used. Privy reports this
// on exit; null means they closed the flow before choosing one.
export type PrivyFundingMethod =
  | "moonpay"
  | "coinbase-onramp"
  | "external"
  | "manual"
  | null;

// How the shortfall got covered, carried out to the setup log.
export type SetupFunding =
  | { via: "usdc_swap"; usdc: number; signature: string }
  | { via: "collateral_sale"; usd: number; signature: string }
  | { via: "privy_funding"; method: PrivyFundingMethod };

// The asset the transaction is moving, when the wallet holds any of it and it
// can be sold. Omit it and only USDC and the funding flow are offered.
export interface GasSheetAsset {
  symbol: string;
  mint: string;
  decimals: number;
  balanceUi: number;
  priceUsd: number | null;
}

export function GasSheet({
  cost,
  walletAddress,
  walletUsdc,
  asset,
  solPriceUsd,
  signTxBase64,
  onFunded,
  onCancel,
}: {
  cost: SetupCost;
  walletAddress: string;
  walletUsdc: number;
  asset?: GasSheetAsset;
  solPriceUsd: number | null;
  signTxBase64: (base64Tx: string) => Promise<string>;
  // The shortfall is covered. The caller re-prices and continues.
  onFunded: (funding: SetupFunding) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [showDetails, setShowDetails] = useState(false);
  const fundingMethodRef = useRef<PrivyFundingMethod>(null);
  const { fundWallet } = useFundWallet({
    onUserExited: ({ fundingMethod }) => {
      fundingMethodRef.current = (fundingMethod ?? null) as PrivyFundingMethod;
    },
  });
  const busy =
    phase.kind === "quoting" ||
    phase.kind === "buying" ||
    phase.kind === "onramp" ||
    phase.kind === "awaiting" ||
    phase.kind === "settling";
  // Waiting for money has nothing in flight; everything else that is busy has
  // a signature out and must not be abandoned half-done.
  const cancellable = !busy || phase.kind === "awaiting";

  const waitAbortRef = useRef<AbortController | null>(null);
  const stopWaiting = useCallback(() => {
    waitAbortRef.current?.abort();
    waitAbortRef.current = null;
  }, []);

  // One in-app source, chosen before the user clicks. USDC where it covers
  // the gap, because spending idle dollars leaves the position alone; else
  // the asset being moved. Never a button that fails into "go find an asset".
  const usdcSource: FundingSource = { kind: "usdc", balanceUi: walletUsdc };
  const assetSource: FundingSource | null =
    asset && asset.priceUsd != null && asset.priceUsd > 0
      ? {
          kind: "collateral",
          symbol: asset.symbol,
          mint: asset.mint,
          decimals: asset.decimals,
          balanceUi: asset.balanceUi,
          priceUsd: asset.priceUsd,
        }
      : null;
  const source: FundingSource | null = sourceCanCover(
    cost.shortfallLamports,
    solPriceUsd,
    usdcSource,
  )
    ? usdcSource
    : assetSource && sourceCanCover(cost.shortfallLamports, solPriceUsd, assetSource)
      ? assetSource
      : null;
  const usdNeeded = usdNeededFor(cost.shortfallLamports, solPriceUsd);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && cancellable) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancellable, onCancel]);

  useEffect(() => stopWaiting, [stopWaiting]);

  const confirmFunding = useCallback(
    async (plan: SetupFundingPlan) => {
      setPhase({ kind: "buying" });
      try {
        const signature = await executeSetupFunding({ plan, signTxBase64 });
        setPhase({ kind: "settling" });
        await onFunded(
          plan.sourceKind === "usdc"
            ? { via: "usdc_swap", usdc: plan.sourceUi, signature }
            : { via: "collateral_sale", usd: plan.sourceUsd, signature },
        );
      } catch (err) {
        setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [signTxBase64, onFunded],
  );

  // Quote, and sign at once when the quote is what the button said. Stop to
  // show it when Jupiter raised the size to its gasless minimum (selling
  // several times what the transaction costs is not a thing to slip past
  // someone) or when the swap would not be gasless after all.
  const useAsset = useCallback(async () => {
    if (!source) return;
    setPhase({ kind: "quoting" });
    try {
      const plan = await quoteSetupFunding({
        walletAddress,
        shortfallLamports: cost.shortfallLamports,
        solPriceUsd,
        source,
      });
      if (plan.raisedForGasless || !plan.gasless) {
        setPhase({ kind: "confirming", plan });
        return;
      }
      await confirmFunding(plan);
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [source, walletAddress, cost.shortfallLamports, solPriceUsd, confirmFunding]);

  // Privy's hosted funding flow, buying SOL directly. defaultFundingMethod is
  // deliberately not pinned: pinning it to a card hid the three free routes.
  const addGas = useCallback(async () => {
    setPhase({ kind: "onramp" });
    fundingMethodRef.current = null;
    try {
      await fundWallet({
        address: walletAddress,
        options: {
          asset: "native-currency",
          amount: lamportsToSol(cost.shortfallLamports).toFixed(6),
          card: { preferredProvider: "moonpay" },
        },
      });
      // Closed without choosing a method: nothing is coming.
      if (fundingMethodRef.current == null) {
        setPhase({ kind: "idle" });
        return;
      }
      const abort = new AbortController();
      waitAbortRef.current = abort;
      setPhase({ kind: "awaiting" });
      const landed = await awaitLamports({
        connection: getConnection(),
        walletAddress,
        atLeast: cost.totalLamports,
        timeoutMs: 120_000,
        signal: abort.signal,
      });
      waitAbortRef.current = null;
      if (abort.signal.aborted) return;
      if (landed < cost.totalLamports) {
        setPhase({
          kind: "error",
          message:
            "The SOL has not arrived yet. Card purchases and transfers can take a few minutes. Try again once it lands.",
        });
        return;
      }
      await onFunded({ via: "privy_funding", method: fundingMethodRef.current });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [fundWallet, walletAddress, cost.shortfallLamports, cost.totalLamports, onFunded]);

  // Portals have no server output; render nothing until hydrated.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!hydrated) return null;

  const needUsd = usdNeeded != null ? `$${usdNeeded.toFixed(2)}` : `${formatSol(cost.shortfallLamports)} SOL`;
  const haveUsd =
    solPriceUsd != null
      ? `$${(lamportsToSol(cost.haveLamports) * solPriceUsd).toFixed(2)}`
      : `${formatSol(cost.haveLamports)} SOL`;
  const sourceLabel =
    source == null
      ? null
      : source.kind === "usdc"
        ? `Use ${needUsd} of your USDC`
        : `Use ${needUsd} of your ${source.symbol}`;

  const busyLabel =
    phase.kind === "quoting"
      ? "Pricing…"
      : phase.kind === "buying"
        ? "Getting SOL…"
        : phase.kind === "onramp"
          ? "Funding window open…"
          : phase.kind === "awaiting"
            ? "Waiting for SOL…"
            : phase.kind === "settling"
              ? "Continuing…"
              : null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 supports-backdrop-filter:backdrop-blur-xs"
        onClick={() => cancellable && onCancel()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Network fee"
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#111415] p-6 text-white shadow-2xl"
      >
        <h2 className="font-light text-lg tracking-tight">Not enough SOL for the network fee</h2>
        <p className="mt-1.5 text-sm text-white/50">
          This needs about {needUsd} of SOL. The wallet holds {haveUsd}.
        </p>

        {cost.items.length > 0 && (
          <div className="mt-3 text-[11px]">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="text-white/40 hover:text-white/70"
            >
              {showDetails ? "Hide details" : "Details"}
            </button>
            {showDetails && (
              <div className="mt-2 space-y-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                {cost.items.map((item) => (
                  <div key={item.label} className="flex justify-between gap-4">
                    <span className="text-white/50">{item.label}</span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {formatSolUsd(item.lamports, solPriceUsd)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between gap-4">
                  <span className="text-white/50">Network fees</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {formatSolUsd(cost.feeLamports, solPriceUsd)}
                  </span>
                </div>
                <p className="pt-1 text-white/40">
                  {cost.venueLabel} keeps its own accounts on Solana for your
                  position. Solana holds this inside them; nobody collects it,
                  and later positions here reuse them.
                </p>
              </div>
            )}
          </div>
        )}

        {phase.kind === "confirming" && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-white/50">Selling</span>
              <span className="shrink-0 font-mono tabular-nums">
                {phase.plan.sourceKind === "usdc"
                  ? `${phase.plan.sourceUi.toFixed(2)} USDC`
                  : `${phase.plan.sourceUi.toFixed(4)} ${phase.plan.sourceSymbol} · $${phase.plan.sourceUsd.toFixed(2)}`}
              </span>
            </div>
            <div className="mt-1.5 flex justify-between gap-4">
              <span className="text-white/50">You receive</span>
              <span className="shrink-0 font-mono tabular-nums">
                {formatSol(phase.plan.expectedLamports)} SOL
              </span>
            </div>
            {phase.plan.raisedForGasless && (
              <p className="mt-2 text-white/70">
                Jupiter will not cover the fee on a swap as small as this needs,
                so this is the smallest it will do. The extra SOL stays in your
                wallet.
              </p>
            )}
            {!phase.plan.gasless && (
              <p className="mt-2 text-aeras-negative">
                Jupiter is charging fees on this swap, so it cannot go through
                from an empty wallet. Add SOL instead.
              </p>
            )}
          </div>
        )}

        {phase.kind === "error" && (
          <p className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
            {phase.message}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {phase.kind === "confirming" ? (
            <button
              type="button"
              onClick={() => confirmFunding(phase.plan)}
              disabled={!phase.plan.gasless}
              className={BORROW_PILL_CLASS}
            >
              Sell {phase.plan.sourceKind === "usdc" ? `$${phase.plan.sourceUi.toFixed(2)} of USDC` : `$${phase.plan.sourceUsd.toFixed(2)} of ${phase.plan.sourceSymbol}`}
            </button>
          ) : sourceLabel ? (
            <button
              type="button"
              onClick={useAsset}
              disabled={busy}
              className={BORROW_PILL_CLASS}
            >
              {busyLabel ?? sourceLabel}
            </button>
          ) : null}

          <button
            type="button"
            onClick={addGas}
            disabled={busy}
            className={
              sourceLabel || phase.kind === "confirming"
                ? "aeras-press w-full rounded-full border border-white/10 px-4 py-2.5 text-sm font-medium text-white/60 hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                : BORROW_PILL_CLASS
            }
          >
            {!sourceLabel && busyLabel ? busyLabel : "Add SOL"}
          </button>

          <button
            type="button"
            onClick={() => {
              if (phase.kind === "awaiting") {
                stopWaiting();
                setPhase({ kind: "idle" });
                return;
              }
              onCancel();
            }}
            disabled={!cancellable}
            className="aeras-press w-full rounded-full px-4 py-2 text-sm font-medium text-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase.kind === "awaiting" ? "Stop waiting" : "Cancel"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
