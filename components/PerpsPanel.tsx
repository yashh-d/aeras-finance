"use client";

// Perps surface. Trading a venue's markets directly, rather than offsetting
// something the user already holds.
//
// The hedge tab is organised around holdings because the decision there is per
// holding. Here there is no holding: the decision is a market, a direction and
// a size, so the surface is organised as a trading terminal. One market header,
// a chart column, a reserved order-book column and a ticket beside them, over a
// tabbed rail of positions and account state. Nothing on this tab assumes the
// user owns the underlying, which is the whole difference between the two.
//
// Two venues, switched at the top, mirroring the hedge tab. Lighter is the
// default and lives in components/LighterPerpsSection.tsx; Ondo is the body of
// this file. They are kept side by side rather than behind a shared abstraction
// for the reason CLAUDE.md gives: the venues differ in ways worth showing.
// Lighter is permissionless, charges no fees and takes USDC margin funded
// natively from Solana. Ondo pays builder commission and accepts the tokenized
// stock itself as margin, at the cost of a sign-in and an Ethereum leg.
//
// What they share is PerpsTerminal, which is furniture rather than content: the
// column grid, the header rail and the tab strip. Each venue fills it with its
// own figures, so the tab stops looking like two unrelated products without
// either venue having to suppress what makes it different.
//
// It renders dark in both app themes, matching the hedge surface. A perps
// screen is read next to the venue's own, so it borrows that convention:
// near-black ground, tabular figures, colour reserved for direction and state.
//
// Two things are stated rather than implied on the Ondo side. Margin is cross,
// so every position shares one balance and a loss on one can liquidate another.
// And collateral posted as tokenized stock can be sold to clear debt at 30%
// LTV, which is a separate mechanism from liquidation and does not close
// positions.

import { useState } from "react";

import { LighterPerpsSection } from "@/components/LighterPerpsSection";
import {
  PerpsTerminal,
  TERMINAL_LABEL,
  type TerminalTab,
} from "@/components/PerpsTerminal";
import {
  PerpsTicket,
  type TicketRow,
  type TicketSide,
} from "@/components/PerpsTicket";
import { OndoPerpsChart } from "@/components/OndoPerpsChart";
import { marketTicker } from "@/lib/tokens/market-logos";
import { OndoMarginCard } from "@/components/OndoMarginCard";
import { OndoUnwindCard } from "@/components/OndoUnwindCard";
import { OndoWithdrawCard } from "@/components/OndoWithdrawCard";
import { useLighterPerps } from "@/lib/lighter/use-lighter-perps";
import { isOndoUnavailable, signInToOndo } from "@/lib/ondo/auth";
import { placeOndoTrade, setOndoLeverage } from "@/lib/ondo/client";
import { useOndoMargin } from "@/lib/ondo/use-ondo-margin";
import { useOndoWithdraw } from "@/lib/ondo/use-ondo-withdraw";
import { useOndoUnwind } from "@/lib/ondo/use-ondo-unwind";
import { useEmbeddedSolanaWallet } from "@/lib/privy/solana";
import { usePerps } from "@/lib/ondo/use-perps";
import { MarketHeader } from "@/components/MarketHeader";
import type { OndoMarket, OndoPosition } from "@/lib/ondo/types";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import type { AccountBalances } from "@/lib/solana/balances";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import { INSET_PANEL } from "@/lib/ui/surface";

// Inner panels sit on top of the outer glass card, so they are a lift in the
// same white wash rather than a second opaque fill: stacking two opaque greys
// broke the ambient blue that reads through every other surface in the app.
const PANEL = INSET_PANEL;
const LABEL = TERMINAL_LABEL;

// Preset sizes rather than only a free-text field. A perps ticket is used
// repeatedly and typing the same figure each time is friction, but the field
// stays authoritative so nothing is capped at the largest preset.
const NOTIONALS = [100, 500, 1000, 5000] as const;

type Venue = "lighter" | "ondo";

