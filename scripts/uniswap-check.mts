// Live check for the Uniswap liquidity pools venue (lib/uniswap). Hits the
// real endpoints, so no app server is needed.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/uniswap-check.mts
//
// Environment: ETHEREUM_RPC_URL, MONAD_RPC_URL, ROBINHOOD_RPC_URL,
// BASE_RPC_URL (all optional; public nodes otherwise), TRUSTWARE_API_KEY
// (section 4), UNISWAP_API_KEY (section 5, skipped without it).
// UNISWAP_CHECK_TRUSTWARE_RETRIES and UNISWAP_CHECK_TRUSTWARE_DELAY_MS tune
// how long a Trustware 502 is waited out (defaults: 3 retries, 60 s apart).
// UNISWAP_CHECK_SKIP=4,5 skips sections.
//
// What it proves, in order of how badly each would hurt if wrong:
//
//   1. The registry matches the chain: tokens, fee, tick spacing and hook for
//      every pool, the v4 ids recomputed from the keys PositionManager
//      returns, and the PositionInfo unpacking against a live position. A
//      wrong entry here mints into the wrong pool.
//   2. Pool state: slot0 and liquidity read for every pool, and the price the
//      dollar-quoted pools imply against GeckoTerminal's within 3%.
//   3. Metrics: TVL and volume from Uniswap's GraphQL for all twelve, and the
//      fee APR the card would show.
//   4. Trustware routes every leg the venue uses: each bridge token from
//      Solana USDC, each gas leg, the same-chain stock swaps on Robinhood
//      Chain, every token's way home, and the allowance proxy. Quotes only;
//      nothing is signed and no intent is created.
//   5. The LP API, when a key is set: check_approval and create for one pool
//      per chain, which is what says which chains the key serves.
//   6. Gas price per chain, printed.
//
// Exit code is non-zero when any asserted section fails.

import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  type Hex,
} from "viem";

import { BASE_CHAIN_ID, BASE_RPC_URL } from "../lib/base/constants";
import { ETHEREUM_CHAIN_ID, ETHEREUM_RPC_URL } from "../lib/ethereum/constants";
import { USDC_MINT } from "../lib/jupiter/constants";
import { MONAD_CHAIN_ID, MONAD_RPC_URL } from "../lib/morpho/constants";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_NATIVE_TOKEN_ALIASES,
  ROBINHOOD_RPC_URL,
} from "../lib/robinhood/constants";
import {
  TRUSTWARE_API_ROOT,
  TRUSTWARE_SOLANA_CHAIN,
} from "../lib/trustware/constants";
import {
  V3_POOL_ABI,
  V4_POSITION_MANAGER_ABI,
  V4_STATE_VIEW_ABI,
} from "../lib/uniswap/abi";
import {
  GECKOTERMINAL_API_BASE_URL,
  PERMIT2_ADDRESS,
  UNISWAP_CONTRACTS,
  UNISWAP_GRAPHQL_ORIGIN,
  UNISWAP_GRAPHQL_URL,
  UNISWAP_LP_API_BASE_URL,
  BAND_BPS,
  type UniswapChainId,
} from "../lib/uniswap/constants";
import {
  bandTicks,
  baseUsdFromPool,
  feeApr,
  poolIdToBytes25,
  unpackPositionInfo,
  v4PoolId,
  v4PoolKey,
} from "../lib/uniswap/math";
import {
  NATIVE_FUNDING_TOKEN,
  UNISWAP_CHAINS,
  UNISWAP_POOLS,
  uniswapTokensForChain,
  type PoolToken,
  type UniswapPool,
} from "../lib/uniswap/pools";

const SOL_ADDR = "HYyEoLDLMmL2wtKczx6JLNeUc7RqUnXGUUnPudwiAbN4";
const EVM_DUMMY = "0x1111111111111111111111111111111111111111";

