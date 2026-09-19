// Server-only Ethereum reads for the Aave venue: live rates and TVL per vault,
// and a wallet's positions, balances, cooldown state and pending rewards.
//
// Everything is read straight from the chain rather than from Aave's API.
// Rates come from the Pool's own reserve data and Umbrella's own emission
// schedule, which are the numbers the contracts pay on; the API would only be
// a cache of them. Batched through lib/ethereum/rpc.ts so a full read is a
// handful of round trips rather than dozens.

import "server-only";

import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
} from "viem";

import { ethCall, rpcBatch, rpcBatchSettled } from "@/lib/ethereum/rpc";

import {
  AAVE_ORACLE_ABI,
  AAVE_POOL_ABI,
  ATOKEN_ABI,
  ERC20_META_ABI,
  ERC4626_ABI,
  REWARDS_CONTROLLER_ABI,
  STAKE_TOKEN_ABI,
  STATA_TOKEN_ABI,
} from "./abi";
import {
  AAVE_ORACLE,
  AAVE_V3_POOL,
  ETHEREUM_USDC,
  ETHEREUM_USDT,
  UMBRELLA_REWARDS_CONTROLLER,
} from "./constants";
import {
  rewardAprFromEmission,
  supplyApyFromLiquidityRate,
  umbrellaTotalApy,
} from "./math";
import { AAVE_VAULTS, type AaveVault } from "./vaults";

// ── metrics ────────────────────────────────────────────────────────────────

export interface AaveRewardStream {
  token: string;
  symbol: string;
  decimals: number;
  // Per second, in the token's own units. Zero once the distribution ends.
  emissionPerSecond: string;
  // Annual rate this stream adds on the staked value. Null when the token
  // could not be priced through the Aave oracle, in which case it is left out
  // of the total rather than guessed.
  apr: number | null;
  // True when the reward is the vault's own aToken, which the batch helper can
  // restake in one step.
  isVaultAToken: boolean;
}

export interface AaveVaultMetric {
  address: string;
  // The reserve's supply APY, compounded per second the way Aave's UI shows
  // it. Both vault kinds earn this.
  supplyApy: number;
  // Safety incentives, umbrella only. Zero for a supply vault.
  rewardApr: number;
  // supplyApy + rewardApr.
  totalApy: number;
  rewards: AaveRewardStream[];
  tvlUsd: number | null;
  // Umbrella only. A paused stake token takes no deposits.
  paused: boolean;
  cooldownSeconds: number;
  unstakeWindowSeconds: number;
  // Supply only: the reserve's free liquidity in underlying units, which caps
  // an instant withdrawal.
  liquidityAtomic: string;
}

function decode<const A extends readonly unknown[], N extends string>(
  abi: A,
  functionName: N,
  data: Hex,
) {
  // Thin wrapper so call sites read as one line. viem infers the return type
  // from the ABI, and the function name is a literal at every call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return decodeFunctionResult({ abi: abi as any, functionName, data }) as any;
}

