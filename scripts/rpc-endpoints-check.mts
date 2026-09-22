// Live check for the Solana RPC split and the EVM read endpoints.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/rpc-endpoints-check.mts
//
// Read-only. It signs nothing and broadcasts nothing.
//
// Alchemy is the primary Solana endpoint. It serves every read this app makes
// except two, so Helius stays configured as NEXT_PUBLIC_SOLANA_RPC_FALLBACK_URL
// and serves those. This script is what says whether that split is still the
// right one, and it is the thing to re-run after changing plans with either
// provider.
//
// What it established when the split was built (2026-09-14):
//   - Alchemy serves getSlot, getLatestBlockhash, getBlockHeight,
//     isBlockhashValid, getSignatureStatuses, getSignaturesForAddress,
//     getMultipleAccounts, getTokenAccountsByOwner (jsonParsed, Token-2022)
//     and getRecentPrioritizationFees.
//   - Alchemy serves getPriorityFeeEstimate, Helius's own method, compatibly.
//     lib/solana/priority-fee.ts needs it and degrades to a floor without it.
//   - Alchemy refuses getProgramAccounts: a 429 in under 100ms reading
//     "exceeded its compute units per second capacity", whatever the filters
//     narrow it to. SPL Memo, which returns almost nothing, is refused too, so
//     this is the method's base cost against the plan's ceiling and not result
//     size. Raising the plan is what changes this.
//   - Alchemy serves no subscription methods at all. The socket opens, then
//     slotSubscribe, accountSubscribe, signatureSubscribe and programSubscribe
//     are each answered -32601.
//
// The last two are why lib/solana/program-accounts.ts and the rpcSubscriptions
// line in lib/privy/provider.tsx exist. If both start passing on the primary,
// both can go.

import bs58 from "bs58";

const PRIMARY = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
const FALLBACK = process.env.NEXT_PUBLIC_SOLANA_RPC_FALLBACK_URL;

// jupr81..., and the `position` account discriminator from the IDL. Kept in
// step with lib/jupiter/borrow.ts, which runs this exact scan per vault.
const JUPITER_LEND_PROGRAM = "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi";
const POSITION_DISCRIMINATOR = Buffer.from([
  170, 188, 143, 228, 122, 64, 247, 208,
]);
const TSLAX_VAULT_ID = 77;

let failures = 0;

