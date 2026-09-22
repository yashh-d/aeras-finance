// Live check for the Bitwise Mag7X venue on Glider, against the real APIs.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/glider-check.mts [--owner 0x...] [--enroll-test]
//
// --enroll-test runs the whole enrollment with a throwaway key: stage 1,
// the personal_sign over the raw digest exactly as lib/glider/enroll.ts
// does it through Privy, stage 2, then the reads the app makes on the new
// portfolio. It moves no funds but leaves one empty portfolio under our
// tenant per run, named "Aeras check (throwaway)".
//
// Signs and moves nothing. Three groups of checks, each settling on its own:
//
//   Public (keyless). The boost campaign, TVL and users, the blueprint's
//   allocation against the registry in lib/glider/constants.ts, and the two
//   performance curves. This is what the Markets card reads, so it should
//   pass with no key at all.
//
//   B2B (GLIDER_API_KEY). whoami and its scopes against what the app needs,
//   the tenant swap fee (Glider's default is 50 bps in our name; it warns),
//   the strategy's allocation and performance, discovery's view of it
//   (canMirror, maxApy), and with --owner the owner's portfolio, positions
//   and performance.
//
//   Trustware (TRUSTWARE_API_KEY). A 25 USDC quote from Solana USDC to Base
//   USDC at an EVM address, the deposit leg's price; and a 2 USDC quote from
//   Solana USDC to native ETH on Base with both spellings Trustware uses for
//   a native asset, which is how BASE_NATIVE_TOKEN in lib/base/constants.ts
//   gets pinned.
//
//   Nasdaq (keyless). Ten years of closes for every holding, and the CAGR
//   table the history route computes from them.
//
// The B2B fetches are written out here rather than imported from
// lib/glider/server.ts, which opens with `import "server-only"` and cannot
// load under tsx. They are deliberately the same requests, so a shape change
// shows up here first.

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { BASE_NATIVE_TOKEN_ALIASES, BASE_USDC } from "../lib/base/constants";
import {
  GLIDER_API_BASE_URL,
  GLIDER_CHAIN_ID,
  GLIDER_PUBLIC_API_BASE_URL,
  GLIDER_STRATEGY_ID,
  MAG7X_HOLDINGS,
} from "../lib/glider/constants";
import { parseNasdaqHistory, type NasdaqHistoricalPayload } from "../lib/glider/history";
import { assetReturn, equalWeightBasketReturn, type PricePoint } from "../lib/glider/math";
import { USDC_MINT } from "../lib/jupiter/constants";
import { TRUSTWARE_API_BASE_URL, TRUSTWARE_SOLANA_CHAIN } from "../lib/trustware/constants";

