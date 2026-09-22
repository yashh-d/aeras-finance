// Server-only fetch for the Jupiter Lend REST API, shared by the earn-tokens
// and borrow-vaults proxies under app/api/jupiter. Imported only from route
// handlers, never from client code, because it reads JUPITER_API_KEY.
//
// Written on 2026-09-09 during a Lend outage, which is the case it is shaped
// for. That afternoon Jupiter's edge answered the Lend endpoints with a 504
// from CloudFront after 30 seconds, keyed or not, while every other Jupiter
// endpoint on the same host answered in under a third of a second. The two
// proxies each made three 6-second attempts per request and returned 502
// after 18 seconds, and every panel that polls them logged an error on every
// poll. Three things fix the behaviour without pretending the data exists:
//
//   1. **Send the API key.** Jupiter's Lend docs show `x-api-key` on every
//      call, keyless traffic is limited to 0.5 requests a second against 1 for
//      the free keyed tier, and `lite-api.jup.ag` is being retired. The key is
//      already on the server for the trigger routes.
//   2. **Do not retry a timeout.** A request that produced no bytes in six
//      seconds is an origin that is slow or down; a second and third attempt
//      only spend the rate budget and triple the wait. Only a transport error
//      (connection reset, DNS) earns one immediate retry.
//   3. **Open a circuit.** After a failed refresh, callers serve their cached
//      payload or fail at once until the cooldown passes, instead of every
//      poll from every panel blocking for the full timeout. A 429 sets the
//      cooldown from Jupiter's own retry-after.
//
// The stale-while-error policy stays where it was, in each route, because the
// cache is per payload; this module only decides whether to go upstream.

import "server-only";

const LEND_BASE = "https://api.jup.ag/lend/v1";

// One attempt's budget. Jupiter's edge times the origin out at 30 seconds;
// nothing a panel is waiting on should wait that long for a rate.
const UPSTREAM_TIMEOUT_MS = 6_000;

// How long to stop calling upstream after a failure. Long enough that the
// polling panels (60 seconds) and the proxies' own 15-second TTL do not turn
// an outage into a request every few seconds; short enough that recovery is
// noticed within a poll.
const FAILURE_COOLDOWN_MS = 20_000;

// Per-path circuit state. One entry per endpoint, since Lend's earn and
// borrow backends can fail independently.
const circuits = new Map<string, { openUntil: number; reason: string }>();

export class LendUpstreamError extends Error {
  constructor(
    message: string,
    // True when the call was skipped because the circuit was open, so the
    // caller knows no fresh attempt was made.
    readonly circuitOpen: boolean,
  ) {
    super(message);
  }
}

// Milliseconds until the circuit for `path` closes, or 0 when it is closed.
export function lendCooldownMs(path: string): number {
  const c = circuits.get(path);
  if (!c) return 0;
  return Math.max(0, c.openUntil - Date.now());
}

function openCircuit(path: string, ms: number, reason: string) {
  circuits.set(path, { openUntil: Date.now() + ms, reason });
}

// Jupiter's 429 carries either the gateway's `x-ratelimit-reset` (a Unix
// timestamp in seconds) or the Lend backend's own `{ errors: [{ retryAfter }] }`
// in seconds. Either way, wait that long and no longer.
async function retryAfterMs(res: Response): Promise<number> {
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset) {
    const ms = Number(reset) * 1000 - Date.now();
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, 60_000);
  }
  const header = res.headers.get("retry-after");
  if (header && Number.isFinite(Number(header))) {
    return Math.min(Number(header) * 1000, 60_000);
  }
  try {
    const body = (await res.clone().json()) as {
      errors?: { retryAfter?: number }[];
    };
    const secs = body.errors?.[0]?.retryAfter;
    if (typeof secs === "number" && secs > 0) return Math.min(secs * 1000, 60_000);
  } catch {
    // Not JSON; fall through to the default.
  }
  return FAILURE_COOLDOWN_MS;
}

// GET a Lend endpoint and parse its JSON. Throws LendUpstreamError on any
// failure, after recording a cooldown so the next caller inside it does not
// wait on the same dead origin.
export async function fetchLendJson<T>(path: string): Promise<T> {
  const cooldown = lendCooldownMs(path);
  if (cooldown > 0) {
    const reason = circuits.get(path)?.reason ?? "upstream failed";
    throw new LendUpstreamError(
      `Jupiter Lend ${path}: ${reason}; retrying in ${Math.ceil(cooldown / 1000)}s`,
      true,
    );
  }

  const headers: Record<string, string> = { "user-agent": "aeras-finance/0.1" };
  const key = process.env.JUPITER_API_KEY;
  if (key) headers["x-api-key"] = key;

  // One attempt, plus one more only for a transport error. A timeout is not
  // retried: see the header comment.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(`${LEND_BASE}${path}`, {
        cache: "no-store",
        signal: controller.signal,
        headers,
      });
      clearTimeout(timer);
      if (res.status === 429) {
        const wait = await retryAfterMs(res);
        openCircuit(path, wait, "rate limited");
        throw new LendUpstreamError(
          `Jupiter Lend ${path}: rate limited, retrying in ${Math.ceil(wait / 1000)}s`,
          false,
        );
      }
      if (!res.ok) {
        openCircuit(path, FAILURE_COOLDOWN_MS, `upstream ${res.status}`);
        throw new LendUpstreamError(`Jupiter Lend ${path}: upstream ${res.status}`, false);
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof LendUpstreamError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      if (aborted) {
        openCircuit(path, FAILURE_COOLDOWN_MS, "no response within 6s");
        throw new LendUpstreamError(
          `Jupiter Lend ${path}: no response within ${UPSTREAM_TIMEOUT_MS / 1000}s`,
          false,
        );
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      openCircuit(path, FAILURE_COOLDOWN_MS, msg);
      throw new LendUpstreamError(`Jupiter Lend ${path}: ${msg}`, false);
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new LendUpstreamError(`Jupiter Lend ${path}: failed`, false);
}
