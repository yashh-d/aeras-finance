// Server-only Ethereum reads for the Aave V4 Gold spoke.
//
// Same shape as lib/morpho/gold-server.ts and the same batched JSON-RPC
// transport, because both venues live on the same chain behind the same
// endpoint. What differs is what has to be read live. On Morpho the market
// parameters are immutable and only the totals move. Here the collateral
// factor, the bonus, the caps and the paused/frozen flags are all governance
// data on an upgradeable proxy, so every request reads them; the registry in
// ./gold-market.ts pins addresses and ids and nothing else.
//
// Two things this module is careful about:
//
//   1. **Caps are in whole tokens.** The hub's `addCap` and `drawCap` are
//      expressed without decimals (4500 means 4,500 XAUt), and a value of
//      MAX_ALLOWED_SPOKE_CAP means no cap. They are scaled to atomic units
//      here so nothing downstream has to remember.
//   2. **A user's collateral factor is the one they are bound to**, which is
//      read from the dynamic config at their own key, not the reserve's
//      latest. The two differ after a governance change until the user's next
//      borrow or withdraw rebinds them (docs/aave-gold.md, "Dynamic risk
//      configuration").

import "server-only";

import { decodeFunctionResult, encodeFunctionData, erc20Abi, type Hex } from "viem";

import { ethCall as call, rpcBatch } from "@/lib/ethereum/rpc";

import { AAVE_HUB_ABI, AAVE_ORACLE_ABI, AAVE_SPOKE_ABI } from "./gold-abi";
import { AAVE_GOLD_ORACLE, type AaveGoldMarket } from "./gold-market";

export { readGasPrice } from "@/lib/ethereum/rpc";

// IHub.MAX_ALLOWED_SPOKE_CAP: a cap set to the type's maximum means no cap.
const MAX_ALLOWED_SPOKE_CAP = 2n ** 40n - 1n;

const spokeCall = (
  market: AaveGoldMarket,
  functionName: Extract<(typeof AAVE_SPOKE_ABI)[number], { type: "function" }>["name"],
  // Loosely typed on purpose: the generated ABI's arg tuples are long unions
  // and this helper only forwards them to viem, which checks them at the call.
  args: readonly unknown[],
) =>
  call(
    market.spoke,
    encodeFunctionData({
      abi: AAVE_SPOKE_ABI,
      functionName,
      args,
    } as Parameters<typeof encodeFunctionData>[0]),
  );

const hubCall = (
  market: AaveGoldMarket,
  functionName: Extract<(typeof AAVE_HUB_ABI)[number], { type: "function" }>["name"],
  args: readonly unknown[],
) =>
  call(
    market.hub,
    encodeFunctionData({
      abi: AAVE_HUB_ABI,
      functionName,
      args,
    } as Parameters<typeof encodeFunctionData>[0]),
  );

const oracleCall = (
  functionName: Extract<(typeof AAVE_ORACLE_ABI)[number], { type: "function" }>["name"],
  args: readonly unknown[],
) =>
  call(
    AAVE_GOLD_ORACLE,
    encodeFunctionData({
      abi: AAVE_ORACLE_ABI,
      functionName,
      args,
    } as Parameters<typeof encodeFunctionData>[0]),
  );

function capToAtomic(cap: bigint, decimals: number): bigint | null {
  return cap >= MAX_ALLOWED_SPOKE_CAP ? null : cap * 10n ** BigInt(decimals);
}

export interface AaveReserveRead {
  paused: boolean;
  frozen: boolean;
  borrowable: boolean;
  // Bps.
  collateralRisk: bigint;
  // The reserve's latest dynamic config key and the config under it.
  dynamicConfigKey: number;
  collateralFactorBps: bigint;
  maxLiquidationBonusBps: bigint;
  liquidationFeeBps: bigint;
  // Oracle price, ORACLE_DECIMALS places.
  price: bigint;
}