// Lighter first, for the same reasons it leads the hedge tab: permissionless,
// zero maker and taker fees, and margin funded straight from the Solana wallet
// the user already holds. Ondo needs a SIWE sign-in and an Ethereum deposit
// before a single order can be placed, so defaulting to it meant a page load
// spent four requests discovering the user was not signed in.
// TEMPORARY (demo): hides the Ondo venue from the toggle. Nothing else is
// removed, and the Ondo body stays reachable the moment this is false again.
const HIDE_ONDO = true;

const VENUES: { id: Venue; label: string }[] = [
  { id: "lighter", label: "Lighter" },
  { id: "ondo", label: "Ondo" },
].filter((v) => !(HIDE_ONDO && v.id === "ondo")) as { id: Venue; label: string }[];

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function PerpsPanel({
  balances,
  prices,
  scan,
  initialMarket,
}: {
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  scan: WalletScan;
  // A Lighter market to open on. See LighterPerpsSection.
  initialMarket?: string;
}) {
  const wallet = useEmbeddedEvmWallet();

  const [venue, setVenue] = useState<Venue>("lighter");

  // Both venues' hooks run, because hooks cannot be called conditionally, but
  // each no-ops while the other is selected rather than polling a catalog
  // nobody is looking at or holding a session open for a surface that is not
  // rendered.
  const lighter = useLighterPerps({
    l1Address: wallet.address,
    enabled: venue === "lighter",
  });

  const perps = usePerps({
    evmAddress: wallet.address,
    enabled: venue === "ondo",
  });

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
    enabled:
      venue === "ondo" &&
      (perps.status === "needs-margin" || perps.status === "ready"),
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
    enabled: venue === "ondo",
    onDelivered: () => void perps.refresh(),
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [signingIn, setSigningIn] = useState(false);
  // The margin and withdraw forms, opened from the ticket. One at a time: both
  // describe the same balance.
  const [marginOpen, setMarginOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const hasOndoSession =
    perps.status === "needs-margin" || perps.status === "ready";
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

  // No card surface around this tab. The terminal, the ticket, the positions
  // table and every notice already carry their own bordered panel, so a glass
  // card around all of them drew a frame around frames. The page padding on
  // <main> still keeps the content off the viewport edge.
  return (
    <div className="text-white">
      <TopBar
        venue={venue}
        onVenue={setVenue}
        refreshing={venue === "ondo" ? perps.refreshing : lighter.refreshing}
        onRefresh={() =>
          void (venue === "ondo" ? perps.refresh() : lighter.refresh())
        }
      />

      {venue === "lighter" ? (
        <LighterPerpsSection
          perps={lighter}
          balances={balances}
          scan={scan}
          initialMarket={initialMarket}
        />
      ) : (
        // Called, not rendered as <OndoBody />. A function declared inside a
        // component is a new identity on every render, so React would treat it
        // as a different component type each time and remount the whole
        // subtree, resetting the ticket state inside it. A plain call returns
        // the same JSX with no component boundary at all.
        OndoBody()
      )}
    </div>
  );

  // The Ondo surface. Kept as a closure rather than lifted to its own component
  // so the venue switch stays a small change to this file and the handlers and
  // hooks above stay in one scope.
  function OndoBody() {
    const notices = (
      <>
        {perps.error && <Notice tone="error">{perps.error}</Notice>}
        {status.kind === "error" && (
          <Notice tone="error">{status.message}</Notice>
        )}
        {status.kind === "done" && (
          <Notice tone="success">{status.message}</Notice>
        )}

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
              <p className="mt-1 max-w-xl text-sm text-white/45">
                {unavailable}
              </p>
            </div>
          ) : (
            // One line, not a card. Signing in is a prerequisite rather than a
            // step worth explaining at length: the markets below already render
            // without it, so this only has to say what the button does.
            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] px-3 py-2">
              <span className="text-[11px] text-white/45">
                Sign in to place orders. One signature, no gas.
              </span>
              <button
                type="button"
                onClick={() => void onSignIn()}
                disabled={signingIn}
                className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
              >
                {signingIn ? "Check your wallet…" : "Sign in"}
              </button>
            </div>
          ))}

        {/* Margin is what gates every button on this tab, so adding it is
            offered here rather than sent to another surface. Opened from the
            ticket and one at a time: both cards describe the same balance, so
            showing both at once is two forms arguing over one number. The pair
            is still the point, though: an app that can only add margin has made
            the deposit a one-way door. */}
        {hasOndoSession && marginOpen && <OndoMarginCard margin={margin} />}
        {hasOndoSession && withdrawOpen && (
          <OndoWithdrawCard withdraw={withdraw} />
        )}

        {/* Rendered outside the session gate above. Withdrawn tokens belong to
            the user regardless of whether Ondo will still talk to them, and
            this card returns null when there is nothing on Ethereum, so it
            costs nothing in the common case. */}
        <OndoUnwindCard unwind={unwind} />
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

    const openHere = market
      ? perps.positions.find((p) => p.market === market.market)
      : undefined;

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
            <Metric
              label="Margin balance"
              value={usd(perps.marginBalanceUsd)}
              hint={`${usd(margin.readyUsd)} USDC in wallet`}
            />
            <Metric
              label="Available margin"
              value={usd(perps.availableMarginUsd)}
              hint="free to open with"
            />
            <Metric
              label="Collateral LTV"
              value={perps.health ? percent(perps.health.ltv) : "—"}
              hint={
                perps.health && perps.health.ltv > 0
                  ? "Ondo sells collateral at 30%"
                  : undefined
              }
              tone={
                perps.health && perps.health.ltv >= 0.25 ? "negative" : undefined
              }
            />
            <Metric label="Margin mode" value="Cross" hint="one shared balance" />
          </div>
        ),
      },
    ];

    return (
      <>
        <PerpsTerminal
          header={
            <div className={`${PANEL} px-3 py-2.5`}>
              <MarketHeader
                markets={perps.markets}
                selected={market ?? null}
                onSelect={(m) => setSelected(m.market)}
                loading={perps.loading}
              />
            </div>
          }
          notices={notices}
          chart={
            market ? (
              // Ondo's own candles and mark price, on the same canvas the
              // Lighter column draws into. Keyed on the market so a switch
              // starts the feeds fresh rather than showing the previous
              // market's bars under the new name.
              <OndoPerpsChart key={market.market} market={market} />
            ) : (
              <div
                className={`${PANEL} flex h-full items-center justify-center text-sm text-white/35`}
              >
                No market available.
              </div>
            )
          }
          ticket={
            market ? (
              <Ticket
                market={market}
                tradable={perps.status === "ready"}
                busy={status.kind === "working"}
                availableMarginUsd={perps.availableMarginUsd}
                openHere={openHere}
                canAddMargin={hasOndoSession}
                canWithdraw={hasOndoSession && perps.marginBalanceUsd > 0}
                onAddMargin={() => {
                  setWithdrawOpen(false);
                  setMarginOpen(true);
                }}
                onWithdraw={() => {
                  setMarginOpen(false);
                  setWithdrawOpen(true);
                }}
                onTrade={(side, notional) => void onTrade(side, notional)}
                onError={(m) => setStatus({ kind: "error", message: m })}
              />
            ) : null
          }
          tabs={tabs}
        />

        <p className="mt-3 text-[11px] leading-relaxed text-white/30">
          Perpetual futures on Ondo Perps. Margin is cross: every position shares
          one balance, so a loss on one can liquidate another. Tokenized stock
          posted as collateral is credited at its mark less a haircut, and Ondo
          can sell it to clear debt at 30 percent loan-to-value. That is separate
          from liquidation and leaves positions open. Markets follow the
          underlying exchange calendars and are not open continuously.
        </p>
      </>
    );
  }
}

