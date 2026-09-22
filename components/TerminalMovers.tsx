"use client";

// The day's biggest moves across the catalog and the crypto majors: gainers
// and losers as two short lists side by side, one row per name with its
// mark, symbol, price and move. Lists rather than chip rows because five
// names read faster down a column than across a scroll, and the two columns
// answer "what rose" and "what fell" at a glance.

import { QuoteRows } from "@/components/QuoteRow";
import type { Movers } from "@/lib/terminal/movers";
import type { Quote } from "@/lib/terminal/quotes";

export function TerminalMovers({
  movers,
  onSelect,
}: {
  movers: Movers;
  onSelect: (quote: Quote) => void;
}) {
  const empty = movers.gainers.length === 0 && movers.losers.length === 0;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Movers
        </div>
        <span className="text-[10px] text-white/30">24h</span>
      </div>
      {empty ? (
        <p className="text-sm text-white/40">Waiting for prices</p>
      ) : (
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <MoverList label="Gainers" quotes={movers.gainers} onSelect={onSelect} />
          <MoverList label="Losers" quotes={movers.losers} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

function MoverList({
  label,
  quotes,
  onSelect,
}: {
  label: string;
  quotes: readonly Quote[];
  onSelect: (quote: Quote) => void;
}) {
  return (
    <div>
      <div className="pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
        {label}
      </div>
      {quotes.length === 0 ? (
        <p className="py-2 text-xs text-white/35">None today</p>
      ) : (
        <QuoteRows quotes={quotes} onSelect={onSelect} />
      )}
    </div>
  );
}