export async function readAaveMetrics(): Promise<AaveVaultMetric[]> {
  // ── round trip 1: reserve rates, prices, vault totals ──────────────────
  const reserves = [ETHEREUM_USDC.address, ETHEREUM_USDT.address];
  const calls = [
    ...reserves.map((a) =>
      ethCall(
        AAVE_V3_POOL,
        encodeFunctionData({
          abi: AAVE_POOL_ABI,
          functionName: "getReserveData",
          args: [a as `0x${string}`],
        }),
      ),
    ),
    ...reserves.map((a) =>
      ethCall(
        AAVE_ORACLE,
        encodeFunctionData({
          abi: AAVE_ORACLE_ABI,
          functionName: "getAssetPrice",
          args: [a as `0x${string}`],
        }),
      ),
    ),
  ];
  const perVault = AAVE_VAULTS.map((v) => {
    const start = calls.length;
    calls.push(
      ethCall(
        v.address,
        encodeFunctionData({ abi: ERC4626_ABI, functionName: "totalAssets" }),
      ),
      ethCall(
        v.stataToken,
        encodeFunctionData({ abi: STATA_TOKEN_ABI, functionName: "latestAnswer" }),
      ),
    );
    if (v.kind === "umbrella") {
      calls.push(
        ethCall(
          v.address,
          encodeFunctionData({ abi: STAKE_TOKEN_ABI, functionName: "paused" }),
        ),
        ethCall(
          v.address,
          encodeFunctionData({ abi: STAKE_TOKEN_ABI, functionName: "getCooldown" }),
        ),
        ethCall(
          v.address,
          encodeFunctionData({
            abi: STAKE_TOKEN_ABI,
            functionName: "getUnstakeWindow",
          }),
        ),
        ethCall(
          UMBRELLA_REWARDS_CONTROLLER,
          encodeFunctionData({
            abi: REWARDS_CONTROLLER_ABI,
            functionName: "getAllRewards",
            args: [v.address as `0x${string}`],
          }),
        ),
      );
    } else {
      // Free liquidity is the underlying the aToken contract holds.
      calls.push(
        ethCall(
          v.asset.address,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [v.aToken as `0x${string}`],
          }),
        ),
      );
    }
    return { vault: v, start };
  });

  const out = await rpcBatch(calls);

  const liquidityRateByAsset = new Map<string, bigint>();
  const priceByAsset = new Map<string, bigint>();
  reserves.forEach((a, i) => {
    const reserve = decode(AAVE_POOL_ABI, "getReserveData", out[i]) as {
      currentLiquidityRate: bigint;
    };
    liquidityRateByAsset.set(a.toLowerCase(), reserve.currentLiquidityRate);
    priceByAsset.set(
      a.toLowerCase(),
      decode(AAVE_ORACLE_ABI, "getAssetPrice", out[reserves.length + i]) as bigint,
    );
  });

  interface Partial1 {
    vault: AaveVault;
    totalAssets: bigint;
    stataPriceE8: bigint;
    paused: boolean;
    cooldownSeconds: number;
    unstakeWindowSeconds: number;
    rewardTokens: string[];
    liquidityAtomic: bigint;
  }
  const partials: Partial1[] = perVault.map(({ vault, start }) => {
    const totalAssets = decode(ERC4626_ABI, "totalAssets", out[start]) as bigint;
    const stataPriceE8 = BigInt(
      decode(STATA_TOKEN_ABI, "latestAnswer", out[start + 1]) as bigint,
    );
    if (vault.kind === "umbrella") {
      return {
        vault,
        totalAssets,
        stataPriceE8,
        paused: decode(STAKE_TOKEN_ABI, "paused", out[start + 2]) as boolean,
        cooldownSeconds: Number(
          decode(STAKE_TOKEN_ABI, "getCooldown", out[start + 3]) as bigint,
        ),
        unstakeWindowSeconds: Number(
          decode(STAKE_TOKEN_ABI, "getUnstakeWindow", out[start + 4]) as bigint,
        ),
        rewardTokens: (
          decode(REWARDS_CONTROLLER_ABI, "getAllRewards", out[start + 5]) as string[]
        ).map((t) => t),
        liquidityAtomic: 0n,
      };
    }
    return {
      vault,
      totalAssets,
      stataPriceE8,
      paused: false,
      cooldownSeconds: 0,
      unstakeWindowSeconds: 0,
      rewardTokens: [],
      liquidityAtomic: decode(erc20Abi, "balanceOf", out[start + 2]) as bigint,
    };
  });

  // ── round trip 2: each reward stream's emission, metadata, and whether it
  // is an aToken (the UNDERLYING_ASSET_ADDRESS probe reverts otherwise) ──
  const rewardCalls: { method: string; params: unknown[] }[] = [];
  const rewardSlots: { vaultIdx: number; token: string; start: number }[] = [];
  partials.forEach((p, vaultIdx) => {
    for (const token of p.rewardTokens) {
      rewardSlots.push({ vaultIdx, token, start: rewardCalls.length });
      rewardCalls.push(
        ethCall(
          UMBRELLA_REWARDS_CONTROLLER,
          encodeFunctionData({
            abi: REWARDS_CONTROLLER_ABI,
            functionName: "calculateCurrentEmission",
            args: [p.vault.address as `0x${string}`, token as `0x${string}`],
          }),
        ),
        ethCall(token, encodeFunctionData({ abi: ERC20_META_ABI, functionName: "decimals" })),
        ethCall(token, encodeFunctionData({ abi: ERC20_META_ABI, functionName: "symbol" })),
        ethCall(
          token,
          encodeFunctionData({ abi: ATOKEN_ABI, functionName: "UNDERLYING_ASSET_ADDRESS" }),
        ),
      );
    }
  });
  const rewardOut = rewardCalls.length > 0 ? await rpcBatchSettled(rewardCalls) : [];

  interface RewardPartial {
    vaultIdx: number;
    token: string;
    emissionPerSecond: bigint;
    decimals: number;
    symbol: string;
    // The reserve to price it through, when it is an aToken.
    underlying: string | null;
  }
  const rewardPartials: RewardPartial[] = rewardSlots.map((s) => {
    const emissionHex = rewardOut[s.start];
    const decimalsHex = rewardOut[s.start + 1];
    const symbolHex = rewardOut[s.start + 2];
    const underlyingHex = rewardOut[s.start + 3];
    return {
      vaultIdx: s.vaultIdx,
      token: s.token,
      emissionPerSecond: emissionHex
        ? (decode(REWARDS_CONTROLLER_ABI, "calculateCurrentEmission", emissionHex) as bigint)
        : 0n,
      decimals: decimalsHex ? Number(decode(ERC20_META_ABI, "decimals", decimalsHex)) : 18,
      symbol: symbolHex ? (decode(ERC20_META_ABI, "symbol", symbolHex) as string) : "?",
      underlying: underlyingHex
        ? (decode(ATOKEN_ABI, "UNDERLYING_ASSET_ADDRESS", underlyingHex) as string)
        : null,
    };
  });

  // ── round trip 3: prices for the reward tokens ─────────────────────────
  // An aToken is worth its reserve's oracle price. Anything else is asked for
  // a stata-style latestAnswer, and left unpriced if it has none.
  const priceCalls = rewardPartials.map((r) =>
    r.underlying
      ? ethCall(
          AAVE_ORACLE,
          encodeFunctionData({
            abi: AAVE_ORACLE_ABI,
            functionName: "getAssetPrice",
            args: [r.underlying as `0x${string}`],
          }),
        )
      : ethCall(
          r.token,
          encodeFunctionData({ abi: STATA_TOKEN_ABI, functionName: "latestAnswer" }),
        ),
  );
  const priceOut = priceCalls.length > 0 ? await rpcBatchSettled(priceCalls) : [];
  const rewardPriceE8: (bigint | null)[] = rewardPartials.map((r, i) => {
    const hex = priceOut[i];
    if (!hex) return null;
    return r.underlying
      ? (decode(AAVE_ORACLE_ABI, "getAssetPrice", hex) as bigint)
      : BigInt(decode(STATA_TOKEN_ABI, "latestAnswer", hex) as bigint);
  });

  return partials.map((p, vaultIdx) => {
    const supplyApy = supplyApyFromLiquidityRate(
      liquidityRateByAsset.get(p.vault.asset.address.toLowerCase()) ?? 0n,
    );
    // TVL: the vault's total assets valued at the stata price. For a supply
    // vault total assets are already in underlying units and the stata price
    // is the underlying price times the exchange rate, so the product
    // overstates by the exchange rate; the underlying's own price is used
    // there instead.
    const assetPriceE8 = priceByAsset.get(p.vault.asset.address.toLowerCase()) ?? 0n;
    const unitPriceE8 = p.vault.kind === "umbrella" ? p.stataPriceE8 : assetPriceE8;
    const tvlUsd =
      unitPriceE8 > 0n
        ? (Number(p.totalAssets) / 10 ** p.vault.shareDecimals) *
          (Number(unitPriceE8) / 1e8)
        : null;

    const rewards: AaveRewardStream[] = rewardPartials
      .map((r, i) => ({ r, priceE8: rewardPriceE8[i] }))
      .filter(({ r }) => r.vaultIdx === vaultIdx)
      .map(({ r, priceE8 }) => ({
        token: r.token,
        symbol: r.symbol,
        decimals: r.decimals,
        emissionPerSecond: r.emissionPerSecond.toString(),
        apr:
          priceE8 != null && priceE8 > 0n
            ? rewardAprFromEmission({
                emissionPerSecond: r.emissionPerSecond,
                rewardDecimals: r.decimals,
                rewardPriceE8: priceE8,
                stakedAtomic: p.totalAssets,
                stakedDecimals: p.vault.shareDecimals,
                stakedPriceE8: p.stataPriceE8,
              })
            : null,
        isVaultAToken: r.token.toLowerCase() === p.vault.aToken.toLowerCase(),
      }));
    const rewardApr = rewards.reduce((sum, r) => sum + (r.apr ?? 0), 0);

    return {
      address: p.vault.address,
      supplyApy,
      rewardApr,
      totalApy: umbrellaTotalApy(supplyApy, rewardApr),
      rewards,
      tvlUsd,
      paused: p.paused,
      cooldownSeconds: p.cooldownSeconds,
      unstakeWindowSeconds: p.unstakeWindowSeconds,
      liquidityAtomic: p.liquidityAtomic.toString(),
    };
  });
}

