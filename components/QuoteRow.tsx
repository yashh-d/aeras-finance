"use client";

// One quote as a plain row: mark, symbol, price, move. The movers, the perps
// list and the related list are all rows of these, in one or two columns.
// Rows rather than chips: a chip's border and padding spend a third of the
// width on the frame, and five of them in a scroll read slower than five
// lines down a column.

import { QuoteMark } from "@/components/QuoteMark";
import { changeColor, formatChange, formatQuotePrice } from "@/lib/terminal/display";
import type { Quote } from "@/lib/terminal/quotes";

export function QuoteRow({
  quote,
  onClick,
}: {
  quote: Quote;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
    >
      <QuoteMark quote={quote} size={22} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight text-white">
        {quote.symbol}
      </span>
      <span className="font-mono text-xs tabular-nums text-white/75">
        {formatQuotePrice(quote.price)}
      </span>
      <span className={`w-16 shrink-0 text-right font-mono text-xs tabular-nums ${changeColor(quote.change)}`}>
        {formatChange(quote.change)}
      </span>
    </button>
  );
}

// A list of rows, split into columns on wider screens when asked.
export function QuoteRows({
  quotes,
  onSelect,
  columns = 1,
}: {
  quotes: readonly Quote[];
  onSelect: (quote: Quote) => void;
  columns?: 1 | 2;
}) {
  if (columns === 1) {
    return (
      <div className="divide-y divide-white/[0.06]">
        {quotes.map((q) => (
          <QuoteRow key={q.id} quote={q} onClick={() => onSelect(q)} />
        ))}
      </div>
    );
  }
  const half = Math.ceil(quotes.length / 2);
  const halves = [quotes.slice(0, half), quotes.slice(half)];
  return (
    <div className="grid gap-x-6 sm:grid-cols-2">
      {halves.map((list, i) => (
        <div key={i} className="divide-y divide-white/[0.06]">
          {list.map((q) => (
            <QuoteRow key={q.id} quote={q} onClick={() => onSelect(q)} />
          ))}
        </div>
      ))}
    </div>
  );
}