function report(ok: boolean, label: string, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label.padEnd(30)} ${detail}`);
}

async function rpc(
  url: string,
  method: string,
  params?: unknown[],
): Promise<{ ms: number; result?: unknown; error?: { message: string } }> {
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const ms = Date.now() - started;
  // A refused method can come back as a JSON-RPC error inside a 200 or as a
  // non-200 with the same body. Read both the same way.
  const payload = (await res.json().catch(() => ({}))) as {
    result?: unknown;
    error?: { message: string };
  };
  return { ms, result: payload.result, error: payload.error };
}

// Every read lib/solana/* makes on the hot paths, plus the estimator.
async function checkPrimaryReads(url: string) {
  console.log("\nPrimary, the reads it has to serve");

  const blockhash = await rpc(url, "getLatestBlockhash");
  const hash = (blockhash.result as { value?: { blockhash?: string } })?.value
    ?.blockhash;
  report(!!hash, "getLatestBlockhash", hash ? `${hash.slice(0, 8)}...` : "no blockhash");

  for (const [method, params] of [
    ["getSlot", undefined],
    ["getBlockHeight", [{ commitment: "confirmed" }]],
    ["getMultipleAccounts", [["So11111111111111111111111111111111111111112"], { encoding: "base64" }]],
    // "1" is zero in base58, so this is a well-formed 64-byte signature that
    // has never existed. A null status is the pass; only an error fails.
    ["getSignatureStatuses", [["1".repeat(64)], { searchTransactionHistory: false }]],
    ["getSignaturesForAddress", ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", { limit: 1 }]],
    ["getRecentPrioritizationFees", [[]]],
    // Token-2022, because the xStocks and PAXG live there and a program the RPC
    // does not parse reads as an empty wallet rather than as an error.
    ["getTokenAccountsByOwner", ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" }, { encoding: "jsonParsed" }]],
  ] as [string, unknown[] | undefined][]) {
    const r = await rpc(url, method, params);
    report(!r.error, method, r.error ? r.error.message : `${r.ms}ms`);
  }

  if (hash) {
    const r = await rpc(url, "isBlockhashValid", [hash, { commitment: "confirmed" }]);
    report(!r.error, "isBlockhashValid", r.error ? r.error.message : `${r.ms}ms`);
  }

  // lib/solana/priority-fee.ts falls back to a percentile of raw samples, which
  // reads zero on a quiet slot, so losing this means bidding the floor.
  const fee = await rpc(url, "getPriorityFeeEstimate", [
    { accountKeys: [JUPITER_LEND_PROGRAM], options: { includeAllPriorityFeeLevels: true } },
  ]);
  const high = (fee.result as { priorityFeeLevels?: { high?: number } })
    ?.priorityFeeLevels?.high;
  report(
    typeof high === "number",
    "getPriorityFeeEstimate",
    typeof high === "number" ? `high ${high} µlamports/CU` : "not served, priority-fee.ts will bid its floor",
  );
}

// The split itself. These two are expected to fail on the primary today; the
// point of the script is to notice the day they stop failing.
async function checkTheSplit() {
  console.log("\nThe split, what the primary will not serve");

  const vaultId = Buffer.alloc(2);
  vaultId.writeUInt16LE(TSLAX_VAULT_ID);
  const scan = [
    JUPITER_LEND_PROGRAM,
    {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(POSITION_DISCRIMINATOR) } },
        { memcmp: { offset: 8, bytes: bs58.encode(vaultId) } },
      ],
    },
  ];

  const onPrimary = await rpc(PRIMARY!, "getProgramAccounts", scan);
  if (onPrimary.error) {
    console.log(`  --   getProgramAccounts        refused by primary in ${onPrimary.ms}ms: ${onPrimary.error.message.slice(0, 70)}`);
    console.log("       (expected. lib/solana/program-accounts.ts routes around it)");
  } else {
    const n = (onPrimary.result as unknown[]).length;
    console.log(`  ++   getProgramAccounts        PRIMARY NOW SERVES IT (${n} accounts, ${onPrimary.ms}ms)`);
    console.log("       lib/solana/program-accounts.ts can be deleted and borrow.ts call the connection directly");
  }

  if (!FALLBACK) {
    report(false, "fallback configured", "NEXT_PUBLIC_SOLANA_RPC_FALLBACK_URL is unset");
    return;
  }

  const onFallback = await rpc(FALLBACK, "getProgramAccounts", scan);
  const found = Array.isArray(onFallback.result) ? onFallback.result.length : 0;
  report(
    !onFallback.error && found > 0,
    "getProgramAccounts fallback",
    onFallback.error
      ? onFallback.error.message
      : `${found} positions in vault ${TSLAX_VAULT_ID}, ${onFallback.ms}ms`,
  );
}

// Privy confirms useSignAndSendTransaction over this socket, so an endpoint
// that accepts the connection and then refuses to subscribe strands a send
// that already landed.
function checkSubscriptions(url: string, label: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url.replace(/^http/, "ws"));
    const done = (ok: boolean, detail: string) => {
      report(ok, label, detail);
      try { ws.close(); } catch { /* already closed */ }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false, "no answer in 8s"), 8000);
    ws.onopen = () =>
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "slotSubscribe" }));
    ws.onmessage = (event) => {
      clearTimeout(timer);
      const msg = JSON.parse(String(event.data)) as {
        result?: number;
        error?: { code: number; message: string };
      };
      done(!msg.error, msg.error ? `${msg.error.code} ${msg.error.message}` : `subscribed (id ${msg.result})`);
    };
    ws.onerror = () => { clearTimeout(timer); done(false, "socket error"); };
  });
}

// Server-only, and unset they fall back to free public endpoints. Both back
// live venues: the two Ethereum gold borrow markets and Morpho-on-Monad.
async function checkEvm() {
  console.log("\nEVM reads");
  for (const [name, url, expectedChainId] of [
    ["ETHEREUM_RPC_URL", process.env.ETHEREUM_RPC_URL, "0x1"],
    ["MONAD_RPC_URL", process.env.MONAD_RPC_URL, "0x8f"],
  ] as [string, string | undefined, string][]) {
    if (!url) {
      console.log(`  --   ${name.padEnd(30)} unset, code falls back to a public endpoint`);
      continue;
    }
    const r = await rpc(url, "eth_chainId");
    const chainId = r.result as string | undefined;
    report(
      chainId === expectedChainId,
      name,
      r.error
        ? r.error.message
        : `chainId ${chainId}${chainId === expectedChainId ? "" : ` (expected ${expectedChainId})`}, ${r.ms}ms`,
    );
  }
}

async function main() {
  if (!PRIMARY) {
    console.error("NEXT_PUBLIC_SOLANA_RPC_URL is not set. Source .env.local first.");
    process.exit(1);
  }
  const host = (u: string) => new URL(u).host;
  console.log(`primary   ${host(PRIMARY)}`);
  console.log(`fallback  ${FALLBACK ? host(FALLBACK) : "(unset)"}`);

  await checkPrimaryReads(PRIMARY);
  await checkTheSplit();

  console.log("\nWebsocket subscriptions");
  const primaryWs = await checkSubscriptions(PRIMARY, "primary slotSubscribe");
  if (!primaryWs) {
    console.log("       (expected. lib/privy/provider.tsx points rpcSubscriptions at the fallback)");
    failures--;
  }
  if (FALLBACK) await checkSubscriptions(FALLBACK, "fallback slotSubscribe");

  await checkEvm();

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