const RPC: Record<UniswapChainId, string> = {
  [ETHEREUM_CHAIN_ID]: ETHEREUM_RPC_URL,
  [MONAD_CHAIN_ID]: MONAD_RPC_URL,
  [ROBINHOOD_CHAIN_ID]: ROBINHOOD_RPC_URL,
  [BASE_CHAIN_ID]: BASE_RPC_URL,
};
const GRAPHQL_CHAIN: Record<UniswapChainId, string> = {
  [ETHEREUM_CHAIN_ID]: "ETHEREUM",
  [MONAD_CHAIN_ID]: "MONAD",
  [ROBINHOOD_CHAIN_ID]: "ROBINHOOD",
  [BASE_CHAIN_ID]: "BASE",
};
const GECKO_NETWORK: Record<UniswapChainId, string> = {
  [ETHEREUM_CHAIN_ID]: "eth",
  [MONAD_CHAIN_ID]: "monad",
  [ROBINHOOD_CHAIN_ID]: "robinhood",
  [BASE_CHAIN_ID]: "base",
};

const SKIP = new Set((process.env.UNISWAP_CHECK_SKIP ?? "").split(",").filter(Boolean));
const failures: string[] = [];
function check(section: string, ok: boolean, what: string) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${what}`);
  if (!ok) failures.push(`${section}: ${what}`);
}
function note(what: string) {
  console.log(`       ${what}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (s: string) => `${s.slice(0, 10)}…`;

// ── RPC ───────────────────────────────────────────────────────────────────

interface Call { to: string; data: Hex; from?: string }