// ── positions ──────────────────────────────────────────────────────────────

export interface AavePendingReward {
  token: string;
  decimals: number;
  amountAtomic: string;
}

export interface AavePosition {
  address: string;
  sharesAtomic: string;
  // What the shares redeem for right now, in the underlying (6-decimal
  // atomic), ignoring liquidity and cooldown.
  assetsAtomic: string;
  // Supply only: what an instant withdrawal can pay out, in the underlying.
  withdrawableAtomic: string;
  // Umbrella only.
  cooldown: {
    amount: string;
    endOfCooldown: number;
    withdrawalWindow: number;
  } | null;
  rewards: AavePendingReward[];
}

export interface AaveWalletRead {
  positions: AavePosition[];
  // Plain USDC and USDT sitting in the Ethereum wallet, 6-decimal atomic.
  usdcBalanceAtomic: string;
  usdtBalanceAtomic: string;
  // The aTokens a reward claim leaves behind, in case a restake is refused.
  aUsdcBalanceAtomic: string;
  aUsdtBalanceAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
  // Latest block timestamp, unix seconds. Cooldown phases are judged against
  // this, not the server clock.
  blockTimestamp: number;
}

// The reserve's aToken for an asset, from the registry. Both vault kinds for
// an asset name the same one.
function aTokenOf(symbol: "USDC" | "USDT"): string {
  const vault = AAVE_VAULTS.find((v) => v.asset.symbol === symbol);
  if (!vault) throw new Error(`No Aave vault registered for ${symbol}`);
  return vault.aToken;
}

