"use client";

// Live figures for the Trader Earn grid, one read per venue in the registry,
// polled on the Earn tab's 60-second cadence. Each venue's reader is the one
// its own card already uses, so a figure on the grid is the figure on the
// venue's detail; there is no second rate calculation.
//
// A venue whose read fails keeps its last quote rather than blanking: a
// figure a minute old is still the venue's figure, and an empty card reads
// as "no yield here", which is wrong.

import { useEffect, useState } from "react";

import { fetchMonUsd, fetchShmonMetrics } from "@/lib/shmonad/client";

import type { EarnVenueId } from "./earn-venues";

const POLL_MS = 60_000;

export interface EarnVenueQuote {
  // Decimal. Null when the venue could not price itself.
  apy: number | null;
  // Total value locked in dollars, when a price is known.
  tvlUsd: number | null;
  // The same figure in the venue's own unit, for when it is not.
  tvlNative: string | null;
  // One short line under the rate: where it comes from.
  basis: string | null;
}

export type EarnVenueQuotes = Partial<Record<EarnVenueId, EarnVenueQuote>>;

async function readShmon(): Promise<EarnVenueQuote> {
  const [m, usd] = await Promise.all([fetchShmonMetrics(), fetchMonUsd()]);
  return {
    apy: m.apy,
    tvlUsd: usd != null ? m.tvlMon * usd : null,
    tvlNative: `${Math.round(m.tvlMon).toLocaleString()} MON`,
    basis:
      m.windowHours != null
        ? `share price over ${Math.round(m.windowHours / 24)} days`
        : null,
  };
}

const READERS: Record<EarnVenueId, () => Promise<EarnVenueQuote>> = {
  shmonad: readShmon,
};

export function useEarnVenueQuotes(): { quotes: EarnVenueQuotes; loading: boolean } {
  const [quotes, setQuotes] = useState<EarnVenueQuotes>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    async function load() {
      const ids = Object.keys(READERS) as EarnVenueId[];
      const results = await Promise.allSettled(ids.map((id) => READERS[id]()));
      if (!live) return;
      setQuotes((prev) => {
        const next: EarnVenueQuotes = { ...prev };
        results.forEach((r, i) => {
          if (r.status === "fulfilled") next[ids[i]] = r.value;
        });
        return next;
      });
      setLoading(false);
    }
    // Deferred a tick so the first state write lands in a callback rather
    // than in the effect body, the pattern the other pollers use.
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  return { quotes, loading };
}
