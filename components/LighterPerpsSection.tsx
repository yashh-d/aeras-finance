"use client";

// The Lighter venue on the perps tab.
//
// Sits beside the Ondo body rather than behind a shared abstraction, for the
// reason CLAUDE.md gives for the hedge tab: the venues differ in ways worth
// showing. Lighter takes USDC margin funded natively from the user's Solana
// wallet, charges no maker or taker fee, and needs no account beyond a deposit.
// Ondo accepts the tokenized stock itself as margin and pays builder
// commission, at the cost of an Ethereum leg and a sign-in. A common component
// would have to suppress all of that to fit both.
//
// What the two DO share is the furniture, which is PerpsTerminal: one market
// header, a chart column, a reserved order-book column and a ticket, over a
// tabbed rail. That is chrome, not content, so sharing it costs neither venue
// anything it was saying before.
//
// One thing this surface does not offer. There is no leverage control: the
// ticket sizes margin at the market's own initial margin fraction, which is
// what an account reserves when no UpdateLeverage was ever sent for that market.
//
// The tag blocker that used to be the reason is gone. UpdateLeverage is tag 20,
// now in constants.ts and verified by scripts/lighter-leverage-check.mts down to
// the argument order. Adding a control here is a product decision, not a
// research one.
//
// KNOWN GAP, and it is the same class of bug the hedge panel just had. Leverage
// on Lighter is per account per MARKET, not per position, and placeHedge now
// sets isolated 2x on whatever market it hedges. So once a user has hedged TSLA,
// the TSLA market on THIS tab is isolated 2x too, while the line below still
// prices margin at the market default of 6.66%. The figure would be understated
// by roughly 7.5x, which is the hedge panel's old bug pointing the other way.
//
// It needs one of: this ticket sending its own UpdateLeverage before an order,
// or a read of the account's current per-market setting to price against. No
// endpoint is known to report the latter, so the former is the likelier fix.
// Until then the numbers here are correct only for markets the user has never
// hedged.

import { useMemo, useState } from "react";

import { LighterChart } from "@/components/LighterChart";
import { LighterMarginCard } from "@/components/LighterMarginCard";
import { LighterMarketSelector } from "@/components/LighterMarketSelector";
import { LighterWithdrawCard } from "@/components/LighterWithdrawCard";
import {
  PerpsTerminal,
  TerminalHeader,
  TerminalStat,
  TERMINAL_LABEL,
  type TerminalTab,
} from "@/components/PerpsTerminal";
import {
  PerpsTicket,
  type TicketRow,
  type TicketSide,
} from "@/components/PerpsTicket";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import {
  isFeeFree,
  liquidationDistance,
  liquidationPrice,
} from "@/lib/lighter/risk";
import { computeOrderSize, type OrderSize } from "@/lib/lighter/sizing";
import {
  closeLighterPosition,
  placeLighterTrade,
  type TradeSide,
} from "@/lib/lighter/trade";
import type { LighterMarket, LighterPosition } from "@/lib/lighter/types";
import { useMarginFunding } from "@/lib/lighter/use-margin-funding";
import type { UseLighterPerps } from "@/lib/lighter/use-lighter-perps";
import type { AccountBalances } from "@/lib/solana/balances";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import { INSET_PANEL } from "@/lib/ui/surface";

const PANEL = INSET_PANEL;
const LABEL = TERMINAL_LABEL;

// Preset sizes rather than only a free-text field. A perps ticket is used
// repeatedly and typing the same figure each time is friction, but the field
// stays authoritative so nothing is capped at the largest preset.
const NOTIONALS = [100, 500, 1000, 5000] as const;

