// Server-only Glider client. Reads GLIDER_API_KEY (no NEXT_PUBLIC_ prefix) and
// sends it as x-api-key; the browser only ever talks to app/api/glider/*.
//
// Two APIs are read here and they are not the same thing.
//
//   The B2B API (api.glider.fi/v2) is the partner contract: enrollment,
//   portfolios, positions, rebalances, withdrawals. Everything that touches a
//   user's money goes through it and needs the key.
//
//   Glider's own frontend API (api.glider.fi/v1/trpc) is keyless and is what
//   glider.fi's strategy page reads. It is used for two figures the B2B API
//   does not carry: the boosted-APR campaign behind the "10%", and the live
//   TVL and user counts. It is not a contract, so scripts/glider-check.mts
//   pins the shapes and this module fails soft when they move: a missing
//   boost is null, never a default.
//
// See docs/glider.md for the enrollment and withdrawal flows these calls
// implement, and for the things that are easy to get wrong (the digest is
// signed untransformed; the withdrawal message goes back byte-for-byte).

import "server-only";

import { BASE_USDC } from "@/lib/base/constants";
import {
  circuitCooldownMs,
  fetchUpstreamJson,
  openCircuit,
  UpstreamError,
} from "@/lib/upstream";

import {
  GLIDER_API_BASE_URL,
  GLIDER_CHAIN_ID,
  GLIDER_PUBLIC_API_BASE_URL,
  GLIDER_STRATEGY_ID,
  mag7xHoldingByContract,
} from "./constants";
import type {
  GliderBoost,
  GliderEnrollmentPrepared,
  GliderLiquidationPrepared,
  GliderOperationState,
  GliderOperationView,
  GliderPortfolioView,
  GliderPositionAsset,
  GliderRebalanceResult,
  PerformancePoint,
  PerformanceWindow,
} from "./types";

const TIMEOUT_MS = 12_000;
// Public reads share one circuit: they are one origin and one rate limit.
const PUBLIC_CIRCUIT_KEY = "glider-public";
export const B2B_CIRCUIT_KEY = "glider-b2b";

export function gliderKeyConfigured(): boolean {
  return Boolean(process.env.GLIDER_API_KEY);
}

function apiKey(): string {
  const key = process.env.GLIDER_API_KEY;
  if (!key) {
    throw new GliderError(
      "Glider is not configured on this server yet (GLIDER_API_KEY is unset).",
      503,
      null,
      null,
    );
  }
  return key;
}

export class GliderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "GliderError";
  }
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown } | string;
  message?: string;
  retryAfter?: number;
  nextCursor?: string | null;
}

