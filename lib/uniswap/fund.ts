"use client";

// Fund and open a liquidity position from the user's Solana USDC, in one
// press. See docs/uniswap-lp-plan.md D6.
//
// The Morpho venue's machinery pointed at four chains: for each token of the
// pair that a bridge delivers, one Trustware leg from Solana USDC; for the
// chain's gas, one more when the wallet is under the floor; for a token no
// bridge delivers (the Robinhood Chain stocks), the chain's dollar token is
// delivered and half of it is swapped on-chain through Trustware's same-chain
// route. Every leg broadcasts up front and settles in parallel, then the
// wallet's balances are read back and the mint is sized from what actually
// arrived (lib/uniswap/deposit.ts), never from the plan.
//
// Balances the wallet already held count toward the deposit only up to each
// side's target, so USDC parked on Monad by another venue is not swept into
// a pool. The same rules as lib/morpho/fund.ts apply: nothing downstream
// treats funds as delivered before Trustware reports success, every
// validation that can happen before the user signs does, and the plan is
// re-made from a fresh balance read so a retry never re-buys what arrived.

import { BASE_CHAIN_ID, BASE_NATIVE_TOKEN } from "@/lib/base/constants";
import { ETHEREUM_CHAIN_ID } from "@/lib/ethereum/constants";
import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import { MONAD_CHAIN_ID, MONAD_NATIVE_TOKEN } from "@/lib/morpho/constants";
import type { EvmSigner, MorphoTxProgress } from "@/lib/morpho/deposit";
import {
  GAS_FLOOR_WEI as MONAD_GAS_FLOOR_WEI,
  broadcastFundingLeg,
  fundingRequest,
  quoteFunding,
  type MorphoFundingLeg,
  type QuoteFn,
} from "@/lib/morpho/fund";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_GAS_FLOOR_WEI,
  ROBINHOOD_GAS_MIN_DELIVERED_WEI,
  ROBINHOOD_GAS_TOPUP_USDC_ATOMIC,
  ROBINHOOD_NATIVE_TOKEN,
} from "@/lib/robinhood/constants";
import { atomicToUi } from "@/lib/trustware/amounts";
import { fetchTrustwareQuoteViaProxy } from "@/lib/trustware/client";
import { TRUSTWARE_DEFAULT_SLIPPAGE } from "@/lib/trustware/constants";
import { needsEthGas, planEthGas } from "@/lib/trustware/eth-gas";
import {
  executeEvmRoute,
  trackTrustwareSettlement,
  type SolanaSigner,
} from "@/lib/trustware/execute";

import { fetchUniswapPools, fetchUniswapPositions, type WalletBalances } from "./client";
import { DEPOSIT_FEE_WARN_USDC_ATOMIC, MIN_DEPOSIT_USDC_ATOMIC } from "./constants";
import { mintPosition } from "./deposit";
import { atomicToFloat, tokenUsdKey } from "./math";
import {
  UNISWAP_CHAINS,
  isDepositable,
  type PoolToken,
  type UniswapChainId,
  type UniswapPool,
} from "./pools";

export type { SolanaSigner };
type Report = (p: MorphoTxProgress) => void;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Margin taken off the Solana balance for Max, the margin
// maxFundableDepositAtomic uses for the Morpho venue.
const MAX_BUFFER_BPS = 300;
// A side short by less than this is not worth a leg: the leg's fixed fee
// would be a large share of it.
const MIN_LEG_USDC_ATOMIC = 500_000n; // 0.5 USDC
// After the legs settle, how long to wait for the balances to read back.
const ARRIVAL_TIMEOUT_MS = 90_000;
const ARRIVAL_POLL_MS = 2_500;
// A leg is counted as arrived once the balance grew by this share of the
// quoted minimum; the rest is read lag or rounding.
const ARRIVAL_TOLERANCE_BPS = 9_800n;
// Rebalance the two sides before minting when they differ by more than this
// share of the total, and by more than a dollar.
const REBALANCE_MIN_BPS = 300n;

// ── gas policy per chain ──────────────────────────────────────────────────

interface GasPolicy {
  floorWei: bigint;
  topupUsdcAtomic: bigint;
  minDeliveredWei: bigint;
  // What Trustware wants as the native destination on this chain.
  token: string;
}

