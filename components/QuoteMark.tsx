"use client";

// The mark for a quote, whichever kind of market it is. A catalog asset draws
// its catalog logo with the monogram fallback the asset rows use; a perp
// draws through the market-logo component, which knows the venue's badges,
// so gold shows "Au" on gold and the index products their numbers rather
// than the bare ticker in a grey circle.

import { AssetLogo } from "@/components/AssetLogo";
import { MarketLogo } from "@/components/MarketLogo";
import type { Quote } from "@/lib/terminal/quotes";

export function QuoteMark({ quote, size }: { quote: Quote; size: number }) {
  if (quote.target.kind === "perp") {
    return <MarketLogo market={quote.target.symbol} size={size} />;
  }
  return (
    <AssetLogo
      xstock={{ symbol: quote.symbol, name: quote.name, logo: quote.logo }}
      size={size}
    />
  );
}
