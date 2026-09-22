"use client";

// A value fetched on mount and again on an interval, with the last good
// result kept for the session so a remount draws it at once. The earnings
// and macro rails are both this shape; the news rail is not, because its key
// changes with a tab, so it has its own hook.

import { useEffect, useState } from "react";

const last = new Map<string, unknown>();

// A null key is idle: nothing is fetched and the hook reports not loading,
// which is how a surface that is not on screen keeps its data source quiet.
export function usePolled<T>(
  key: string | null,
  loader: () => Promise<T>,
  intervalMs: number,
): { data: T | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>(
    () => ({ key, data: key ? ((last.get(key) as T | undefined) ?? null) : null, error: null }),
  );

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    async function load() {
      try {
        const next = await loader();
        last.set(key as string, next);
        if (!cancelled) setState({ key, data: next, error: null });
      } catch (err) {
        if (!cancelled) {
          setState({
            key,
            data: (last.get(key as string) as T | undefined) ?? null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // The loader is a stable module function for every caller; the key is
    // what identifies the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);

  // State written for a previous key must not show under the current one.
  const current =
    state.key === key
      ? state
      : { data: key ? ((last.get(key) as T | undefined) ?? null) : null, error: null };

  return {
    data: current.data,
    loading: key != null && current.data == null && current.error == null,
    error: current.error,
  };
}
