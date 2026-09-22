// The ForexFactory weekly feed, cached for thirty minutes and served stale
// for six hours past that if the host does not answer. One file for the whole
// week, so this is one request per half hour however many viewers there are.
//
// The host rate-limits by address and answers 429 when it is unhappy; a burst
// of a few requests within a few minutes was enough on 2026-09-10. A 429
// therefore opens a hold (Retry-After when sent, five minutes otherwise)
// during which the loader does not go upstream at all, so a cold start under
// a limit serves an error to the page rather than deepening the limit on
// every client poll.

import { normalizeMacro, type MacroResponse, type RawMacroEvent } from "./macro";

export const FF_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const TTL_MS = 30 * 60_000;
const STALE_MAX_MS = 6 * 60 * 60_000;
const TIMEOUT_MS = 10_000;
const RATE_LIMIT_HOLD_MS = 5 * 60_000;

let cache: { body: MacroResponse; fetchedAt: number } | null = null;
let inFlight: Promise<MacroResponse> | null = null;
let holdUntil = 0;

async function load(): Promise<MacroResponse> {
  if (Date.now() < holdUntil) {
    throw new Error("Calendar feed: rate limited, holding");
  }
  const res = await fetch(FF_CALENDAR_URL, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 (compatible; AerasFinance/0.1)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    holdUntil =
      Date.now() +
      (Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : RATE_LIMIT_HOLD_MS);
    throw new Error("Calendar feed: HTTP 429");
  }
  if (!res.ok) throw new Error(`Calendar feed: HTTP ${res.status}`);
  const raw = (await res.json()) as RawMacroEvent[];
  if (!Array.isArray(raw)) throw new Error("Calendar feed: not a list");
  const body: MacroResponse = {
    events: normalizeMacro(raw),
    fetchedAt: Date.now(),
    stale: false,
  };
  cache = { body, fetchedAt: body.fetchedAt };
  return body;
}

export async function loadMacro(): Promise<MacroResponse> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache.body;
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null;
    });
  }
  try {
    return await inFlight;
  } catch (err) {
    if (cache && now - cache.fetchedAt < STALE_MAX_MS) {
      return { ...cache.body, stale: true };
    }
    throw err;
  }
}
