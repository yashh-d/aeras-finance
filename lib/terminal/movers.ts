// The day's biggest moves among a set of quotes, split by direction. Unpriced
// quotes and unchanged ones are neither gainers nor losers, so they are left
// out rather than sorted to an end.

import type { Quote } from "./quotes";

export interface Movers {
  gainers: Quote[];
  losers: Quote[];
}

export function movers(quotes: readonly Quote[], count: number): Movers {
  const priced = quotes.filter(
    (q): q is Quote & { change: number } => q.change != null && q.price != null,
  );
  return {
    gainers: priced
      .filter((q) => q.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, count),
    losers: priced
      .filter((q) => q.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, count),
  };
}
