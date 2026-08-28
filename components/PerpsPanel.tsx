"use client";

// Perps surface. Trading Ondo's markets directly, rather than offsetting
// something the user already holds.
//
// The hedge tab is organised around holdings because the decision there is per
// holding. Here there is no holding: the decision is a market, a direction and
// a size, so the surface is organised around a market picker with a ticket
// beside it. Nothing on this tab assumes the user owns the underlying, which is
// the whole difference between the two.
//
// It renders dark in both app themes, matching the hedge surface. A perps
// screen is read next to the venue's own, so it borrows that convention:
// near-black ground, tabular figures, colour reserved for direction and state.
//
// Two things are stated rather than implied. Margin is cross, so every position
// shares one balance and a loss on one can liquidate another. And collateral
// posted as tokenized stock can be sold to clear debt at 30% LTV, which is a
// separate mechanism from liquidation and does not close positions.

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";

import { OndoMarginCard } from "@/components/OndoMarginCard";
import { OndoUnwindCard } from "@/components/OndoUnwindCard";
import { OndoWithdrawCard } from "@/components/OndoWithdrawCard";
import { isOndoUnavailable, signInToOndo } from "@/lib/ondo/auth";
import {
  fetchOndoCandles,
  placeOndoTrade,
  setOndoLeverage,
} from "@/lib/ondo/client";
import { useOndoMargin } from "@/lib/ondo/use-ondo-margin";
import { useOndoWithdraw } from "@/lib/ondo/use-ondo-withdraw";
import { useOndoUnwind } from "@/lib/ondo/use-ondo-unwind";
import { useEmbeddedSolanaWallet } from "@/lib/privy/solana";
import { usePerps } from "@/lib/ondo/use-perps";
import { MarketHeader } from "@/components/MarketHeader";
import type { OndoCandle, OndoMarket, OndoPosition } from "@/lib/ondo/types";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import type { AccountBalances } from "@/lib/solana/balances";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import { GLASS_SURFACE } from "@/lib/ui/surface";

// Inner panels sit on top of the outer glass card, so they are a lift in the
// same white wash rather than a second opaque fill: stacking two opaque greys
// broke the ambient blue that reads through every other surface in the app.
const PANEL = "rounded-xl border border-white/[0.07] bg-white/[0.04]";
const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.14em] text-white/35";

const UP = "#119b62";
const DOWN = "#d93232";

