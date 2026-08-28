"use client";

// Ondo perps market browser for the hedge tab.
//
// A browse surface, not a trading one. Hedges route through the venue body
// below it, which is driven by what the user holds rather than by what they
// pick here. The perps tab uses the same header but owns its catalog through
// its own hook, so only this wrapper fetches.

import { useEffect, useMemo, useState } from "react";

import { MarketHeader } from "@/components/MarketHeader";
import { fetchOndoCatalog } from "@/lib/ondo/client";
import type { OndoMarket } from "@/lib/ondo/types";

import { GLASS_SURFACE } from "@/lib/ui/surface";

export function OndoMarketsCard() {
  const [markets, setMarkets] = useState<OndoMarket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cat = await fetchOndoCatalog();
        if (cancelled) return;
        setMarkets(cat.markets);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error("[ondo catalog]", err);
          setError("Ondo's market list is unavailable right now.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Default to the deepest market rather than the first alphabetically, so the
  // card opens on something with a real price and real volume.
  const selected = useMemo(() => {
    if (markets.length === 0) return null;
    if (selectedId) {
      const hit = markets.find((m) => m.market === selectedId);
      if (hit) return hit;
    }
    return [...markets].sort(
      (a, b) => Number(b.usdVolume ?? 0) - Number(a.usdVolume ?? 0),
    )[0];
  }, [markets, selectedId]);

  return (
    <div className={`${GLASS_SURFACE} p-5 lg:p-6`}>
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Ondo perps
        </div>
        <div className="text-[11px] text-white/50">
          {markets.length > 0 ? `${markets.length} markets` : "Browse only"}
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-warning">
          {error}
        </p>
      ) : (
        <div className="mt-3">
          <MarketHeader
            markets={markets}
            selected={selected}
            onSelect={(m) => setSelectedId(m.market)}
            loading={loading}
          />
        </div>
      )}
    </div>
  );
}
