"use client";

// Browser-side read of one company section, polled while mounted. Null
// ticker means idle, which is how a tab that is not open avoids fetching.

import { usePolled } from "@/lib/calendar/use-polled";

import type { CompanySection, SectionResponse } from "./types";

export async function fetchSection<T>(
  ticker: string,
  section: CompanySection,
): Promise<SectionResponse<T>> {
  const res = await fetch(
    `/api/company?ticker=${encodeURIComponent(ticker)}&section=${section}`,
    { cache: "no-store" },
  );
  const body = (await res.json().catch(() => ({}))) as Partial<SectionResponse<T>> & {
    error?: string;
  };
  if (!res.ok || body.data === undefined) {
    throw new Error(body.error ?? `${section} failed: ${res.status}`);
  }
  return body as SectionResponse<T>;
}

export function useCompanySection<T>(
  ticker: string | null,
  section: CompanySection,
  refreshMs: number,
): { data: SectionResponse<T> | null; loading: boolean; error: string | null } {
  return usePolled<SectionResponse<T>>(
    ticker ? `company:${section}:${ticker}` : null,
    () => fetchSection<T>(ticker as string, section),
    refreshMs,
  );
}
