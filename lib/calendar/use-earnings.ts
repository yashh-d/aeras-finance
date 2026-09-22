"use client";

import { fetchEarnings } from "./client";
import type { EarningsResponse } from "./earnings";
import { usePolled } from "./use-polled";

// The server caches for six hours; the page asks every thirty minutes so a
// refresh lands within the half hour without hammering the route.
const REFRESH_MS = 30 * 60_000;

export function useEarnings(): {
  data: EarningsResponse | null;
  loading: boolean;
  error: string | null;
} {
  return usePolled("earnings", fetchEarnings, REFRESH_MS);
}
