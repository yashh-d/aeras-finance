"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ViewMode = "list" | "grid";

// A remembered list-or-grid choice, one store per storage key.
//
// The card holding the choice unmounts whenever the user leaves its tab, so the
// choice has to outlive the component or the toggle reads as broken: pick grid,
// open another tab, come back to a list.
//
// Held as an external store rather than as state hydrated in an effect. These
// surfaces are still server-rendered for the initial HTML, where localStorage
// does not exist, so a lazy useState initialiser would disagree with the client
// and trip hydration. useSyncExternalStore is the API for that split: the server
// snapshot is always "list", and React reconciles to the stored value on the
// client without a cascading render.
//
// Keyed rather than global because Home and Markets keep separate preferences.
// They show different things — Markets carries a holdings column and the whole
// catalog — so wanting the table on one and tiles on the other is reasonable.

interface ViewStore {
  cached: ViewMode | null;
  listeners: Set<() => void>;
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => ViewMode;
}

// One store per key, created once. useSyncExternalStore compares `subscribe`
// and `getSnapshot` by identity and resubscribes when either changes, so these
// have to be the same functions on every render, not rebuilt per call.
const stores = new Map<string, ViewStore>();

function storeFor(key: string): ViewStore {
  const existing = stores.get(key);
  if (existing) return existing;

  const store: ViewStore = {
    cached: null,
    listeners: new Set(),
    subscribe(onChange) {
      store.listeners.add(onChange);
      return () => {
        store.listeners.delete(onChange);
      };
    },
    getSnapshot() {
      if (store.cached == null) {
        try {
          store.cached =
            window.localStorage.getItem(key) === "grid" ? "grid" : "list";
        } catch {
          // Private browsing can throw on access. The default stands.
          store.cached = "list";
        }
      }
      return store.cached;
    },
  };
  stores.set(key, store);
  return store;
}

// Stable identity, for the same reason the store's methods are.
function getServerSnapshot(): ViewMode {
  return "list";
}

export function useViewMode(key: string): [ViewMode, (next: ViewMode) => void] {
  const store = storeFor(key);
  const view = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    getServerSnapshot,
  );

  const setView = useCallback(
    (next: ViewMode) => {
      const target = storeFor(key);
      target.cached = next;
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Preference just does not persist. Not worth surfacing.
      }
      for (const listener of target.listeners) listener();
    },
    [key],
  );

  return [view, setView];
}