// Monad and Robinhood Chain measured in docs/uniswap-lp-plan.md; Base from
// lib/trustware/base.ts's floor with a fixed top-up (an Orbit-class fee
// market, like Robinhood). Ethereum is not fixed: its gas moves by an order
// of magnitude within a week, so lib/trustware/eth-gas.ts sizes it from the
// live price (slice 4); until then an Ethereum deposit needs ETH already in
// the wallet.
const GAS: Partial<Record<UniswapChainId, GasPolicy>> = {
  [MONAD_CHAIN_ID]: {
    floorWei: MONAD_GAS_FLOOR_WEI,
    topupUsdcAtomic: 500_000n,
    minDeliveredWei: 1_000_000_000_000_000_000n,
    token: MONAD_NATIVE_TOKEN,
  },
  [ROBINHOOD_CHAIN_ID]: {
    floorWei: ROBINHOOD_GAS_FLOOR_WEI,
    topupUsdcAtomic: ROBINHOOD_GAS_TOPUP_USDC_ATOMIC,
    minDeliveredWei: ROBINHOOD_GAS_MIN_DELIVERED_WEI,
    token: ROBINHOOD_NATIVE_TOKEN,
  },
  [BASE_CHAIN_ID]: {
    floorWei: 200_000_000_000_000n,
    topupUsdcAtomic: 1_500_000n,
    minDeliveredWei: 150_000_000_000_000n,
    token: BASE_NATIVE_TOKEN,
  },
};

// Ethereum: the reserve a Move to Solana keeps back, and the gas units one
// full position lifecycle costs there (two Permit2 approvals, a first v3
// mint with its NFT, a decrease with collect, a claim), which planEthGas
// prices at the live gas price and refuses past 2% of the position.
const ETHEREUM_GAS_FLOOR_WEI = 2_000_000_000_000_000n; // 0.002 ETH
const ETHEREUM_GAS_UNITS_FULL_CYCLE = 1_000_000n;

export function gasFloorWei(chainId: UniswapChainId): bigint {
  return GAS[chainId]?.floorWei ?? ETHEREUM_GAS_FLOOR_WEI;
}

export function needsGas(chainId: UniswapChainId, nativeAtomic: string | undefined, gasPriceWei?: string): boolean {
  if (chainId === ETHEREUM_CHAIN_ID) {
    return gasPriceWei ? needsEthGas(nativeAtomic ?? "0", gasPriceWei, ETHEREUM_GAS_UNITS_FULL_CYCLE) : true;
  }
  return BigInt(nativeAtomic || "0") < gasFloorWei(chainId);
}

// ── sizing ────────────────────────────────────────────────────────────────

export function maxDepositUsdcAtomic(solanaUsdcAtomic: string): string {
  return ((BigInt(solanaUsdcAtomic || "0") * BigInt(10_000 - MAX_BUFFER_BPS)) / 10_000n).toString();
}

function isNative(t: PoolToken): boolean {
  return Boolean(t.native) || t.address.toLowerCase() === ZERO_ADDRESS;
}

function held(balances: WalletBalances | null | undefined, t: PoolToken): bigint {
  if (!balances) return 0n;
  return BigInt((isNative(t) ? balances.native : balances[t.address.toLowerCase()]) ?? "0");
}

function usdOf(t: PoolToken, atomic: bigint, price: number | undefined): number {
  return price == null ? 0 : atomicToFloat(atomic, t.decimals) * price;
}

function atomicOfUsd(t: PoolToken, usd: number, price: number | undefined): bigint {
  if (price == null || price <= 0 || usd <= 0) return 0n;
  return BigInt(Math.floor((usd / price) * 10 ** t.decimals));
}

function usdcAtomic(usd: number): bigint {
  return BigInt(Math.max(0, Math.round(usd * 10 ** USDC_DECIMALS)));
}

export interface PlannedLeg {
  // The pool token the leg delivers, or null for the gas leg.
  token: PoolToken | null;
  leg: MorphoFundingLeg;
  describe: string;
}

export type DepositPlan =
  | {
      kind: "ok";
      pool: UniswapPool;
      usdcAtomic: bigint;
      legs: PlannedLeg[];
      // The same-chain swap that makes a `swap` token's half, decided in
      // amount at execution from what arrived.
      swap: { from: PoolToken; to: PoolToken } | null;
      // Balances already in the wallet that count toward each side.
      counted: [bigint, bigint];
      // What the mint is expected to use per side, at the quotes.
      expected: [bigint, bigint];
      // Solana USDC the legs spend, all in.
      spendAtomic: bigint;
      totalFeesUsd: number | null;
      warn: string | null;
    }
  | { kind: "blocked"; reason: string };

