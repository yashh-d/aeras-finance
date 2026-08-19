"use client";

// Hedge surface. A user long a tokenized stock opens an offsetting short on
// Lighter without selling the stock.
//
// The panel is organized around one row per holding, because the decision the
// user is making is per holding: this position, how much of it, offset or not.
// Portfolio-level coverage sits at the top as context, not as a control, since
// there is no single order that hedges a basket.
//
// It renders dark in both app themes. This is the only surface in Aeras that
// does. A hedge is priced against a live order book and read in a glance next to
// the venue's own screen, so it borrows that convention: near-black ground,
// tabular figures, colour reserved for direction and state rather than for
// decoration.
//
// Two things are stated rather than implied, both because getting them wrong
// costs the user money. Margin is the user's own USDC on Lighter and is separate
// from the wallet balance shown elsewhere in the app. And a hedge is liquidated
// exactly when the stock it offsets has risen, so the liquidation distance is
// presented as a number to size collateral against, not as a safety rating.

import { useMemo, useState } from "react";

import { LighterChart } from "@/components/LighterChart";
import { Sparkline } from "@/components/Sparkline";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { AccountBalances } from "@/lib/solana/balances";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import type { HedgeView } from "@/lib/lighter/exposure";
import { closeHedge, placeHedge } from "@/lib/lighter/order";
import {
  estimateFundingFromInterest,
  liquidationDistance,
  marginForLeverage,
} from "@/lib/lighter/risk";
import { computeHedgeSize } from "@/lib/lighter/sizing";
import { useHedge } from "@/lib/lighter/use-hedge";
import { useSparklines } from "@/lib/lighter/use-candles";
import { useMarginFunding } from "@/lib/lighter/use-margin-funding";

interface Props {
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  scan: WalletScan;
}

// Leverage the hedge is opened at. 2x rather than the market maximum: a hedge
// held against a stock is a long-lived position, and the margin saved by opening
// it at 20x is the same margin that keeps it alive through a rally.
const HEDGE_LEVERAGE = 2;

const RATIOS = [0.25, 0.5, 0.75, 1] as const;

type Status =
  | { kind: "idle" }
  | { kind: "working"; symbol: string }
  | { kind: "registering"; txHash: string }
  | { kind: "done"; symbol: string; txHash: string }
  | { kind: "error"; message: string };

const PANEL = "rounded-xl border border-white/[0.07] bg-[#111415]";
const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.14em] text-white/35";

