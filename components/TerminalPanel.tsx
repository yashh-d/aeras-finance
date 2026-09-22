"use client";

// The Terminal: the market on one screen, in the shape a trading terminal
// uses rather than the shape a page does. A tape and an overview strip across
// the top; below them the selected asset's chart with its ticket beside it,
// and the catalog with the rail beside that: news, then the catalog's
// earnings, then the week's macro calendar. Nothing here is new
// machinery: prices, sparklines, the chart, the ticket and the perp marks are
// the same hooks and components Home and Markets draw, and the only state the
// panel owns is what is selected: a catalog asset, or a bare Lighter market
// (see lib/terminal/selection.ts).
//
// Selection is one value that four surfaces write (tape, strip, cards, and the
// ticket reads it), which is why it lives here and not in any of them.

import { useCallback, useEffect, useState } from "react";

import { TerminalAssetDetail } from "@/components/TerminalAssetDetail";
import { TerminalCalendar } from "@/components/TerminalCalendar";
import { TerminalEarnings } from "@/components/TerminalEarnings";
import { TerminalMacro } from "@/components/TerminalMacro";
import { TerminalMovers } from "@/components/TerminalMovers";
import { TerminalNews } from "@/components/TerminalNews";
import { TerminalOverview } from "@/components/TerminalOverview";
import { TerminalPerpDetail } from "@/components/TerminalPerpDetail";
import { TerminalPerpLink } from "@/components/TerminalPerpLink";
import { TerminalPerps } from "@/components/TerminalPerps";
import { TerminalRelated } from "@/components/TerminalRelated";
import { TerminalStocks } from "@/components/TerminalStocks";
import { TerminalTicket, type TicketMode } from "@/components/TerminalTicket";
import { TickerTape } from "@/components/TickerTape";
import { hasLendingMarket } from "@/lib/borrow/availability";
import { useEarnings } from "@/lib/calendar/use-earnings";
import { useMacro } from "@/lib/calendar/use-macro";
import { fetchSparklines, type SparklinesResponse } from "@/lib/jupiter/charts";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { useTriggerAuth } from "@/lib/jupiter/use-trigger-auth";
import { XSTOCKS, type XStock } from "@/lib/jupiter/xstocks";
import { useLighterCatalog } from "@/lib/lighter/use-catalog";
import { useLighterPerps } from "@/lib/lighter/use-lighter-perps";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import type { AccountBalances } from "@/lib/solana/balances";
import { movers } from "@/lib/terminal/movers";
import {
  allPerpQuotes,
  overviewQuotes,
  tapeQuotes,
  underlyingTicker,
  type Quote,
} from "@/lib/terminal/quotes";
import {
  selectionForPerp,
  selectionId,
  type TerminalSelection,
} from "@/lib/terminal/selection";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import { GLASS_SURFACE } from "@/lib/ui/surface";

const SPARKLINE_REFRESH_MS = 60_000;

// The rail cards the header links jump to. Ids are on the sections below.
const JUMP_LINKS: readonly { id: string; label: string }[] = [
  { id: "terminal-earnings", label: "Earnings" },
  { id: "terminal-news", label: "News" },
  { id: "terminal-macro", label: "Macro events" },
];
// Chips per movers row. Five is what fits the two-thirds column at a laptop
// width; the row scrolls past that, but the point of the row is the top of it.
const MOVERS_PER_SIDE = 5;
// Markets on the perps row. Lighter lists over two hundred; the row shows
// the busiest and the picker has the rest.
const PERPS_ROW_LIMIT = 40;

