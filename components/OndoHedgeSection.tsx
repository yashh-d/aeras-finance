"use client";

// The Ondo venue on the hedge surface.
//
// A sibling of the Lighter body in HedgePanel rather than a generalisation of
// it. The two venues answer the same question with different mechanics, and
// flattening them into one component would mean hiding the differences that are
// the reason to offer both:
//
//   - **Margin can be the stock itself.** On Lighter a hedge is funded with
//     USDC. Here the holding being hedged can be posted as its own collateral,
//     credited at its mark less a haircut, so the row shows what it would
//     credit rather than asking the user to fund separately.
//   - **There is a second way a hedge ends.** A Lighter hedge is liquidated.
//     An Ondo hedge can also have its collateral auto-sold at 30% LTV or
//     $100,000 of debt. That is not liquidation, it does not close the
//     position, and for a self-collateralized hedge it fires first, so it is
//     the number shown.
//   - **A session is an explicit act.** Ondo needs a SIWE signature before any
//     account read works, so "not signed in" is a first-class state rather than
//     an error.
//
// Visual conventions are borrowed from the Lighter body deliberately: same
// near-black ground, same tabular figures, colour reserved for direction and
// state. The formatting helpers are local copies rather than imports so this
// file can be added without editing the panel it sits beside.

import { useState } from "react";

import { isOndoUnavailable, signInToOndo } from "@/lib/ondo/auth";
import {
  closeOndoHedge,
  fetchOndoAccount,
  openOndoHedge,
  type OndoAccountSnapshot,
} from "@/lib/ondo/client";
import type { OndoHedgeView } from "@/lib/ondo/exposure";
import type { UseOndoHedge } from "@/lib/ondo/use-ondo-hedge";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useEmbeddedSolanaWallet } from "@/lib/privy/solana";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import { uiToAtomic } from "@/lib/trustware/amounts";
import { runOneClickHedge } from "@/lib/ondo/one-click";
import { selfHedgeLiquidationMove } from "@/lib/ondo/risk";
import { collateralTicker } from "@/lib/tokens/market-logos";
import { ONDO_FUNDING_ENABLED } from "@/lib/ondo/fund";
import { AssetLogo } from "@/components/AssetLogo";
import { MarketLogo } from "@/components/MarketLogo";
import { assetIdentity } from "@/lib/jupiter/xstocks";

import { INSET_PANEL } from "@/lib/ui/surface";

const PANEL = INSET_PANEL;
const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.14em] text-white/35";

const RATIOS = [0.25, 0.5, 0.75, 1] as const;

// Backed issues every xStock at 8 decimals; the catalog type pins it too.
const XSTOCK_DECIMALS = 8;

type Status =
  | { kind: "idle" }
  | { kind: "working"; symbol: string }
  | { kind: "done"; symbol: string; orderId: string }
  | { kind: "error"; message: string };


// What the posted collateral is credited at.
//
// Not read from collateralHealth.nonUsdcMarginValueUsd: that derives non-USDC
// value as marginBalance - walletBalance - unrealizedPnl, which assumes
// walletBalance counts USDC only. On a collateral-only account Ondo's
// walletBalance already includes the collateral, so the subtraction returns
// zero and the panel reported $0.00 against $14.13 of real collateral.
//
// When every deposit is a non-USDC coin, the whole margin balance IS the
// collateral, so that is the honest figure. With USDC in the mix we cannot
// decompose it from the public API, and fall back to the derived value rather
// than assert a number we cannot support.
function creditedCollateralUsd(account: OndoAccountSnapshot): number {
  const deposits = account.deposits ?? [];
  const hasUsdc = deposits.some((d) => d.coin.toUpperCase() === "USDC");
  const hasNonUsdc = deposits.some((d) => d.coin.toUpperCase() !== "USDC");
  if (hasNonUsdc && !hasUsdc) return Number(account.balance.marginBalance);
  return account.collateralHealth.nonUsdcMarginValueUsd;
}

