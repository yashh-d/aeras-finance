"use client";

import { fetchMacro } from "./client";
import type { MacroResponse } from "./macro";
import { usePolled } from "./use-polled";

const REFRESH_MS = 10 * 60_000;

export function useMacro(): {
  data: MacroResponse | null;
  loading: boolean;
  error: string | null;
} {
  return usePolled("macro", fetchMacro, REFRESH_MS);
}