export function TerminalPanel({
  prices,
  pricesError,
  balances,
  scan,
  walletAddress,
  auth,
  onRefresh,
}: {
  prices: JupiterPriceMap | null;
  pricesError: string | null;
  balances: AccountBalances | null;
  scan: WalletScan;
  walletAddress: string | null;
  auth: ReturnType<typeof useTriggerAuth>;
  onRefresh: () => void;
}) {
  const [selection, setSelection] = useState<TerminalSelection>({
    kind: "asset",
    xstock: XSTOCKS[0],
  });
  // The catalog asset on screen, or null for a bare market. Everything that
  // needs a company (news, earnings, related, spot and borrow) reads this.
  const selected: XStock | null = selection.kind === "asset" ? selection.xstock : null;
  const [sparks, setSparks] = useState<SparklinesResponse | null>(null);
  const catalog = useLighterCatalog();

  // Which of the ticket's modes is open. Held here because the chart follows
  // it: in perps mode the column draws the Lighter market, which is a
  // different instrument at a different price from the xStock below it.
  const [mode, setMode] = useState<TicketMode>("spot");
  // Which header's asset picker is open, so that card can sit above its
  // siblings: each card is its own stacking context, and a panel hanging
  // below one would otherwise paint under the next.
  const [pickerOpen, setPickerOpen] = useState<"detail" | "ticket" | null>(null);
  // The limit form's price while it is open, drawn on the chart as a line so
  // the order is seen where it would fill. Null whenever the form is not.
  const [limit, setLimit] = useState<{ price: number; side: "buy" | "sell" } | null>(null);
  // Stable, because the limit form lists it as an effect dependency: a fresh
  // arrow each render would re-run that effect on every render.
  const onLimitPriceChange = useCallback(
    (price: number | null, side: "buy" | "sell") =>
      setLimit(price == null ? null : { price, side }),
    [],
  );
  // The month calendar overlay: whether it is open, the day it opens on, and
  // a counter that keys the overlay so each opening mounts fresh on its day.
  const [calendar, setCalendar] = useState<{ open: boolean; day: string | null; session: number }>({
    open: false,
    day: null,
    session: 0,
  });
  const openCalendar = (day?: string) =>
    setCalendar((c) => ({ open: true, day: day ?? null, session: c.session + 1 }));
  function pick(next: TerminalSelection, nextMode: TicketMode) {
    setSelection(next);
    setMode(nextMode);
  }
  function pickAsset(xstock: XStock, nextMode: TicketMode = "spot") {
    pick({ kind: "asset", xstock }, nextMode);
  }
  const perpSymbol =
    selection.kind === "perp" ? selection.symbol : underlyingTicker(selection.xstock);
  const perpMarket = catalog.markets.find((m) => m.symbol === perpSymbol) ?? null;
  const modes: TicketMode[] = [];
  if (selected) modes.push("spot");
  if (perpMarket || !selected) modes.push("perps");
  if (selected && hasLendingMarket(selected.mint)) modes.push("borrow");
  // Selecting something without the open mode falls back to its first mode:
  // spot for an asset, perps for a bare market.
  const activeMode: TicketMode = modes.includes(mode) ? mode : modes[0];

  // The perps account, polled only while the perps mode is on screen. The
  // hook takes the embedded EVM wallet because that is the key Lighter
  // accounts are provisioned under.
  const evm = useEmbeddedEvmWallet();
  const lighter = useLighterPerps({
    l1Address: evm.address,
    enabled: activeMode === "perps",
  });
  const earnings = useEarnings();
  const macro = useMacro();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await fetchSparklines();
        if (!cancelled) setSparks(next);
      } catch {
        // The cards draw without a sparkline; not worth an error.
      }
    }
    load();
    const id = setInterval(load, SPARKLINE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tape = tapeQuotes(prices, catalog.markets);
  const overview = overviewQuotes(prices, catalog.markets);
  // Movers are drawn from the tape's set, the catalog plus the crypto majors,
  // and not from the equity perps as well: a perp moves with its underlying,
  // and listing both would show every big move twice.
  const moved = movers(tape, MOVERS_PER_SIDE);
  const perps = allPerpQuotes(catalog.markets, PERPS_ROW_LIMIT);

  // A quote anywhere on the page selects here: an asset in spot, a perp as
  // its catalog asset in perps mode when it has one, else the bare market.
  function open(quote: Quote) {
    if (quote.target.kind === "asset") pickAsset(quote.target.xstock);
    else pick(selectionForPerp(quote.target.symbol), "perps");
  }

  const showingPerp = activeMode === "perps" && perpMarket != null;
  const nextEarningsAt =
    (selected && earnings.data?.rows.find((r) => r.mint === selected.mint)?.nextAt) ?? null;

  return (
    <div className="space-y-6">
      {/* First thing on the page, above the title: a tape is a strip along
          the top edge of a screen, and under a heading it read as a widget. */}
      <TickerTape quotes={tape} onSelect={open} />

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Terminal
          </div>
          <h2 className="font-light text-2xl tracking-tight text-white">
            Markets, news and trading
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          {/* Jump links to the rail's reference cards, which sit below the
              fold on a laptop. Buttons that scroll rather than hash links, so
              the URL does not change and the app router is not involved. */}
          <nav aria-label="Terminal sections" className="flex items-center gap-4 text-xs">
            {JUMP_LINKS.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() =>
                  document
                    .getElementById(link.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="text-white/50 transition-colors hover:text-white"
              >
                {link.label}
              </button>
            ))}
            {/* The month calendar is an overlay, not a card, so its link opens
                it rather than scrolling. */}
            <button
              type="button"
              onClick={() => openCalendar()}
              className="text-white/50 transition-colors hover:text-white"
            >
              Market calendar
            </button>
          </nav>
          {pricesError ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-aeras-warning">
              <span className="inline-block size-1.5 rounded-full bg-aeras-warning" />
              Price feed offline
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-white/50">
              <span className="inline-block size-1.5 rounded-full bg-aeras-positive" />
              Live
            </span>
          )}
        </div>
      </div>

      <TerminalOverview
        quotes={overview}
        selectedId={selectionId(selection)}
        onSelect={open}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section
            className={`${GLASS_SURFACE} p-5 text-white lg:p-6 ${
              pickerOpen === "detail" ? "relative z-30" : ""
            }`}
          >
            {selected ? (
              <TerminalAssetDetail
                xstock={selected}
                prices={prices}
                showingPerp={showingPerp}
                perpMarket={perpMarket}
                perpMarkets={catalog.markets}
                catalogLoading={catalog.loading}
                catalogError={catalog.error}
                nextEarningsAt={nextEarningsAt}
                marker={
                  limit && !showingPerp
                    ? { price: limit.price, label: limit.side === "buy" ? "Buy limit" : "Sell limit" }
                    : undefined
                }
                onPick={pick}
                onPickerOpen={(open) =>
                  setPickerOpen((prev) => (open ? "detail" : prev === "detail" ? null : prev))
                }
              />
            ) : (
              <TerminalPerpDetail
                symbol={perpSymbol}
                market={perpMarket}
                perpMarkets={catalog.markets}
                prices={prices}
                catalogLoading={catalog.loading}
                catalogError={catalog.error}
                onPick={pick}
                onPickerOpen={(open) =>
                  setPickerOpen((prev) => (open ? "detail" : prev === "detail" ? null : prev))
                }
              />
            )}
          </section>

          <section className={`${GLASS_SURFACE} p-5 text-white lg:p-6`}>
            <TerminalMovers movers={moved} onSelect={open} />
          </section>

          <section className={`${GLASS_SURFACE} p-5 text-white lg:p-6`}>
            <TerminalPerps
              quotes={perps}
              loading={catalog.loading}
              error={catalog.error}
              onSelect={open}
            />
          </section>

          <section className={`${GLASS_SURFACE} p-5 text-white lg:p-6`}>
            <div className="pb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
              Assets
            </div>
            <TerminalStocks
              prices={prices}
              sparks={sparks}
              selectedMint={selected?.mint ?? ""}
              onSelect={(x) => pickAsset(x)}
            />
          </section>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <section
            className={`${GLASS_SURFACE} p-5 text-white lg:p-6 ${
              pickerOpen === "ticket" ? "relative z-30" : ""
            }`}
          >
            <TerminalTicket
              selection={selection}
              mode={activeMode}
              modes={modes}
              onMode={setMode}
              prices={prices}
              balances={balances}
              scan={scan}
              walletAddress={walletAddress}
              auth={auth}
              onRefresh={onRefresh}
              perpMarket={perpMarket}
              perpMarkets={catalog.markets}
              perps={activeMode === "perps" ? lighter : null}
              onLimitPriceChange={onLimitPriceChange}
              onPick={pick}
              onPickerOpen={(open) =>
                setPickerOpen((prev) => (open ? "ticket" : prev === "ticket" ? null : prev))
              }
            />
          </section>

          {selected && perpMarket && activeMode !== "perps" && (
            <section className={`${GLASS_SURFACE} p-4 text-white lg:p-5`}>
              <TerminalPerpLink
                xstock={selected}
                market={perpMarket}
                onOpen={() => setMode("perps")}
              />
            </section>
          )}

          {selected && (
            <section className={`${GLASS_SURFACE} p-5 text-white lg:p-6`}>
              <TerminalRelated xstock={selected} prices={prices} onSelect={(x) => pickAsset(x)} />
            </section>
          )}

          <section
            id="terminal-news"
            className={`${GLASS_SURFACE} scroll-mt-6 p-5 text-white lg:p-6`}
          >
            <TerminalNews asset={selected} />
          </section>

          <section
            id="terminal-earnings"
            className={`${GLASS_SURFACE} scroll-mt-6 p-5 text-white lg:p-6`}
          >
            <TerminalEarnings
              data={earnings.data}
              loading={earnings.loading}
              error={earnings.error}
              onSelect={(x) => pickAsset(x)}
              onOpenCalendar={() => openCalendar()}
            />
          </section>

          <section
            id="terminal-macro"
            className={`${GLASS_SURFACE} scroll-mt-6 p-5 text-white lg:p-6`}
          >
            <TerminalMacro
              data={macro.data}
              loading={macro.loading}
              error={macro.error}
              onOpenCalendar={() => openCalendar()}
            />
          </section>
        </div>
      </div>

      <TerminalCalendar
        key={calendar.session}
        open={calendar.open}
        onClose={() => setCalendar((c) => ({ ...c, open: false }))}
        initialDay={calendar.day}
        earnings={earnings.data}
        macro={macro.data}
        onSelect={(x) => pickAsset(x)}
      />
    </div>
  );
}
