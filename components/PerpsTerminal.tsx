"use client";

// The terminal chrome both perps venues render into.
//
// The tab used to be a form with a chart beside it: a stat strip, a market
// picker on its own row, a short chart, a ticket in a sidebar, and a positions
// table trailing underneath. Everything was stacked in reading order, which is
// the right shape for a page you scroll and the wrong one for a screen you sit
// on. A perps surface is read next to the venue's own, and those are laid out as
// three columns under one market header, so nothing scrolls while you are
// working: the market you are trading, the depth you are trading into, and the
// ticket are all in view at once.
//
// This holds the chrome and nothing else. It does not know what a market is,
// which venue is selected, or what any figure means; the venue sections pass
// their own header, chart, ticket and rail content in. That is the same split
// PerpsTicket already uses, and the same reason: CLAUDE.md keeps Lighter and
// Ondo side by side rather than behind an abstraction because the venues differ
// in ways worth showing, so the shared piece has to be the furniture, not the
// content.
//
// The middle column is reserved rather than invented. Lighter's own screen puts
// an order book there, which needs /orderBookOrders and /recentTrades, neither
// of which is wired or checked against production yet. `book` is the slot it
// will land in; until something is passed, the chart takes the width instead of
// a placeholder sitting there claiming a feature we do not have.

import { useState } from "react";

import { INSET_PANEL } from "@/lib/ui/surface";

export const TERMINAL_LABEL =
  "text-[10px] font-medium uppercase tracking-[0.12em] text-white/40";

export interface TerminalTab {
  id: string;
  label: string;
  // Rendered as a small count beside the label. Omitted rather than shown as
  // zero, because "Positions 0" reads as a broken figure where "Positions"
  // reads as an empty tab.
  count?: number;
  content: React.ReactNode;
}

export function PerpsTerminal({
  header,
  notices,
  chart,
  book,
  ticket,
  tabs,
}: {
  // Market selector plus the live stat rail. Full width, above the columns.
  header: React.ReactNode;
  // Errors, sign-in prompts and the margin forms. Full width, because they are
  // forms and conversations rather than panels, and because a margin shortfall
  // is not something to discover inside a column.
  notices?: React.ReactNode;
  chart: React.ReactNode;
  // The order book column. See the note at the top of this file.
  book?: React.ReactNode;
  ticket: React.ReactNode;
  // The bottom rail. Positions, account state, anything read after the fact
  // rather than acted on while sizing.
  tabs: TerminalTab[];
}) {
  return (
    <div className="mt-3 space-y-3">
      {header}
      {notices}

      <div
        className={`grid gap-3 ${
          book
            ? "lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_13.5rem_19rem]"
            : "lg:grid-cols-[minmax(0,1fr)_19rem]"
        }`}
      >
        {/* A floor, not a fixed height. The row is as tall as the ticket, which
            is the one column whose height is content and not a choice, and the
            chart stretches into it so the three columns end on the same line.
            Pinning the chart instead left a dead band under it on every screen,
            which is worse than the small reflow when a warning appears in the
            ticket. */}
        <div className="min-h-[22rem] min-w-0 lg:min-h-[28rem]">{chart}</div>
        {book && (
          <div className="hidden min-h-[28rem] min-w-0 xl:block">{book}</div>
        )}
        <div className="min-w-0">{ticket}</div>
      </div>

      <TerminalRail tabs={tabs} />
    </div>
  );
}

// The bottom rail.
//
// Tabbed rather than stacked. Positions and account state are both read after a
// decision rather than during one, and stacking them pushed the account figures
// below the fold on every screen that had a position open. The tab strip also
// gives the rail a fixed height, so opening a position does not shove the page.
function TerminalRail({ tabs }: { tabs: TerminalTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);

  // Resolved by lookup rather than by index, so a tab appearing or leaving
  // (Positions only exists once there is one) cannot silently switch which
  // panel is shown.
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!current) return null;

  return (
    <div className={INSET_PANEL}>
      <div className="flex items-center gap-1 border-b border-white/[0.07] px-2 py-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
              tab.id === current.id
                ? "bg-white/10 text-white"
                : "text-white/45 hover:text-white/75"
            }`}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className="ml-1.5 font-mono tabular-nums text-white/40">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
      {current.content}
    </div>
  );
}

// The market header: selector on the left, live stats to the right of it.
//
// The stats scroll horizontally on their own rather than wrapping. Wrapping
// pushed the columns below down by a row at some widths and not others, so the
// chart changed height as the window moved; scrolling keeps the header exactly
// one row tall at every width, which is what makes the layout below it stable.
export function TerminalHeader({
  selector,
  stats,
  note,
}: {
  selector: React.ReactNode;
  stats: React.ReactNode;
  // A market-level warning: halted, closed, disabled by the venue.
  note?: React.ReactNode;
}) {
  return (
    <div className={`${INSET_PANEL} px-3 py-2.5`}>
      <div className="flex items-center gap-4">
        <div className="shrink-0">{selector}</div>
        <div className="flex min-w-0 flex-1 items-center gap-6 overflow-x-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {stats}
        </div>
      </div>
      {note && <div className="mt-2">{note}</div>}
    </div>
  );
}

// One cell in the header rail.
//
// `emphasis` is for the mark, which is the one figure on the row a trader looks
// at continuously and the only reason to break the rail's even rhythm.
export function TerminalStat({
  label,
  value,
  tone,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  hint?: string;
  emphasis?: boolean;
}) {
  const color =
    tone === "positive"
      ? "text-aeras-positive"
      : tone === "negative"
        ? "text-aeras-negative"
        : "text-white";

  return (
    <div className="shrink-0">
      <div className={TERMINAL_LABEL}>{label}</div>
      <div
        className={`mt-0.5 font-mono tabular-nums ${
          emphasis ? "text-[15px]" : "text-[13px]"
        } ${color}`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-white/30">{hint}</div>}
    </div>
  );
}
