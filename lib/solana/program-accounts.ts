import {
  Connection,
  type GetProgramAccountsConfig,
  type GetProgramAccountsResponse,
  type PublicKey,
} from "@solana/web3.js";

// getProgramAccounts against an RPC that may refuse to serve it.
//
// Alchemy is the primary endpoint (NEXT_PUBLIC_SOLANA_RPC_URL) and serves every
// other method this app calls, including Helius's getPriorityFeeEstimate, which
// lib/solana/priority-fee.ts depends on and which Alchemy answers compatibly.
// It will not serve getProgramAccounts on our plan: the call is rejected in
// 60-80ms with a 429 reading "exceeded its compute units per second capacity",
// whatever the filters narrow it to. Verified 2026-09-14 against the Jupiter
// Lend scan below, a memcmp-narrowed Token program scan, and SPL Memo, which
// returns almost nothing. The method's base compute-unit cost is above the
// plan's per-second ceiling, so result size does not enter into it.
//
// This matters more than one blocked read. lib/borrow/use-borrow-summary.ts
// runs one of these per Jupiter Lend vault, thirteen of them, behind the shared
// snapshot that Home's positions card and the Borrow panel both read. The
// failure is silent: both callers of findExistingNftId catch and log, so a
// blocked scan does not surface an error, it just fails to find the position
// NFT the user already owns and lets them open (and pay rent for) a second one,
// with the live position hidden behind it.
//
// So Helius stays configured as NEXT_PUBLIC_SOLANA_RPC_FALLBACK_URL and serves
// this one read. The primary is asked once per session rather than never, so
// the day the Alchemy plan's ceiling is raised this moves back to it with no
// code change. A fresh page load asks again.
//
// That question is a separate probe rather than "try the real call and fall
// back on failure", which is what this did first and is worth not going back
// to. web3.js's Connection retries a 429 itself, backing off 500ms, 1s, 2s and
// 4s before it gives up, so a refused scan costs 8.7 SECONDS, not the 70ms the
// endpoint takes to say no (measured 2026-09-14 across four vaults). Thirteen
// of those share one answer, so it was one 8.7s stall per session rather than
// thirteen, but it sat in front of the positions card on every first load.
// Probing with a plain fetch that does no retrying keeps it at one cheap
// request, and every real scan then goes straight to an endpoint that serves
// it.

function fallbackUrl(): string | null {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_FALLBACK_URL || null;
}

let fallback: Connection | null = null;

// One Connection for the session, for the same reason lib/solana/balances.ts
// holds one: a fresh Connection per call pays a handshake it does not need.
function fallbackConnection(): Connection | null {
  const url = fallbackUrl();
  if (!url) return null;
  if (!fallback) fallback = new Connection(url, "confirmed");
  return fallback;
}

const PROBE_TIMEOUT_MS = 2500;

// The cheapest possible getProgramAccounts. SPL Memo is a program with almost
// no accounts to begin with, the dataSize filter matches none of them, and
// dataSlice asks for zero bytes of whatever it did match. An endpoint that
// serves the method answers this in tens of milliseconds with an empty array;
// one that prices the method above its per-second ceiling refuses it just as
// fast, because that refusal is about the method's base cost and not about how
// much this particular call would return.
const PROBE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: "gpa-probe",
  method: "getProgramAccounts",
  params: [
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    { encoding: "base64", dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: 1 }] },
  ],
});

// Held as a promise, not a boolean, so the thirteen vault scans that start
// together wait on one answer instead of each sending its own probe.
let primaryServesGpa: Promise<boolean> | null = null;

async function probe(endpoint: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: PROBE_BODY,
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const payload = (await res.json()) as { result?: unknown; error?: unknown };
    // A refusal arrives as a JSON-RPC error inside a 200 as readily as a 429.
    return !payload.error && Array.isArray(payload.result);
  } catch {
    // A timeout or a network failure resolves to the fallback, which is the
    // endpoint we already know serves this.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function getProgramAccountsWithFallback(
  primary: Connection,
  programId: PublicKey,
  config: GetProgramAccountsConfig,
): Promise<GetProgramAccountsResponse> {
  const secondary = fallbackConnection();
  // Nothing to fall back to. Behave exactly as the bare call would, errors
  // included, rather than swallowing them into an empty result: an empty scan
  // reads as "no position" everywhere upstream.
  if (!secondary) return primary.getProgramAccounts(programId, config);

  primaryServesGpa ??= probe(primary.rpcEndpoint);

  if (await primaryServesGpa) {
    try {
      return await primary.getProgramAccounts(programId, config);
    } catch {
      // The probe said it serves the method, so this is a transient failure
      // rather than the plan's ceiling. Still worth answering from the other
      // endpoint rather than failing the scan.
    }
  }
  return secondary.getProgramAccounts(programId, config);
}
