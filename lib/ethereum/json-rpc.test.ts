import { describe, expect, it, vi } from "vitest";

import { jsonRpcBatch, jsonRpcBatchSettled, type RpcCall } from "./json-rpc";

const ENDPOINTS = {
  label: "Ethereum",
  url: "https://primary.test/v2/key",
  fallbackUrl: "https://public.test",
};
const CALLS: RpcCall[] = [
  { method: "eth_call", params: [{ to: "0x1", data: "0x" }, "latest"] },
  { method: "eth_gasPrice", params: [] },
];
// No waiting in tests: the backoff is what is under test, not the clock.
const FAST = { throttleBackoffMs: [0, 0, 0] };

// Alchemy's shape for a throttled batch, verbatim from a live 429 body.
const ALCHEMY_429 = (ids: number[]) =>
  ids.map((id) => ({
    jsonrpc: "2.0",
    id,
    error: {
      code: 429,
      message:
        "Your app has exceeded its compute units per second capacity. If you have retries enabled, you can safely ignore this message.",
    },
  }));

function response(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stub(responses: (() => Response)[]) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    urls.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error("stub exhausted");
    return next();
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, urls };
}

describe("jsonRpcBatchSettled", () => {
  it("returns outcomes in call order whatever order the node answers in", async () => {
    const { fetchImpl } = stub([
      () =>
        response(200, [
          { jsonrpc: "2.0", id: 1, result: "0x5" },
          { jsonrpc: "2.0", id: 0, result: "0xabc" },
        ]),
    ]);
    const out = await jsonRpcBatchSettled(ENDPOINTS, CALLS, { fetchImpl, ...FAST });
    expect(out).toEqual([{ result: "0xabc" }, { result: "0x5" }]);
  });

  it("retries a 429 on the primary and never touches the fallback when it clears", async () => {
    const { fetchImpl, urls } = stub([
      () => response(429, ALCHEMY_429([0, 1])),
      () => response(429, ""),
      () =>
        response(200, [
          { jsonrpc: "2.0", id: 0, result: "0x1" },
          { jsonrpc: "2.0", id: 1, result: "0x2" },
        ]),
    ]);
    const out = await jsonRpcBatchSettled(ENDPOINTS, CALLS, { fetchImpl, ...FAST });
    expect(out.map((o) => o.result)).toEqual(["0x1", "0x2"]);
    expect(urls).toEqual([ENDPOINTS.url, ENDPOINTS.url, ENDPOINTS.url]);
  });

  it("asks the fallback once the primary is throttled past every retry", async () => {
    const { fetchImpl, urls } = stub([
      () => response(429, ALCHEMY_429([0, 1])),
      () => response(429, ALCHEMY_429([0, 1])),
      () => response(429, ALCHEMY_429([0, 1])),
      () => response(429, ALCHEMY_429([0, 1])),
      () =>
        response(200, [
          { jsonrpc: "2.0", id: 0, result: "0x1" },
          { jsonrpc: "2.0", id: 1, result: "0x2" },
        ]),
    ]);
    const out = await jsonRpcBatchSettled(ENDPOINTS, CALLS, { fetchImpl, ...FAST });
    expect(out.map((o) => o.result)).toEqual(["0x1", "0x2"]);
    // Four on the primary (one plus three retries), then the public node.
    expect(urls.filter((u) => u === ENDPOINTS.url)).toHaveLength(4);
    expect(urls.at(-1)).toBe(ENDPOINTS.fallbackUrl);
  });

  it("treats a 200 whose every entry is the throttle wording as a throttle", async () => {
    const { fetchImpl, urls } = stub([
      () => response(200, ALCHEMY_429([0, 1])),
      () =>
        response(200, [
          { jsonrpc: "2.0", id: 0, result: "0x1" },
          { jsonrpc: "2.0", id: 1, result: "0x2" },
        ]),
    ]);
    const out = await jsonRpcBatchSettled(ENDPOINTS, CALLS, { fetchImpl, ...FAST });
    expect(out.map((o) => o.result)).toEqual(["0x1", "0x2"]);
    expect(urls).toHaveLength(2);
  });

  it("goes straight to the fallback on a 5xx rather than retrying a node that is down", async () => {
    const { fetchImpl, urls } = stub([
      () => response(502, "bad gateway"),
      () =>
        response(200, [
          { jsonrpc: "2.0", id: 0, result: "0x1" },
          { jsonrpc: "2.0", id: 1, result: "0x2" },
        ]),
    ]);
    const out = await jsonRpcBatchSettled(ENDPOINTS, CALLS, { fetchImpl, ...FAST });
    expect(out.map((o) => o.result)).toEqual(["0x1", "0x2"]);
    expect(urls).toEqual([ENDPOINTS.url, ENDPOINTS.fallbackUrl]);
  });

  it("keeps a per-call revert as that call's answer and asks nobody else", async () => {
    const { fetchImpl, urls } = stub([
      () =>
        response(200, [
          { jsonrpc: "2.0", id: 0, error: { code: 3, message: "execution reverted" } },
          { jsonrpc: "2.0", id: 1, result: "0x2" },
        ]),
    ]);
    const out = await jsonRpcBatchSettled(ENDPOINTS, CALLS, { fetchImpl, ...FAST });
    expect(out).toEqual([{ error: "execution reverted" }, { result: "0x2" }]);
    expect(urls).toHaveLength(1);
  });

  it("names both failures when the fallback fails too", async () => {
    const { fetchImpl } = stub([
      () => response(503, ""),
      () => response(500, ""),
    ]);
    await expect(
      jsonRpcBatchSettled(ENDPOINTS, CALLS, { fetchImpl, ...FAST }),
    ).rejects.toThrow("Ethereum RPC 503 (fallback: Ethereum RPC 500)");
  });

  it("throws the primary's error when there is no fallback", async () => {
    const { fetchImpl, urls } = stub([
      () => response(429, ALCHEMY_429([0, 1])),
      () => response(429, ALCHEMY_429([0, 1])),
      () => response(429, ALCHEMY_429([0, 1])),
      () => response(429, ALCHEMY_429([0, 1])),
    ]);
    await expect(
      jsonRpcBatchSettled({ label: "Monad", url: ENDPOINTS.url }, CALLS, {
        fetchImpl,
        ...FAST,
      }),
    ).rejects.toThrow("Monad RPC 429");
    expect(urls).toHaveLength(4);
  });
});