export function HedgePanel({ balances, prices, scan }: Props) {
  const wallet = useEmbeddedEvmWallet();
  const hedge = useHedge({ l1Address: wallet.address, balances, prices });
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const margin = useMarginFunding({
    balances,
    scan,
    depositAddress: hedge.state?.depositAddress,
  });

  const collateralUsd = Number(hedge.state?.detail?.availableBalanceUsd ?? "0");

  // Which holding the big chart is showing. Held as a mint rather than a market
  // id so a holding whose market is missing can still be selected and explain
  // itself, and so the choice survives the catalog reloading underneath it.
  const [selectedMint, setSelectedMint] = useState<string | null>(null);

  const charted =
    hedge.views.find((view) => view.holding.mint === selectedMint) ??
    // Default to the largest exposure that has a market. That is the position
    // most worth watching and the one a user is most likely to hedge first.
    hedge.views.find((view) => view.market) ??
    hedge.views[0] ??
    null;

  const sparklineIds = useMemo(
    () =>
      hedge.views
        .map((view) => view.market?.marketId)
        .filter((id): id is number => id != null),
    [hedge.views],
  );
  const sparklines = useSparklines(sparklineIds);

  async function withProvider(
    symbol: string,
    run: (provider: Awaited<ReturnType<typeof wallet.getProvider>>) => Promise<void>,
  ) {
    setStatus({ kind: "working", symbol });
    try {
      const provider = await wallet.getProvider();
      await run(provider);
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onOpen(view: HedgeView, ratio: number) {
    if (!wallet.address || !view.market) return;
    const market = view.market;

    await withProvider(view.holding.xstockSymbol, async (provider) => {
      const outcome = await placeHedge({
        provider,
        l1Address: wallet.address as string,
        market,
        quantity: view.holding.quantity,
        tokenPriceUsd: String(view.holding.tokenPriceUsd),
        hedgeRatio: ratio,
      });

      if (outcome.kind === "submitted") {
        setStatus({
          kind: "done",
          symbol: view.holding.xstockSymbol,
          txHash: outcome.txHash,
        });
        await hedge.refresh();
      } else if (outcome.kind === "key-registering") {
        setStatus({ kind: "registering", txHash: outcome.txHash });
      } else if (outcome.kind === "too-small") {
        setStatus({
          kind: "error",
          message:
            outcome.size.limitedBy === "below-min-notional"
              ? `That hedge is under Lighter's ${market.minQuoteAmount} USD order minimum.`
              : `That hedge is smaller than the minimum order size for ${market.symbol}.`,
        });
      } else {
        setStatus({ kind: "error", message: outcome.reason });
      }
    });
  }

  async function onClose(view: HedgeView) {
    if (!wallet.address || !view.market || !view.position) return;
    const market = view.market;
    const size = view.position.size;

    await withProvider(view.holding.xstockSymbol, async (provider) => {
      const outcome = await closeHedge({
        provider,
        l1Address: wallet.address as string,
        market,
        size,
      });

      if (outcome.kind === "submitted") {
        setStatus({
          kind: "done",
          symbol: view.holding.xstockSymbol,
          txHash: outcome.txHash,
        });
        await hedge.refresh();
      } else if (outcome.kind === "key-registering") {
        setStatus({ kind: "registering", txHash: outcome.txHash });
      } else if (outcome.kind === "not-ready") {
        setStatus({ kind: "error", message: outcome.reason });
      }
    });
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#0a0c0d] p-4 text-white lg:p-5">
      <TopBar
        refreshing={hedge.refreshing}
        onRefresh={() => void hedge.refresh()}
      />

      <StatStrip
        exposureUsd={hedge.totals.exposureUsd}
        shortNotionalUsd={hedge.totals.shortNotionalUsd}
        coverageRatio={hedge.totals.coverageRatio}
        collateralUsd={collateralUsd}
      />

      <div className="mt-3 space-y-3">
        {hedge.error && <Notice tone="error">{hedge.error}</Notice>}
        {status.kind === "error" && <Notice tone="error">{status.message}</Notice>}
        {status.kind === "registering" && (
          <Notice tone="info">
            Your trading key is being registered on Lighter. This takes a few
            seconds. Refresh and place the hedge again once it lands.
          </Notice>
        )}
        {status.kind === "done" && (
          <Notice tone="success">
            {status.symbol} hedge submitted. Lighter transaction{" "}
            <span className="font-mono">{status.txHash.slice(0, 10)}…</span>
          </Notice>
        )}

        {hedge.onboarding.status === "no-wallet" ? (
          <div className={`${PANEL} p-4 text-sm text-white/45`}>
            Waiting for the embedded wallet to provision.
          </div>
        ) : (
          <MarginCard
            margin={margin}
            collateralUsd={collateralUsd}
            needsAccount={hedge.onboarding.status === "needs-deposit"}
          />
        )}

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
          <>
            {charted && (
              <LighterChart
                marketId={charted.market?.marketId ?? null}
                symbol={charted.route.market}
                markPrice={
                  charted.market ? Number(charted.market.markPrice) : undefined
                }
                // The line that ends the hedge. Drawn only when a short is open,
                // because on a market with no position it would be a price with
                // no meaning.
                marker={
                  charted.position
                    ? {
                        price: Number(charted.position.liquidationPriceUsd),
                        label: "Liq",
                      }
                    : undefined
                }
              />
            )}

            <div className={PANEL}>
              <RowHeader />
              <div className="divide-y divide-white/[0.06]">
                {hedge.views.map((view) => (
                  <HedgeRow
                    key={view.holding.mint}
                    view={view}
                    collateralUsd={collateralUsd}
                    busy={
                      status.kind === "working" &&
                      status.symbol === view.holding.xstockSymbol
                    }
                    sparkline={
                      view.market ? sparklines[view.market.marketId] : undefined
                    }
                    selected={charted?.holding.mint === view.holding.mint}
                    onSelect={() => setSelectedMint(view.holding.mint)}
                    onOpen={(ratio) => onOpen(view, ratio)}
                    onClose={() => onClose(view)}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <Disclosure />
      </div>
    </div>
  );
}

function TopBar({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-medium tracking-tight text-white">Hedge</span>
        <span className="text-xs text-white/35">
          Offset a holding without selling it
        </span>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
      >
        {refreshing ? "Refreshing" : "Refresh"}
      </button>
    </div>
  );
}

function StatStrip({
  exposureUsd,
  shortNotionalUsd,
  coverageRatio,
  collateralUsd,
}: {
  exposureUsd: number;
  shortNotionalUsd: number;
  coverageRatio: number;
  collateralUsd: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-white/[0.07] py-3 lg:grid-cols-4">
      <Metric label="Hedgeable exposure" value={usd(exposureUsd)} />
      <Metric label="Currently offset" value={usd(shortNotionalUsd)} />
      <Metric
        label="Coverage"
        value={exposureUsd > 0 ? percent(coverageRatio) : "—"}
      />
      <Metric
        label="Margin available"
        value={usd(collateralUsd)}
        hint="USDC on Lighter"
      />
    </div>
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
      <div className={`mt-1 font-mono text-base tabular-nums ${color}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-white/30">{hint}</div>}
    </div>
  );
}

// Funding margin, in the app.
//
// The old version of this card printed Lighter's deposit address and asked the
// user to send USDC to it by hand. The address is a bare token account, so that
// was both a chore and a way to lose funds to a mistyped character. The wallet
// is already connected and the address is already known, so the transfer is ours
// to make.
function MarginCard({
  margin,
  collateralUsd,
  needsAccount,
}: {
  margin: ReturnType<typeof useMarginFunding>;
  collateralUsd: number;
  needsAccount: boolean;
}) {
  const [amount, setAmount] = useState("");
  const { funding, block, status } = margin;

  // Nothing to say once the account is funded and the user has not asked to add
  // more. Collapsing to a single line keeps the hedge rows at the top of the
  // panel, which is what the tab is for.
  const [expanded, setExpanded] = useState(false);
  const showForm = needsAccount || expanded;

  const entered = Number(amount);
  const overBalance = entered > funding.readyUsd;
  const underMinimum = entered > 0 && entered < funding.minimumUsd;
  const canSubmit =
    margin.ready &&
    status.kind !== "sending" &&
    entered > 0 &&
    !overBalance &&
    !underMinimum;

  if (!showForm) {
    return (
      <div className={`${PANEL} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div className="text-sm text-white/45">
          <span className="font-mono tabular-nums text-white">
            {usd(collateralUsd)}
          </span>{" "}
          margin on Lighter
          {funding.readyUsd > 0 && (
            <>
              {" · "}
              <span className="font-mono tabular-nums">{usd(funding.readyUsd)}</span>{" "}
              USDC in your wallet
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white"
        >
          Add margin
        </button>
      </div>
    );
  }

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-white">
            {needsAccount ? "Fund your Lighter margin" : "Add margin"}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-white/45">
            Hedges are margined with USDC held on Lighter, which is separate from
            the USDC in your wallet. This moves it for you and credits in about
            15 to 20 minutes.
          </p>
        </div>
        {!needsAccount && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs text-white/35 transition-colors hover:text-white/70"
          >
            Close
          </button>
        )}
      </div>

      {status.kind === "sent" ? (
        <div className="mt-3">
          <Notice tone="success">
            {usd(Number(amount))} USDC sent to Lighter. Solana signature{" "}
            <span className="font-mono">{status.signature.slice(0, 10)}…</span>.
            Your margin appears once Lighter credits it.
          </Notice>
          <button
            type="button"
            onClick={() => {
              setAmount("");
              margin.reset();
            }}
            className="mt-2 text-xs text-white/40 transition-colors hover:text-white/70"
          >
            Send more
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[180px] flex-1 items-center rounded-lg border border-white/10 bg-black/40 px-3 py-2 focus-within:border-white/25">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0.00"
                className="w-full bg-transparent font-mono text-base tabular-nums text-white outline-none placeholder:text-white/20"
              />
              <span className="ml-2 text-xs text-white/35">USDC</span>
            </div>
            {([0.25, 0.5, 1] as const).map((fraction) => (
              <button
                key={fraction}
                type="button"
                onClick={() =>
                  setAmount(String(Math.floor(funding.readyUsd * fraction * 100) / 100))
                }
                disabled={funding.readyUsd <= 0}
                className="rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white disabled:opacity-30"
              >
                {fraction === 1 ? "Max" : `${fraction * 100}%`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void margin.deposit(amount)}
              disabled={!canSubmit}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {status.kind === "sending" ? "Sending…" : "Deposit"}
            </button>
          </div>

          <div className="mt-2 text-[11px] text-white/35">
            {overBalance
              ? `That is more than the ${usd(funding.readyUsd)} USDC in your wallet.`
              : underMinimum
                ? `Lighter's minimum deposit is ${usd(funding.minimumUsd)}.`
                : `${usd(funding.readyUsd)} USDC available on Solana.`}
          </div>

          {status.kind === "error" && (
            <div className="mt-3">
              <Notice tone="error">{status.message}</Notice>
            </div>
          )}

          {block.kind === "bridge-first" && (
            <div className="mt-3">
              <Notice tone="info">
                You hold {usd(block.bridgeableUsd)} USDC off Solana. Move it to
                your Solana wallet and it becomes available here.
              </Notice>
            </div>
          )}

          {funding.sources.some((s) => s.route === "bridge-then-transfer") && (
            <div className="mt-3 space-y-1">
              <div className={LABEL}>Elsewhere</div>
              {funding.sources
                .filter((s) => s.route === "bridge-then-transfer")
                .map((source) => (
                  <div
                    key={source.chain}
                    className="flex items-center justify-between text-xs text-white/45"
                  >
                    <span>{source.chainLabel}</span>
                    <span className="font-mono tabular-nums">
                      {usd(source.amountUsd)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RowHeader() {
  return (
    <div className="hidden grid-cols-12 gap-4 border-b border-white/[0.07] px-4 py-2 lg:grid">
      <div className={`${LABEL} col-span-3`}>Holding</div>
      <div className={`${LABEL} col-span-2 text-right`}>Exposure</div>
      <div className={`${LABEL} col-span-2 text-right`}>Short</div>
      <div className={`${LABEL} col-span-2`}>Market</div>
      <div className={`${LABEL} col-span-3 text-right`}>Coverage</div>
    </div>
  );
}

function HedgeRow({
  view,
  collateralUsd,
  busy,
  sparkline,
  selected,
  onSelect,
  onOpen,
  onClose,
}: {
  view: HedgeView;
  collateralUsd: number;
  busy: boolean;
  sparkline: number[] | undefined;
  selected: boolean;
  onSelect: () => void;
  onOpen: (ratio: number) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState<number>(1);

  const { holding, market, position, route } = view;

  return (
    <div className={`px-4 py-3 ${selected ? "bg-white/[0.03]" : ""}`}>
      <div className="grid grid-cols-2 items-center gap-4 lg:grid-cols-12">
        <button
          type="button"
          onClick={onSelect}
          className="col-span-2 text-left lg:col-span-3"
        >
          <div
            className={`text-sm font-medium transition-colors ${
              selected ? "text-white" : "text-white/80 hover:text-white"
            }`}
          >
            {holding.xstockSymbol}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-white/35">
            {trim(holding.quantity)} tokens
          </div>
        </button>

        <div className="font-mono text-sm tabular-nums text-white lg:col-span-2 lg:text-right">
          {usd(holding.exposureUsd)}
        </div>

        <div className="font-mono text-sm tabular-nums text-white/70 lg:col-span-2 lg:text-right">
          {position ? usd(Number(position.notionalUsd)) : "—"}
        </div>

        <div className="flex items-center gap-2 lg:col-span-2">
          <div className="min-w-0">
            <div className="text-xs text-white/55">{route.market}</div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-white/30">
              {market ? usd(Number(market.markPrice)) : "not tradeable"}
            </div>
          </div>
          <Sparkline values={sparkline} />
        </div>

        <div className="col-span-2 flex items-center justify-end gap-2 lg:col-span-3">
          <CoverageTag view={view} />
          {position && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
            >
              Close
            </button>
          )}
          {market && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              disabled={busy}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              {busy ? "Working…" : position ? "Add" : "Hedge"}
            </button>
          )}
        </div>
      </div>

      {position && (
        <div className="mt-3 grid grid-cols-2 gap-4 rounded-lg bg-black/30 px-3 py-2.5 lg:grid-cols-4">
          <Metric label="Short" value={`${trim(position.size)} ${route.market}`} />
          <Metric label="Entry" value={usd(Number(position.entryPriceUsd))} />
          <Metric
            label="Liquidation"
            value={usd(Number(position.liquidationPriceUsd))}
          />
          <Metric
            label="Unrealized"
            value={usd(Number(position.unrealizedPnlUsd))}
            tone={
              Number(position.unrealizedPnlUsd) >= 0 ? "positive" : "negative"
            }
          />
        </div>
      )}

      {open && market && (
        <HedgeForm
          view={view}
          ratio={ratio}
          onRatio={setRatio}
          collateralUsd={collateralUsd}
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

function HedgeForm({
  view,
  ratio,
  onRatio,
  collateralUsd,
  busy,
  onConfirm,
}: {
  view: HedgeView;
  ratio: number;
  onRatio: (r: number) => void;
  collateralUsd: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const market = view.market;
  if (!market) return null;

  // Sized with the same function that builds the order, so the preview cannot
  // disagree with what is submitted.
  const size = computeHedgeSize({
    quantity: view.holding.quantity,
    tokenPriceUsd: String(view.holding.tokenPriceUsd),
    hedgeRatio: ratio,
    marketPriceUsd: market.markPrice,
    sizeDecimals: market.sizeDecimals,
    minBaseAmount: market.minBaseAmount,
    minQuoteAmount: market.minQuoteAmount,
    orderQuoteLimit: market.orderQuoteLimit,
  });

  const notionalUsd = Number(size.notionalUsd);
  const margin = marginForLeverage(notionalUsd, HEDGE_LEVERAGE, market);
  const distance = liquidationDistance({
    entryPriceUsd: Number(market.markPrice),
    size: Number(size.size),
    collateralUsd: margin.marginUsd,
    isShort: true,
    market,
  });
  const funding = estimateFundingFromInterest(notionalUsd, market, true);
  const affordable = margin.marginUsd <= collateralUsd;
  const tooSmall = size.baseAmount === "0";

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/[0.07] bg-black/40 p-4">
      <div>
        <div className={LABEL}>How much to offset</div>
        <div className="mt-2 flex gap-2">
          {RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRatio(r)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                r === ratio
                  ? "border-white/25 bg-white/10 text-white"
                  : "border-white/10 text-white/45 hover:border-white/20 hover:text-white/80"
              }`}
            >
              {Math.round(r * 100)}%
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label="Short size"
          value={tooSmall ? "—" : `${trim(size.size)} ${market.symbol}`}
        />
        <Metric label="Notional" value={usd(notionalUsd)} />
        <Metric
          label="Margin"
          value={usd(margin.marginUsd)}
          hint={`${margin.leverage}x`}
        />
        <Metric
          label="Funding"
          value={`${funding.annualizedPercent >= 0 ? "" : "+"}${Math.abs(
            funding.annualizedPercent,
          ).toFixed(2)}%`}
          hint={funding.annualizedPercent < 0 ? "received, est" : "paid, est"}
          tone={funding.annualizedPercent < 0 ? "positive" : undefined}
        />
      </div>

      {distance !== null && !tooSmall && (
        <p className="text-[11px] leading-relaxed text-white/40">
          Liquidates if {market.symbol} rises about {percent(distance)} from here.
          A hedge is liquidated when the stock it offsets has gone up, so size the
          margin against a rally you consider plausible.
        </p>
      )}

      {view.route.match === "proxy" && view.route.basis && (
        <p className="text-[11px] leading-relaxed text-white/40">
          {view.route.basis}
        </p>
      )}

      {size.limitedBy === "quote-limit" && (
        <p className="text-[11px] leading-relaxed text-white/40">
          Capped at Lighter&apos;s per-order limit, so this offsets{" "}
          {percent(size.effectiveRatio)} of the holding. Place another to cover
          the rest.
        </p>
      )}

      {!affordable && !tooSmall && (
        <Notice tone="error">
          This needs {usd(margin.marginUsd)} of margin and you have{" "}
          {usd(collateralUsd)} on Lighter. Add margin above first.
        </Notice>
      )}

      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || tooSmall || !affordable}
        className="w-full rounded-lg bg-red-500/90 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
      >
        {tooSmall
          ? "Below the minimum order size"
          : `Short ${usd(notionalUsd)} of ${market.symbol}`}
      </button>
    </div>
  );
}

function CoverageTag({ view }: { view: HedgeView }) {
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

function Disclosure() {
  return (
    <p className="text-[11px] leading-relaxed text-white/30">
      Hedges are perpetual futures on Lighter, margined with USDC you hold there.
      A perp tracks the underlying but is a separate instrument with its own
      funding and its own liquidation risk, and it does not settle against the
      tokenized stock in your wallet. Closing a hedge realizes its profit or loss
      in USDC.
    </p>
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
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${style}`}>
      {children}
    </div>
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

// Trailing zeros on an 8-decimal token amount are noise in a row of figures.
function trim(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
