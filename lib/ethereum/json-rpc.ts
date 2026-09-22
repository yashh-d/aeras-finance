// Batched JSON-RPC over HTTP for the server-side EVM reads, with the two things
// a plain fetch did not do: retry a throttled response, and fall back to a
// second node when the first will not answer.
//
// Chain-neutral. lib/ethereum/rpc.ts wraps it for Ethereum, and the Monad
// readers (lib/shmonad/server.ts, app/api/morpho/position/route.ts) call it
// with their own endpoints. It holds no keys: the caller passes the URLs.
//
// Why this exists. The Ethereum, Monad and Solana endpoints all sit on ONE
// Alchemy app key, and Alchemy meters throughput per app, across networks.
// Measured 2026-09-22: forty Solana reads fired alongside twenty Ethereum
// batches got fifteen of the twenty Ethereum batches refused with HTTP 429
// "exceeded its compute units per second capacity", and six of ten Monad
// reads with it. Every batch alone, at thirty concurrent, passed. So the
// browser's Solana polling can starve a server-side Ethereum read of the same
// second, and a read that failed on one 429 blanked a venue's position for
// as long as its route's stale window allowed, then 502'd. Alchemy's own 429
// body says "if you have retries enabled, you can safely ignore this
// message"; this is those retries, plus the public node for the batch that
// is still refused after them (ethereum-rpc.publicnode.com answered the
// heaviest batch here in 70ms).
//
// Three rules. A throttle (HTTP 429, or a JSON-RPC error carrying code 429 or
// Alchemy's wording) is retried on the primary with a short backoff, because
// the limit is per second and the next second is usually fine. Any other
// transport failure (5xx, timeout, network) goes straight to the fallback,
// because retrying a node that is down just spends the deadline. A JSON-RPC
// error on an individual call (a revert, an unknown method) is an ANSWER and
// is never retried or re-asked elsewhere: a probe whose revert is the result
// must not be turned into a fallback read that reverts identically, slower.
//
// Pure apart from the fetch it is handed, so lib/ethereum/json-rpc.test.ts
// pins the retry and fallback paths with a stubbed fetch.

export interface RpcCall {
  method: string;
  params: unknown[];
}

// One call's outcome. `result` is whatever the node returned: a hex string
// for eth_call and the balance reads, an object for eth_getBlockByNumber.
export interface RpcOutcome {
  result?: unknown;
  error?: string;
}

export interface RpcEndpoints {
  // Names the chain in error messages ("Ethereum RPC 502").
  label: string;
  url: string;
  // A second node asked when the first is throttled past the retries or is
  // down. Omit when the primary is already the public node.
  fallbackUrl?: string;
}

export interface RpcOptions {
  fetchImpl?: typeof fetch;
  // Delays before each throttle retry on the primary. Three by default; the
  // last one lands well into the next per-second window.
  throttleBackoffMs?: readonly number[];
  timeoutMs?: number;
}

const DEFAULT_THROTTLE_BACKOFF_MS: readonly number[] = [250, 750, 1500];
const DEFAULT_TIMEOUT_MS = 10_000;

// Alchemy answers a throttled batch with HTTP 429 and, in the body, one
// JSON-RPC error per call reading "Your app has exceeded its compute units per
// second capacity". Other providers say "too many requests" or "rate limit".
const THROTTLE_WORDS = /compute units|rate limit|too many requests/i;

class Throttled extends Error {
  constructor(label: string) {
    super(`${label} RPC 429`);
    this.name = "Throttled";
  }
}

type RawEntry = { id?: number; result?: unknown; error?: { code?: number; message?: string } };

function isThrottleEntry(entry: RawEntry): boolean {
  const e = entry.error;
  if (!e) return false;
  return e.code === 429 || THROTTLE_WORDS.test(e.message ?? "");
}

// One POST of the whole batch to one node. Resolves to the outcomes in call
// order, or throws: Throttled for a rate limit, Error for anything else that
// stops the batch being answered at all.
async function send(
  url: string,
  label: string,
  calls: RpcCall[],
  opts: Required<Pick<RpcOptions, "fetchImpl" | "timeoutMs">>,
): Promise<RpcOutcome[]> {
  const res = await opts.fetchImpl(url, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i, ...c }))),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (res.status === 429) throw new Throttled(label);
  if (!res.ok) throw new Error(`${label} RPC ${res.status}`);

  const text = await res.text();
  let json: RawEntry[] | RawEntry;
  try {
    json = JSON.parse(text) as RawEntry[] | RawEntry;
  } catch {
    throw new Error(`${label} RPC: non-JSON response`);
  }

  // A batch-level refusal comes back as one object rather than an array.
  if (!Array.isArray(json)) {
    if (isThrottleEntry(json)) throw new Throttled(label);
    throw new Error(json.error?.message ?? `${label} RPC: unexpected response`);
  }
  // A throttle can also arrive as a 200 whose every entry is the refusal.
  if (json.length > 0 && json.every(isThrottleEntry)) throw new Throttled(label);

  // Responses are not required to come back in request order.
  const byId = new Map(json.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const entry = byId.get(i);
    if (!entry) return { error: `no response for call ${i}` };
    if (entry.error) return { error: entry.error.message ?? "unknown error" };
    return { result: entry.result };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// The batch, with every call settling on its own. See the module comment for
// what is retried, what falls back and what is an answer.
export async function jsonRpcBatchSettled(
  endpoints: RpcEndpoints,
  calls: RpcCall[],
  options: RpcOptions = {},
): Promise<RpcOutcome[]> {
  const opts = {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const backoff = options.throttleBackoffMs ?? DEFAULT_THROTTLE_BACKOFF_MS;
  const { label, url, fallbackUrl } = endpoints;

  let primaryError: Error | null = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send(url, label, calls, opts);
    } catch (err) {
      primaryError = err instanceof Error ? err : new Error(String(err));
      if (primaryError instanceof Throttled && attempt < backoff.length) {
        await sleep(backoff[attempt]);
        continue;
      }
      break;
    }
  }

  if (!fallbackUrl) throw primaryError;
  try {
    return await send(fallbackUrl, label, calls, opts);
  } catch (err) {
    const fallbackError = err instanceof Error ? err.message : String(err);
    throw new Error(`${primaryError.message} (fallback: ${fallbackError})`);
  }
}

// The strict form: every call must answer with a result, or the batch throws.
// For reads where a missing answer means the caller cannot proceed.
export async function jsonRpcBatch(
  endpoints: RpcEndpoints,
  calls: RpcCall[],
  options: RpcOptions = {},
): Promise<unknown[]> {
  const outcomes = await jsonRpcBatchSettled(endpoints, calls, options);
  return outcomes.map((o, i) => {
    if (o.error) {
      throw new Error(`${endpoints.label} RPC call ${i} (${calls[i].method}): ${o.error}`);
    }
    if (o.result == null) {
      throw new Error(`${endpoints.label} RPC: empty result for call ${i} (${calls[i].method})`);
    }
    return o.result;
  });
}