describe("jsonRpcBatch", () => {
  it("throws on a per-call error, naming the call", async () => {
    const { fetchImpl } = stub([
      () =>
        response(200, [
          { jsonrpc: "2.0", id: 0, result: "0x1" },
          { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } },
        ]),
    ]);
    await expect(jsonRpcBatch(ENDPOINTS, CALLS, { fetchImpl, ...FAST })).rejects.toThrow(
      "Ethereum RPC call 1 (eth_gasPrice): method not found",
    );
  });

  it("throws on a missing result", async () => {
    const { fetchImpl } = stub([
      () =>
        response(200, [
          { jsonrpc: "2.0", id: 0, result: "0x1" },
          { jsonrpc: "2.0", id: 1, result: null },
        ]),
    ]);
    await expect(jsonRpcBatch(ENDPOINTS, CALLS, { fetchImpl, ...FAST })).rejects.toThrow(
      "empty result for call 1",
    );
  });

  it("passes an object result through, as eth_getBlockByNumber returns one", async () => {
    const { fetchImpl } = stub([
      () =>
        response(200, [
          { jsonrpc: "2.0", id: 0, result: { timestamp: "0x1" } },
          { jsonrpc: "2.0", id: 1, result: "0x2" },
        ]),
    ]);
    const out = await jsonRpcBatch(ENDPOINTS, CALLS, { fetchImpl, ...FAST });
    expect(out).toEqual([{ timestamp: "0x1" }, "0x2"]);
  });
});
