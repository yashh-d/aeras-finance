// Calling a third-party HTTP API that can be slow, down, or rate limiting us.
//
// The shape here is the one lib/jupiter/lend-server.ts arrived at during the
// Jupiter Lend outage on 2026-09-09, generalised so the other upstreams can
// reuse it instead of each rediscovering it. Three rules, all of them learned
// from a real failure:
//
//   1. **One attempt, with a deadline.** A request that has produced no bytes
//      in its budget is an origin that is slow or down. A second attempt only
//      spends the rate budget and doubles the wait. Only a transport error
//      (connection reset, DNS) earns one immediate retry.
//   2. **Never retry a 429.** Retrying a rate limit is the one retry that is
//      guaranteed to make things worse: it spends the budget that would have
//      let the window recover. Wait out the server's own retry-after instead.
//   3. **Open a circuit.** After a failure, callers fail fast until the
//      cooldown passes rather than every poll from every panel blocking for
//      the full timeout against a dead origin.
//
// Caching and stale-while-error stay with the caller, because the payload
// shape and how long a stale one is worth serving are the caller's business.
// This module only decides whether to go upstream at all.
//
// Deliberately NOT marked `server-only`, unlike lib/jupiter/price-server.ts.
// Nothing here reads a secret, and lib/jupiter/charts.ts needs the circuit
// while still being imported by seven client components for its proxy helpers
// (fetchSparklines, fetchChartViaProxy). A `server-only` import here would
// fail their builds. The guard belongs on the modules that read keys, and
// price-server.ts carries its own. Splitting charts.ts into server and client
// halves would let this be server-only too, and is worth doing separately.

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_COOLDOWN_MS = 20_000;
// Never sit out longer than this on a server's say-so. A retry-after of an
// hour, which some gateways do send, would otherwise wedge a panel until the
// process restarts.
const MAX_COOLDOWN_MS = 60_000;

export class UpstreamError extends Error {
  constructor(
    message: string,
    // True when no request was made because the circuit was already open, so
    // a caller can log the first failure and stay quiet through the cooldown.
    readonly circuitOpen: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

const circuits = new Map<string, { openUntil: number; reason: string }>();

// Milliseconds until the circuit for `key` closes, or 0 when it is closed.
export function circuitCooldownMs(key: string): number {
  const c = circuits.get(key);
  if (!c) return 0;
  return Math.max(0, c.openUntil - Date.now());
}

export function openCircuit(key: string, ms: number, reason: string): void {
  circuits.set(key, { openUntil: Date.now() + Math.min(ms, MAX_COOLDOWN_MS), reason });
}

// Read a rate limit's own waiting period. Different gateways say it three
// different ways and all three show up across the APIs this app calls:
// `retry-after` in seconds, `x-ratelimit-reset` as a Unix timestamp, or a
// `retryAfter` in the JSON body.
export async function retryAfterMs(res: Response, fallback: number): Promise<number> {
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset) {
    const ms = Number(reset) * 1000 - Date.now();
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_COOLDOWN_MS);
  }
  const header = res.headers.get("retry-after");
  if (header && Number.isFinite(Number(header))) {
    return Math.min(Number(header) * 1000, MAX_COOLDOWN_MS);
  }
  try {
    const body = (await res.clone().json()) as { errors?: { retryAfter?: number }[] };
    const secs = body.errors?.[0]?.retryAfter;
    if (typeof secs === "number" && secs > 0) return Math.min(secs * 1000, MAX_COOLDOWN_MS);
  } catch {
    // Not JSON, or already consumed. Fall through.
  }
  return fallback;
}

export interface UpstreamRequest {
  // Circuit identity. One per endpoint whose availability moves independently,
  // NOT one per distinct URL: a circuit keyed by a URL that carries a range or
  // an id never opens twice for the same thing and so never protects anything.
  key: string;
  url: string;
  // Prefixes error messages so a failure says which API it came from.
  label: string;
  headers?: Record<string, string>;
  // GET unless a body is given. A GraphQL endpoint (Uniswap's, for the
  // liquidity pools venue) is a POST with the same failure modes as a GET
  // and the same need for the circuit.
  method?: "GET" | "POST";
  body?: string;
  timeoutMs?: number;
  cooldownMs?: number;
}

// GET a JSON endpoint through the circuit. Throws UpstreamError on any
// failure, having recorded a cooldown so the next caller inside it fails fast.
export async function fetchUpstreamJson<T>(req: UpstreamRequest): Promise<T> {
  const { key, url, label } = req;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cooldown = req.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  const open = circuitCooldownMs(key);
  if (open > 0) {
    const reason = circuits.get(key)?.reason ?? "upstream failed";
    throw new UpstreamError(
      `${label}: ${reason}; retrying in ${Math.ceil(open / 1000)}s`,
      true,
    );
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: req.method ?? (req.body !== undefined ? "POST" : "GET"),
        cache: "no-store",
        signal: controller.signal,
        headers: req.headers,
        body: req.body,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        const wait = await retryAfterMs(res, cooldown);
        openCircuit(key, wait, "rate limited");
        throw new UpstreamError(
          `${label}: rate limited, retrying in ${Math.ceil(wait / 1000)}s`,
          false,
          429,
        );
      }
      if (!res.ok) {
        openCircuit(key, cooldown, `upstream ${res.status}`);
        throw new UpstreamError(`${label}: upstream ${res.status}`, false, res.status);
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof UpstreamError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      if (aborted) {
        openCircuit(key, cooldown, `no response within ${timeoutMs / 1000}s`);
        throw new UpstreamError(
          `${label}: no response within ${timeoutMs / 1000}s`,
          false,
        );
      }
      // Transport error. One immediate retry, then give up.
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      openCircuit(key, cooldown, msg);
      throw new UpstreamError(`${label}: ${msg}`, false);
    }
  }
  throw new UpstreamError(`${label}: failed`, false);
}

// Collapse concurrent identical work onto one call.
//
// Without this, two panels mounting at once each miss the cache and each go
// upstream for the same bytes, which on a rate-limited tier is one request
// spent for nothing. The promise is held only while in flight, so this is a
// deduplicator and not a cache; the caller still owns the caching.
const inFlight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const started = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}