// One B2B call. Never retried: enrollment and withdrawal are idempotent on
// their own anchors and a blind retry of a rebalance trigger spends the
// cooldown. A 429 is surfaced with its retry-after rather than waited out,
// because the caller (a route handler) has a user waiting on it.
async function b2b<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; query?: Record<string, string> } = {},
): Promise<{ data: T; nextCursor: string | null }> {
  const key = apiKey();
  const url = new URL(`${GLIDER_API_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  const open = circuitCooldownMs(B2B_CIRCUIT_KEY);
  if (open > 0 && init.method !== "POST") {
    throw new GliderError(
      `Glider is not answering; retrying in ${Math.ceil(open / 1000)}s.`,
      503,
      null,
      Math.ceil(open / 1000),
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "x-api-key": key,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    if (init.method !== "POST") openCircuit(B2B_CIRCUIT_KEY, 20_000, aborted ? "timeout" : "unreachable");
    throw new GliderError(
      aborted ? "Glider did not answer in time." : "Glider could not be reached.",
      503,
      null,
      null,
    );
  }
  clearTimeout(timer);

  const text = await res.text();
  let body: Envelope<T> = {};
  try {
    body = text ? (JSON.parse(text) as Envelope<T>) : {};
  } catch {
    throw new GliderError(`Glider ${path}: non-JSON response (${res.status})`, 502, null, null);
  }

  if (res.status === 429) {
    const header = Number(res.headers.get("retry-after"));
    const secs = Number.isFinite(header) && header > 0 ? header : (body.retryAfter ?? null);
    throw new GliderError(
      "Glider is rate limiting this server right now.",
      429,
      typeof body.error === "object" ? (body.error?.code ?? null) : null,
      secs,
    );
  }
  if (!res.ok || body.success === false) {
    const err = body.error;
    const message =
      (typeof err === "object" && err?.message) ||
      (typeof err === "string" && err) ||
      body.message ||
      `Glider ${path} failed (${res.status})`;
    const code = typeof err === "object" ? (err?.code ?? null) : null;
    if (res.status >= 500 && init.method !== "POST") {
      openCircuit(B2B_CIRCUIT_KEY, 20_000, `upstream ${res.status}`);
    }
    throw new GliderError(message, res.status, code, null);
  }
  if (body.data === undefined) {
    throw new GliderError(`Glider ${path}: empty response`, 502, null, null);
  }
  return { data: body.data, nextCursor: body.nextCursor ?? null };
}

// ── Identifiers ─────────────────────────────────────────────────────────────

// Chain-agnostic CAIP-10 for an EVM EOA, the form Glider keys owners by.
export function ownerAccountId(evmAddress: string): string {
  return `eip155:0:${evmAddress.toLowerCase()}`;
}

// Chain-bound CAIP-10 for a recipient on Base.
export function baseAccountId(evmAddress: string): string {
  return `eip155:${GLIDER_CHAIN_ID}:${evmAddress.toLowerCase()}`;
}

// The bare address out of a chain-bound CAIP-10 on the strategy's chain, or
// null when the entry is for another chain.
export function baseSmartAccount(
  accounts: { accountId: string }[] | undefined,
): string | null {
  const prefix = `eip155:${GLIDER_CHAIN_ID}:`;
  for (const a of accounts ?? []) {
    if (a.accountId.startsWith(prefix)) {
      const address = a.accountId.slice(prefix.length);
      if (/^0x[0-9a-fA-F]{40}$/.test(address)) return address.toLowerCase();
    }
  }
  return null;
}

// "eip155:8453/erc20:0xabc" -> "0xabc". Null for anything not an ERC-20 on
// the strategy's chain.
export function baseErc20FromAssetId(assetId: string): string | null {
  const prefix = `eip155:${GLIDER_CHAIN_ID}/erc20:`;
  if (!assetId.startsWith(prefix)) return null;
  const address = assetId.slice(prefix.length);
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : null;
}

// ── Public (keyless) reads ──────────────────────────────────────────────────

function trpcUrl(procedure: string, input: unknown): string {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  return `${GLIDER_PUBLIC_API_BASE_URL}/${procedure}?input=${encoded}`;
}

interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } };
}

async function trpc<T>(procedure: string, input: unknown): Promise<T> {
  const body = await fetchUpstreamJson<TrpcEnvelope<T>>({
    key: PUBLIC_CIRCUIT_KEY,
    url: trpcUrl(procedure, input),
    label: `Glider ${procedure}`,
    headers: {
      accept: "application/json",
      origin: "https://glider.fi",
      referer: "https://glider.fi/",
    },
    timeoutMs: 8_000,
  });
  const json = body.result?.data?.json;
  if (json === undefined) {
    throw new UpstreamError(`Glider ${procedure}: unexpected shape`, false);
  }
  return json;
}

// The campaign behind the advertised return. Read live every time the
// strategy view is built, because it is a campaign with a name and a date,
// not a property of the assets, and the day it ends this must read null.
export async function fetchBoost(): Promise<GliderBoost | null> {
  const r = await trpc<{
    success?: boolean;
    campaignId?: string;
    campaignName?: string;
    apr?: number;
    maxApr?: number;
    timestamp?: string;
  }>("strategyBlueprints.getDynamicAprForStrategy", {
    legacyBlueprintId: GLIDER_STRATEGY_ID,
  });
  if (!r.success || typeof r.apr !== "number" || !r.campaignId) return null;
  return {
    apr: r.apr,
    maxApr: typeof r.maxApr === "number" ? r.maxApr : r.apr,
    campaignId: r.campaignId,
    campaignName: r.campaignName ?? r.campaignId,
    asOf: r.timestamp ?? new Date().toISOString(),
  };
}

export interface PublicStats {
  tvlUsd: number | null;
  users: number | null;
  portfolios: number | null;
}

export async function fetchPublicStats(): Promise<PublicStats> {
  const r = await trpc<{
    items?: {
      blueprintId?: string;
      summary?: { totalTvlUsd?: string; portfolioCount?: number; userCount?: number };
    }[];
  }>("strategyBlueprints.getStrategyTvlStatsBatch", {
    blueprintIds: [GLIDER_STRATEGY_ID],
    contributorLimit: 1,
  });
  const summary = r.items?.find((i) => i.blueprintId === GLIDER_STRATEGY_ID)?.summary;
  const tvl = summary?.totalTvlUsd != null ? Number(summary.totalTvlUsd) : NaN;
  return {
    tvlUsd: Number.isFinite(tvl) ? tvl : null,
    users: typeof summary?.userCount === "number" ? summary.userCount : null,
    portfolios: typeof summary?.portfolioCount === "number" ? summary.portfolioCount : null,
  };
}

function toWindows(raw: unknown): PerformanceWindow[] {
  const windows = (raw as { windows?: { window?: string; percentChange?: string; since?: string }[] } | undefined)?.windows;
  const out: PerformanceWindow[] = [];
  for (const w of windows ?? []) {
    const pct = Number(w.percentChange);
    if (!w.window || !Number.isFinite(pct) || !w.since) continue;
    if (!["1d", "1w", "1m", "3m", "6m", "12m", "all"].includes(w.window)) continue;
    out.push({ window: w.window as PerformanceWindow["window"], percentChange: pct, since: w.since });
  }
  return out;
}

function toPoints(raw: unknown): PerformancePoint[] {
  const points = raw as { date?: string; percentChange?: string | null }[] | undefined;
  const out: PerformancePoint[] = [];
  for (const p of points ?? []) {
    const pct = Number(p.percentChange);
    if (!p.date || !Number.isFinite(pct)) continue;
    out.push({ date: p.date, percentChange: pct });
  }
  return out;
}

export interface PublicPerformance {
  live: { points: PerformancePoint[]; windows: PerformanceWindow[] } | null;
  backtestExcludingSpacex: { windows: PerformanceWindow[] } | null;
}

// Glider's page draws two curves and headlines the second as the all-time
// return, so both are kept apart here under their own names.
export async function fetchPublicPerformance(): Promise<PublicPerformance> {
  const r = await trpc<{
    points?: unknown;
    summary?: unknown;
    backtestExcludingSpacex?: { points?: unknown; summary?: unknown };
  }>("strategyBlueprints.getStrategyBlueprintPerformance", {
    blueprintId: GLIDER_STRATEGY_ID,
  });
  const livePoints = toPoints(r.points);
  const liveWindows = toWindows(r.summary);
  const backtest = r.backtestExcludingSpacex ? toWindows(r.backtestExcludingSpacex.summary) : [];
  return {
    live: livePoints.length > 0 ? { points: livePoints, windows: liveWindows } : null,
    backtestExcludingSpacex: backtest.length > 0 ? { windows: backtest } : null,
  };
}

export interface PublicBlueprint {
  name: string;
  description: string;
  allocation: { contract: string; weight: number }[];
  rebalanceIntervalMs: number | null;
  driftTriggerPct: number | null;
  version: number | null;
}

export async function fetchPublicBlueprint(): Promise<PublicBlueprint> {
  const r = await trpc<{
    blueprint_name?: string;
    blueprint_description?: string;
    default_rebalance_interval_milliseconds?: number;
    version?: number;
    strategy_data?: {
      entry?: {
        children?: {
          children?: { assetId?: string; blockType?: string }[];
          weightings?: string[];
        };
      };
      tradingSettings?: { type?: string; triggerPercentage?: number };
    };
  }>("strategyBlueprints.getStrategyBlueprint", { blueprintId: GLIDER_STRATEGY_ID });

  const node = r.strategy_data?.entry?.children;
  const allocation: { contract: string; weight: number }[] = [];
  (node?.children ?? []).forEach((child, i) => {
    if (child.blockType !== "asset" || !child.assetId) return;
    // "0xabc:8453" on this API, CAIP-19 on the B2B one.
    const [address, chain] = child.assetId.split(":");
    if (chain !== String(GLIDER_CHAIN_ID)) return;
    const weight = Number(node?.weightings?.[i]);
    allocation.push({ contract: address.toLowerCase(), weight: Number.isFinite(weight) ? weight / 100 : 0 });
  });
  return {
    name: r.blueprint_name ?? "",
    description: r.blueprint_description ?? "",
    allocation,
    rebalanceIntervalMs: r.default_rebalance_interval_milliseconds ?? null,
    driftTriggerPct: r.strategy_data?.tradingSettings?.triggerPercentage ?? null,
    version: r.version ?? null,
  };
}

// ── B2B: strategy reads ─────────────────────────────────────────────────────

export interface B2bStrategy {
  strategyId: string;
  name: string;
  description: string;
  maxApy: string | null;
  allocation: { assetId: string; weight: string }[];
  isPublic: boolean | null;
  version: number | null;
}

export async function fetchStrategy(): Promise<B2bStrategy> {
  const { data } = await b2b<{
    strategyId: string;
    name?: string;
    description?: string;
    maxApy?: string;
    allocation?: { assets?: { assetId: string; weight: string }[] };
    isPublic?: boolean;
    version?: number;
  }>(`/strategies/${GLIDER_STRATEGY_ID}`);
  return {
    strategyId: data.strategyId,
    name: data.name ?? "",
    description: data.description ?? "",
    maxApy: data.maxApy ?? null,
    allocation: data.allocation?.assets ?? [],
    isPublic: data.isPublic ?? null,
    version: data.version ?? null,
  };
}

export async function fetchStrategyPerformance(): Promise<{
  points: PerformancePoint[];
  windows: PerformanceWindow[];
}> {
  const { data } = await b2b<{ points?: unknown; summary?: unknown }>(
    `/strategies/${GLIDER_STRATEGY_ID}/performance`,
  );
  return { points: toPoints(data.points), windows: toWindows(data.summary) };
}

export async function whoami(): Promise<{ tenantName: string; scopes: string[] }> {
  const { data } = await b2b<{ tenantName?: string; scopes?: string[] }>("/whoami");
  return { tenantName: data.tenantName ?? "", scopes: data.scopes ?? [] };
}

export async function fetchTenantFees(): Promise<{ swapBps: number | null }> {
  const { data } = await b2b<{ swapBps?: number | null }>("/tenant/fees");
  return { swapBps: data.swapBps ?? null };
}

// ── B2B: portfolios ─────────────────────────────────────────────────────────

export interface PortfolioRecord {
  portfolioId: string;
  portfolioName: string | null;
  ownerAccountId: string;
  strategyId: string;
  smartAccount: string;
  schedule: GliderPortfolioView["schedule"];
  createdAt: string;
}

interface RawPortfolio {
  portfolioId: string;
  portfolioName?: string | null;
  ownerAccountId: string;
  strategyId: string;
  smartAccounts?: { accountId: string }[];
  schedule?: {
    status?: string;
    frequency?: string;
    nextDueAt?: string | null;
    lastRebalanceAt?: string | null;
  } | null;
  createdAt?: string;
}

function toRecord(raw: RawPortfolio): PortfolioRecord | null {
  const smartAccount = baseSmartAccount(raw.smartAccounts);
  if (!smartAccount) return null;
  const status = raw.schedule?.status;
  return {
    portfolioId: raw.portfolioId,
    portfolioName: raw.portfolioName ?? null,
    ownerAccountId: raw.ownerAccountId,
    strategyId: raw.strategyId,
    smartAccount,
    schedule: {
      status: status === "active" || status === "paused" ? status : null,
      frequency: raw.schedule?.frequency ?? null,
      nextDueAt: raw.schedule?.nextDueAt ?? null,
      lastRebalanceAt: raw.schedule?.lastRebalanceAt ?? null,
    },
    createdAt: raw.createdAt ?? "",
  };
}

// The one place a user's portfolio is looked up, cached briefly because the
// Trustware route handler and the portfolio route both ask within the same
// second during a deposit.
const portfolioCache = new Map<string, { at: number; record: PortfolioRecord | null }>();
const PORTFOLIO_CACHE_MS = 20_000;

export function forgetPortfolio(evmAddress: string): void {
  portfolioCache.delete(evmAddress.toLowerCase());
}

// This user's Mag7X portfolio under our tenant, or null. Glider allows one
// enrollment per (owner, strategy, account index) and the app only ever
// creates one, so the newest with a Base smart account is the portfolio.
export async function findPortfolio(evmAddress: string): Promise<PortfolioRecord | null> {
  const key = evmAddress.toLowerCase();
  const cached = portfolioCache.get(key);
  if (cached && Date.now() - cached.at < PORTFOLIO_CACHE_MS) return cached.record;

  const { data } = await b2b<{ portfolios?: RawPortfolio[] }>("/portfolios", {
    query: {
      ownerAccountId: ownerAccountId(evmAddress),
      strategyId: GLIDER_STRATEGY_ID,
      limit: "10",
    },
  });
  let record: PortfolioRecord | null = null;
  for (const raw of data.portfolios ?? []) {
    const r = toRecord(raw);
    if (r) {
      record = r;
      break;
    }
  }
  portfolioCache.set(key, { at: Date.now(), record });
  return record;
}

// Whether `address` is the Base smart account of this user's own portfolio.
// The Trustware route handler asks this before it will build a deposit that
// delivers anywhere other than the user's own wallet.
export async function verifyGliderSmartAccount(
  evmAddress: string | null,
  address: string,
): Promise<boolean> {
  if (!evmAddress) return false;
  const record = await findPortfolio(evmAddress);
  return record != null && record.smartAccount === address.toLowerCase();
}

export async function prepareEnrollment(evmAddress: string): Promise<GliderEnrollmentPrepared> {
  const owner = ownerAccountId(evmAddress);
  const { data } = await b2b<{
    message?: { kind?: string; raw?: string };
    agentAccountId?: string;
    accountIndex?: string;
    flowId?: string;
  }>("/enroll/signature", {
    method: "POST",
    body: {
      ownerAccountId: owner,
      strategyId: GLIDER_STRATEGY_ID,
      chainIds: [GLIDER_CHAIN_ID],
      accountType: "ECDSA",
    },
  });
  if (data.message?.kind !== "ecdsa" || !data.message.raw || !data.agentAccountId || !data.flowId) {
    throw new GliderError("Glider returned an enrollment payload this app cannot sign.", 502, null, null);
  }
  return {
    ownerAccountId: owner,
    messageRaw: data.message.raw,
    agentAccountId: data.agentAccountId,
    accountIndex: data.accountIndex ?? "0",
    flowId: data.flowId,
  };
}

export async function completeEnrollment(args: {
  evmAddress: string;
  prepared: Pick<GliderEnrollmentPrepared, "agentAccountId" | "accountIndex" | "flowId">;
  signature: string;
}): Promise<{ portfolioId: string; smartAccount: string }> {
  const { data } = await b2b<{
    portfolioId: string;
    smartAccounts?: { accountId: string }[];
  }>("/enroll", {
    method: "POST",
    body: {
      ownerAccountId: ownerAccountId(args.evmAddress),
      strategyId: GLIDER_STRATEGY_ID,
      chainIds: [GLIDER_CHAIN_ID],
      accountType: "ECDSA",
      accountIndex: args.prepared.accountIndex,
      agentAccountId: args.prepared.agentAccountId,
      signature: args.signature,
      flowId: args.prepared.flowId,
      portfolioName: "Aeras Mag7X",
    },
  });
  const smartAccount = baseSmartAccount(data.smartAccounts);
  if (!smartAccount) {
    throw new GliderError("Glider created the portfolio without a Base smart account.", 502, null, null);
  }
  forgetPortfolio(args.evmAddress);
  return { portfolioId: data.portfolioId, smartAccount };
}

export async function fetchPortfolioRecord(portfolioId: string): Promise<PortfolioRecord | null> {
  const { data } = await b2b<RawPortfolio>(`/portfolios/${encodeURIComponent(portfolioId)}`);
  return toRecord(data);
}

interface RawPositions {
  totalValueUsd?: string;
  inTransit?: { totalUsd?: string };
  assets?: {
    assetId: string;
    symbol?: string;
    decimals?: number;
    balance?: string;
    priceUsd?: string | null;
    valueUsd?: string;
  }[];
  warnings?: { kind?: string; message?: string }[];
}

export interface Positions {
  totalValueUsd: number;
  inTransitUsd: number;
  idleUsdc: number;
  assets: GliderPositionAsset[];
  warnings: string[];
}

export async function fetchPositions(portfolioId: string): Promise<Positions> {
  const { data } = await b2b<RawPositions>(
    `/portfolios/${encodeURIComponent(portfolioId)}/positions`,
  );
  const assets: GliderPositionAsset[] = [];
  let idleUsdc = 0;
  for (const a of data.assets ?? []) {
    const contract = baseErc20FromAssetId(a.assetId);
    if (!contract) continue;
    const balance = Number(a.balance ?? "0");
    const valueUsd = Number(a.valueUsd ?? "0");
    const price = a.priceUsd != null ? Number(a.priceUsd) : NaN;
    if (contract === BASE_USDC.address) idleUsdc += Number.isFinite(balance) ? balance : 0;
    assets.push({
      assetId: a.assetId,
      contract,
      symbol: a.symbol ?? contract.slice(0, 8),
      decimals: a.decimals ?? 18,
      balance: Number.isFinite(balance) ? balance : 0,
      priceUsd: Number.isFinite(price) ? price : null,
      valueUsd: Number.isFinite(valueUsd) ? valueUsd : 0,
      holding: mag7xHoldingByContract(contract) ?? null,
    });
  }
  const total = Number(data.totalValueUsd ?? "0");
  const transit = Number(data.inTransit?.totalUsd ?? "0");
  return {
    totalValueUsd: Number.isFinite(total) ? total : 0,
    inTransitUsd: Number.isFinite(transit) ? transit : 0,
    idleUsdc,
    assets,
    warnings: (data.warnings ?? []).map((w) => w.message ?? w.kind ?? "").filter(Boolean),
  };
}

export async function fetchPortfolioPerformance(
  portfolioId: string,
): Promise<{ windows: PerformanceWindow[] } | null> {
  try {
    const { data } = await b2b<{ summary?: unknown }>(
      `/portfolios/${encodeURIComponent(portfolioId)}/performance`,
    );
    const windows = toWindows(data.summary);
    return windows.length > 0 ? { windows } : null;
  } catch (err) {
    // A portfolio with one day of history has no summary, and the read is
    // decoration next to the balances; the view survives without it.
    if (err instanceof GliderError && err.status < 500) return null;
    throw err;
  }
}

export async function buildPortfolioView(record: PortfolioRecord): Promise<GliderPortfolioView> {
  const [positions, performance] = await Promise.all([
    fetchPositions(record.portfolioId),
    fetchPortfolioPerformance(record.portfolioId),
  ]);
  return {
    portfolioId: record.portfolioId,
    portfolioName: record.portfolioName,
    smartAccount: record.smartAccount,
    schedule: record.schedule,
    totalValueUsd: positions.totalValueUsd,
    idleUsdc: positions.idleUsdc,
    inTransitUsd: positions.inTransitUsd,
    assets: positions.assets,
    warnings: positions.warnings,
    performance,
    createdAt: record.createdAt,
    fetchedAt: new Date().toISOString(),
  };
}

// ── B2B: automation ─────────────────────────────────────────────────────────

// Resume the schedule (a no-op when active) and ask for a rebalance now, so
// a deposit becomes the eight holdings in minutes rather than at the next
// daily tick. A refused trigger is reported with its cooldown, not thrown:
// the scheduler will still run and the deposit is safe in the smart account.
export async function startAndRebalance(portfolioId: string): Promise<GliderRebalanceResult> {
  const id = encodeURIComponent(portfolioId);
  try {
    await b2b(`/portfolios/${id}/start`, { method: "POST" });
  } catch (err) {
    // 400 means "no schedule to resume", which a mirrored public strategy can
    // legitimately report; the manual trigger below still works.
    if (!(err instanceof GliderError && err.status === 400)) throw err;
  }
  try {
    const { data } = await b2b<{ operationId?: string }>(`/portfolios/${id}/rebalance`, {
      method: "POST",
    });
    return { operationId: data.operationId ?? null, retryAfterSeconds: null };
  } catch (err) {
    if (err instanceof GliderError && err.status === 429) {
      return { operationId: null, retryAfterSeconds: err.retryAfterSeconds ?? 60 };
    }
    throw err;
  }
}

const OPERATION_STATES: ReadonlySet<string> = new Set([
  "accepted",
  "running",
  "retrying",
  "awaiting_user",
  "completed",
  "failed",
  "cancelled",
]);

export async function fetchOperation(
  portfolioId: string,
  operationId: string,
): Promise<GliderOperationView> {
  const { data } = await b2b<{
    operationId: string;
    kind?: string;
    state?: string;
    error?: string | null;
    finishedAt?: string | null;
  }>(
    `/portfolios/${encodeURIComponent(portfolioId)}/operations/${encodeURIComponent(operationId)}`,
  );
  const state = data.state && OPERATION_STATES.has(data.state) ? (data.state as GliderOperationState) : "running";
  return {
    operationId: data.operationId,
    kind: data.kind ?? "",
    state,
    error: data.error ?? null,
    finishedAt: data.finishedAt ?? null,
  };
}

// ── B2B: exit ───────────────────────────────────────────────────────────────

// Stage 1 of liquidate-all: every holding on Base above Glider's swap
// threshold, sold to USDC and delivered to `recipientEvmAddress`. The route
// handler passes the user's own embedded wallet and nothing else.
export async function prepareLiquidateAll(
  portfolioId: string,
  recipientEvmAddress: string,
): Promise<GliderLiquidationPrepared> {
  const { data } = await b2b<{
    authorizationId?: string;
    expiresAt?: string;
    typedData?: Record<string, unknown> & { message?: { assets?: unknown[] } };
  }>(`/portfolios/${encodeURIComponent(portfolioId)}/liquidate-all/signature`, {
    method: "POST",
    body: { recipientAccountId: baseAccountId(recipientEvmAddress) },
  });
  if (!data.typedData || !data.authorizationId || !data.expiresAt) {
    throw new GliderError("Glider returned no liquidation authorization to sign.", 502, null, null);
  }
  return {
    authorizationId: data.authorizationId,
    expiresAt: data.expiresAt,
    typedData: data.typedData,
    recipient: recipientEvmAddress.toLowerCase(),
    assetCount: data.typedData.message?.assets?.length ?? 0,
  };
}

// Stage 2. `message` is the stage-1 typedData.message, byte-for-byte.
export async function submitLiquidateAll(
  portfolioId: string,
  message: unknown,
  signature: string,
): Promise<{ operationId: string }> {
  const { data } = await b2b<{ operationId?: string }>(
    `/portfolios/${encodeURIComponent(portfolioId)}/liquidate-all`,
    { method: "POST", body: { message, signature } },
  );
  if (!data.operationId) {
    throw new GliderError("Glider accepted the liquidation but returned no operation to track.", 502, null, null);
  }
  return { operationId: data.operationId };
}