function TopBar({
  venue,
  onVenue,
  refreshing,
  onRefresh,
}: {
  venue: Venue;
  onVenue: (v: Venue) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-medium tracking-tight text-white">Perps</span>
        <span className="hidden text-xs text-white/35 sm:inline">
          Trade perpetual futures directly
        </span>
      </div>
      <div className="flex items-center gap-2">
        {VENUES.length > 1 && (
        <div className="flex items-center rounded-lg border border-white/10 p-0.5">
          {VENUES.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onVenue(v.id)}
              className={`rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                venue === v.id
                  ? "bg-white/10 text-white"
                  : "text-white/45 hover:text-white/70"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
        >
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

function Ticket({
  market,
  tradable,
  busy,
  availableMarginUsd,
  openHere,
  canAddMargin,
  canWithdraw,
  onAddMargin,
  onWithdraw,
  onTrade,
  onError,
}: {
  market: OndoMarket;
  tradable: boolean;
  busy: boolean;
  availableMarginUsd: number;
  // The position on THIS market, if any. Stated in the ticket because it is
  // what the order being sized will add to or offset.
  openHere?: OndoPosition;
  canAddMargin: boolean;
  canWithdraw: boolean;
  onAddMargin: () => void;
  onWithdraw: () => void;
  onTrade: (side: "buy" | "sell", notionalUsd: string) => void;
  onError: (message: string) => void;
}) {
  const [notional, setNotional] = useState("500");
  const [side, setSide] = useState<TicketSide>("long");
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

  // The largest order the free margin covers at the chosen leverage, which is
  // what the sizing slider is a fraction of. It moves with the leverage
  // control, because on this venue leverage is what decides how far a dollar of
  // margin reaches.
  const maxNotionalUsd = availableMarginUsd * Math.max(1, leverage);

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

  const entryPrice = Number(market.price);
  const positionSize =
    valid && entryPrice > 0 ? notionalUsd / entryPrice : null;

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
        ? `${openHere.direction === "short" ? "Short" : "Long"} ${trim(openHere.netQuantity)} · ${usd(Number(openHere.notionalValue))}`
        : "None",
      muted: !openHere,
    },
  ];

  const rows: TicketRow[] = [
    { label: "Entry (approx)", value: usd(entryPrice), muted: true },
    {
      label: "Order size",
      value:
        positionSize == null
          ? "—"
          : `${trim(positionSize.toFixed(4))} ${marketTicker(market.market)}`,
    },
    { label: "Order value", value: valid ? usd(notionalUsd) : "—" },
    { label: "Margin required", value: usd(requiredMarginUsd) },
    {
      label: "Taker fee",
      value: usd(valid ? notionalUsd * Number(market.takerFee) : 0),
    },
  ];

  const warnings: string[] = [];
  if (market.isClosed) {
    warnings.push(
      `${marketTicker(market.market)} is closed. A market order needs an open book, so it will be refused until it reopens.`,
    );
  }
  if (!affordable && valid && tradable) {
    warnings.push(
      `That needs ${usd(requiredMarginUsd)} of margin and you have ${usd(availableMarginUsd)}. Lower the size, raise the leverage, or post more collateral.`,
    );
  }

  return (
    <PerpsTicket
      symbol={marketTicker(market.market)}
      side={side}
      onSide={setSide}
      context={context}
      amount={notional}
      onAmount={setNotional}
      presets={NOTIONALS}
      sizing={{ maxUsd: maxNotionalUsd }}
      leverage={{
        value: leverage,
        min: 1,
        max,
        onChange: (next) => void applyLeverage(next),
        saving: savingLeverage,
      }}
      rows={rows}
      warnings={warnings}
      tradable={tradable}
      busy={busy}
      submittable={valid && !market.isClosed}
      disabledReason="Sign in and post margin to trade."
      onSubmit={(next) => onTrade(next === "long" ? "buy" : "sell", notional)}
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
  positions: OndoPosition[];
  busy: boolean;
  onSelect: (market: string) => void;
  onClose: (position: OndoPosition) => void;
}) {
  return (
    <div>
      <div className="hidden grid-cols-12 gap-4 border-b border-white/[0.06] px-4 py-2 lg:grid">
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
                    p.direction === "short"
                      ? "text-aeras-negative"
                      : "text-aeras-positive"
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
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? "text-aeras-positive"
      : tone === "negative"
        ? "text-aeras-negative"
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
      ? "border-aeras-negative/25 bg-aeras-negative/10 text-red-300"
      : tone === "success"
        ? "border-aeras-positive/30 bg-aeras-positive/10 text-emerald-300"
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