export interface AaveGoldMarketRead {
  collateral: AaveReserveRead;
  debt: AaveReserveRead;
  // Spoke-wide liquidation settings, WAD and bps.
  targetHealthFactorWad: bigint;
  healthFactorForMaxBonusWad: bigint;
  liquidationBonusFactorBps: bigint;
  // Annual drawn rate for the debt asset, RAY.
  debtDrawnRateRay: bigint;
  // Free liquidity for the debt asset across the whole hub, atomic.
  hubLiquidityAtomic: bigint;
  // What this spoke may still draw of the debt asset: cap less drawn, atomic.
  // Null means uncapped.
  spokeDrawHeadroomAtomic: bigint | null;
  // What may still be supplied of the collateral asset: cap less added, atomic.
  // Null means uncapped.
  supplyHeadroomAtomic: bigint | null;
  supplyCapAtomic: bigint | null;
  // Collateral supplied to this spoke in total, atomic.
  totalSuppliedAtomic: bigint;
  oracleDecimals: number;
}

// Market-level state: config, rate, caps and prices. No address involved.
export async function readAaveGoldMarket(
  market: AaveGoldMarket,
): Promise<AaveGoldMarketRead> {
  const c = market.collateral;
  const d = market.debt;

  // Batch 1: everything that does not depend on a dynamic config key.
  const [
    collReserveHex,
    debtReserveHex,
    collCfgHex,
    debtCfgHex,
    liqHex,
    collPriceHex,
    debtPriceHex,
    decimalsHex,
    rateHex,
    liquidityHex,
    debtSpokeCfgHex,
    debtSpokeOwedHex,
    collSpokeCfgHex,
    collSpokeAddedHex,
    suppliedHex,
  ] = await rpcBatch([
    spokeCall(market, "getReserve", [c.reserveId]),
    spokeCall(market, "getReserve", [d.reserveId]),
    spokeCall(market, "getReserveConfig", [c.reserveId]),
    spokeCall(market, "getReserveConfig", [d.reserveId]),
    spokeCall(market, "getLiquidationConfig", []),
    oracleCall("getReservePrice", [c.reserveId]),
    oracleCall("getReservePrice", [d.reserveId]),
    oracleCall("decimals", []),
    hubCall(market, "getAssetDrawnRate", [d.assetId]),
    hubCall(market, "getAssetLiquidity", [d.assetId]),
    hubCall(market, "getSpokeConfig", [d.assetId, market.spoke]),
    hubCall(market, "getSpokeTotalOwed", [d.assetId, market.spoke]),
    hubCall(market, "getSpokeConfig", [c.assetId, market.spoke]),
    hubCall(market, "getSpokeAddedAssets", [c.assetId, market.spoke]),
    spokeCall(market, "getReserveSuppliedAssets", [c.reserveId]),
  ]);

  const collReserve = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getReserve", data: collReserveHex });
  const debtReserve = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getReserve", data: debtReserveHex });

  // Batch 2: the dynamic config at each reserve's latest key.
  const [collDynHex, debtDynHex] = await rpcBatch([
    spokeCall(market, "getDynamicReserveConfig", [
      c.reserveId,
      collReserve.dynamicConfigKey,
    ]),
    spokeCall(market, "getDynamicReserveConfig", [
      d.reserveId,
      debtReserve.dynamicConfigKey,
    ]),
  ]);

  const reserveRead = (
    reserve: typeof collReserve,
    cfgHex: Hex,
    dynHex: Hex,
    priceHex: Hex,
  ): AaveReserveRead => {
    const cfg = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getReserveConfig", data: cfgHex });
    const dyn = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getDynamicReserveConfig", data: dynHex });
    return {
      paused: cfg.paused,
      frozen: cfg.frozen,
      borrowable: cfg.borrowable,
      collateralRisk: BigInt(cfg.collateralRisk),
      dynamicConfigKey: reserve.dynamicConfigKey,
      collateralFactorBps: BigInt(dyn.collateralFactor),
      maxLiquidationBonusBps: BigInt(dyn.maxLiquidationBonus),
      liquidationFeeBps: BigInt(dyn.liquidationFee),
      price: decodeFunctionResult({ abi: AAVE_ORACLE_ABI, functionName: "getReservePrice", data: priceHex }),
    };
  };

  const liq = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getLiquidationConfig", data: liqHex });
  const debtSpokeCfg = decodeFunctionResult({ abi: AAVE_HUB_ABI, functionName: "getSpokeConfig", data: debtSpokeCfgHex });
  const collSpokeCfg = decodeFunctionResult({ abi: AAVE_HUB_ABI, functionName: "getSpokeConfig", data: collSpokeCfgHex });
  const debtDrawn = decodeFunctionResult({ abi: AAVE_HUB_ABI, functionName: "getSpokeTotalOwed", data: debtSpokeOwedHex });
  const collAdded = decodeFunctionResult({ abi: AAVE_HUB_ABI, functionName: "getSpokeAddedAssets", data: collSpokeAddedHex });

  const drawCap = capToAtomic(BigInt(debtSpokeCfg.drawCap), market.debtToken.decimals);
  const addCap = capToAtomic(
    BigInt(collSpokeCfg.addCap),
    market.collateralToken.decimals,
  );

  return {
    collateral: reserveRead(collReserve, collCfgHex, collDynHex, collPriceHex),
    debt: reserveRead(debtReserve, debtCfgHex, debtDynHex, debtPriceHex),
    targetHealthFactorWad: BigInt(liq.targetHealthFactor),
    healthFactorForMaxBonusWad: BigInt(liq.healthFactorForMaxBonus),
    liquidationBonusFactorBps: BigInt(liq.liquidationBonusFactor),
    debtDrawnRateRay: decodeFunctionResult({ abi: AAVE_HUB_ABI, functionName: "getAssetDrawnRate", data: rateHex }),
    hubLiquidityAtomic: decodeFunctionResult({ abi: AAVE_HUB_ABI, functionName: "getAssetLiquidity", data: liquidityHex }),
    spokeDrawHeadroomAtomic:
      drawCap === null ? null : drawCap > debtDrawn ? drawCap - debtDrawn : 0n,
    supplyHeadroomAtomic:
      addCap === null ? null : addCap > collAdded ? addCap - collAdded : 0n,
    supplyCapAtomic: addCap,
    totalSuppliedAtomic: decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getReserveSuppliedAssets", data: suppliedHex }),
    oracleDecimals: decodeFunctionResult({ abi: AAVE_ORACLE_ABI, functionName: "decimals", data: decimalsHex }),
  };
}

