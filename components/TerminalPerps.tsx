"use client";

// Lighter's busiest markets by 24h volume, as two columns of rows. A row
// selects that market on the Terminal: a market on a catalog name lands on
// the asset in perps mode, any other on the perp-only view. The full list is
// in the picker.

import { QuoteRows } from "@/components/QuoteRow";
import type { Quote } from "@/lib/terminal/quotes";

export function TerminalPerps({
  quotes,
  loading,
  error,
  onSelect,
}: {
  quotes: readonly Quote[];
  loading: boolean;
  error: string | null;
  onSelect: (quote: Quote) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Perps
        </div>
        <span className="text-[10px] text-white/30">Busiest {quotes.length} · 24h</span>
      </div>
      {quotes.length > 0 ? (
        <QuoteRows quotes={quotes} onSelect={onSelect} columns={2} />
      ) : loading ? (
        <p className="text-sm text-white/40">Loading markets</p>
      ) : error ? (
        <p className="text-sm text-aeras-warning">Perp markets are unavailable right now.</p>
      ) : (
        <p className="text-sm text-white/40">No perp markets match the catalog.</p>
      )}
    </div>
  );
}
