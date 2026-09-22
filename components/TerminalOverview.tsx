"use client";

// The market at a glance under the tape: six quotes in one flat row, each a
// mark, a name, a price and the day's move. No card around any of them. The
// row is a line of figures to scan, not six panels to read, and boxes gave
// each figure a frame that took more of the screen than the figure did. The
// one whose asset is selected is named in the accent colour so the row and
// the chart below it agree.

import { QuoteMark } from "@/components/QuoteMark";
import { changeColor, formatChange, formatQuotePrice } from "@/lib/terminal/display";
import type { Quote } from "@/lib/terminal/quotes";

export function TerminalOverview({
  quotes,
  selectedId,
  onSelect,
}: {
  quotes: readonly Quote[];
  selectedId: string | null;
  onSelect: (quote: Quote) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-2 border-y border-white/[0.08] py-2.5">
      {quotes.map((quote) => {
        const selected = quote.id === selectedId;
        return (
          <button
            key={quote.id}
            type="button"
            onClick={() => onSelect(quote)}
            aria-pressed={selected}
            title={quote.symbol}
            className="group flex items-center gap-2 text-left"
          >
            <QuoteMark quote={quote} size={18} />
            <span
              className={`text-xs font-medium tracking-tight transition-colors ${
                selected ? "text-aeras-blue" : "text-white group-hover:text-white/80"
              }`}
            >
              {quote.name}
            </span>
            <span className="font-mono text-xs tabular-nums text-white/80">
              {formatQuotePrice(quote.price)}
            </span>
            <span className={`font-mono text-xs tabular-nums ${changeColor(quote.change)}`}>
              {formatChange(quote.change)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