export interface AaveGoldWalletRead {
  // Straight from the contract, WAD. uint256 max with no debt.
  healthFactorWad: bigint;
  // Value units (1e26 per USD).
  totalCollateralValue: bigint;
  totalDebtValueRay: bigint;
  riskPremiumBps: bigint;
  // Collateral supplied to the market's collateral reserve, atomic.
  suppliedAtomic: bigint;
  usingAsCollateral: boolean;
  // The dynamic config key the user's position is bound to, and the collateral
  // factor under it. Equal to the reserve's until governance changes it.
  userDynamicConfigKey: number;
  userCollateralFactorBps: bigint;
  // Debt on the market's debt reserve, atomic, drawn plus premium.
  debtAtomic: bigint;
  // Debt on every other reserve of the spoke that the user owes on, with the
  // decimals and price needed to value it. Counts against health; not
  // repayable through this market's card.
  otherDebts: { reserveId: bigint; atomic: bigint; decimals: number; price: bigint }[];
  // Wallet balances on Ethereum, atomic.
  collateralBalanceAtomic: bigint;
  debtBalanceAtomic: bigint;
  // Native ETH, wei. Every action on this market spends it.
  ethBalanceAtomic: bigint;
}

// A borrower's position plus the wallet balances the forms need.
//
// `otherReserveIds` lists every borrowable reserve on the spoke other than the
// market's own, so a user who borrowed something else through Aave's UI still
// gets an honest health figure here. The route passes the count it read.
export async function readAaveGoldWallet(
  market: AaveGoldMarket,
  address: string,
  otherReserves: { reserveId: bigint; decimals: number }[],
): Promise<AaveGoldWalletRead> {
  const owner = address as `0x${string}`;
  const c = market.collateral;
  const d = market.debt;

  const balanceOf = (token: string) =>
    call(
      token,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
    );

  const fixed = [
    spokeCall(market, "getUserAccountData", [owner]),
    spokeCall(market, "getUserSuppliedAssets", [c.reserveId, owner]),
    spokeCall(market, "getUserReserveStatus", [c.reserveId, owner]),
    spokeCall(market, "getUserPosition", [c.reserveId, owner]),
    spokeCall(market, "getUserTotalDebt", [d.reserveId, owner]),
    balanceOf(market.collateralToken.address),
    balanceOf(market.debtToken.address),
    { method: "eth_getBalance", params: [owner, "latest"] },
  ];
  const others = otherReserves.flatMap((r) => [
    spokeCall(market, "getUserTotalDebt", [r.reserveId, owner]),
    oracleCall("getReservePrice", [r.reserveId]),
  ]);

  const results = await rpcBatch([...fixed, ...others]);
  const [
    acctHex,
    suppliedHex,
    statusHex,
    positionHex,
    debtHex,
    collBalHex,
    debtBalHex,
    ethHex,
  ] = results;

  const acct = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getUserAccountData", data: acctHex });
  const [usingAsCollateral] = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getUserReserveStatus", data: statusHex });
  const position = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getUserPosition", data: positionHex });

  // The user's own collateral factor, at their key.
  const [userDynHex] = await rpcBatch([
    spokeCall(market, "getDynamicReserveConfig", [
      c.reserveId,
      position.dynamicConfigKey,
    ]),
  ]);
  const userDyn = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getDynamicReserveConfig", data: userDynHex });

  const decodeBalance = (data: Hex) =>
    decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data });

  const otherDebts: AaveGoldWalletRead["otherDebts"] = [];
  otherReserves.forEach((r, i) => {
    const atomic = decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getUserTotalDebt", data: results[fixed.length + i * 2] });
    if (atomic > 0n) {
      otherDebts.push({
        reserveId: r.reserveId,
        atomic,
        decimals: r.decimals,
        price: decodeFunctionResult({ abi: AAVE_ORACLE_ABI, functionName: "getReservePrice", data: results[fixed.length + i * 2 + 1] }),
      });
    }
  });

  return {
    healthFactorWad: acct.healthFactor,
    totalCollateralValue: acct.totalCollateralValue,
    totalDebtValueRay: acct.totalDebtValueRay,
    riskPremiumBps: acct.riskPremium,
    suppliedAtomic: decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getUserSuppliedAssets", data: suppliedHex }),
    usingAsCollateral,
    userDynamicConfigKey: position.dynamicConfigKey,
    userCollateralFactorBps: BigInt(userDyn.collateralFactor),
    debtAtomic: decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getUserTotalDebt", data: debtHex }),
    otherDebts,
    collateralBalanceAtomic: decodeBalance(collBalHex),
    debtBalanceAtomic: decodeBalance(debtBalHex),
    ethBalanceAtomic: BigInt(ethHex),
  };
}

// Every reserve on the spoke other than the market's two, with decimals, so
// the wallet read can value debt the user holds elsewhere on the spoke. Read
// once per market request and cached with it; reserve listings change by
// governance, not by the block.
export async function readOtherReserves(
  market: AaveGoldMarket,
): Promise<{ reserveId: bigint; decimals: number }[]> {
  const [countHex] = await rpcBatch([spokeCall(market, "getReserveCount", [])]);
  const count = Number(decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getReserveCount", data: countHex }));
  const ids: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const id = BigInt(i);
    if (id === market.collateral.reserveId || id === market.debt.reserveId) continue;
    ids.push(id);
  }
  if (ids.length === 0) return [];
  const hexes = await rpcBatch(ids.map((id) => spokeCall(market, "getReserve", [id])));
  return ids.map((reserveId, i) => ({
    reserveId,
    decimals: decodeFunctionResult({ abi: AAVE_SPOKE_ABI, functionName: "getReserve", data: hexes[i] }).decimals,
  }));
}
