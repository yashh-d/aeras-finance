"use client";

// Hooks over app/api/glider for the Markets card and the Positions view.
// Each keeps its last good value through a failed poll and reports the
// error beside it, the way useJupiterPrices does, so a Glider stumble dims a
// number rather than blanking a card.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchGliderHistory,
  fetchGliderPortfolio,
  fetchGliderStrategy,
} from "./client";
import type { GliderPortfolioView, GliderStrategyView, HistoryView } from "./types";

const STRATEGY_POLL_MS = 60_000;
const PORTFOLIO_POLL_MS = 30_000;

export interface GliderStrategyState {
  strategy: GliderStrategyView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useGliderStrategy(enabled = true): GliderStrategyState {
  const [strategy, setStrategy] = useState<GliderStrategyView | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchGliderStrategy();
      setStrategy(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refresh();
    };
    tick();
    const id = setInterval(tick, STRATEGY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, refresh]);

  return { strategy, loading, error, refresh };
}

export interface GliderHistoryState {
  history: HistoryView | null;
  loading: boolean;
  error: string | null;
}

// Once per mount. The server caches for a day; nothing here changes intraday.
export function useGliderHistory(enabled = true): GliderHistoryState {
  const [history, setHistory] = useState<HistoryView | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await fetchGliderHistory();
        if (!cancelled) {
          setHistory(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { history, loading, error };
}

export interface GliderPortfolioState {
  portfolio: GliderPortfolioView | null;
  // False until the server has said whether it has a key. The ticket draws
  // nothing about enrollment until it knows.
  known: boolean;
  keyConfigured: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// This user's portfolio. `enabled` is the EVM wallet being provisioned and
// the user being signed in; without either there is nothing to read.
export function useGliderPortfolio(enabled: boolean): GliderPortfolioState {
  const [portfolio, setPortfolio] = useState<GliderPortfolioView | null>(null);
  const [known, setKnown] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const next = await fetchGliderPortfolio();
        setPortfolio(next.portfolio);
        setKeyConfigured(next.keyConfigured);
        setKnown(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refresh();
    };
    tick();
    const id = setInterval(tick, PORTFOLIO_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, refresh]);

  // Disabled means there is nothing to load, so nothing is loading.
  return { portfolio, known, keyConfigured, loading: enabled && loading, error, refresh };
}
