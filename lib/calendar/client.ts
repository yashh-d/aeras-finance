// Browser-side reads of the two calendar routes.

import type { EarningsResponse } from "./earnings";
import type { MacroResponse } from "./macro";

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as Partial<T> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${what} failed: ${res.status}`);
  return body as T;
}

export function fetchEarnings(): Promise<EarningsResponse> {
  return getJson<EarningsResponse>("/api/calendar/earnings", "Earnings");
}

export function fetchMacro(): Promise<MacroResponse> {
  return getJson<MacroResponse>("/api/calendar/macro", "Calendar");
}
