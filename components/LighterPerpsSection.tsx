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
// Leverage is the user's choice here, as of 2026-09-11, and the ticket sends
// it. Every order goes out behind an UpdateLeverage (isolated, at the chosen
// leverage) through the same helper the hedge path uses, so the margin and the
// liquidation price the ticket draws are the ones the exchange applies at
// fill. Before this the ticket sized margin at the market default while a
// hedged market had already been set to isolated 2x by placeHedge, and the
// figures were wrong by the ratio of the two.
//
// One case is deliberately left alone. Leverage on Lighter is per account per
// MARKET, and a margin-mode change with a position open in that market is
// expected to be refused (unverified live). So when the account already holds
// a position on the selected market the control is locked, the order is sent
// under the market's current setting, and no liquidation estimate is shown,
// because that setting is not something any endpoint reports.

import { useMemo, useState } from "react";

import { LighterMarginCard } from "@/components/LighterMarginCard";
import { LighterPerpsChart } from "@/components/LighterPerpsChart";
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
  marginForLeverage,
} from "@/lib/lighter/risk";
import {
  computeOrderSize,
  minimumFillableNotional,
  type OrderSize,
} from "@/lib/lighter/sizing";
import {
  clampLeverage,
  DEFAULT_TICKET_LEVERAGE,
  maxNotionalUsd,
} from "@/lib/lighter/ticket-math";
import {
  closeLighterPosition,
  placeLighterTrade,
  type TradeSide,
} from "@/lib/lighter/trade";
import type { LighterMarket, LighterPosition } from "@/lib/lighter/types";
import { useMarginFunding } from "@/lib/lighter/use-margin-funding";
import type { LighterOnboarding } from "@/lib/lighter/onboarding";
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
  initialMarket,
  embedded = false,
}: {
  perps: UseLighterPerps;
  balances: AccountBalances | null;
  scan: WalletScan;
  // The market to open on, as a Lighter symbol. The Terminal passes it when a
  // perp chip is clicked; without it the section opens on DEFAULT_SYMBOL. Read
  // once on mount: the tab unmounts when the section changes, so a later click
  // elsewhere mounts it afresh.
  initialMarket?: string;
  // The Terminal's use: notices and the ticket only, on the market named by
  // `initialMarket`, with no header, chart, selector or positions rail. The
  // chart lives in the Terminal's own column and the market is fixed by the
  // asset selected there. Same hooks, same trade path, same margin cards.
  embedded?: boolean;
}) {
  const wallet = useEmbeddedEvmWallet();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Held as a symbol rather than an index so the choice survives the catalog
  // reloading underneath it.
  const [selected, setSelected] = useState<string | null>(initialMarket ?? null);

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

  // An account that exists and holds margin is enough to place an order.
  //
  // This used to require "ready", which is unreachable from here and made the
  // action button permanently dead. resolveOnboarding only returns "ready" when
  // it is handed a derived trading key to compare against the registered one,
  // and this surface never derives one, because deriving costs the user a
  // signature prompt and doing it on page load would prompt everyone who merely
  // opened the tab. So the status here is always "needs-key" once an account
  // exists, and the button was gated on a value it could never see.
  //
  // Placing the order is what derives the key. placeLighterTrade calls
  // ensureTradingKey, which registers it if missing and reports back
  // "key-registering" so the user retries once. The hedge panel has always
  // worked this way and does not gate on onboarding at all; this brings the two
  // into line rather than inventing a third behaviour.
  const tradable =
    perps.onboarding.status === "ready" ||
    perps.onboarding.status === "needs-key";

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

  async function onTrade(side: TradeSide, notionalUsd: string, leverage: number | null) {
    if (!wallet.address || !market) return;
    await withProvider(async (provider) => {
      const outcome = await placeLighterTrade({
        provider,
        l1Address: wallet.address as string,
        market,
        side,
        notionalUsd,
        leverage: leverage ?? undefined,
      });
      applyOutcome(outcome, market, (size) =>
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
      applyOutcome(outcome, positionMarket, () => `Closing ${position.symbol}.`);
    });
  }

  // Every outcome the trade path can return, turned into one status. Written
  // once because the open and close paths share the shape, and because the two
  // non-error outcomes that are not failures (a key still registering, an order
  // the exchange would reject) are the ones easiest to report as successes by
  // accident.
  // `orderMarket` is the market the ORDER was on, which is not always the one
  // selected: closing a position sizes against that position's market. Passing
  // it explicitly means a rejected close reports its own market's minimum
  // rather than whichever market the picker happens to be showing.
  function applyOutcome(
    outcome: Awaited<ReturnType<typeof placeLighterTrade>>,
    orderMarket: LighterMarket,
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
    setStatus({ kind: "error", message: tooSmall(outcome.size, orderMarket) });
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

  if (embedded) {
    return (
      <div className="space-y-3">
        {notices}
        {market ? (
          <Ticket
            market={market}
            tradable={tradable}
            disabledReason={reasonFor(perps.onboarding.status)}
            busy={status.kind === "working"}
            availableMarginUsd={perps.availableMarginUsd}
            openHere={openHere}
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
            onTrade={(side, notional, leverage) => void onTrade(side, notional, leverage)}
          />
        ) : (
          <div className={`${PANEL} p-4 text-sm text-white/45`}>
            No tradeable market.
          </div>
        )}
      </div>
    );
  }

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
          // Lighter's own candles. The venue's bars are what a position here
          // is marked against, so the chart is the venue, not the underlying.
          <LighterPerpsChart
            marketId={market.marketId}
            symbol={market.symbol}
            markPrice={Number(market.markPrice)}
            priceDecimals={market.priceDecimals}
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
            disabledReason={reasonFor(perps.onboarding.status)}
            busy={status.kind === "working"}
            availableMarginUsd={perps.availableMarginUsd}
            openHere={openHere}
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
            onTrade={(side, notional, leverage) => void onTrade(side, notional, leverage)}
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
  disabledReason,
  busy,
  availableMarginUsd,
  openHere,
  canAddMargin,
  canWithdraw,
  onAddMargin,
  onWithdraw,
  onTrade,
}: {
  market: LighterMarket;
  tradable: boolean;
  // What is actually blocking, when something is. Passed in rather than derived
  // here because the blocker is an account-level fact and the ticket only knows
  // about a market.
  disabledReason?: string;
  busy: boolean;
  availableMarginUsd: number;
  // The position on THIS market, if any. Stated in the ticket because it is
  // what the order being sized will add to or offset, and because it locks
  // the leverage control.
  openHere?: LighterPosition;
  canAddMargin: boolean;
  canWithdraw: boolean;
  onAddMargin: () => void;
  onWithdraw: () => void;
  // Leverage is null when the order must land under the market's current
  // setting, which is the open-position case described at the top of the file.
  onTrade: (side: TradeSide, notionalUsd: string, leverage: number | null) => void;
}) {
  const [notional, setNotional] = useState("500");
  const [side, setSide] = useState<TicketSide>("long");
  const [chosenLeverage, setChosenLeverage] = useState(DEFAULT_TICKET_LEVERAGE);
  // Clamped to the market on every render rather than reset on switch, so a
  // 20x choice survives moving to a 10x market as 10x and comes back as 20x.
  const leverage = clampLeverage(chosenLeverage, market);
  // Adding to an open position keeps the setting it was opened under.
  const leverageLocked = openHere != null;

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

  // What the exchange reserves at the chosen leverage, since the order goes
  // out behind an UpdateLeverage for exactly that. With the control locked the
  // position's setting is unknown and the market default is the only figure on
  // hand, which the row is labelled as.
  const requiredMarginUsd = !valid
    ? 0
    : leverageLocked
      ? Number(sized.notionalUsd) * market.initialMarginFraction
      : marginForLeverage(Number(sized.notionalUsd), leverage, market).marginUsd;
  const affordable = requiredMarginUsd <= availableMarginUsd;

  // The largest order the free margin covers at the chosen leverage. This is
  // what the sizing slider is a fraction of. Plain arithmetic, not memoised:
  // it is four operations on numbers already in hand.
  const maxNotional = leverageLocked
    ? market.initialMarginFraction > 0
      ? Math.min(
          availableMarginUsd / market.initialMarginFraction,
          Number(market.orderQuoteLimit) || Infinity,
        )
      : 0
    : maxNotionalUsd(availableMarginUsd, leverage, market);

  // An isolated position's liquidation depends only on its own margin, which
  // is what makes the estimate honest whatever else the account holds. It is
  // withheld when the control is locked, because then the margin behind the
  // position is not known.
  const liquidation =
    valid && !leverageLocked
      ? {
          price: liquidationPrice({
            entryPriceUsd: Number(market.markPrice),
            size: Number(sized.size),
            collateralUsd: requiredMarginUsd,
            isShort: side === "short",
            market,
          }),
          distance: liquidationDistance({
            entryPriceUsd: Number(market.markPrice),
            size: Number(sized.size),
            collateralUsd: requiredMarginUsd,
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
    {
      label: "Leverage",
      value: leverageLocked ? "Position's current setting" : `${leverage}× isolated`,
      muted: leverageLocked,
    },
    {
      label: leverageLocked ? "Margin (at market default)" : "Margin required",
      value: usd(requiredMarginUsd),
      muted: leverageLocked,
    },
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
    warnings.push(tooSmall(sized, market));
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
      sizing={{ maxUsd: maxNotional }}
      leverage={{
        value: leverage,
        min: 1,
        max: market.maxLeverage,
        onChange: (next) => setChosenLeverage(clampLeverage(next, market)),
        saving: busy || leverageLocked,
        lockedReason: leverageLocked
          ? `You already hold ${market.symbol}. Leverage is set per market on Lighter and cannot change with a position open, so this order adds at the position's current setting.`
          : undefined,
      }}
      rows={rows}
      warnings={warnings}
      tradable={tradable}
      busy={busy}
      submittable={valid}
      disabledReason={disabledReason}
      onSubmit={(next) => onTrade(next, notional, leverageLocked ? null : leverage)}
      footnote={
        valid && leverageLocked
          ? "No liquidation price is shown because the position's margin setting is not reported by the exchange."
          : valid
            ? "Isolated margin: this position is walled off from the rest of your balance, so it liquidates at the price shown and cannot draw on other margin to survive a move."
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
// Why the exchange would reject this order, with the number that fixes it.
//
// The old copy said "below the minimum order value for this market" and stopped
// there, which is unhelpful precisely when a user is most likely to hit it:
// every market's minimum is $10, and $10 is refused, because the size is
// floored to the market increment before the value is checked and $10 of SPY
// floors to $9.96. Someone typing the minimum was told their amount was below
// the minimum. Verified against all 230 live markets: every one rejects a bare
// $10, and every one accepts minimumFillableNotional.
function tooSmall(size: OrderSize, market: LighterMarket): string {
  const floor = minimumFillable(market);
  if (size.limitedBy === "below-min-notional") {
    return `Too small for ${market.symbol}. The smallest order it accepts is ${usd(floor)}, because the size is rounded to the market's increment before its value is checked.`;
  }
  return `Too small for ${market.symbol}. The smallest order it accepts is ${usd(floor)}.`;
}

// The market's floor, rounded UP to whole cents. Rounding to nearest could quote
// a figure a cent below the real minimum, which would be a number that fails the
// moment the user types it.
function minimumFillable(market: LighterMarket): number {
  try {
    return (
      Math.ceil(
        Number(
          minimumFillableNotional({
            marketPriceUsd: market.markPrice,
            sizeDecimals: market.sizeDecimals,
            minBaseAmount: market.minBaseAmount,
            minQuoteAmount: market.minQuoteAmount,
            orderQuoteLimit: market.orderQuoteLimit,
          }),
        ) * 100,
      ) / 100
    );
  } catch {
    return Number(market.minQuoteAmount);
  }
}

// What is actually stopping an order, when something is. Derived from the
// onboarding status rather than hardcoded: the old copy told every blocked user
// to post margin, including those who already had.
function reasonFor(status: LighterOnboarding["status"]): string | undefined {
  if (status === "no-wallet") {
    return "Waiting for your wallet to finish setting up.";
  }
  if (status === "needs-deposit") {
    return "Post margin to trade. Your account is created by the first deposit.";
  }
  return undefined;
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