export async function planDeposit(args: {
  pool: UniswapPool;
  usdcAtomic: bigint;
  balances: WalletBalances | null;
  // USD per registry token, from the pools or positions payload.
  prices: Record<string, number>;
  solanaUsdcAtomic: string;
  solanaAddress: string | undefined;
  evmAddress: string;
  // The chain's gas price, wei; only Ethereum's planner reads it.
  gasPriceWei?: string;
  fetchQuote?: QuoteFn;
}): Promise<DepositPlan> {
  const { pool, usdcAtomic: usdc } = args;
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;
  const chain = UNISWAP_CHAINS[pool.chainId];
  const blocked = (reason: string): DepositPlan => ({ kind: "blocked", reason });

  if (!isDepositable(pool)) {
    const missing = pool.token0.source === "none" ? pool.token0 : pool.token1;
    return blocked(`No route delivers ${missing.symbol} to ${chain.label} today.`);
  }
  if (usdc <= 0n) return blocked("Enter an amount above zero.");
  if (usdc < MIN_DEPOSIT_USDC_ATOMIC) {
    return blocked(`The minimum deposit is ${atomicToUi(MIN_DEPOSIT_USDC_ATOMIC.toString(), USDC_DECIMALS)} USDC.`);
  }
  if (usdc > BigInt(args.solanaUsdcAtomic || "0")) return blocked("Amount is above your Solana USDC balance.");
  if (!args.solanaAddress) return blocked("No Solana wallet is available to deposit from.");
  const price0 = args.prices[tokenUsdKey(pool.chainId, pool.token0)];
  const price1 = args.prices[tokenUsdKey(pool.chainId, pool.token1)];
  if (price0 == null || price1 == null) return blocked("The pool's prices are not available yet. Try again in a moment.");

  const legs: PlannedLeg[] = [];
  let feesUsd = 0;
  let feesKnown = true;
  let budget = usdc;
  const solanaAddress = args.solanaAddress;

  const quote = async (amount: bigint, toToken: string, describe: string, token: PoolToken | null): Promise<PlannedLeg | string> => {
    const request = fundingRequest(amount.toString(), solanaAddress, args.evmAddress, toToken, pool.chainId);
    try {
      const q = await quoteFunding(request, fetchQuote);
      if (q.totalFeesUsd == null) feesKnown = false;
      else feesUsd += q.totalFeesUsd;
      return {
        token,
        describe,
        leg: { request, sourceAmountAtomic: amount.toString(), toAmountMinAtomic: q.toAmountMinAtomic, totalFeesUsd: q.totalFeesUsd },
      };
    } catch (err) {
      return `Could not price the ${describe} leg to ${chain.label}. ${err instanceof Error ? err.message : "Try again shortly."}`;
    }
  };

  // Gas first, so the sides are sized against what is left. A pool whose
  // own side is the native asset folds the reserve into that side's leg.
  const nativeSide = isNative(pool.token0) ? 0 : isNative(pool.token1) ? 1 : null;
  const nativeHeld = BigInt(args.balances?.native ?? "0");
  const gas = GAS[pool.chainId];
  let reserveUsd = 0;
  if (pool.chainId === ETHEREUM_CHAIN_ID) {
    // Ethereum gas is sized from the live price, and the shared planner
    // refuses when it would swamp the position (lib/trustware/eth-gas.ts).
    if (!args.gasPriceWei) return blocked("Could not read the Ethereum gas price. Try again shortly.");
    const ethPlan = await planEthGas({
      ethBalanceAtomic: nativeHeld.toString(),
      gasPriceWei: args.gasPriceWei,
      solanaUsdcAtomic: args.solanaUsdcAtomic,
      solanaAddress,
      evmAddress: args.evmAddress,
      gasUnits: ETHEREUM_GAS_UNITS_FULL_CYCLE,
      positionValueUsd: Number(usdc) / 10 ** USDC_DECIMALS,
      fetchQuote,
    });
    if (ethPlan.kind === "blocked") return blocked(ethPlan.reason);
    if (ethPlan.leg) {
      const source = BigInt(ethPlan.leg.sourceAmountAtomic);
      if (source >= budget) {
        return blocked(`The Ethereum gas top-up (about ${atomicToUi(source.toString(), USDC_DECIMALS)} USDC) would use up this deposit. Deposit more, or wait for cheaper gas.`);
      }
      legs.push({
        token: null,
        describe: "ETH for gas",
        leg: {
          request: ethPlan.leg.request,
          sourceAmountAtomic: ethPlan.leg.sourceAmountAtomic,
          toAmountMinAtomic: ethPlan.leg.toAmountMinAtomic,
          totalFeesUsd: ethPlan.leg.totalFeesUsd,
        },
      });
      if (ethPlan.leg.totalFeesUsd == null) feesKnown = false;
      else feesUsd += ethPlan.leg.totalFeesUsd;
      budget -= source;
    }
  } else if (nativeHeld < gasFloorWei(pool.chainId)) {
    if (!gas) return blocked(`Gas on ${chain.label} is not handled.`);
    if (nativeSide !== null) {
      const t = nativeSide === 0 ? pool.token0 : pool.token1;
      reserveUsd = usdOf(t, gas.floorWei - nativeHeld, nativeSide === 0 ? price0 : price1);
    } else {
      if (budget <= gas.topupUsdcAtomic) {
        return blocked(`Your ${chain.label} wallet needs a one-time gas top-up (about ${atomicToUi(gas.topupUsdcAtomic.toString(), USDC_DECIMALS)} USDC), which this amount does not cover.`);
      }
      const g = await quote(gas.topupUsdcAtomic, gas.token, `${chain.nativeSymbol} for gas`, null);
      if (typeof g === "string") return blocked(g);
      if (BigInt(g.leg.toAmountMinAtomic) < gas.minDeliveredWei) {
        return blocked(`The ${chain.label} gas top-up did not return a usable rate. Try again shortly.`);
      }
      legs.push(g);
      budget -= gas.topupUsdcAtomic;
    }
  }

  // Each side gets half the budget in dollars, less what the wallet already
  // holds of it (counted up to the target, never beyond).
  const budgetUsd = Number(budget) / 10 ** USDC_DECIMALS;
  const targetUsd = budgetUsd / 2;
  const tokens: [PoolToken, PoolToken] = [pool.token0, pool.token1];
  const prices: [number, number] = [price0, price1];
  const counted: [bigint, bigint] = [0n, 0n];
  const expected: [bigint, bigint] = [0n, 0n];
  const needUsd: [number, number] = [0, 0];
  for (const i of [0, 1] as const) {
    const t = tokens[i];
    let h = held(args.balances, t);
    // The native side's balance below the gas floor is gas, not deposit.
    if (isNative(t)) h = h > gasFloorWei(pool.chainId) ? h - gasFloorWei(pool.chainId) : 0n;
    const target = atomicOfUsd(t, targetUsd, prices[i]);
    counted[i] = h < target ? h : target;
    needUsd[i] = targetUsd - usdOf(t, counted[i], prices[i]);
    expected[i] = counted[i];
  }

  let swap: { from: PoolToken; to: PoolToken } | null = null;
  const dollarSide = pool.quoteSide;
  for (const i of [0, 1] as const) {
    const t = tokens[i];
    if (t.source === "swap") {
      // The dollar side's leg carries this side's dollars too; the swap
      // makes the token once they land.
      if (dollarSide === null) return blocked(`${t.symbol} needs a dollar token on ${chain.label} to be bought with.`);
      const dollar = tokens[dollarSide];
      swap = { from: dollar, to: t };
      needUsd[dollarSide] += needUsd[i];
      needUsd[i] = 0;
      continue;
    }
  }
  for (const i of [0, 1] as const) {
    const t = tokens[i];
    if (t.source === "swap") continue;
    let usd = needUsd[i];
    if (isNative(t) && i === nativeSide) usd += reserveUsd;
    const amount = usdcAtomic(usd);
    if (amount < MIN_LEG_USDC_ATOMIC) continue;
    const toToken = isNative(t) ? (gas?.token ?? t.address) : t.address;
    const l = await quote(amount, toToken, t.symbol, t);
    if (typeof l === "string") return blocked(l);
    legs.push(l);
    expected[i] += BigInt(l.leg.toAmountMinAtomic);
  }
  if (swap) {
    // The stock half is expected to be roughly the dollars it costs.
    const s = swap.to === pool.token0 ? 0 : 1;
    const d = 1 - s;
    const half = expected[d] / 2n;
    expected[d] -= half;
    expected[s] += atomicOfUsd(tokens[s], usdOf(tokens[d], half, prices[d]), prices[s]);
  }

  const spend = legs.reduce((sum, l) => sum + BigInt(l.leg.sourceAmountAtomic), 0n);
  if (legs.length === 0 && counted[0] === 0n && counted[1] === 0n) {
    return blocked("This amount is too small to fund either side of the pool.");
  }
  return {
    kind: "ok",
    pool,
    usdcAtomic: usdc,
    legs,
    swap,
    counted,
    expected,
    spendAtomic: spend,
    totalFeesUsd: feesKnown ? feesUsd : null,
    warn:
      usdc < DEPOSIT_FEE_WARN_USDC_ATOMIC
        ? "Each leg carries a fixed fee of about $0.07 to $0.30, which is a noticeable share at this size."
        : null,
  };
}

