// Wire shapes between app/api/glider and the browser. Everything here is what
// our own routes return, not what Glider returns; the Glider shapes stay in
// lib/glider/server.ts where they are read.

import type { Mag7xHolding } from "./constants";

export interface GliderBoost {
  // Decimal (0.1 = 10%). The campaign's current rate.
  apr: number;
  maxApr: number;
  campaignId: string;
  campaignName: string;
  asOf: string;
}

export interface PerformanceWindow {
  window: "1d" | "1w" | "1m" | "3m" | "6m" | "12m" | "all";
  // Percent, as Glider reports it (15.99 = 15.99%).
  percentChange: number;
  since: string;
}

export interface PerformancePoint {
  date: string;
  percentChange: number;
}

export interface GliderStrategyView {
  strategyId: string;
  name: string;
  description: string;
  holdings: Mag7xHolding[];
  // Null when the campaign endpoint did not answer. Never a default.
  boost: GliderBoost | null;
  fee: number;
  tvlUsd: number | null;
  users: number | null;
  portfolios: number | null;
  // The live curve since the strategy's first day with all eight holdings
  // listed, and the twelve-month backtest without SpaceX that Glider's page
  // headlines as the all-time figure. Both named so the UI cannot conflate
  // them.
  live: { points: PerformancePoint[]; windows: PerformanceWindow[] } | null;
  backtestExcludingSpacex: { windows: PerformanceWindow[] } | null;
  rebalance: { intervalMs: number; driftTriggerPct: number } | null;
  // False until GLIDER_API_KEY is set. The read side works without it; the
  // enrollment and deposit side does not.
  keyConfigured: boolean;
  fetchedAt: string;
}

export interface HistoryRow {
  ticker: string;
  symbol: string;
  name: string;
  from: string;
  to: string;
  years: number;
  sessions: number;
  // "cagr" carries an annualised figure over a multi-year window;
  // "since-listing" carries a plain cumulative return, because annualising a
  // few months of trading produces a number that means nothing.
  kind: "cagr" | "since-listing";
  // Decimal. CAGR for "cagr", cumulative return for "since-listing".
  value: number;
}

export interface HistoryView {
  rows: HistoryRow[];
  // Daily-rebalanced equal weight across the holdings with a full window.
  basket: {
    cagr: number;
    years: number;
    from: string;
    to: string;
    tickers: string[];
    excluded: string[];
  } | null;
  fetchedAt: string;
}

export interface GliderPositionAsset {
  assetId: string;
  contract: string;
  symbol: string;
  decimals: number;
  balance: number;
  priceUsd: number | null;
  valueUsd: number;
  // Set when the asset is one of the eight holdings.
  holding: Mag7xHolding | null;
}

export interface GliderPortfolioView {
  portfolioId: string;
  portfolioName: string | null;
  // The Base smart account the user funds. Chain-bound CAIP-10 with the
  // prefix stripped: a bare 0x address.
  smartAccount: string;
  schedule: {
    status: "active" | "paused" | null;
    frequency: string | null;
    nextDueAt: string | null;
    lastRebalanceAt: string | null;
  };
  totalValueUsd: number;
  // USDC sitting in the smart account waiting for a rebalance to buy the
  // holdings. A just-funded portfolio is all of this and none of the eight.
  idleUsdc: number;
  inTransitUsd: number;
  assets: GliderPositionAsset[];
  warnings: string[];
  // Money-weighted, the user's own outcome after deposits and withdrawals.
  performance: { windows: PerformanceWindow[] } | null;
  createdAt: string;
  fetchedAt: string;
}

export interface GliderEnrollmentPrepared {
  ownerAccountId: string;
  // The 32-byte digest to sign with personal_sign, untransformed.
  messageRaw: string;
  agentAccountId: string;
  accountIndex: string;
  flowId: string;
}

export interface GliderEnrollmentResult {
  portfolioId: string;
  smartAccount: string;
}

export type GliderOperationState =
  | "accepted"
  | "running"
  | "retrying"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "cancelled";

export interface GliderOperationView {
  operationId: string;
  kind: string;
  state: GliderOperationState;
  error: string | null;
  finishedAt: string | null;
}

export interface GliderRebalanceResult {
  operationId: string | null;
  // Set when Glider refused the manual trigger for landing too soon after the
  // last one. The scheduler still runs; the deposit is not stuck.
  retryAfterSeconds: number | null;
}

export interface GliderLiquidationPrepared {
  authorizationId: string;
  expiresAt: string;
  // EIP-712 payload, passed to eth_signTypedData_v4 as-is.
  typedData: Record<string, unknown>;
  // The bare recipient address, which the server pinned to the user's own
  // embedded EVM wallet.
  recipient: string;
  assetCount: number;
}

export interface BaseBalancesView {
  address: string;
  usdcAtomic: string;
  ethWei: string;
  fetchedAt: string;
}