const owner = (() => {
  const i = process.argv.indexOf("--owner");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

const failures: string[] = [];
const warnings: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(label);
}
function warn(label: string, detail = ""): void {
  console.log(`warn ${label}${detail ? `  ${detail}` : ""}`);
  warnings.push(label);
}
function note(label: string, value: unknown): void {
  console.log(`     ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}
async function section<T>(label: string, work: () => Promise<T>): Promise<T | null> {
  console.log(`\n== ${label} ==`);
  try {
    return await work();
  } catch (err) {
    check(label, false, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── Public ──────────────────────────────────────────────────────────────────

async function trpc<T>(procedure: string, input: unknown): Promise<T> {
  const url = `${GLIDER_PUBLIC_API_BASE_URL}/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", origin: "https://glider.fi", referer: "https://glider.fi/" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${procedure}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: { data?: { json?: T } } };
  const json = body.result?.data?.json;
  if (json === undefined) throw new Error(`${procedure}: unexpected shape`);
  return json;
}

await section("public: boost campaign", async () => {
  const r = await trpc<{ success?: boolean; campaignId?: string; apr?: number; maxApr?: number; timestamp?: string }>(
    "strategyBlueprints.getDynamicAprForStrategy",
    { legacyBlueprintId: GLIDER_STRATEGY_ID },
  );
  check("campaign answers", r.success === true && typeof r.apr === "number", JSON.stringify(r));
  note("campaign", r.campaignId);
  note("apr", r.apr);
  if (typeof r.apr === "number" && r.apr !== 0.1) warn("boost is not 10%", String(r.apr));
});

await section("public: blueprint allocation vs registry", async () => {
  const r = await trpc<{
    blueprint_name?: string;
    default_rebalance_interval_milliseconds?: number;
    strategy_data?: { entry?: { children?: { children?: { assetId?: string; blockType?: string }[]; weightings?: string[] } }; tradingSettings?: { triggerPercentage?: number } };
    can_mirror?: boolean;
    is_public?: boolean;
  }>("strategyBlueprints.getStrategyBlueprint", { blueprintId: GLIDER_STRATEGY_ID });
  note("name", r.blueprint_name);
  note("rebalance interval ms", r.default_rebalance_interval_milliseconds);
  note("drift trigger %", r.strategy_data?.tradingSettings?.triggerPercentage);
  check("public and mirrorable", r.is_public === true && r.can_mirror === true);
  const node = r.strategy_data?.entry?.children;
  const live = new Map<string, number>();
  (node?.children ?? []).forEach((c, i) => {
    if (c.blockType !== "asset" || !c.assetId) return;
    const [addr, chain] = c.assetId.split(":");
    if (chain !== String(GLIDER_CHAIN_ID)) return;
    live.set(addr.toLowerCase(), Number(node?.weightings?.[i]) / 100);
  });
  check("eight holdings on Base", live.size === 8, `${live.size}`);
  for (const h of MAG7X_HOLDINGS) {
    const w = live.get(h.contract);
    check(`${h.symbol} in allocation at ${(h.weight * 100).toFixed(1)}%`, w != null && Math.abs(w - h.weight) < 1e-9, w == null ? "missing" : `${(w * 100).toFixed(2)}%`);
  }
  for (const addr of live.keys()) {
    if (!MAG7X_HOLDINGS.some((h) => h.contract === addr)) check(`registry knows ${addr}`, false, "not in MAG7X_HOLDINGS");
  }
});

await section("public: stats and performance", async () => {
  const stats = await trpc<{ items?: { summary?: { totalTvlUsd?: string; portfolioCount?: number; userCount?: number } }[] }>(
    "strategyBlueprints.getStrategyTvlStatsBatch",
    { blueprintIds: [GLIDER_STRATEGY_ID], contributorLimit: 1 },
  );
  const summary = stats.items?.[0]?.summary;
  check("tvl answers", summary?.totalTvlUsd != null, summary?.totalTvlUsd);
  note("users / portfolios", `${summary?.userCount} / ${summary?.portfolioCount}`);
  const perf = await trpc<{ points?: { date: string; percentChange: string }[]; summary?: { windows?: { window: string; percentChange: string }[] }; backtestExcludingSpacex?: { summary?: { windows?: { window: string; percentChange: string }[] } } }>(
    "strategyBlueprints.getStrategyBlueprintPerformance",
    { blueprintId: GLIDER_STRATEGY_ID },
  );
  check("live curve present", (perf.points?.length ?? 0) > 1, `${perf.points?.length} points from ${perf.points?.[0]?.date}`);
  note("live windows", perf.summary?.windows?.map((w) => `${w.window}=${w.percentChange}`).join(" "));
  note("backtest ex-SpaceX windows", perf.backtestExcludingSpacex?.summary?.windows?.map((w) => `${w.window}=${w.percentChange}`).join(" "));
});

// ── B2B ─────────────────────────────────────────────────────────────────────

const key = process.env.GLIDER_API_KEY;
async function b2b<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data?: T; error?: unknown; raw: unknown }> {
  const res = await fetch(`${GLIDER_API_BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "x-api-key": key ?? "",
      accept: "application/json",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const raw = (await res.json().catch(() => null)) as { data?: T; error?: unknown } | null;
  return { status: res.status, data: raw?.data, error: raw?.error, raw };
}

if (!key) {
  console.log("\n== B2B ==\nskip GLIDER_API_KEY is not set; the card reads without it, the ticket cannot enroll or deposit.");
} else {
  await section("b2b: whoami and scopes", async () => {
    const r = await b2b<{ tenantName?: string; scopes?: string[] }>("/whoami");
    check("key accepted", r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.error ?? "")}`);
    note("tenant", r.data?.tenantName);
    const scopes = new Set(r.data?.scopes ?? []);
    note("scopes", [...scopes].join(" "));
    for (const s of ["strategies:read", "portfolios:read", "enroll:write", "portfolios:write", "portfolios:withdraw"]) {
      check(`scope ${s}`, scopes.has(s), scopes.has(s) ? "" : "missing: request it in the console or from developers@glider.fi");
    }
  });

  await section("b2b: tenant fees", async () => {
    const r = await b2b<{ swapBps?: number | null }>("/tenant/fees");
    if (r.status === 403) {
      warn("fees:read scope missing", "cannot read the tenant swap fee; check it in the console");
      return;
    }
    check("fees answer", r.status === 200, `HTTP ${r.status}`);
    note("swapBps", r.data?.swapBps);
    if (r.data?.swapBps == null) {
      note("integrator fee", "none configured (null): no swap fee is charged in our name. Set one deliberately with PATCH /v2/tenant/fees if wanted.");
    } else if (r.data.swapBps >= 50) {
      warn("tenant swap fee is high", `${r.data.swapBps} bps on every rebalance swap in our name, on top of the strategy's 0.20%`);
    }
  });

  await section("b2b: strategy", async () => {
    const r = await b2b<{ name?: string; maxApy?: string; allocation?: { assets?: { assetId: string; weight: string }[] }; isPublic?: boolean; version?: number }>(`/strategies/${GLIDER_STRATEGY_ID}`);
    check("strategy readable", r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.error ?? "")}`);
    note("name / version / maxApy", `${r.data?.name} / ${r.data?.version} / ${r.data?.maxApy}`);
    const assets = r.data?.allocation?.assets ?? [];
    check("eight allocation assets", assets.length === 8, `${assets.length}`);
    for (const a of assets) {
      const prefix = `eip155:${GLIDER_CHAIN_ID}/erc20:`;
      const contract = a.assetId.startsWith(prefix) ? a.assetId.slice(prefix.length).toLowerCase() : null;
      const known = contract ? MAG7X_HOLDINGS.find((h) => h.contract === contract) : undefined;
      check(`b2b asset ${a.assetId} known`, known != null, known ? `${known.symbol} ${a.weight}%` : "not in registry");
    }
    const perf = await b2b<{ summary?: { windows?: { window: string; percentChange: string }[] } }>(`/strategies/${GLIDER_STRATEGY_ID}/performance`);
    check("strategy performance readable", perf.status === 200, `HTTP ${perf.status}`);
    note("b2b windows", perf.data?.summary?.windows?.map((w) => `${w.window}=${w.percentChange}`).join(" "));
  });

  await section("b2b: discovery", async () => {
    for (const collection of ["curated", "top_performing"]) {
      let cursor: string | null = null;
      let found: { canMirror?: boolean; maxApy?: string; metrics?: unknown } | null = null;
      for (let page = 0; page < 6 && !found; page++) {
        const qs = new URLSearchParams({ collection, limit: "50" });
        if (cursor) qs.set("cursor", cursor);
        const r = await b2b<{ strategies?: { strategyId: string; canMirror?: boolean; maxApy?: string; metrics?: unknown }[] }>(`/discovery/strategies?${qs}`);
        if (r.status !== 200) break;
        found = r.data?.strategies?.find((s) => s.strategyId === GLIDER_STRATEGY_ID) ?? null;
        cursor = (r.raw as { nextCursor?: string | null } | null)?.nextCursor ?? null;
        if (!cursor) break;
      }
      if (found) {
        check(`listed in ${collection}`, true);
        check("canMirror", found.canMirror === true);
        note("discovery maxApy", found.maxApy);
        note("discovery metrics", found.metrics);
        return;
      }
    }
    warn("strategy not in the first pages of discovery", "enrollment still works by id if the strategy is public");
  });

  if (process.argv.includes("--enroll-test")) {
    await section("b2b: enrollment with a throwaway key (creates one empty portfolio)", async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const ownerAccountId = `eip155:0:${account.address.toLowerCase()}`;
      note("throwaway owner", account.address);
      const s1 = await b2b<{ message?: { kind?: string; raw?: string }; agentAccountId?: string; accountIndex?: string; flowId?: string }>("/enroll/signature", {
        method: "POST",
        body: { ownerAccountId, strategyId: GLIDER_STRATEGY_ID, chainIds: [GLIDER_CHAIN_ID], accountType: "ECDSA" },
      });
      check("stage 1 answers", s1.status === 200, `HTTP ${s1.status} ${JSON.stringify(s1.error ?? "")}`);
      check("stage 1 is an ecdsa digest", s1.data?.message?.kind === "ecdsa" && /^0x[0-9a-f]{64}$/i.test(s1.data?.message?.raw ?? ""), JSON.stringify(s1.data?.message));
      note("agent / accountIndex / flowId", `${s1.data?.agentAccountId} / ${s1.data?.accountIndex} / ${s1.data?.flowId}`);
      if (!s1.data?.message?.raw || !s1.data.flowId || !s1.data.agentAccountId) return;
      // Exactly what lib/glider/enroll.ts does through Privy's provider:
      // personal_sign over the raw digest bytes, untransformed.
      const signature = await account.signMessage({ message: { raw: s1.data.message.raw as `0x${string}` } });
      const s2 = await b2b<{ portfolioId?: string; smartAccounts?: { accountId: string }[] }>("/enroll", {
        method: "POST",
        body: {
          ownerAccountId, strategyId: GLIDER_STRATEGY_ID, chainIds: [GLIDER_CHAIN_ID], accountType: "ECDSA",
          accountIndex: s1.data.accountIndex ?? "0", agentAccountId: s1.data.agentAccountId, signature, flowId: s1.data.flowId,
          portfolioName: "Aeras check (throwaway)",
        },
      });
      check("stage 2 creates the portfolio", s2.status === 201 || s2.status === 200, `HTTP ${s2.status} ${JSON.stringify(s2.error ?? "")}`);
      const base = s2.data?.smartAccounts?.find((a) => a.accountId.startsWith(`eip155:${GLIDER_CHAIN_ID}:`));
      check("portfolio has a Base smart account", base != null, JSON.stringify(s2.data?.smartAccounts));
      note("portfolioId", s2.data?.portfolioId);
      if (!s2.data?.portfolioId) return;
      const id = s2.data.portfolioId;
      const list = await b2b<{ portfolios?: { portfolioId: string }[] }>(`/portfolios?${new URLSearchParams({ ownerAccountId, strategyId: GLIDER_STRATEGY_ID })}`);
      check("list by owner finds it (what findPortfolio does)", list.data?.portfolios?.some((p) => p.portfolioId === id) === true, `HTTP ${list.status}`);
      const pos = await b2b<{ totalValueUsd?: string; assets?: unknown[] }>(`/portfolios/${id}/positions`);
      check("positions readable on an empty portfolio", pos.status === 200, `HTTP ${pos.status}`);
      note("empty total", pos.data?.totalValueUsd);
      const liq = await b2b<unknown>(`/portfolios/${id}/liquidate-all/signature`, { method: "POST", body: { recipientAccountId: `eip155:${GLIDER_CHAIN_ID}:${account.address.toLowerCase()}` } });
      const liqCode = (liq.error as { code?: string } | undefined)?.code;
      check("liquidate-all on an empty portfolio answers API_220", liq.status === 400 && liqCode === "API_220", `HTTP ${liq.status} ${JSON.stringify(liq.error ?? "")}`);
      // Measured 2026-09-22: an EMPTY portfolio answers 500 API_600 "Failed
      // to trigger manual rebalance", which the app's deposit path tolerates
      // (the deposit is in the account; the scheduler runs daily). A funded
      // one is expected to answer 202, or 429 inside the cooldown.
      const reb = await b2b<{ operationId?: string }>(`/portfolios/${id}/rebalance`, { method: "POST" });
      const rebCode = (reb.error as { code?: string } | undefined)?.code;
      check("rebalance trigger answers as expected on an empty portfolio", reb.status === 202 || reb.status === 429 || (reb.status === 500 && rebCode === "API_600"), `HTTP ${reb.status} ${JSON.stringify(reb.error ?? "")}`);
      note("rebalance", reb.status === 202 ? reb.data?.operationId : reb.status === 429 ? "cooldown" : "refused on an empty portfolio (expected)");
    });
  }

  if (owner) {
    await section(`b2b: portfolio for ${owner}`, async () => {
      const qs = new URLSearchParams({ ownerAccountId: `eip155:0:${owner.toLowerCase()}`, strategyId: GLIDER_STRATEGY_ID });
      const r = await b2b<{ portfolios?: { portfolioId: string; smartAccounts?: { accountId: string }[]; schedule?: unknown; createdAt?: string }[] }>(`/portfolios?${qs}`);
      check("portfolios readable", r.status === 200, `HTTP ${r.status}`);
      const p = r.data?.portfolios?.[0];
      if (!p) {
        note("portfolio", "none for this owner under our tenant");
        return;
      }
      note("portfolioId", p.portfolioId);
      note("smart accounts", p.smartAccounts);
      note("schedule", p.schedule);
      const pos = await b2b<{ totalValueUsd?: string; assets?: { symbol?: string; balance?: string; valueUsd?: string }[]; warnings?: unknown[] }>(`/portfolios/${p.portfolioId}/positions`);
      check("positions readable", pos.status === 200, `HTTP ${pos.status}`);
      note("total value", pos.data?.totalValueUsd);
      for (const a of pos.data?.assets ?? []) note(`  ${a.symbol}`, `${a.balance} ($${a.valueUsd})`);
      if ((pos.data?.warnings?.length ?? 0) > 0) warn("position warnings", JSON.stringify(pos.data?.warnings));
      const perf = await b2b<{ summary?: { windows?: { window: string; percentChange: string }[] } }>(`/portfolios/${p.portfolioId}/performance`);
      note("portfolio MWR windows", perf.data?.summary?.windows?.map((w) => `${w.window}=${w.percentChange}`).join(" ") ?? `HTTP ${perf.status}`);
    });
  } else {
    console.log("\n== b2b: portfolio ==\nskip pass --owner 0x... to read a wallet's portfolio and positions");
  }
}

// ── Trustware ───────────────────────────────────────────────────────────────

const twKey = process.env.TRUSTWARE_API_KEY;
if (!twKey) {
  console.log("\n== Trustware ==\nskip TRUSTWARE_API_KEY is not set");
} else {
  const quote = async (body: Record<string, unknown>) => {
    const res = await fetch(`${TRUSTWARE_API_BASE_URL}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": twKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let parsed: { data?: { estimate?: { toAmount?: string; toAmountMin?: string; totalFeesUsd?: string } }; error?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* reported below */ }
    return { status: res.status, parsed, text: text.slice(0, 300) };
  };
  const FROM = "5ZWj7a1f8tWkjBESHKgrLmXshuXxqeY9SMbmvE9NFVHy";
  const TO = "0x3333333333333333333333333333333333333333";

  await section("trustware: Solana USDC -> Base USDC (the deposit leg)", async () => {
    const r = await quote({
      fromChain: TRUSTWARE_SOLANA_CHAIN, toChain: String(GLIDER_CHAIN_ID),
      fromToken: USDC_MINT, toToken: BASE_USDC.address,
      fromAmount: "25000000", fromAmountUSD: "25", fromAddress: FROM, toAddress: TO, slippage: 1,
    });
    check("quote answers", r.status === 200, `HTTP ${r.status} ${r.text}`);
    const est = r.parsed.data?.estimate;
    check("estimate present", !!est?.toAmount);
    note("delivers (min)", `${est?.toAmount} (${est?.toAmountMin}) of 25000000, fees $${est?.totalFeesUsd}`);
  });

  await section("trustware: Solana USDC -> native ETH on Base (the gas leg)", async () => {
    const quoted: string[] = [];
    for (const token of BASE_NATIVE_TOKEN_ALIASES) {
      const r = await quote({
        fromChain: TRUSTWARE_SOLANA_CHAIN, toChain: String(GLIDER_CHAIN_ID),
        fromToken: USDC_MINT, toToken: token,
        fromAmount: "2000000", fromAmountUSD: "2", fromAddress: FROM, toAddress: TO, slippage: 1,
      });
      const est = r.parsed.data?.estimate;
      const ok = r.status === 200 && !!est?.toAmount;
      if (ok) quoted.push(token);
      console.log(`${ok ? "ok  " : "info"} ${token}: HTTP ${r.status}${est?.toAmount ? ` delivers ${est.toAmount} wei` : ` ${r.text}`}`);
    }
    check("the spelling the app uses quotes", quoted.includes(BASE_NATIVE_TOKEN_ALIASES[0]));
    if (!quoted.includes(BASE_NATIVE_TOKEN_ALIASES[0]) && quoted.length > 0) {
      warn("BASE_NATIVE_TOKEN should be flipped", `${quoted[0]} quotes and ${BASE_NATIVE_TOKEN_ALIASES[0]} does not`);
    }
  });
}

