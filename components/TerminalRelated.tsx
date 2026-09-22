"use client";

// Other catalog assets in the selected one's sector, as a short list.
// Selecting one selects it everywhere: the chart, the ticket and the news
// follow.

import { QuoteRows } from "@/components/QuoteRow";
import { relatedAssets } from "@/lib/company/listing";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { XStock } from "@/lib/jupiter/xstocks";
import { catalogQuote } from "@/lib/terminal/quotes";

const LIMIT = 6;

export function TerminalRelated({
  xstock,
  prices,
  onSelect,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  onSelect: (xstock: XStock) => void;
}) {
  const related = relatedAssets(xstock, LIMIT);
  if (related.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        Related
      </div>
      <QuoteRows
        quotes={related.map((x) => catalogQuote(x, prices))}
        onSelect={(q) => {
          if (q.target.kind === "asset") onSelect(q.target.xstock);
        }}
      />
    </div>
  );
}
