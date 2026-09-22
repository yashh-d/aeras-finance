"use client";

// The strip of prices that runs across the top of the Terminal. Each cell is
// the mark, the name, the price and the day's move, the same grammar as the
// overview row beneath it.
//
// The quotes are rendered twice, side by side, and the strip slides left by
// exactly one copy's width before starting over, so the loop has no seam. The
// duration scales with the number of quotes so the tape moves at the same
// speed whether it carries twelve or forty. Hovering pauses it, since a moving
// figure cannot be read or clicked; a reduced-motion preference stops it
// altogether and the strip scrolls by hand instead (see .aeras-tape in
// globals.css). The second copy is hidden from assistive technology and the
// tab order, because it is the same content twice.

import type { CSSProperties } from "react";

import { QuoteMark } from "@/components/QuoteMark";
import { changeColor, formatChange, formatQuotePrice } from "@/lib/terminal/display";
import type { Quote } from "@/lib/terminal/quotes";

// Seconds each quote takes to cross, which is what sets the speed whatever
// the count. 4.5 is a reading pace: the cells carry a name and a mark now, so
// they are wider than the ticker-only cells the earlier 2.6 was tuned for,
// and at that figure the row went by faster than a price could be read.
const SECONDS_PER_QUOTE = 4.5;
const MIN_DURATION_S = 40;

export function TickerTape({
  quotes,
  onSelect,
}: {
  quotes: readonly Quote[];
  onSelect: (quote: Quote) => void;
}) {
  const duration = Math.max(MIN_DURATION_S, quotes.length * SECONDS_PER_QUOTE);

  return (
    // No box and no cell borders: the cells are the same mark, name, price
    // and move the overview row under it draws, and the two read as one
    // instrument rather than a boxed strip over a bare line. The edge fade is
    // what says the row continues.
    <div
      className="aeras-tape-viewport relative py-1 [mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%_-_2.5rem),transparent)]"
      aria-label="Ticker tape"
    >
      {quotes.length === 0 ? (
        <div className="py-2 text-xs text-white/40">Loading prices</div>
      ) : (
        <div
          className="aeras-tape"
          style={
            { "--aeras-tape-duration": `${duration}s` } as CSSProperties
          }
        >
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className="flex shrink-0"
              aria-hidden={copy === 1 ? true : undefined}
            >
              {quotes.map((quote) => (
                <TapeCell
                  key={quote.id}
                  quote={quote}
                  onClick={() => onSelect(quote)}
                  focusable={copy === 0}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TapeCell({
  quote,
  onClick,
  focusable,
}: {
  quote: Quote;
  onClick: () => void;
  focusable: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={focusable ? 0 : -1}
      title={quote.symbol}
      className="group flex shrink-0 items-center gap-2 px-4 py-1.5 text-xs"
    >
      <QuoteMark quote={quote} size={18} />
      <span className="font-medium tracking-tight text-white transition-colors group-hover:text-white/80">
        {quote.name}
      </span>
      <span className="font-mono tabular-nums text-white/80">
        {formatQuotePrice(quote.price)}
      </span>
      <span className={`font-mono tabular-nums ${changeColor(quote.change)}`}>
        {formatChange(quote.change)}
      </span>
    </button>
  );
}