// Where the picker starts. SPY because it is the market an Aeras user is most
// likely to recognise and the one the hedge path routes most of its volume to.
const DEFAULT_SYMBOL = "SPY";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "registering"; txHash: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function LighterPerpsSection({
  perps,
  balances,
  scan,
}: {
  perps: UseLighterPerps;
  balances: AccountBalances | null;
  scan: WalletScan;
}) {
  const wallet = useEmbeddedEvmWallet();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Held as a symbol rather than an index so the choice survives the catalog
  // reloading underneath it.
  const [selected, setSelected] = useState<string | null>(null);

  // The margin deposit and withdraw forms, opened from the ticket. One at a
  // time: both describe the same balance.
  const [marginOpen, setMarginOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const margin = useMarginFunding({
    balances,
    scan,
    depositAddress: perps.state?.depositAddress,
    // The margin figure on this surface comes from `perps`, not from the
    // funding hook, so the credit poll has to say when to re-read it. Without
    // this the deposit lands and nothing on screen moves until the user presses
    // Refresh, which is what made a two-minute credit feel like five.
    onCredited: () => void perps.refresh(),
  });

  const market = useMemo(() => {
    const { markets } = perps;
    return (
      markets.find((m) => m.symbol === selected) ??
      markets.find((m) => m.symbol === DEFAULT_SYMBOL) ??
      // Deepest book, so an empty catalog of familiar names still opens on
      // something tradeable rather than on whatever sorts first.
      markets.reduce<LighterMarket | null>(
        (best, m) =>
          best == null || m.dailyQuoteVolume > best.dailyQuoteVolume ? m : best,
        null,
      )
    );
  }, [perps, selected]);

  const tradable = perps.onboarding.status === "ready";

  // What the account is already in on the market being sized, which is the one
  // position the ticket has to state. Every other position lives in the rail.
  const openHere = market
    ? perps.positions.find((p) => p.marketId === market.marketId)
    : undefined;

  async function withProvider(run: (provider: Awaited<ReturnType<typeof wallet.getProvider>>) => Promise<void>) {
    setStatus({ kind: "working" });
    try {
      const provider = await wallet.getProvider();
      await run(provider);
    } catch (err) {
      setStatus({ kind: "error", message: message(err) });
    }
  }

  async function onTrade(side: TradeSide, notionalUsd: string) {
    if (!wallet.address || !market) return;
    await withProvider(async (provider) => {
      const outcome = await placeLighterTrade({
        provider,
        l1Address: wallet.address as string,
        market,
        side,
        notionalUsd,
      });
      applyOutcome(outcome, (size) =>
        `${side === "long" ? "Long" : "Short"} ${usd(Number(size?.notionalUsd ?? notionalUsd))} of ${market.symbol} submitted.`,
      );
    });
  }

  async function onClosePosition(position: LighterPosition) {
    const positionMarket = perps.marketFor(position);
    if (!wallet.address || !positionMarket) return;
    await withProvider(async (provider) => {
      const outcome = await closeLighterPosition({
        provider,
        l1Address: wallet.address as string,
        market: positionMarket,
        size: position.size,
        isShort: position.isShort,
      });
      applyOutcome(outcome, () => `Closing ${position.symbol}.`);
    });
  }

  // Every outcome the trade path can return, turned into one status. Written
  // once because the open and close paths share the shape, and because the two
  // non-error outcomes that are not failures (a key still registering, an order
  // the exchange would reject) are the ones easiest to report as successes by
  // accident.
  function applyOutcome(
    outcome: Awaited<ReturnType<typeof placeLighterTrade>>,
    describe: (size?: OrderSize) => string,
  ) {
    if (outcome.kind === "submitted") {
      setStatus({ kind: "done", message: describe(outcome.size) });
      void perps.refresh();
      return;
    }
    if (outcome.kind === "key-registering") {
      setStatus({ kind: "registering", txHash: outcome.txHash });
      return;
    }
    if (outcome.kind === "not-ready") {
      setStatus({ kind: "error", message: outcome.reason });
      return;
    }
    setStatus({ kind: "error", message: tooSmall(outcome.size) });
  }

  const notices = (
    <>
      {perps.error && <Notice tone="error">{perps.error}</Notice>}
      {status.kind === "error" && <Notice tone="error">{status.message}</Notice>}
      {status.kind === "registering" && (
        <Notice tone="info">
          Your trading key is being registered on Lighter. This takes a few
          seconds. Refresh and place the order again once it lands.
        </Notice>
      )}
      {status.kind === "done" && <Notice tone="success">{status.message}</Notice>}

      {perps.onboarding.status === "no-wallet" ? (
        <div className={`${PANEL} p-4 text-sm text-white/45`}>
          Waiting for the embedded wallet to provision.
        </div>
      ) : (
        <LighterMarginCard
          margin={margin}
          needsAccount={perps.onboarding.status === "needs-deposit"}
          open={marginOpen}
          onClose={() => setMarginOpen(false)}
        />
      )}

      {withdrawOpen && perps.onboarding.status !== "no-wallet" && (
        <LighterWithdrawCard
          accountIndex={perps.state?.account?.index}
          availableUsd={perps.availableMarginUsd}
          solanaUsdcAtomic={balances?.usdcAtomic ?? "0"}
          onClose={() => setWithdrawOpen(false)}
          onSettled={() => void perps.refresh()}
        />
      )}
    </>
  );

  if (perps.loading) {
    return (
      <div className="mt-3 space-y-3">
        {notices}
        <div className={`${PANEL} p-4 text-sm text-white/45`}>
          Loading markets.
        </div>
      </div>
    );
  }

  const tabs: TerminalTab[] = [
    {
      id: "positions",
      label: "Positions",
      count: perps.positions.length,
      content:
        perps.positions.length > 0 ? (
          <Positions
            positions={perps.positions}
            busy={status.kind === "working"}
            onSelect={setSelected}
            onClose={(p) => void onClosePosition(p)}
          />
        ) : (
          <p className="px-4 py-6 text-sm text-white/35">
            No open positions. What you open shows here with its entry,
            liquidation price and unrealized profit.
          </p>
        ),
    },
    {
      id: "account",
      label: "Account",
      content: (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4 lg:grid-cols-4">
          <Metric label="Account value" value={usd(perps.accountValueUsd)} />
          <Metric
            label="Available margin"
            value={usd(perps.availableMarginUsd)}
            hint="free to open with"
          />
          <Metric
            label="Margin posted"
            value={usd(perps.collateralUsd)}
            hint={`${usd(margin.totalUsd)} USDC in wallet`}
          />
          <Metric
            label="Fees"
            value={market && isFeeFree(market) ? "None" : "Per market"}
            hint="maker and taker"
          />
        </div>
      ),
    },
  ];

  return (
    <PerpsTerminal
      header={
        <TerminalHeader
          selector={
            <LighterMarketSelector
              markets={perps.markets}
              selected={market}
              onSelect={(m) => setSelected(m.symbol)}
              loading={perps.loading}
            />
          }
          stats={
            market && (
              <>
                <TerminalStat
                  label="Mark price"
                  value={price(market.markPrice)}
                  emphasis
                />
                <TerminalStat
                  label="Index price"
                  value={price(market.indexPrice)}
                />
                <TerminalStat
                  label="24h change"
                  value={signedPercent(market.dailyPriceChange)}
                  tone={market.dailyPriceChange >= 0 ? "positive" : "negative"}
                />
                <TerminalStat
                  label="24h volume"
                  value={compactUsd(market.dailyQuoteVolume)}
                />
                {/* open_interest is in BASE units. Multiplying by the mark is
                    what makes it a dollar figure, and that derivation is
                    recorded on the field in lib/lighter/types.ts. */}
                <TerminalStat
                  label="Open interest"
                  value={compactUsd(
                    market.openInterest * Number(market.markPrice),
                  )}
                />
                <TerminalStat
                  label="Fees"
                  value={
                    isFeeFree(market)
                      ? "0% / 0%"
                      : `${(Number(market.takerFee) * 10_000).toFixed(1)} bps`
                  }
                  hint="maker / taker"
                />
                <TerminalStat
                  label="Max leverage"
                  value={`${market.maxLeverage}×`}
                />
              </>
            )
          }
        />
      }
      notices={notices}
      chart={
        market ? (
          <LighterChart
            marketId={market.marketId}
            symbol={market.symbol}
            markPrice={Number(market.markPrice)}
            fill
          />
        ) : (
          <div
            className={`${PANEL} flex h-full items-center justify-center text-sm text-white/35`}
          >
            No tradeable market.
          </div>
        )
      }
      ticket={
        market ? (
          // Deliberately not keyed on the market. The ticket is sized in
          // dollars, and dollars mean the same thing on every market, so
          // switching markets should keep the size the user typed rather than
          // resetting it.
          <Ticket
            market={market}
            tradable={tradable}
            busy={status.kind === "working"}
            availableMarginUsd={perps.availableMarginUsd}
            openHere={openHere}
            hasOtherPositions={perps.positions.length > 0}
            canWithdraw={
              perps.state?.account != null && perps.availableMarginUsd > 0
            }
            canAddMargin={perps.onboarding.status !== "no-wallet"}
            onAddMargin={() => {
              setWithdrawOpen(false);
              setMarginOpen(true);
            }}
            onWithdraw={() => {
              setMarginOpen(false);
              setWithdrawOpen(true);
            }}
            onTrade={(side, notional) => void onTrade(side, notional)}
          />
        ) : null
      }
      tabs={tabs}
    />
  );
}

function Ticket({
  market,
  tradable,
  busy,
  availableMarginUsd,
  openHere,
  hasOtherPositions,
  canAddMargin,
  canWithdraw,
  onAddMargin,
  onWithdraw,
  onTrade,
}: {
  market: LighterMarket;
  tradable: boolean;
  busy: boolean;
  availableMarginUsd: number;
  // The position on THIS market, if any. Stated in the ticket because it is
  // what the order being sized will add to or offset.
  openHere?: LighterPosition;
  // Whether the account already holds a position somewhere. Margin is cross, so
  // a liquidation price computed for this order alone is only right when it
  // would be the only one. See the caveat at the top of lib/lighter/risk.ts.
  hasOtherPositions: boolean;
  canAddMargin: boolean;
  canWithdraw: boolean;
  onAddMargin: () => void;
  onWithdraw: () => void;
  onTrade: (side: TradeSide, notionalUsd: string) => void;
}) {
  const [notional, setNotional] = useState("500");
  const [side, setSide] = useState<TicketSide>("long");

  // Sizing throws on anything that is not a positive decimal, which is the
  // right behaviour for the money path and the wrong one for a preview that
  // runs on every keystroke. "1.2.3" survives the input filter and fails the
  // parse, so the preview is the caller that guards.
  const sized = useMemo<OrderSize | null>(() => {
    try {
      return computeOrderSize({
        notionalUsd: notional,
        marketPriceUsd: market.markPrice,
        sizeDecimals: market.sizeDecimals,
        minBaseAmount: market.minBaseAmount,
        minQuoteAmount: market.minQuoteAmount,
        orderQuoteLimit: market.orderQuoteLimit,
      });
    } catch {
      return null;
    }
  }, [notional, market]);

  const valid = sized != null && sized.baseAmount !== "0";

  // What Lighter reserves at the market's own default. No leverage control is
  // offered, so this is the figure rather than an estimate of one.
  const requiredMarginUsd = valid
    ? Number(sized.notionalUsd) * market.initialMarginFraction
    : 0;
  const affordable = requiredMarginUsd <= availableMarginUsd;

  // The largest order the free margin covers, at the market's own initial
  // margin fraction. This is what the sizing slider is a fraction of, and it is
  // capped by the exchange's own per-order limit so 100% is never a size the
  // venue would refuse.
  const maxNotionalUsd = useMemo(() => {
    if (market.initialMarginFraction <= 0) return 0;
    const byMargin = availableMarginUsd / market.initialMarginFraction;
    const byOrderCap = Number(market.orderQuoteLimit);
    return Number.isFinite(byOrderCap) && byOrderCap > 0
      ? Math.min(byMargin, byOrderCap)
      : byMargin;
  }, [availableMarginUsd, market.initialMarginFraction, market.orderQuoteLimit]);

  // Only meaningful for a position that would be alone in the account, which is
  // the assumption risk.ts documents. Shown as an estimate rather than a quote,
  // and withheld entirely rather than shown wrong.
  const liquidation =
    valid && !hasOtherPositions
      ? {
          price: liquidationPrice({
            entryPriceUsd: Number(market.markPrice),
            size: Number(sized.size),
            collateralUsd: availableMarginUsd,
            isShort: side === "short",
            market,
          }),
          distance: liquidationDistance({
            entryPriceUsd: Number(market.markPrice),
            size: Number(sized.size),
            collateralUsd: availableMarginUsd,
            isShort: side === "short",
            market,
          }),
        }
      : null;

  const context: TicketRow[] = [
    {
      label: "Available to trade",
      value: usd(availableMarginUsd),
      action: (
        <span className="flex items-center gap-1">
          {canAddMargin && <Pill onClick={onAddMargin}>Add</Pill>}
          {canWithdraw && <Pill onClick={onWithdraw}>Withdraw</Pill>}
        </span>
      ),
    },
    {
      label: "Position",
      value: openHere
        ? `${openHere.isShort ? "Short" : "Long"} ${trim(openHere.size)} · ${usd(Number(openHere.notionalUsd))}`
        : "None",
      muted: !openHere,
    },
  ];

  const rows: TicketRow[] = [
    { label: "Entry (approx)", value: price(market.markPrice), muted: true },
    {
      label: "Order size",
      value: valid ? `${trim(sized.size)} ${market.symbol}` : "—",
    },
    { label: "Order value", value: valid ? usd(Number(sized.notionalUsd)) : "—" },
    { label: "Margin required", value: usd(requiredMarginUsd) },
    {
      label: "Fees",
      value: isFeeFree(market)
        ? "None"
        : usd(valid ? Number(sized.notionalUsd) * Number(market.takerFee) : 0),
    },
    { label: "Max leverage", value: `${market.maxLeverage}×`, muted: true },
  ];

  if (liquidation) {
    rows.push({
      label: "Est. liq. price",
      value: liquidation.price == null ? "—" : usd(liquidation.price),
      muted: true,
    });
    rows.push({
      label: "Liq. distance",
      value:
        liquidation.distance == null
          ? "—"
          : `~${(liquidation.distance * 100).toFixed(1)}%`,
      muted: true,
    });
  }

  const warnings: string[] = [];
  if (sized != null && !valid) {
    warnings.push(tooSmall(sized));
  }
  if (valid && sized.limitedBy === "quote-limit") {
    warnings.push(
      `${market.symbol} caps a single order at ${usd(Number(market.orderQuoteLimit))}, so this will be sized to ${usd(Number(sized.notionalUsd))}. Place the rest as a second order.`,
    );
  }
  if (valid && !affordable && tradable) {
    warnings.push(
      `That needs ${usd(requiredMarginUsd)} of margin and you have ${usd(availableMarginUsd)}. Lower the size or post more margin.`,
    );
  }

  return (
    <PerpsTicket
      symbol={market.symbol}
      side={side}
      onSide={setSide}
      context={context}
      amount={notional}
      onAmount={setNotional}
      presets={NOTIONALS}
      sizing={{ maxUsd: maxNotionalUsd }}
      rows={rows}
      warnings={warnings}
      tradable={tradable}
      busy={busy}
      submittable={valid}
      disabledReason="Post margin to trade. Your account is created by the first deposit."
      onSubmit={(next) => onTrade(next, notional)}
      footnote={
        valid && hasOtherPositions
          ? "No liquidation price is shown because you already hold a position. Margin is cross, so the price depends on all of them together."
          : undefined
      }
    />
  );
}

function Pill({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white"
    >
      {children}
    </button>
  );
}

function Positions({
  positions,
  busy,
  onSelect,
  onClose,
}: {
  positions: LighterPosition[];
  busy: boolean;
  onSelect: (symbol: string) => void;
  onClose: (position: LighterPosition) => void;
}) {
  return (
    <div>
      <div className="hidden grid-cols-12 gap-4 border-b border-white/[0.06] px-4 py-2 lg:grid">
        <div className={`${LABEL} col-span-3`}>Market</div>
        <div className={`${LABEL} col-span-2 text-right`}>Notional</div>
        <div className={`${LABEL} col-span-2 text-right`}>Entry</div>
        <div className={`${LABEL} col-span-2 text-right`}>Liquidation</div>
        <div className={`${LABEL} col-span-3 text-right`}>Unrealized</div>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {positions.map((p) => {
          const pnl = Number(p.unrealizedPnlUsd);
          const liquidation = Number(p.liquidationPriceUsd);
          return (
            <div
              key={p.marketId}
              className="grid grid-cols-2 items-center gap-4 px-4 py-3 lg:grid-cols-12"
            >
              <button
                type="button"
                onClick={() => onSelect(p.symbol)}
                className="col-span-2 text-left lg:col-span-3"
              >
                <div className="text-sm text-white/80">{p.symbol}</div>
                <div
                  className={`mt-0.5 text-[11px] font-medium uppercase tracking-wider ${
                    p.isShort ? "text-aeras-negative" : "text-aeras-positive"
                  }`}
                >
                  {/* size is unsigned. Direction lives only in isShort, so
                      reading size alone would show every short as a long. */}
                  {p.isShort ? "short" : "long"} {trim(p.size)}
                </div>
              </button>

              <div className="font-mono text-sm tabular-nums text-white/70 lg:col-span-2 lg:text-right">
                {usd(Number(p.notionalUsd))}
              </div>
              <div className="font-mono text-sm tabular-nums text-white/70 lg:col-span-2 lg:text-right">
                {usd(Number(p.entryPriceUsd))}
              </div>
              <div className="font-mono text-sm tabular-nums text-white/70 lg:col-span-2 lg:text-right">
                {/* Lighter reports "0" for a position that cannot be liquidated
                    by price, which is not a liquidation price of zero. */}
                {liquidation > 0 ? usd(liquidation) : "—"}
              </div>

              <div className="col-span-2 flex items-center justify-end gap-3 lg:col-span-3">
                <span
                  className={`font-mono text-sm tabular-nums ${
                    pnl >= 0 ? "text-aeras-positive" : "text-aeras-negative"
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

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className="mt-1 font-mono text-sm tabular-nums text-white">{value}</div>
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
      ? "border-aeras-negative/25 bg-aeras-negative/10 text-red-300"
      : tone === "success"
        ? "border-aeras-positive/30 bg-aeras-positive/10 text-emerald-300"
        : "border-white/15 bg-white/[0.06] text-white/70";

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${style}`}>
      {children}
    </div>
  );
}

// Why the exchange would reject this order, in the user's terms. Both minimums
// can bind first depending on the market, so the reason is read off the size
// rather than guessed from the notional.
function tooSmall(size: OrderSize): string {
  if (size.limitedBy === "below-min-notional") {
    return "That is below the minimum order value for this market.";
  }
  return "That is below the minimum order size for this market.";
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function price(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: n < 1 ? 5 : 2,
    maximumFractionDigits: n < 1 ? 5 : 2,
  })}`;
}

function signedPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function compactUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

function trim(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
