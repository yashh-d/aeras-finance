"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which of the two product surfaces the signed-in page shows.
//
// "investor" is the app as it has always been: every section, every venue,
// every ticket. "trader" is the card-first surface in components/trader: four
// sections, one card per venue or play, the same account underneath. See
// docs/trader-mode-plan.md.
//
// Remembered per browser the way the list-or-grid choice is
// (lib/ui/use-view-mode.ts), and for the same reason: the page is
// server-rendered first, where localStorage does not exist, so the choice
// lives in an external store whose server snapshot is the default and which
// React reconciles to the stored value on the client without tripping
// hydration.
export type AppMode = "investor" | "trader";

const KEY = "aeras.app.mode";
const DEFAULT: AppMode = "investor";

let cached: AppMode | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): AppMode {
  if (cached == null) {
    try {
      cached = window.localStorage.getItem(KEY) === "trader" ? "trader" : DEFAULT;
    } catch {
      cached = DEFAULT;
    }
  }
  return cached;
}

function getServerSnapshot(): AppMode {
  return DEFAULT;
}

export function useAppMode(): [AppMode, (next: AppMode) => void] {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setMode = useCallback((next: AppMode) => {
    cached = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // The choice just does not persist. Not worth surfacing.
    }
    for (const listener of listeners) listener();
  }, []);
  return [mode, setMode];
}