export async function readAaveWallet(address: string): Promise<AaveWalletRead> {
  const owner = address as `0x${string}`;
  const balanceOf = (token: string) =>
    ethCall(
      token,
      encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    );

  // ── round trip 1 ─────────────────────────────────────────────────────
  const calls: { method: string; params: unknown[] }[] = [
    balanceOf(ETHEREUM_USDC.address),
    balanceOf(ETHEREUM_USDT.address),
    balanceOf(aTokenOf("USDC")),
    balanceOf(aTokenOf("USDT")),
    { method: "eth_getBalance", params: [owner, "latest"] },
    { method: "eth_gasPrice", params: [] },
    { method: "eth_getBlockByNumber", params: ["latest", false] },
  ];
  const slots = AAVE_VAULTS.map((v) => {
    const start = calls.length;
    calls.push(balanceOf(v.address));
    if (v.kind === "umbrella") {
      calls.push(
        ethCall(
          v.address,
          encodeFunctionData({
            abi: STAKE_TOKEN_ABI,
            functionName: "getStakerCooldown",
            args: [owner],
          }),
        ),
        ethCall(
          UMBRELLA_REWARDS_CONTROLLER,
          encodeFunctionData({
            abi: REWARDS_CONTROLLER_ABI,
            functionName: "calculateCurrentUserRewards",
            args: [v.address as `0x${string}`, owner],
          }),
        ),
      );
    }
    return { vault: v, start };
  });
  const out = await rpcBatch(calls);

  const usdcBalanceAtomic = (decode(erc20Abi, "balanceOf", out[0]) as bigint).toString();
  const usdtBalanceAtomic = (decode(erc20Abi, "balanceOf", out[1]) as bigint).toString();
  const aUsdcBalanceAtomic = (decode(erc20Abi, "balanceOf", out[2]) as bigint).toString();
  const aUsdtBalanceAtomic = (decode(erc20Abi, "balanceOf", out[3]) as bigint).toString();
  const ethBalanceAtomic = BigInt(out[4]).toString();
  const gasPriceWei = BigInt(out[5]).toString();
  const blockTimestamp = Number(
    BigInt((out[6] as unknown as { timestamp: string }).timestamp),
  );

  interface Slot {
    vault: AaveVault;
    shares: bigint;
    cooldown: AavePosition["cooldown"];
    rewardTokens: string[];
    rewardAmounts: bigint[];
  }
  const read: Slot[] = slots.map(({ vault, start }) => {
    const shares = decode(ERC4626_ABI, "balanceOf", out[start]) as bigint;
    if (vault.kind !== "umbrella") {
      return { vault, shares, cooldown: null, rewardTokens: [], rewardAmounts: [] };
    }
    const snapshot = decode(STAKE_TOKEN_ABI, "getStakerCooldown", out[start + 1]) as {
      amount: bigint;
      endOfCooldown: number;
      withdrawalWindow: number;
    };
    const [rewardTokens, rewardAmounts] = decode(
      REWARDS_CONTROLLER_ABI,
      "calculateCurrentUserRewards",
      out[start + 2],
    ) as [string[], bigint[]];
    return {
      vault,
      shares,
      cooldown: {
        amount: snapshot.amount.toString(),
        endOfCooldown: Number(snapshot.endOfCooldown),
        withdrawalWindow: Number(snapshot.withdrawalWindow),
      },
      rewardTokens: [...rewardTokens],
      rewardAmounts: [...rewardAmounts],
    };
  });

  // ── round trip 2: shares -> assets (stake shares -> stata shares for
  // umbrella), instant-withdraw ceiling for supply, reward decimals ────────
  const calls2: { method: string; params: unknown[] }[] = [];
  const idx2 = read.map((s) => {
    const start = calls2.length;
    if (s.shares > 0n) {
      calls2.push(
        ethCall(
          s.vault.address,
          encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: "convertToAssets",
            args: [s.shares],
          }),
        ),
      );
      if (s.vault.kind === "supply") {
        calls2.push(
          ethCall(
            s.vault.address,
            encodeFunctionData({ abi: ERC4626_ABI, functionName: "maxWithdraw", args: [owner] }),
          ),
        );
      }
    }
    const rewardStart = calls2.length;
    for (const t of s.rewardTokens) {
      calls2.push(ethCall(t, encodeFunctionData({ abi: ERC20_META_ABI, functionName: "decimals" })));
    }
    return { start, rewardStart };
  });
  const out2 = calls2.length > 0 ? await rpcBatchSettled(calls2) : [];

  // ── round trip 3: umbrella stata shares -> underlying ──────────────────
  const calls3: { method: string; params: unknown[] }[] = [];
  const idx3 = read.map((s, i) => {
    if (s.vault.kind !== "umbrella" || s.shares <= 0n) return -1;
    const hex = out2[idx2[i].start];
    const stataShares = hex ? (decode(ERC4626_ABI, "convertToAssets", hex) as bigint) : 0n;
    const at = calls3.length;
    calls3.push(
      ethCall(
        s.vault.stataToken,
        encodeFunctionData({
          abi: ERC4626_ABI,
          functionName: "convertToAssets",
          args: [stataShares],
        }),
      ),
    );
    return at;
  });
  const out3 = calls3.length > 0 ? await rpcBatchSettled(calls3) : [];

  const positions: AavePosition[] = read.map((s, i) => {
    let assets = 0n;
    let withdrawable = 0n;
    if (s.shares > 0n) {
      if (s.vault.kind === "supply") {
        const assetsHex = out2[idx2[i].start];
        const maxHex = out2[idx2[i].start + 1];
        assets = assetsHex ? (decode(ERC4626_ABI, "convertToAssets", assetsHex) as bigint) : 0n;
        withdrawable = maxHex ? (decode(ERC4626_ABI, "maxWithdraw", maxHex) as bigint) : 0n;
      } else {
        const hex = idx3[i] >= 0 ? out3[idx3[i]] : null;
        assets = hex ? (decode(ERC4626_ABI, "convertToAssets", hex) as bigint) : 0n;
      }
    }
    const rewards: AavePendingReward[] = s.rewardTokens.map((token, j) => {
      const decHex = out2[idx2[i].rewardStart + j];
      return {
        token,
        decimals: decHex ? Number(decode(ERC20_META_ABI, "decimals", decHex)) : 18,
        amountAtomic: (s.rewardAmounts[j] ?? 0n).toString(),
      };
    });
    return {
      address: s.vault.address,
      sharesAtomic: s.shares.toString(),
      assetsAtomic: assets.toString(),
      withdrawableAtomic: withdrawable.toString(),
      cooldown: s.cooldown,
      rewards,
    };
  });

  return {
    positions,
    usdcBalanceAtomic,
    usdtBalanceAtomic,
    aUsdcBalanceAtomic,
    aUsdtBalanceAtomic,
    ethBalanceAtomic,
    gasPriceWei,
    blockTimestamp,
  };
}