async function rpcBatch(chainId: UniswapChainId, calls: (Call | { method: string; params: unknown[] })[]): Promise<(Hex | Record<string, unknown> | null)[]> {
  const body = calls.map((c, i) =>
    "method" in c
      ? { jsonrpc: "2.0", id: i, method: c.method, params: c.params }
      : { jsonrpc: "2.0", id: i, method: "eth_call", params: [c.from ? { from: c.from, to: c.to, data: c.data } : { to: c.to, data: c.data }, "latest"] },
  );
  const res = await fetch(RPC[chainId], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${UNISWAP_CHAINS[chainId].label} RPC ${res.status}`);
  const json = (await res.json()) as { id: number; result?: Hex | Record<string, unknown>; error?: { message?: string } }[];
  if (!Array.isArray(json)) throw new Error(`${UNISWAP_CHAINS[chainId].label} RPC: ${JSON.stringify(json).slice(0, 200)}`);
  const byId = new Map(json.map((r) => [r.id, r]));
  const results = calls.map((_, i) => byId.get(i)?.result ?? null);
  // Base's public node drops calls from a batch of six (observed twice on
  // 2026-09-22: one of token1, slot0 or liquidity came back null). Re-ask
  // any dropped call on its own before giving up.
  for (let i = 0; i < results.length; i += 1) {
    if (results[i] != null || byId.get(i)?.error) continue;
    const c = calls[i];
    const res2 = await fetch(RPC[chainId], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify("method" in c ? { jsonrpc: "2.0", id: 1, method: c.method, params: c.params } : { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: c.to, data: c.data }, "latest"] }),
      signal: AbortSignal.timeout(20_000),
    });
    const one = (await res2.json()) as { result?: Hex | Record<string, unknown> };
    results[i] = one.result ?? null;
  }
  return results;
}

type V3Fn = (typeof V3_POOL_ABI)[number]["name"];
type PmFn = (typeof V4_POSITION_MANAGER_ABI)[number]["name"];
type SvFn = (typeof V4_STATE_VIEW_ABI)[number]["name"];

const v3 = (to: string, fn: V3Fn): Call => ({ to, data: encodeFunctionData({ abi: V3_POOL_ABI, functionName: fn } as never) });
const pm = (to: string, fn: PmFn, args: unknown[] = []): Call => ({ to, data: encodeFunctionData({ abi: V4_POSITION_MANAGER_ABI, functionName: fn, args: args as never } as never) });
const sv = (to: string, fn: SvFn, args: unknown[] = []): Call => ({ to, data: encodeFunctionData({ abi: V4_STATE_VIEW_ABI, functionName: fn, args: args as never } as never) });
const dec3 = <T,>(fn: V3Fn, data: Hex) => decodeFunctionResult({ abi: V3_POOL_ABI, functionName: fn, data } as never) as T;
const decPm = <T,>(fn: PmFn, data: Hex) => decodeFunctionResult({ abi: V4_POSITION_MANAGER_ABI, functionName: fn, data } as never) as T;
const decSv = <T,>(fn: SvFn, data: Hex) => decodeFunctionResult({ abi: V4_STATE_VIEW_ABI, functionName: fn, data } as never) as T;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ── 1. registry vs chain ──────────────────────────────────────────────────

const state = new Map<string, { sqrtP: bigint; tick: number; liquidity: bigint }>();

async function section1() {
  console.log("\n1. Registry vs chain");
  for (const pool of UNISWAP_POOLS) {
    const c = UNISWAP_CONTRACTS[pool.chainId];
    const label = `${UNISWAP_CHAINS[pool.chainId].label} ${pool.protocol} ${pool.label} ${short(pool.id)}`;
    try {
      if (pool.protocol === "V3") {
        const [t0, t1, fee, ts, slot, liq] = (await rpcBatch(pool.chainId, [
          v3(pool.id, "token0"), v3(pool.id, "token1"), v3(pool.id, "fee"), v3(pool.id, "tickSpacing"), v3(pool.id, "slot0"), v3(pool.id, "liquidity"),
        ])) as Hex[];
        const token0 = dec3<string>("token0", t0);
        const token1 = dec3<string>("token1", t1);
        const feeChain = dec3<number>("fee", fee);
        const tsChain = dec3<number>("tickSpacing", ts);
        const s = dec3<readonly [bigint, number]>("slot0", slot);
        const ok = same(token0, pool.token0.address) && same(token1, pool.token1.address) && feeChain === pool.fee && tsChain === pool.tickSpacing;
        check("1", ok, `${label}: tokens, fee ${feeChain}, spacing ${tsChain}`);
        state.set(pool.id.toLowerCase(), { sqrtP: s[0], tick: s[1], liquidity: dec3<bigint>("liquidity", liq) });
      } else {
        const [keyHex, slotHex, liqHex] = (await rpcBatch(pool.chainId, [
          pm(c.v4PositionManager, "poolKeys", [poolIdToBytes25(pool.id)]),
          sv(c.v4StateView, "getSlot0", [pool.id]),
          sv(c.v4StateView, "getLiquidity", [pool.id]),
        ])) as Hex[];
        const [c0, c1, feeChain, tsChain, hooks] = decPm<readonly [string, string, number, number, string]>("poolKeys", keyHex);
        const recomputed = v4PoolId({ currency0: c0, currency1: c1, fee: feeChain, tickSpacing: tsChain, hooks });
        const s = decSv<readonly [bigint, number, number, number]>("getSlot0", slotHex);
        const ok =
          same(c0, pool.token0.address) && same(c1, pool.token1.address) && feeChain === pool.fee && tsChain === pool.tickSpacing &&
          same(hooks, pool.hooks) && same(recomputed, pool.id) && same(v4PoolId(v4PoolKey(pool)), pool.id) && s[3] === pool.fee;
        check("1", ok, `${label}: key, fee ${feeChain} (lpFee ${s[3]}), spacing ${tsChain}, hook ${short(hooks)}, id recomputes`);
        state.set(pool.id.toLowerCase(), { sqrtP: s[0], tick: s[1], liquidity: decSv<bigint>("getLiquidity", liqHex) });
      }
    } catch (err) {
      check("1", false, `${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // PositionInfo unpacking against a live position on each v4 chain: the
  // latest minted token id. Its unpacked pool id must be the prefix of the
  // id its own key recomputes, and its ticks must sit on the spacing.
  for (const chainId of [ROBINHOOD_CHAIN_ID, MONAD_CHAIN_ID] as UniswapChainId[]) {
    const c = UNISWAP_CONTRACTS[chainId];
    try {
      const [nextHex] = (await rpcBatch(chainId, [pm(c.v4PositionManager, "nextTokenId")])) as Hex[];
      const next = decPm<bigint>("nextTokenId", nextHex);
      let found = false;
      for (let id = next - 1n; id > next - 6n && id > 0n && !found; id -= 1n) {
        const [infoHex] = (await rpcBatch(chainId, [pm(c.v4PositionManager, "getPoolAndPositionInfo", [id])])) as (Hex | null)[];
        if (!infoHex || infoHex === "0x") continue;
        const [key, info] = decPm<readonly [{ currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }, bigint]>("getPoolAndPositionInfo", infoHex);
        const u = unpackPositionInfo(info);
        const idFromKey = v4PoolId(key);
        const ok = same(u.poolId25, poolIdToBytes25(idFromKey)) && u.tickLower % key.tickSpacing === 0 && u.tickUpper % key.tickSpacing === 0 && u.tickLower < u.tickUpper;
        check("1", ok, `${UNISWAP_CHAINS[chainId].label} PositionInfo unpack on token ${id}: ticks [${u.tickLower}, ${u.tickUpper}] spacing ${key.tickSpacing}, pool ${short(idFromKey)}`);
        found = true;
      }
      if (!found) note(`${UNISWAP_CHAINS[chainId].label}: no recent position to unpack (nextTokenId ${next})`);
    } catch (err) {
      check("1", false, `${UNISWAP_CHAINS[chainId].label} PositionInfo: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── 2. pool state and prices ──────────────────────────────────────────────

async function gecko(pool: UniswapPool): Promise<{ baseUsd: number; quoteUsd: number; reserveUsd: number; vol24h: number; baseIsToken0: boolean } | null> {
  const res = await fetch(`${GECKOTERMINAL_API_BASE_URL}/networks/${GECKO_NETWORK[pool.chainId]}/pools/${pool.id.toLowerCase()}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { attributes?: Record<string, unknown>; relationships?: { base_token?: { data?: { id?: string } } } } };
  const a = body.data?.attributes ?? {};
  const baseId = body.data?.relationships?.base_token?.data?.id ?? "";
  return {
    baseUsd: Number(a.base_token_price_usd),
    quoteUsd: Number(a.quote_token_price_usd),
    reserveUsd: Number(a.reserve_in_usd),
    vol24h: Number((a.volume_usd as Record<string, string> | undefined)?.h24),
    baseIsToken0: baseId.toLowerCase().endsWith(pool.token0.address.toLowerCase()),
  };
}

async function section2() {
  console.log("\n2. Pool state and implied prices");
  for (const pool of UNISWAP_POOLS) {
    const s = state.get(pool.id.toLowerCase());
    const label = `${UNISWAP_CHAINS[pool.chainId].label} ${pool.label}`;
    if (!s) { check("2", false, `${label}: no state from section 1`); continue; }
    const band = bandTicks(s.tick, pool.bandBps ?? BAND_BPS, pool.tickSpacing);
    const implied = baseUsdFromPool(pool, s.sqrtP);
    note(`${label}: tick ${s.tick}, L ${s.liquidity}, band [${band.tickLower}, ${band.tickUpper}]${implied != null ? `, ${pool.quoteSide === 0 ? pool.token1.symbol : pool.token0.symbol} ≈ $${implied.toPrecision(6)}` : ""}`);
    if (implied == null) continue;
    await sleep(2_100); // GeckoTerminal's keyless budget
    const g = await gecko(pool);
    if (!g) { note(`  GeckoTerminal unavailable (rate limit or unknown pool); price not cross-checked`); continue; }
    const baseSym = pool.quoteSide === 0 ? pool.token1 : pool.token0;
    const geckoUsd = same(baseSym.address, pool.token0.address) === g.baseIsToken0 ? g.baseUsd : g.quoteUsd;
    const diff = Math.abs(implied - geckoUsd) / geckoUsd;
    check("2", diff < 0.03, `${label}: ${baseSym.symbol} $${implied.toPrecision(5)} vs GeckoTerminal $${geckoUsd.toPrecision(5)} (${(diff * 100).toFixed(2)}%), reserve $${Math.round(g.reserveUsd).toLocaleString()}, vol24h $${Math.round(g.vol24h).toLocaleString()}`);
  }
}

// ── 3. metrics ────────────────────────────────────────────────────────────

async function section3() {
  console.log("\n3. Metrics (Uniswap GraphQL)");
  const parts = UNISWAP_POOLS.map((p, i) =>
    p.protocol === "V3"
      ? `p${i}: v3Pool(chain: ${GRAPHQL_CHAIN[p.chainId]}, address: "${p.id}") { totalLiquidity { value } day: cumulativeVolume(duration: DAY) { value } week: cumulativeVolume(duration: WEEK) { value } feeTier }`
      : `p${i}: v4Pool(chain: ${GRAPHQL_CHAIN[p.chainId]}, poolId: "${p.id}") { totalLiquidity { value } day: cumulativeVolume(duration: DAY) { value } week: cumulativeVolume(duration: WEEK) { value } feeTier }`,
  );
  try {
    const res = await fetch(UNISWAP_GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", origin: UNISWAP_GRAPHQL_ORIGIN, referer: `${UNISWAP_GRAPHQL_ORIGIN}/` },
      body: JSON.stringify({ query: `query { ${parts.join(" ")} }` }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as { data?: Record<string, { totalLiquidity?: { value?: number }; day?: { value?: number }; week?: { value?: number }; feeTier?: number } | null>; errors?: unknown };
    check("3", res.ok && !!body.data, `GraphQL answered ${res.status}${body.errors ? ` with errors ${JSON.stringify(body.errors).slice(0, 200)}` : ""}`);
    UNISWAP_POOLS.forEach((p, i) => {
      const d = body.data?.[`p${i}`];
      if (!d) { note(`${UNISWAP_CHAINS[p.chainId].label} ${p.label}: no data`); return; }
      const tvl = d.totalLiquidity?.value ?? 0;
      const day = d.day?.value ?? 0;
      const week = d.week?.value ?? 0;
      const apr1 = feeApr(day, p.fee, tvl, 1);
      const apr7 = feeApr(week, p.fee, tvl, 7);
      note(`${UNISWAP_CHAINS[p.chainId].label} ${p.label}: TVL $${Math.round(tvl).toLocaleString()}, vol24h $${Math.round(day).toLocaleString()}, vol7d $${Math.round(week).toLocaleString()}, fee APR 24h ${apr1 == null ? "—" : (apr1 * 100).toFixed(1) + "%"}, 7d ${apr7 == null ? "—" : (apr7 * 100).toFixed(1) + "%"}${d.feeTier != null && d.feeTier !== p.fee ? ` (explorer feeTier ${d.feeTier}, chain ${p.fee})` : ""}`);
    });
  } catch (err) {
    check("3", false, `GraphQL: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── 4. Trustware ──────────────────────────────────────────────────────────

const TW_KEY = process.env.TRUSTWARE_API_KEY;
const TW_RETRIES = Number(process.env.UNISWAP_CHECK_TRUSTWARE_RETRIES ?? 3);
const TW_DELAY = Number(process.env.UNISWAP_CHECK_TRUSTWARE_DELAY_MS ?? 60_000);

interface QuoteOutcome { ok: boolean; provider?: string; toAmount?: string; toAmountMin?: string; feesUsd?: number; detail?: string; status?: number }

function find(o: unknown, k: string): unknown {
  if (o && typeof o === "object") {
    if (k in (o as Record<string, unknown>)) return (o as Record<string, unknown>)[k];
    for (const v of Object.values(o as Record<string, unknown>)) {
      const f = find(v, k);
      if (f !== undefined) return f;
    }
  }
  return undefined;
}

async function twQuote(req: Record<string, unknown>, retryOn502 = false): Promise<QuoteOutcome> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${TRUSTWARE_API_ROOT}/routes/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": TW_KEY! },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = null; }
    if (res.status === 502 && retryOn502 && attempt < TW_RETRIES) {
      note(`  502 from Trustware; retrying in ${TW_DELAY / 1000}s (${attempt + 1}/${TW_RETRIES})`);
      await sleep(TW_DELAY);
      continue;
    }
    if (!res.ok || !body || (body.error && !body.data)) {
      const providers = (body?.providers as { name?: string; outcome?: string; code?: string }[] | undefined) ?? [];
      return { ok: false, status: res.status, detail: body ? `${body.code ?? body.error ?? ""} ${providers.map((p) => `${p.name}:${p.code}`).join(", ")}`.trim() : text.slice(0, 80) };
    }
    const est = (find(body, "estimate") as Record<string, unknown> | undefined) ?? {};
    return {
      ok: true,
      provider: find(body, "provider") as string | undefined,
      toAmount: est.toAmount as string | undefined,
      toAmountMin: est.toAmountMin as string | undefined,
      feesUsd: Number(est.totalFeesUsd ?? find(body, "totalFeesUsd") ?? NaN),
    };
  }
}

function fmtQuote(q: QuoteOutcome, decimals: number, symbol: string): string {
  if (!q.ok) return `no route (${q.status}: ${q.detail})`;
  return `${q.provider}, ${formatUnits(BigInt(q.toAmount ?? "0"), decimals)} ${symbol} (min ${formatUnits(BigInt(q.toAmountMin ?? q.toAmount ?? "0"), decimals)}), fees $${q.feesUsd?.toFixed(3)}`;
}

async function section4() {
  console.log("\n4. Trustware legs");
  if (!TW_KEY) { check("4", false, "TRUSTWARE_API_KEY is not set"); return; }
  const fromSolana = (toChain: number, toToken: string, usdc: bigint) => ({
    fromChain: TRUSTWARE_SOLANA_CHAIN, toChain: String(toChain), fromToken: USDC_MINT, toToken,
    fromAmount: usdc.toString(), fromAmountUSD: (Number(usdc) / 1e6).toFixed(2), fromAddress: SOL_ADDR, toAddress: EVM_DUMMY, slippage: 1,
  });
  const toSolana = (fromChain: number, fromToken: string, amount: bigint) => ({
    fromChain: String(fromChain), toChain: TRUSTWARE_SOLANA_CHAIN, fromToken, toToken: USDC_MINT,
    fromAmount: amount.toString(), fromAddress: EVM_DUMMY, toAddress: SOL_ADDR, slippage: 1,
  });
  const sameChain = (chain: number, fromToken: string, toToken: string, amount: bigint) => ({
    fromChain: String(chain), toChain: String(chain), fromToken, toToken, fromAmount: amount.toString(), fromAddress: EVM_DUMMY, toAddress: EVM_DUMMY, slippage: 1,
  });
  // A $25-ish amount of each token for the return legs.
  const homeAmount = (t: PoolToken): bigint => {
    if (t.stable) return 25n * 10n ** BigInt(t.decimals);
    if (t.symbol === "MON") return 1000n * 10n ** 18n;
    if (t.symbol === "WETH") return 10n ** 16n;
    if (t.symbol === "WBTC" || t.symbol === "cbBTC") return 30_000n;
    return 10n ** 17n; // 0.1 of a stock token
  };

  const chains = [ROBINHOOD_CHAIN_ID, MONAD_CHAIN_ID, ETHEREUM_CHAIN_ID, BASE_CHAIN_ID] as UniswapChainId[];
  for (const chainId of chains) {
    const chain = UNISWAP_CHAINS[chainId];
    console.log(`  ${chain.label}`);
    const tokens = uniswapTokensForChain(chainId);
    for (const t of tokens.filter((t) => t.source === "bridge")) {
      const q = await twQuote(fromSolana(chainId, t.address, 25_000_000n));
      const must = (chainId === ROBINHOOD_CHAIN_ID && t.symbol === "USDG") || (chainId === MONAD_CHAIN_ID && t.symbol === "USDC");
      const line = `Solana USDC 25 → ${chain.label} ${t.symbol}: ${fmtQuote(q, t.decimals, t.symbol)}`;
      if (must) check("4", q.ok, line); else note(line);
    }
    // Gas legs: the chain's native token by the spelling the registry uses,
    // and on Robinhood Chain both spellings with the 502 retry.
    const spellings = chainId === ROBINHOOD_CHAIN_ID ? ROBINHOOD_NATIVE_TOKEN_ALIASES : [NATIVE_FUNDING_TOKEN[chainId]];
    for (const s of spellings) {
      const q = await twQuote(fromSolana(chainId, s, chainId === ETHEREUM_CHAIN_ID ? 20_000_000n : 2_000_000n), chainId === ROBINHOOD_CHAIN_ID);
      note(`Solana USDC ${chainId === ETHEREUM_CHAIN_ID ? 20 : 2} → ${chain.label} native ${chain.nativeSymbol} (${short(s)}): ${fmtQuote(q, 18, chain.nativeSymbol)}`);
    }
    // Same-chain swaps for every `swap` token, both directions, and for a
    // `none` token so the day it becomes routable is visible.
    for (const t of tokens.filter((t) => t.source === "swap" || t.source === "none")) {
      if (t.source === "none") note(`${t.symbol} is registered as unobtainable; the two quotes below say whether that still holds`);
      const buy = await twQuote(sameChain(chainId, chain.dollar.address, t.address, 12n * 10n ** BigInt(chain.dollar.decimals)));
      note(`${chain.label} ${chain.dollar.symbol} 12 → ${t.symbol}: ${fmtQuote(buy, t.decimals, t.symbol)}`);
      const sell = await twQuote(sameChain(chainId, t.address, chain.dollar.address, homeAmount(t)));
      note(`${chain.label} ${t.symbol} ${formatUnits(homeAmount(t), t.decimals)} → ${chain.dollar.symbol}: ${fmtQuote(sell, chain.dollar.decimals, chain.dollar.symbol)}`);
    }
    // The way home for every token.
    for (const t of tokens) {
      const q = await twQuote(toSolana(chainId, t.address, homeAmount(t)));
      note(`${chain.label} ${t.symbol} ${formatUnits(homeAmount(t), t.decimals)} → Solana USDC: ${fmtQuote(q, 6, "USDC")}`);
    }
    // The allowance proxy on this chain.
    try {
      const qs = new URLSearchParams({ chainId: String(chainId), tokenAddress: chain.dollar.address, ownerAddress: EVM_DUMMY, spenderAddress: PERMIT2_ADDRESS });
      const res = await fetch(`${TRUSTWARE_API_ROOT}/sdk/rpc/evm/allowance?${qs}`, { headers: { "x-api-key": TW_KEY }, signal: AbortSignal.timeout(20_000) });
      const body = (await res.json()) as { data?: { allowance?: string }; error?: string };
      note(`allowance proxy: ${res.status}${body.data?.allowance != null ? `, allowance ${body.data.allowance}` : body.error ? `, ${body.error}` : ""}`);
    } catch (err) {
      note(`allowance proxy: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── 5. LP API ─────────────────────────────────────────────────────────────

async function lp(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> | string }> {
  const res = await fetch(`${UNISWAP_LP_API_BASE_URL}/lp/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.UNISWAP_API_KEY! },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as Record<string, unknown> }; } catch { return { status: res.status, body: text.slice(0, 300) }; }
}

async function section5() {
  console.log("\n5. Uniswap LP API");
  if (!process.env.UNISWAP_API_KEY) { note("UNISWAP_API_KEY is not set; skipped. Create one on the Uniswap Developer Platform."); return; }
  const seen = new Set<UniswapChainId>();
  for (const pool of UNISWAP_POOLS) {
    if (seen.has(pool.chainId)) continue;
    seen.add(pool.chainId);
    const s = state.get(pool.id.toLowerCase());
    const label = `${UNISWAP_CHAINS[pool.chainId].label} ${pool.protocol} ${pool.label}`;
    const amount = 10n ** BigInt(pool.token0.decimals - 2); // 0.01 of token0
    const approval = await lp("check_approval", {
      walletAddress: EVM_DUMMY, protocol: pool.protocol, chainId: pool.chainId,
      lpTokens: [{ tokenAddress: pool.token0.address, amount: amount.toString() }, { tokenAddress: pool.token1.address, amount: "1" }],
      action: "CREATE", generatePermitAsTransaction: true,
    });
    const ab = approval.body;
    const txs = typeof ab === "object" ? (ab.transactions as unknown[] | undefined) : undefined;
    note(`${label} check_approval: ${approval.status}${txs ? `, ${txs.length} transaction(s)` : `, ${typeof ab === "string" ? ab : JSON.stringify(ab).slice(0, 200)}`}`);
    if (!s) continue;
    const band = bandTicks(s.tick, pool.bandBps ?? BAND_BPS, pool.tickSpacing);
    const create = await lp("create", {
      walletAddress: EVM_DUMMY, protocol: pool.protocol, chainId: pool.chainId,
      existingPool: { token0Address: pool.token0.address, token1Address: pool.token1.address, poolReference: pool.id },
      independentToken: { tokenAddress: pool.token0.address, amount: amount.toString() },
      tickBounds: { tickLower: band.tickLower, tickUpper: band.tickUpper },
      slippageTolerance: 0.5, simulateTransaction: false,
    });
    const cb = create.body;
    const tx = typeof cb === "object" ? (cb.create as { to?: string; data?: string; value?: string; chainId?: number } | undefined) : undefined;
    const served = create.status === 200 && !!tx?.data && tx.data !== "0x";
    check("5", served, `${label} create: ${create.status}${tx ? `, to ${short(tx.to ?? "")}, ${(tx.data ?? "").length / 2 - 1} bytes, value ${tx.value ?? "0"}, chainId ${tx.chainId}` : `, ${typeof cb === "string" ? cb : JSON.stringify(cb).slice(0, 300)}`}`);
    if (typeof cb === "object" && cb.token1) note(`  token1 amount ${JSON.stringify(cb.token1)}, ticks [${cb.tickLower}, ${cb.tickUpper}]`);
  }
}

// ── 6. gas ────────────────────────────────────────────────────────────────

async function section6() {
  console.log("\n6. Gas price per chain");
  for (const chainId of [ROBINHOOD_CHAIN_ID, MONAD_CHAIN_ID, ETHEREUM_CHAIN_ID, BASE_CHAIN_ID] as UniswapChainId[]) {
    try {
      const [gp] = (await rpcBatch(chainId, [{ method: "eth_gasPrice", params: [] }])) as Hex[];
      const gwei = Number(BigInt(gp)) / 1e9;
      note(`${UNISWAP_CHAINS[chainId].label}: ${gwei < 1 ? gwei.toFixed(4) : gwei.toFixed(2)} gwei; a 600k-gas mint ≈ ${(gwei * 600_000 / 1e9).toFixed(6)} ${UNISWAP_CHAINS[chainId].nativeSymbol}`);
    } catch (err) {
      note(`${UNISWAP_CHAINS[chainId].label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const sections: [string, () => Promise<void>][] = [["1", section1], ["2", section2], ["3", section3], ["4", section4], ["5", section5], ["6", section6]];
for (const [n, run] of sections) {
  if (SKIP.has(n)) { console.log(`\n${n}. skipped`); continue; }
  await run();
}
console.log(failures.length ? `\n${failures.length} failure(s):\n  ${failures.join("\n  ")}` : "\nAll asserted sections passed.");
process.exit(failures.length ? 1 : 0);