// ── execution ─────────────────────────────────────────────────────────────

async function readBalances(chainId: UniswapChainId): Promise<{ balances: WalletBalances | null; prices: Record<string, number> }> {
  try {
    const p = await fetchUniswapPositions();
    return { balances: p.balances[chainId] ?? null, prices: p.prices };
  } catch {
    return { balances: null, prices: {} };
  }
}

async function awaitArrival(
  chainId: UniswapChainId,
  before: WalletBalances | null,
  legs: PlannedLeg[],
  signal?: AbortSignal,
): Promise<WalletBalances | null> {
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  const need = legs.map((l) => ({
    key: l.token ? (isNative(l.token) ? "native" : l.token.address.toLowerCase()) : "native",
    grow: (BigInt(l.leg.toAmountMinAtomic) * ARRIVAL_TOLERANCE_BPS) / 10_000n,
  }));
  let last: WalletBalances | null = null;
  for (;;) {
    if (signal?.aborted) return last;
    const { balances } = await readBalances(chainId);
    if (balances) {
      last = balances;
      const ok = need.every((n) => BigInt(balances[n.key] ?? "0") - BigInt(before?.[n.key] ?? "0") >= n.grow);
      if (ok) return balances;
    }
    if (Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, ARRIVAL_POLL_MS));
  }
}