// ── Nasdaq ──────────────────────────────────────────────────────────────────

await section("nasdaq: ten-year history and CAGR", async () => {
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
  const from = new Date(); from.setUTCFullYear(from.getUTCFullYear() - 10);
  const byTicker: Record<string, PricePoint[]> = {};
  for (const h of MAG7X_HOLDINGS) {
    const url = `https://api.nasdaq.com/api/quote/${h.ticker}/historical?assetclass=stocks&fromdate=${from.toISOString().slice(0, 10)}&todate=${new Date().toISOString().slice(0, 10)}&limit=9999`;
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json, text/plain, */*", "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15_000) });
    check(`${h.ticker} history HTTP ${res.status}`, res.ok);
    if (!res.ok) continue;
    const series = parseNasdaqHistory((await res.json()) as NasdaqHistoricalPayload);
    byTicker[h.ticker] = series;
    const r = assetReturn(series);
    note(h.ticker, r ? `${series.length} sessions ${r.from}..${r.to} ${r.kind} ${(r.value * 100).toFixed(1)}%${r.kind === "cagr" ? "/yr" : ""}` : "no series");
    await new Promise((res) => setTimeout(res, 400));
  }
  const basket = equalWeightBasketReturn(byTicker);
  check("basket computed", basket != null);
  if (basket) note("basket", `${(basket.cagr * 100).toFixed(1)}%/yr over ${basket.years.toFixed(1)}y, ${basket.tickers.join(",")}; excluded ${basket.excluded.join(",") || "none"}`);
});

console.log("\n== summary ==");
console.log(failures.length === 0 ? "all checks passed" : `${failures.length} failed: ${failures.join("; ")}`);
if (warnings.length > 0) console.log(`${warnings.length} warning(s): ${warnings.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);