// Preset sizes rather than only a free-text field. A perps ticket is used
// repeatedly and typing the same figure each time is friction, but the field
// stays authoritative so nothing is capped at the largest preset.
const NOTIONALS = [100, 500, 1000, 5000] as const;

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function PerpsPanel({
  balances,
  prices,
  scan,
}: {
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  scan: WalletScan;
}) {
  const wallet = useEmbeddedEvmWallet();
  const perps = usePerps({ evmAddress: wallet.address });

  // Margin sources come from the same cross-chain scan the rest of the app
  // shares, so opening this tab costs no extra upstream call.
  const margin = useOndoMargin({
    balances,
    prices,
    scan,
    collateral: perps.collateral,
    onDelivered: () => void perps.refresh(),
  });

  // The way out. Reads its own view rather than deriving one from `perps`,
  // because the question it answers (how much of each asset can leave) needs
  // the deposit and withdrawal ledgers, which nothing else on this tab reads:
  // Ondo exposes no per-asset balance anywhere.
  // Gated on there being a session, because the read behind it fans out to
  // eight Ondo calls and answers nothing useful before sign-in.
  const withdraw = useOndoWithdraw({
    enabled: perps.status === "needs-margin" || perps.status === "ready",
    onWithdrawn: () => void perps.refresh(),
  });

  // What a withdrawal actually left behind, read off Ethereum directly.
  //
  // Not gated on an Ondo session, unlike everything else on this tab: once the
  // tokens are withdrawn they are the user's own ERC-20s and Ondo has nothing
  // to do with them. Someone whose session expired must still be able to see
  // and move them, which is the whole failure this card was built to fix.
  const { address: solanaAddress } = useEmbeddedSolanaWallet();
  const unwind = useOndoUnwind({
    collateral: perps.collateral,
    solanaAddress,
    onDelivered: () => void perps.refresh(),
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [signingIn, setSigningIn] = useState(false);
  // Set when Ondo refuses to serve this account or location at all. Separate
  // from `status` because it is not a transient error: it replaces the sign-in
  // offer rather than appearing above it.
  const [unavailable, setUnavailable] = useState<string | null>(null);

  // Held as a market symbol rather than an index so the choice survives the
  // catalog reloading underneath it.
  const market =
    perps.markets.find((m) => m.market === selected) ??
    perps.markets.find((m) => m.market === "SPY-USD.P") ??
    perps.markets[0] ??
    null;

  async function onSignIn() {
    if (!wallet.address) return;
    setSigningIn(true);
    try {
      const provider = await wallet.getProvider();
      await signInToOndo(provider, wallet.address);
      await perps.refresh();
    } catch (err) {
      // A terminal refusal is held separately from an ordinary error. Ondo
      // answering `forbidden_country` is not something a retry fixes, so the
      // Sign in button is withdrawn rather than left there to fail again.
      if (isOndoUnavailable(err)) {
        setUnavailable(message(err));
      } else {
        setStatus({ kind: "error", message: message(err) });
      }
    } finally {
      setSigningIn(false);
    }
  }

  async function onTrade(side: "buy" | "sell", notionalUsd: string) {
    setStatus({ kind: "working" });
    try {
      const result = await placeOndoTrade({
        market: market?.market ?? "",
        side,
        notionalUsd,
      });
      setStatus({
        kind: "done",
        message: `${side === "buy" ? "Long" : "Short"} ${usd(Number(result.notionalUsd))} of ${result.market}. Order ${result.order.orderId.slice(0, 10)}…`,
      });
      await perps.refresh();
    } catch (err) {
      setStatus({ kind: "error", message: message(err) });
    }
  }

  // Closing is the same market order in the other direction, reduce-only, so an
  // oversized close stops at flat instead of opening the opposite position.
  async function onClosePosition(position: OndoPosition) {
    setStatus({ kind: "working" });
    try {
      const notional = Number(position.notionalValue);
      await placeOndoTrade({
        market: position.market,
        side: position.direction === "short" ? "buy" : "sell",
        notionalUsd: String(notional),
        reduceOnly: true,
      });
      setStatus({ kind: "done", message: `Closing ${position.market}.` });
      await perps.refresh();
    } catch (err) {
      setStatus({ kind: "error", message: message(err) });
    }
  }

  return (
    <div className={`${GLASS_SURFACE} p-4 text-white lg:p-5`}>
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-medium tracking-tight text-white">Perps</span>
          <span className="hidden text-xs text-white/35 sm:inline">
            Trade Ondo markets directly
          </span>
        </div>
        <button
          type="button"
          onClick={() => void perps.refresh()}
          disabled={perps.refreshing}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
        >
          {perps.refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-white/[0.07] py-3 lg:grid-cols-4">
        <Metric label="Margin balance" value={usd(perps.marginBalanceUsd)} />
        <Metric
          label="Available margin"
          value={usd(perps.availableMarginUsd)}
          hint="free to open with"
        />
        <Metric label="Open positions" value={String(perps.positions.length)} />
        <Metric
          label="Collateral LTV"
          value={perps.health ? percent(perps.health.ltv) : "—"}
          hint={
            perps.health && perps.health.ltv > 0
              ? "Ondo sells collateral at 30%"
              : undefined
          }
          tone={perps.health && perps.health.ltv >= 0.25 ? "negative" : undefined}
        />
      </div>

      <div className="mt-3 space-y-3">
        {perps.error && <Notice tone="error">{perps.error}</Notice>}
        {status.kind === "error" && <Notice tone="error">{status.message}</Notice>}
        {status.kind === "done" && <Notice tone="success">{status.message}</Notice>}

        {perps.status === "no-wallet" && (
          <div className={`${PANEL} p-4 text-sm text-white/45`}>
            Waiting for the embedded wallet to provision.
          </div>
        )}

        {perps.status === "needs-signin" &&
          (unavailable ? (
            // No Sign in button. Ondo has refused outright, so offering a retry
            // would be offering something that cannot succeed. The markets
            // below stay rendered because they are unauthenticated and still
            // load, which is also what the copy says.
            <div className={`${PANEL} p-4`}>
              <h3 className="text-sm font-medium text-white">
                Ondo Perps is unavailable
              </h3>
              <p className="mt-1 max-w-xl text-sm text-white/45">{unavailable}</p>
            </div>
          ) : (
            <div className={`${PANEL} p-4`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-white">
                    Sign in to Ondo Perps
                  </h3>
                  <p className="mt-1 max-w-xl text-sm text-white/45">
                    One signature, no transaction and no gas. Markets and prices
                    below are live without it; placing an order needs it.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onSignIn()}
                  disabled={signingIn}
                  className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
                >
                  {signingIn ? "Check your wallet…" : "Sign in"}
                </button>
              </div>
            </div>
          ))}

        {/* Margin is what gates every button on this tab, so adding it is
            offered here rather than sent to another surface. Shown whenever
            there is a session: topping up matters as much as starting.

            The withdraw card sits beside it rather than on another surface for
            the same reason, and because the pair is the point: an app that can
            only add margin has made the deposit a one-way door. */}
        {(perps.status === "needs-margin" || perps.status === "ready") && (
          <div className="grid gap-3 lg:grid-cols-2">
            <OndoMarginCard margin={margin} />
            <OndoWithdrawCard withdraw={withdraw} />
          </div>
        )}

        {/* Rendered outside the session gate above. Withdrawn tokens belong to
            the user regardless of whether Ondo will still talk to them, and
            this card returns null when there is nothing on Ethereum, so it
            costs nothing in the common case. */}
        <OndoUnwindCard unwind={unwind} />

        {perps.loading ? (
          <div className={`${PANEL} p-4 text-sm text-white/45`}>
            Loading markets.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
            <div className="space-y-3">
              <div className={`${PANEL} p-4`}>
                <MarketHeader
                  markets={perps.markets}
                  selected={market ?? null}
                  onSelect={(m) => setSelected(m.market)}
                  loading={perps.loading}
                />
              </div>
              {market && <MarketChart key={market.market} market={market} />}
            </div>

            <div className="space-y-3">
              {market && (
                <Ticket
                  market={market}
                  tradable={perps.status === "ready"}
                  busy={status.kind === "working"}
                  availableMarginUsd={perps.availableMarginUsd}
                  onTrade={(side, notional) => void onTrade(side, notional)}
                  onError={(m) => setStatus({ kind: "error", message: m })}
                />
              )}
            </div>
          </div>
        )}

        {perps.positions.length > 0 && (
          <Positions
            positions={perps.positions}
            busy={status.kind === "working"}
            onSelect={setSelected}
            onClose={(p) => void onClosePosition(p)}
          />
        )}

        <p className="text-[11px] leading-relaxed text-white/30">
          Perpetual futures on Ondo Perps. Margin is cross: every position shares
          one balance, so a loss on one can liquidate another. Tokenized stock
          posted as collateral is credited at its mark less a haircut, and Ondo
          can sell it to clear debt at 30 percent loan-to-value. That is separate
          from liquidation and leaves positions open. Markets follow the
          underlying exchange calendars and are not open continuously.
        </p>
      </div>
    </div>
  );
}

// Price history for the selected market.
//
// An area line rather than the candlesticks the hedge tab draws for Lighter.
// That surface shows a single market a user is committing a hedge to; this one
// is switched between constantly while picking, so the chart is a shape to read
// at a glance rather than a series to study.
//
// Rendered with `key={market.market}`, so switching markets remounts this with
// empty state instead of clearing the previous market's candles by hand. That
// keeps a stale series from being shown under a new market's name without a
// synchronous setState in the effect below.
function MarketChart({ market }: { market: OndoMarket }) {
  const [candles, setCandles] = useState<OndoCandle[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchOndoCandles(market.market, "15", 120)
      .then((data) => {
        if (!cancelled) setCandles(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [market.market]);

  const change = useMemo(() => {
    if (candles.length < 2) return 0;
    const first = candles[0].close;
    const last = candles[candles.length - 1].close;
    return first > 0 ? (last - first) / first : 0;
  }, [candles]);

  const positive = change >= 0;

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{market.market}</div>
          <div className="mt-0.5 text-[11px] text-white/35">{market.longName}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg tabular-nums text-white">
            {usd(Number(market.price))}
          </div>
          {candles.length >= 2 && (
            <div
              className={`font-mono text-[11px] tabular-nums ${
                positive ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {positive ? "+" : ""}
              {(change * 100).toFixed(2)}%
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 h-40">
        {failed ? (
          <div className="flex h-full items-center text-xs text-white/35">
            Price history is unavailable for this market.
          </div>
        ) : candles.length === 0 ? (
          <div className="flex h-full items-center text-xs text-white/35">
            Loading price history.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={candles} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ondoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={positive ? UP : DOWN}
                    stopOpacity={0.25}
                  />
                  <stop
                    offset="100%"
                    stopColor={positive ? UP : DOWN}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              {/* Domain fitted to the data rather than anchored at zero: these
                  are equity prices, and a zero baseline flattens a day's move
                  into a straight line. */}
              <YAxis domain={["dataMin", "dataMax"]} hide />
              <Tooltip
                contentStyle={{
                  background: "#111415",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as OndoCandle | undefined;
                  return point ? new Date(point.time).toLocaleString() : "";
                }}
                formatter={(value) => [usd(Number(value)), "Close"] as [string, string]}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={positive ? UP : DOWN}
                strokeWidth={1.5}
                fill="url(#ondoFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Max leverage" value={`${market.maxLeverage}x`} />
        <Metric
          label="Taker fee"
          value={`${(Number(market.takerFee) * 10_000).toFixed(1)} bps`}
        />
        <Metric
          label="Funding"
          value={
            market.fundingRate === null
              ? "—"
              : `${(Number(market.fundingRate) * 100).toFixed(4)}%`
          }
          hint="hourly"
        />
        <Metric
          label="State"
          value={market.isClosed ? "Closed" : "Open"}
          tone={market.isClosed ? "negative" : undefined}
        />
      </div>
    </div>
  );
}

function Ticket({
  market,
  tradable,
  busy,
  availableMarginUsd,
  onTrade,
  onError,
}: {
  market: OndoMarket;
  tradable: boolean;
  busy: boolean;
  availableMarginUsd: number;
  onTrade: (side: "buy" | "sell", notionalUsd: string) => void;
  onError: (message: string) => void;
}) {
  const [notional, setNotional] = useState("500");
  const [leverage, setLeverage] = useState(2);
  const [savingLeverage, setSavingLeverage] = useState(false);

  const max = Number(market.maxLeverage);
  const notionalUsd = Number(notional);
  const valid = Number.isFinite(notionalUsd) && notionalUsd > 0;

  // What the position reserves at the chosen leverage. Cross margin means this
  // is drawn from the same balance every other position shares, so it is shown
  // against available margin rather than against the whole balance.
  const requiredMarginUsd = valid && leverage > 0 ? notionalUsd / leverage : 0;
  const affordable = requiredMarginUsd <= availableMarginUsd;

  async function applyLeverage(next: number) {
    setLeverage(next);
    if (!tradable) return;
    setSavingLeverage(true);
    try {
      await setOndoLeverage(market.market, next);
    } catch (err) {
      onError(message(err));
    } finally {
      setSavingLeverage(false);
    }
  }

  return (
    <div className={`${PANEL} p-4`}>
      <div className={LABEL}>Order</div>

      <div className="mt-3">
        <div className="flex items-center rounded-lg border border-white/10 bg-black/40 px-3 py-2 focus-within:border-white/25">
          <span className="mr-1 text-sm text-white/35">$</span>
          <input
            value={notional}
            onChange={(e) => setNotional(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="w-full bg-transparent font-mono text-sm tabular-nums text-white outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {NOTIONALS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNotional(String(n))}
              className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white"
            >
              ${n.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className={LABEL}>Leverage</span>
          <span className="font-mono text-xs tabular-nums text-white/70">
            {leverage}x
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={max}
          step={1}
          value={leverage}
          onChange={(e) => void applyLeverage(Number(e.target.value))}
          disabled={savingLeverage}
          className="mt-2 w-full accent-white/70"
        />
        <div className="mt-1 flex justify-between text-[10px] text-white/25">
          <span>1x</span>
          <span>{max}x max</span>
        </div>
      </div>

      <div className="mt-4 space-y-1 border-t border-white/[0.07] pt-3 text-[11px]">
        <Line label="Margin required" value={usd(requiredMarginUsd)} />
        <Line label="Available" value={usd(availableMarginUsd)} />
        <Line
          label="Taker fee"
          value={usd(valid ? notionalUsd * Number(market.takerFee) : 0)}
        />
      </div>

      {market.isClosed && (
        <p className="mt-3 text-[11px] leading-relaxed text-white/45">
          {market.market} is closed. A market order needs an open book, so it
          will be refused until it reopens.
        </p>
      )}

      {!affordable && valid && tradable && (
        <p className="mt-3 text-[11px] leading-relaxed text-amber-400/80">
          That needs {usd(requiredMarginUsd)} of margin and you have{" "}
          {usd(availableMarginUsd)}. Lower the size, raise the leverage, or post
          more collateral.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onTrade("buy", notional)}
          disabled={!tradable || busy || !valid || market.isClosed}
          className="rounded-lg bg-emerald-500/90 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {busy ? "Working…" : "Long"}
        </button>
        <button
          type="button"
          onClick={() => onTrade("sell", notional)}
          disabled={!tradable || busy || !valid || market.isClosed}
          className="rounded-lg bg-red-500/90 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {busy ? "Working…" : "Short"}
        </button>
      </div>

      {!tradable && (
        <p className="mt-2 text-[11px] text-white/30">
          Sign in and post margin to trade.
        </p>
      )}
    </div>
  );
}

function Positions({
  positions,
  busy,
  onSelect,
  onClose,
}: {
  positions: OndoPosition[];
  busy: boolean;
  onSelect: (market: string) => void;
  onClose: (position: OndoPosition) => void;
}) {
  return (
    <div className={PANEL}>
      <div className="hidden grid-cols-12 gap-4 border-b border-white/[0.07] px-4 py-2 lg:grid">
        <div className={`${LABEL} col-span-3`}>Market</div>
        <div className={`${LABEL} col-span-2 text-right`}>Size</div>
        <div className={`${LABEL} col-span-2 text-right`}>Entry</div>
        <div className={`${LABEL} col-span-2 text-right`}>Liquidation</div>
        <div className={`${LABEL} col-span-3 text-right`}>Unrealized</div>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {positions.map((p) => {
          const pnl = Number(p.unrealizedPnl);
          return (
            <div
              key={p.market}
              className="grid grid-cols-2 items-center gap-4 px-4 py-3 lg:grid-cols-12"
            >
              <button
                type="button"
                onClick={() => onSelect(p.market)}
                className="col-span-2 text-left lg:col-span-3"
              >
                <div className="text-sm text-white/80">{p.market}</div>
                <div
                  className={`mt-0.5 text-[11px] font-medium uppercase tracking-wider ${
                    p.direction === "short" ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {/* netQuantity is unsigned. Direction is the only place the
                      sign lives, so reading quantity alone would show every
                      short as a long. */}
                  {p.direction} {trim(p.netQuantity)}
                </div>
              </button>

              <div className="font-mono text-sm tabular-nums text-white/70 lg:col-span-2 lg:text-right">
                {usd(Number(p.notionalValue))}
              </div>
              <div className="font-mono text-sm tabular-nums text-white/70 lg:col-span-2 lg:text-right">
                {usd(Number(p.averageEntryPrice))}
              </div>
              <div className="font-mono text-sm tabular-nums text-white/70 lg:col-span-2 lg:text-right">
                {usd(Number(p.liquidationPrice))}
              </div>

              <div className="col-span-2 flex items-center justify-end gap-3 lg:col-span-3">
                <span
                  className={`font-mono text-sm tabular-nums ${
                    pnl >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {usd(pnl)}
                </span>
                <button
                  type="button"
                  onClick={() => onClose(p)}
                  disabled={busy}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/35">{label}</span>
      <span className="font-mono tabular-nums text-white/70">{value}</span>
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

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function percent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

function trim(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