export function OndoHedgeSection({ hedge }: { hedge: UseOndoHedge }) {
  const wallet = useEmbeddedEvmWallet();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [signingIn, setSigningIn] = useState(false);
  // Ondo refusing to serve this account or location at all. Not a transient
  // error, so it replaces the sign-in offer rather than sitting above it.
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  // Set when a self-hedge is priced above the soft bound. Holding it here
  // rather than in the row keeps the confirm visible while the row re-renders
  // on every catalog poll.
  const [confirm, setConfirm] = useState<
    | { view: OndoHedgeView; ratio: number; lossBps: number; costUsd: number;
        inputValueUsd: number; deliveredValueUsd: number; reason: string;
        liquidationMove: number | null }
    | null
  >(null);
  const sendSolanaTx = useSendSolanaTxBase64();
  const { address: solanaAddress } = useEmbeddedSolanaWallet();

  async function onSignIn() {
    if (!wallet.address) return;
    setSigningIn(true);
    try {
      const provider = await wallet.getProvider();
      await signInToOndo(provider, wallet.address);
      await hedge.refresh();
      setStatus({ kind: "idle" });
    } catch (err) {
      // Held apart from the error status for the same reason as the Perps tab:
      // a terminal refusal withdraws the Sign in button instead of leaving one
      // that cannot succeed.
      if (isOndoUnavailable(err)) {
        setUnavailable(err instanceof Error ? err.message : String(err));
      } else {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setSigningIn(false);
    }
  }

  // Post the holding as its own margin and short it, in one signature.
  //
  // The two legs are deliberately not merged into onOpen: that path assumes
  // margin already exists, and conflating them would hide which half failed
  // when a deposit lands but the order does not.
  async function onSelfHedge(
    view: OndoHedgeView,
    ratio: number,
    acceptLossBps?: number,
  ) {
    const wallet = solanaAddress;
    if (!wallet || !view.collateral || !view.market) return;

    setStatus({ kind: "working", symbol: view.holding.xstockSymbol });
    try {
      const outcome = await runOneClickHedge({
        collateral: view.collateral,
        source: {
          chain: "solana-mainnet-beta",
          token: view.holding.mint,
          decimals: XSTOCK_DECIMALS,
          symbol: view.holding.xstockSymbol,
          amountAtomic: uiToAtomic(view.holding.quantity, XSTOCK_DECIMALS),
          amountUsd: view.holding.exposureUsd,
          ownerAddress: wallet,
        },
        solana: { address: wallet, signAndSendBase64: sendSolanaTx },
        xstockSymbol: view.holding.xstockSymbol,
        quantity: view.holding.quantity,
        tokenPriceUsd: String(view.holding.tokenPriceUsd),
        hedgeRatio: ratio,
        acceptLossBps,
        // Read straight from Ondo, not from the hook.
        //
        // `hedge.marginUsd` here is frozen at the render this callback was
        // created in: awaiting refresh() updates React state, but the closed-over
        // `hedge` object never changes, so the poll compared the same stale
        // number for ten minutes, timed out, and skipped opening the short while
        // the deposit had in fact credited. Same trap CLAUDE.md flags for Privy
        // wallet objects across a chain switch.
        readMarginUsd: async () => {
          const snap = await fetchOndoAccount();
          return Number(snap?.balance.availableMargin ?? "0");
        },
        onProgress: (p) => setProgress(p.message),
      });

      setProgress(null);
      if (outcome.kind === "needs-confirmation") {
        const notional = view.holding.exposureUsd * ratio;
        setConfirm({
          view,
          ratio,
          ...outcome,
          liquidationMove: selfHedgeLiquidationMove({
            collateralUsd: outcome.deliveredValueUsd,
            retained: 1 - (view.collateral?.haircut ?? 0.1),
            shortNotionalUsd: notional,
            maintenanceMarginRate: Number(
              view.market?.maintenanceMarginRate ?? 0.05,
            ),
          }),
        });
        setStatus({ kind: "idle" });
        return;
      }
      setConfirm(null);
      if (outcome.kind === "done") {
        setStatus({
          kind: "done",
          symbol: view.holding.xstockSymbol,
          orderId: outcome.hedge.order.orderId,
        });
      } else if (outcome.kind === "funded-not-credited") {
        setStatus({
          kind: "error",
          message: `Deposit sent but Ondo has not credited it after ${Math.round(outcome.waitedMs / 60000)} minutes. It is in flight, not lost. Do not send again; open the hedge once the margin appears.`,
        });
      } else if (outcome.kind === "funded-not-hedged") {
        setStatus({
          kind: "error",
          message: `Margin credited (${usd(outcome.creditedMarginUsd)}) but the order was rejected: ${outcome.reason} Your collateral is posted; place the hedge again.`,
        });
      } else {
        setStatus({ kind: "error", message: outcome.reason });
      }
      await hedge.refresh();
    } catch (err) {
      setProgress(null);
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "That did not go through.",
      });
    }
  }

  async function onOpen(view: OndoHedgeView, ratio: number) {
    setStatus({ kind: "working", symbol: view.holding.xstockSymbol });
    try {
      // The size is not passed. The route recomputes it from the same preview
      // this section renders from, so a tab left open cannot size an order
      // against a stale price.
      const result = await openOndoHedge({
        xstockSymbol: view.holding.xstockSymbol,
        quantity: view.holding.quantity,
        tokenPriceUsd: String(view.holding.tokenPriceUsd),
        hedgeRatio: ratio,
      });
      setStatus({
        kind: "done",
        symbol: view.holding.xstockSymbol,
        orderId: result.order.orderId,
      });
      await hedge.refresh();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onClose(view: OndoHedgeView) {
    if (!view.market || !view.position) return;
    setStatus({ kind: "working", symbol: view.holding.xstockSymbol });
    try {
      // Size omitted closes the whole position. The route clamps whatever it is
      // given to the live position size, and the order itself is reduce-only,
      // so a close can only ever shrink the short.
      const result = await closeOndoHedge({ market: view.market.market });
      setStatus({
        kind: "done",
        symbol: view.holding.xstockSymbol,
        orderId: result.order.orderId,
      });
      await hedge.refresh();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-white/[0.07] py-3 lg:grid-cols-4">
        <Metric label="Hedgeable exposure" value={usd(hedge.totals.exposureUsd)} />
        <Metric label="Currently offset" value={usd(hedge.totals.shortNotionalUsd)} />
        <Metric
          label="Coverage"
          value={
            hedge.totals.exposureUsd > 0 ? percent(hedge.totals.coverageRatio) : "—"
          }
        />
        <Metric
          label="Margin available"
          value={usd(hedge.marginUsd)}
          hint="USDC and posted collateral"
        />
      </div>

      {/* What the margin actually IS.
          A self-collateralized hedge moves the holding off Solana, so the row it
          came from disappears and the only trace left is a pooled dollar figure.
          Ondo runs one unified account with no spot wallet, and its balance
          endpoint returns totals only, so deposit history is the sole place the
          asset is named. Without this the collateral looks like it vanished. */}
      {(hedge.account?.deposits?.length ?? 0) > 0 && (
        <div className={`${INSET_PANEL} p-4`}>
          <div className="flex items-baseline justify-between">
            <div className={LABEL}>Posted collateral</div>
            <div className="font-mono text-[11px] tabular-nums text-white/40">
              {usd(creditedCollateralUsd(hedge.account!))} credited
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {hedge.account!.deposits.slice(0, 6).map((dep, i) => (
              <div
                key={`${dep.txid ?? dep.coin}-${i}`}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="flex items-center gap-2 text-white/80">
                  <MarketLogo market={collateralTicker(dep.coin)} size={20} />
                  {dep.coin}
                  {dep.status !== "confirmed" && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-aeras-warning">
                      {dep.status}
                    </span>
                  )}
                </span>
                <span className="font-mono tabular-nums text-white/60">
                  {Number(dep.size).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}
                  {dep.usdValue ? ` · ${usd(Number(dep.usdValue))} in` : ""}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-white/30">
            Deposited collateral is held in your Ondo margin account, not a spot
            wallet. It backs open positions and can be withdrawn subject to
            margin health.
          </p>
        </div>
      )}

      {hedge.error && <Notice tone="error">{hedge.error}</Notice>}
      {/* The self-hedge runs a bridge and then waits on Ondo to credit, which
          takes minutes. A spinner alone would look hung, so the current step is
          named. */}
      {progress && status.kind === "working" && (
        <Notice tone="info">{progress}</Notice>
      )}
      {/* The cost is stated in dollars and in percent, next to the cheaper
          alternative, and nothing is signed until this is accepted. */}
      {confirm && (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
          <h3 className="text-sm font-medium text-white">
            This deposit costs {usd(confirm.costUsd)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/55">
            {confirm.reason}
          </p>
          <div className="mt-3 flex flex-wrap gap-6">
            <Metric label="You post" value={usd(confirm.inputValueUsd)} />
            <Metric label="Ondo receives" value={usd(confirm.deliveredValueUsd)} />
            <Metric
              label="Cost"
              value={`${usd(confirm.costUsd)} (${(confirm.lossBps / 100).toFixed(2)}%)`}
            />
            {/* Collateral and short are the same underlying, so a rally hits
                both sides. Posting the whole holding is what buys the headroom;
                posting only the margin requirement would liquidate on a small
                move. */}
            <Metric
              label="Liquidates at"
              value={
                confirm.liquidationMove === null
                  ? "no upward move"
                  : `${(confirm.liquidationMove * 100).toFixed(0)}% rise`
              }
              hint="collateral and short move together"
            />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                void onSelfHedge(c.view, c.ratio, c.lossBps);
              }}
              className="rounded-lg bg-amber-400/20 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-400/30"
            >
              Post anyway and hedge
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 transition-colors hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {status.kind === "error" && <Notice tone="error">{status.message}</Notice>}
      {status.kind === "done" && (
        <Notice tone="success">
          {status.symbol} hedge submitted. Ondo order{" "}
          <span className="font-mono">{status.orderId.slice(0, 10)}…</span>
        </Notice>
      )}

      <SessionCard
        status={hedge.status}
        signingIn={signingIn}
        unavailable={unavailable}
        onSignIn={() => void onSignIn()}
        selfCollateralizableUsd={hedge.totals.selfCollateralizableUsd}
        marginUsd={hedge.marginUsd}
      />

      {hedge.loading ? (
        <div className={`${PANEL} p-4 text-sm text-white/45`}>
          Loading markets and positions.
        </div>
      ) : hedge.views.length === 0 ? (
        <div className={`${PANEL} p-4`}>
          <h3 className="text-sm font-medium text-white">Nothing to hedge yet</h3>
          <p className="mt-1 text-sm text-white/45">
            Buy a tokenized stock and it will appear here with the market that
            offsets it.
          </p>
        </div>
      ) : (
        <div className={PANEL}>
          <div className="hidden grid-cols-12 gap-4 border-b border-white/[0.07] px-4 py-2 lg:grid">
            <div className={`${LABEL} col-span-3`}>Holding</div>
            <div className={`${LABEL} col-span-2 text-right`}>Exposure</div>
            <div className={`${LABEL} col-span-2 text-right`}>Short</div>
            <div className={`${LABEL} col-span-2`}>Market</div>
            <div className={`${LABEL} col-span-3 text-right`}>Coverage</div>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {hedge.views.map((view) => (
              <OndoRow
                key={view.holding.mint}
                view={view}
                tradable={hedge.status === "ready"}
                // Post & hedge only needs a signed-in session, not margin:
                // gating it on `tradable` deadlocked it, because `tradable`
                // means margin is already there.
                canFund={
                  hedge.status === "ready" || hedge.status === "needs-margin"
                }
                busy={
                  status.kind === "working" &&
                  status.symbol === view.holding.xstockSymbol
                }
                onOpen={(ratio) => void onOpen(view, ratio)}
                onSelfHedge={(ratio) => void onSelfHedge(view, ratio)}
                onClose={() => void onClose(view)}
              />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// Where the user is in the Ondo flow. Sign-in is a signature rather than a
// transaction: nothing is spent, and it is what every account read is gated on.
function SessionCard({
  status,
  signingIn,
  unavailable,
  onSignIn,
  selfCollateralizableUsd,
  marginUsd,
}: {
  status: UseOndoHedge["status"];
  signingIn: boolean;
  // Non-null when Ondo has refused outright, which withdraws the sign-in offer.
  unavailable: string | null;
  onSignIn: () => void;
  selfCollateralizableUsd: number;
  marginUsd: number;
}) {
  if (status === "no-wallet") {
    return (
      <div className={`${PANEL} p-4 text-sm text-white/45`}>
        Waiting for the embedded wallet to provision.
      </div>
    );
  }

  if (status === "needs-signin") {
    if (unavailable) {
      return (
        <div className={`${PANEL} p-4`}>
          <h3 className="text-sm font-medium text-white">
            Ondo Perps is unavailable
          </h3>
          <p className="mt-1 max-w-xl text-sm text-white/45">{unavailable}</p>
          <p className="mt-2 max-w-xl text-sm text-white/45">
            Lighter is the other hedge venue on this tab and is unaffected.
          </p>
        </div>
      );
    }

    return (
      <div className={`${PANEL} p-4`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-white">Sign in to Ondo Perps</h3>
            <p className="mt-1 max-w-xl text-sm text-white/45">
              One signature with your wallet, no transaction and no gas. It
              proves the account is yours and lasts 24 hours.
            </p>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            disabled={signingIn}
            className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
          >
            {signingIn ? "Check your wallet…" : "Sign in"}
          </button>
        </div>
      </div>
    );
  }

  if (status === "needs-margin") {
    return (
      <div className={`${PANEL} p-4`}>
        <h3 className="text-sm font-medium text-white">No margin posted yet</h3>
        {selfCollateralizableUsd > 0 && (
          <div className="mt-3">
            <Metric
              label="Your holdings would credit"
              value={usd(selfCollateralizableUsd)}
              hint="after Ondo's haircut, if posted as collateral"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <Metric label="Margin available" value={usd(marginUsd)} />
        {selfCollateralizableUsd > 0 && (
          <Metric
            label="Postable collateral"
            value={usd(selfCollateralizableUsd)}
            hint="your holdings, after haircut"
          />
        )}
      </div>
    </div>
  );
}

function OndoRow({
  view,
  tradable,
  canFund,
  busy,
  onOpen,
  onSelfHedge,
  onClose,
}: {
  view: OndoHedgeView;
  tradable: boolean;
  canFund: boolean;
  busy: boolean;
  onOpen: (ratio: number) => void;
  onSelfHedge: (ratio: number) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState<number>(1);

  const { holding, market, position, collateral } = view;

  // Self-hedging needs three things at once: Ondo credits this asset, we can
  // say what it would credit, and execution is switched on.
  // Offered at any size. Cost is not pre-empted by a size rule: a small
  // deposit is expensive, not forbidden, and the flow prices it and asks
  // before signing. Quoted live on 2026-08-26 the SPCXx -> SPCXon route costs
  // 431 bps at $20 and 46 bps at $690, almost all of it fixed relayer cost.
  const canSelfHedge =
    ONDO_FUNDING_ENABLED &&
    collateral !== null &&
    view.creditableUsd !== null &&
    !position;

  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-2 items-center gap-4 lg:grid-cols-12">
        <div className="col-span-2 flex items-center gap-2.5 lg:col-span-3">
          <AssetLogo
            xstock={assetIdentity(holding.mint, holding.xstockSymbol)}
            size={28}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white/80">
              {holding.xstockSymbol}
            </div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-white/35">
              {trim(holding.quantity)} tokens
            </div>
          </div>
        </div>

        <div className="font-mono text-sm tabular-nums text-white lg:col-span-2 lg:text-right">
          {usd(holding.exposureUsd)}
        </div>

        <div className="font-mono text-sm tabular-nums text-white/70 lg:col-span-2 lg:text-right">
          {position ? usd(Number(position.notionalValue)) : "—"}
        </div>

        <div className="min-w-0 lg:col-span-2">
          <div className="flex items-center gap-1.5">
            <MarketLogo
              market={market ? market.market : view.route.market}
              size={18}
            />
            <span className="truncate text-xs text-white/55">
              {market ? market.market : view.route.market}
            </span>
            {/* A proxy hedge tracks a correlated instrument rather than the
                holding itself. Read from the market that resolved, since Ondo
                moves which one that is. */}
            {view.proxy && (
              <span className="shrink-0 rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-400/90">
                Proxy
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-white/30">
            {market ? usd(Number(market.price)) : "not tradeable"}
          </div>
        </div>

        <div className="col-span-2 flex items-center justify-end gap-2 lg:col-span-3">
          <CoverageTag view={view} />
          {position && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy || !tradable}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
            >
              Close
            </button>
          )}
          {/* One click: post the holding as its own margin, then short it.
              Only offered when Ondo actually credits this asset AND we can
              price what it would credit, because the whole proposition is
              "this pays for its own hedge" and a null credit cannot promise
              that. Falls back to the manual flow otherwise. */}
          {market && canSelfHedge && (
            <button
              type="button"
              onClick={() => onSelfHedge(1)}
              disabled={busy || !canFund}
              title={`Post ${holding.xstockSymbol} as margin and short ${market.market}`}
              className="rounded-lg bg-aeras-positive/15 px-3 py-1.5 text-xs font-medium text-aeras-positive transition-colors hover:bg-aeras-positive/25 disabled:opacity-40"
            >
              {busy ? "Working…" : "Post & hedge"}
            </button>
          )}
          {market && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              disabled={busy || !tradable}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              {busy ? "Working…" : position ? "Add" : "Hedge"}
            </button>
          )}
        </div>
      </div>

      {/* Whether this holding can pay for its own hedge is the question that
          decides how a user funds it, so it is answered on the row rather than
          left to the funding step. */}
      {!position && (
        <div className="mt-2 text-[11px] text-white/30">
          {collateral === null ? null : view.creditableUsd === null ? (
            <>
              {collateral.symbol} is accepted as margin, but Ondo has no market to
              mark it against, so its credited value is only known once deposited.
            </>
          ) : (
            <>
              Posts as {collateral.symbol} for {usd(view.creditableUsd)} of margin
              {collateral.documented ? "" : ", at an assumed haircut Ondo has not published"}.
            </>
          )}
        </div>
      )}

      {position && (
        <div className="mt-3 grid grid-cols-2 gap-4 rounded-lg bg-black/30 px-3 py-2.5 lg:grid-cols-4">
          <Metric
            label="Short"
            value={`${trim(position.netQuantity)} ${position.market}`}
          />
          <Metric label="Entry" value={usd(Number(position.averageEntryPrice))} />
          <Metric
            label="Liquidation"
            value={usd(Number(position.liquidationPrice))}
          />
          <Metric
            label="Unrealized"
            value={usd(Number(position.unrealizedPnl))}
            tone={Number(position.unrealizedPnl) >= 0 ? "positive" : "negative"}
          />
        </div>
      )}

      {/* The trigger that ends a self-collateralized hedge before liquidation
          does. Shown as the price of the stock the user is watching, not of the
          perp, and labelled by which of the two limits fires first. */}
      {position && view.autoExchangePriceUsd !== null && (
        <div className="mt-2 text-[11px] text-white/30">
          Ondo sells collateral to clear debt if {holding.xstockSymbol} reaches{" "}
          <span className="font-mono tabular-nums text-white/45">
            {usd(view.autoExchangePriceUsd)}
          </span>
          {view.autoExchangeTrigger === "debt-cap"
            ? " (the $100,000 debt ceiling, reached before the 30% ratio)"
            : " (30% loan-to-value)"}
          . Your position stays open.
        </div>
      )}

      {open && market && (
        <OndoHedgeForm
          view={view}
          ratio={ratio}
          onRatio={setRatio}
          busy={busy}
          onConfirm={() => {
            setOpen(false);
            onOpen(ratio);
          }}
        />
      )}
    </div>
  );
}

function OndoHedgeForm({
  view,
  ratio,
  onRatio,
  busy,
  onConfirm,
}: {
  view: OndoHedgeView;
  ratio: number;
  onRatio: (r: number) => void;
  busy: boolean;
  onConfirm: () => void;
}) {
  const market = view.market;
  if (!market) return null;

  // Preview only. The order route sizes the real thing from the same holding
  // and ratio against a freshly read catalog, so this figure can be a
  // reasonable estimate without being the number that gets submitted.
  const targetNotionalUsd = view.holding.exposureUsd * ratio;

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/[0.07] bg-black/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {RATIOS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onRatio(r)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium tabular-nums transition-colors ${
              ratio === r
                ? "bg-white/15 text-white"
                : "border border-white/10 text-white/55 hover:border-white/20 hover:text-white"
            }`}
          >
            {percent(r)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Metric label="Offsetting" value={usd(targetNotionalUsd)} />
        <Metric label="Market" value={market.market} />
        <Metric
          label="Taker fee"
          value={usd(targetNotionalUsd * Number(market.takerFee))}
        />
      </div>

      {view.proxy && (
        <p className="text-[11px] leading-relaxed text-amber-400/80">
          {market.market} tracks a correlated instrument, not {view.holding.xstockSymbol}{" "}
          itself. The two move together but not exactly, and they can trade on
          different schedules.
        </p>
      )}

      {market.isClosed && (
        <p className="text-[11px] leading-relaxed text-white/45">
          {market.market} is closed right now. A market order needs an open book,
          so this will be refused until it reopens.
        </p>
      )}

      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || market.isClosed}
        className="w-full rounded-lg bg-red-500/90 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
      >
        Short {usd(targetNotionalUsd)} of {market.market}
      </button>
    </div>
  );
}

function CoverageTag({ view }: { view: OndoHedgeView }) {
  const label =
    view.coverage === "hedged"
      ? "Hedged"
      : view.coverage === "partial"
        ? `${percent(view.coverageRatio)}`
        : view.coverage === "over-hedged"
          ? "Over-hedged"
          : "Unhedged";

  const tone =
    view.coverage === "hedged"
      ? "bg-emerald-400/10 text-emerald-400"
      : view.coverage === "over-hedged"
        ? "bg-amber-400/10 text-amber-400"
        : view.coverage === "partial"
          ? "bg-white/10 text-white/70"
          : "bg-white/[0.06] text-white/40";

  return (
    <span
      className={`rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wider tabular-nums ${tone}`}
    >
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? "text-emerald-400"
      : tone === "negative"
        ? "text-red-400"
        : "text-white";

  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className={`mt-1 font-mono text-sm tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-white/30">{hint}</div>}
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "info" | "success";
  children: React.ReactNode;
}) {
  const style =
    tone === "error"
      ? "border-red-500/25 bg-red-500/10 text-red-300"
      : tone === "success"
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
        : "border-white/15 bg-white/[0.06] text-white/70";

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${style}`}>{children}</div>
  );
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function percent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(0)}%`;
}

function trim(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
