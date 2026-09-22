"use client";

// The current time as a value a component may read during render.
//
// Date.now() in a render is impure and the lint says so: a re-render for an
// unrelated reason would move every "3h ago" and every "past" flag. This holds
// one clock that ticks every half minute and is read through
// useSyncExternalStore, so a render sees one stable value and the page moves
// on the tick, not on the render. On the server it is null: an SSR pass has
// no business deciding what has already happened, and null means a
// time-dependent row simply waits for hydration.

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  // Refreshed on subscribe, not only on the tick: the module may have loaded
  // long before the first component mounted.
  now = Date.now();
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

function getServerSnapshot(): null {
  return null;
}

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
