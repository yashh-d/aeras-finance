"use client";

// Headlines for one key, polled while mounted. A null key is idle: the rail
// renders one hook and swaps the key with its tab, so only the list on screen
// polls.
//
// The last response per key is kept for the session, so flipping between the
// company tab and the market tab, or between two assets, draws the previous
// list at once and refreshes behind it rather than blanking to a spinner.

import { useEffect, useState } from "react";

import { fetchNews } from "./client";
import type { NewsResponse } from "./types";

const REFRESH_MS = 5 * 60_000;

const lastByKey = new Map<string, NewsResponse>();

interface NewsState {
  key: string | null;
  data: NewsResponse | null;
  error: string | null;
}

export function useNews(key: string | null): {
  data: NewsResponse | null;
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<NewsState>(() => ({
    key,
    data: key ? (lastByKey.get(key) ?? null) : null,
    error: null,
  }));

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    async function load() {
      try {
        const next = await fetchNews(key as string);
        lastByKey.set(key as string, next);
        if (!cancelled) setState({ key, data: next, error: null });
      } catch (err) {
        if (cancelled) return;
        // Keep whatever this key already showed; only report the failure when
        // there is nothing to show instead.
        setState({
          key,
          data: lastByKey.get(key as string) ?? null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key]);

  // State written for a previous key must not show under the current one, so
  // a key change reads the session cache until its own fetch lands.
  const current: Pick<NewsState, "data" | "error"> =
    state.key === key
      ? state
      : { data: key ? (lastByKey.get(key) ?? null) : null, error: null };

  return {
    data: current.data,
    loading: key != null && current.data == null && current.error == null,
    error: current.error,
  };
}