// Bring the two sides to roughly equal value with one same-chain swap when
// they differ enough to matter, then mint from what the wallet holds. Shared
// by the funded deposit and Reopen (docs/uniswap-lp-plan.md D11).
export async function balanceAndMint(args: {
  pool: UniswapPool;
  signer: EvmSigner;
  // What the wallet may put into the position, per side, atomic.
  use: [bigint, bigint];
  prices: Record<string, number>;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ txHash: string; recorded: boolean }> {
  const { pool, signer } = args;
  const report: Report = (p) => args.onProgress?.(p);
  const chain = UNISWAP_CHAINS[pool.chainId];
  const tokens: [PoolToken, PoolToken] = [pool.token0, pool.token1];
  const use: [bigint, bigint] = [args.use[0], args.use[1]];
  const price = (i: 0 | 1) => args.prices[tokenUsdKey(pool.chainId, tokens[i])];
  const usd: [number, number] = [usdOf(tokens[0], use[0], price(0)), usdOf(tokens[1], use[1], price(1))];
  const total = usd[0] + usd[1];
  const diff = usd[0] - usd[1];

  if (total > 0 && Math.abs(diff) > 1 && BigInt(Math.round((Math.abs(diff) / total) * 10_000)) > REBALANCE_MIN_BPS) {
    const rich: 0 | 1 = diff > 0 ? 0 : 1;
    const poor: 0 | 1 = rich === 0 ? 1 : 0;
    const from = tokens[rich];
    const to = tokens[poor];
    const amount = atomicOfUsd(from, Math.abs(diff) / 2, price(rich));
    if (amount > 0n) {
      const beforeSwap = (await readBalances(pool.chainId)).balances;
      const heldTo = held(beforeSwap, to);
      report({ stage: "funding", message: `Swapping ${from.symbol} for ${to.symbol} on ${chain.label}.` });
      await executeEvmRoute({
        request: {
          fromChain: String(pool.chainId),
          toChain: String(pool.chainId),
          fromToken: isNative(from) ? (GAS[pool.chainId]?.token ?? from.address) : from.address,
          toToken: isNative(to) ? (GAS[pool.chainId]?.token ?? to.address) : to.address,
          fromAmount: amount.toString(),
          fromAddress: signer.address,
          toAddress: signer.address,
          slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
        },
        evm: signer,
        describe: from.symbol,
        onProgress: (p) => report({ stage: "funding", message: p.message }),
        signal: args.signal,
      });
      // What the swap delivered is what the poor side gains; a same-chain
      // route settles in its own transaction, so one fresh read suffices.
      const after = (await readBalances(pool.chainId)).balances;
      const gained = held(after, to) - heldTo;
      use[rich] -= amount;
      use[poor] += gained > 0n ? gained : 0n;
    }
  }

  // Never spend the native side into the gas floor.
  for (const i of [0, 1] as const) {
    if (!isNative(tokens[i])) continue;
    const now = (await readBalances(pool.chainId)).balances;
    const spendable = held(now, tokens[i]) - gasFloorWei(pool.chainId);
    if (use[i] > spendable) use[i] = spendable > 0n ? spendable : 0n;
  }
  if (use[0] <= 0n && use[1] <= 0n) throw new Error("Nothing arrived to deposit.");

  return mintPosition({ pool, signer, use, prices: args.prices, onProgress: args.onProgress, signal: args.signal });
}

// The one-press deposit: plan from a fresh read, fund, wait, swap if the
// pool needs it, mint, record. Returns the mint hash.
export async function depositFromSolana(args: {
  pool: UniswapPool;
  usdcAtomic: bigint;
  solanaUsdcAtomic: string;
  prices: Record<string, number>;
  gasPriceWei?: string;
  signer: EvmSigner;
  solana: SolanaSigner;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ txHash: string; recorded: boolean; plan: Extract<DepositPlan, { kind: "ok" }> }> {
  const { pool, signer } = args;
  const report: Report = (p) => args.onProgress?.(p);
  const chain = UNISWAP_CHAINS[pool.chainId];

  report({ stage: "funding", message: `Reading your ${chain.label} wallet.` });
  const [fresh, poolsPayload] = await Promise.all([
    readBalances(pool.chainId),
    fetchUniswapPools().catch(() => null),
  ]);
  const prices = Object.keys(fresh.prices).length > 0 ? fresh.prices : args.prices;
  const plan = await planDeposit({
    pool,
    usdcAtomic: args.usdcAtomic,
    balances: fresh.balances,
    prices,
    solanaUsdcAtomic: args.solanaUsdcAtomic,
    solanaAddress: args.solana.address,
    evmAddress: signer.address,
    gasPriceWei: poolsPayload?.gasPriceWei?.[pool.chainId] ?? args.gasPriceWei,
  });
  if (plan.kind === "blocked") throw new Error(plan.reason);

  const before = fresh.balances;
  const broadcasted = [];
  for (const l of plan.legs) {
    broadcasted.push(
      await broadcastFundingLeg({
        funding: l.leg,
        minDeliveredAtomic: 0n,
        describe: l.describe,
        solana: args.solana,
        report,
        signal: args.signal,
      }),
    );
  }
  if (broadcasted.length > 0) {
    report({ stage: "funding", message: `Bridging to ${chain.label}. This can take a few minutes.` });
    await Promise.all(
      broadcasted.map((b) =>
        trackTrustwareSettlement(b.intentId, args.signal, () =>
          report({ stage: "funding", message: `Bridging to ${chain.label}. This can take a few minutes.` }),
        ),
      ),
    );
    report({ stage: "funding", message: `Funds arrived. Confirming the ${chain.label} balances.` });
  }
  const after = broadcasted.length > 0 ? await awaitArrival(pool.chainId, before, plan.legs, args.signal) : before;
  if (!after) throw new Error(`The funds are on ${chain.label} but the balance read has not caught up. Your funds are safe. Try again in a moment.`);

  // What the mint may use: the counted prior balance plus what each side
  // gained. A short arrival is a smaller position, not an error.
  const use: [bigint, bigint] = [0n, 0n];
  for (const i of [0, 1] as const) {
    const t = i === 0 ? pool.token0 : pool.token1;
    const gained = held(after, t) - held(before, t);
    use[i] = plan.counted[i] + (gained > 0n ? gained : 0n);
  }
  if (broadcasted.length > 0 && use[0] === 0n && use[1] === 0n) {
    throw new Error(`The funds are on ${chain.label} but the balance read has not caught up. Your funds are safe. Try again in a moment.`);
  }

  const minted = await balanceAndMint({ pool, signer, use, prices, onProgress: args.onProgress, signal: args.signal });
  return { ...minted, plan };
}
