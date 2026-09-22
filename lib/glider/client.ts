// Browser-side calls to app/api/glider/*. The API key never leaves the
// server; the user's Privy access token is what authenticates the routes that
// read or act on a portfolio.

import { privyAuthHeaders } from "@/lib/privy/access-token";

import { GLIDER_OPERATION_POLL_MS, GLIDER_OPERATION_TIMEOUT_MS } from "./constants";
import type {
  BaseBalancesView,
  GliderEnrollmentPrepared,
  GliderEnrollmentResult,
  GliderLiquidationPrepared,
  GliderOperationView,
  GliderPortfolioView,
  GliderRebalanceResult,
  GliderStrategyView,
  HistoryView,
} from "./types";

export class GliderClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "GliderClientError";
  }
}

async function call<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; authenticated?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    cache: "no-store",
    signal: init.signal,
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.authenticated ? await privyAuthHeaders() : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let parsed: (T & { error?: string; code?: string | null }) | null = null;
  try {
    parsed = (await res.json()) as T & { error?: string; code?: string | null };
  } catch {
    // A non-JSON body on an error is handled below; on success it is a bug.
  }
  if (!res.ok) {
    throw new GliderClientError(
      parsed?.error ?? `${path} failed: ${res.status}`,
      res.status,
      parsed?.code ?? null,
    );
  }
  if (parsed == null) throw new GliderClientError(`${path}: empty response`, 502);
  return parsed;
}

export function fetchGliderStrategy(signal?: AbortSignal): Promise<GliderStrategyView> {
  return call<GliderStrategyView>("/api/glider/strategy", { signal });
}

export function fetchGliderHistory(signal?: AbortSignal): Promise<HistoryView> {
  return call<HistoryView>("/api/glider/history", { signal });
}

export interface GliderPortfolioRead {
  portfolio: GliderPortfolioView | null;
  keyConfigured: boolean;
}

export function fetchGliderPortfolio(signal?: AbortSignal): Promise<GliderPortfolioRead> {
  return call<GliderPortfolioRead>("/api/glider/portfolio", { authenticated: true, signal });
}

export type GliderEnrollmentStage1 =
  | { existing: GliderEnrollmentResult; prepared?: undefined }
  | { prepared: GliderEnrollmentPrepared; existing?: undefined };

export function prepareGliderEnrollment(attest: boolean): Promise<GliderEnrollmentStage1> {
  return call<GliderEnrollmentStage1>("/api/glider/enroll/signature", {
    method: "POST",
    body: { attest },
    authenticated: true,
  });
}

export function submitGliderEnrollment(args: {
  signature: string;
  flowId: string;
  accountIndex: string;
  agentAccountId: string;
}): Promise<GliderEnrollmentResult> {
  return call<GliderEnrollmentResult>("/api/glider/enroll", {
    method: "POST",
    body: { ...args, attest: true },
    authenticated: true,
  });
}

export function requestGliderRebalance(): Promise<GliderRebalanceResult> {
  return call<GliderRebalanceResult>("/api/glider/portfolio/rebalance", {
    method: "POST",
    authenticated: true,
  });
}

export function fetchGliderOperation(operationId: string, signal?: AbortSignal): Promise<GliderOperationView> {
  return call<GliderOperationView>(
    `/api/glider/portfolio/operation?id=${encodeURIComponent(operationId)}`,
    { authenticated: true, signal },
  );
}

export function prepareGliderLiquidation(): Promise<GliderLiquidationPrepared> {
  return call<GliderLiquidationPrepared>("/api/glider/portfolio/liquidate/signature", {
    method: "POST",
    body: {},
    authenticated: true,
  });
}

export function submitGliderLiquidation(
  message: unknown,
  signature: string,
): Promise<{ operationId: string }> {
  return call<{ operationId: string }>("/api/glider/portfolio/liquidate", {
    method: "POST",
    body: { message, signature },
    authenticated: true,
  });
}

export function fetchBaseBalances(signal?: AbortSignal): Promise<BaseBalancesView> {
  return call<BaseBalancesView>("/api/glider/base-balances", { authenticated: true, signal });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled."));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new Error("Cancelled."));
      },
      { once: true },
    );
  });
}

export function isTerminalOperation(state: GliderOperationView["state"]): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

// Poll an operation until it settles or the wait runs out. A timeout resolves
// with the last state seen rather than throwing: the operation keeps running
// on Glider's side, and the caller decides what that means for its copy.
export async function waitForGliderOperation(
  operationId: string,
  opts: { onTick?: (op: GliderOperationView) => void; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ operation: GliderOperationView | null; timedOut: boolean }> {
  const deadline = Date.now() + (opts.timeoutMs ?? GLIDER_OPERATION_TIMEOUT_MS);
  let last: GliderOperationView | null = null;
  while (Date.now() < deadline) {
    try {
      last = await fetchGliderOperation(operationId, opts.signal);
      opts.onTick?.(last);
      if (isTerminalOperation(last.state)) return { operation: last, timedOut: false };
    } catch (err) {
      // A transient read failure is not the operation failing; keep polling
      // unless the caller cancelled.
      if (opts.signal?.aborted) throw err;
    }
    await sleep(GLIDER_OPERATION_POLL_MS, opts.signal);
  }
  return { operation: last, timedOut: true };
}
