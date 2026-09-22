import { describe, expect, it } from "vitest";

import { BPS, VALUE_PER_USD, WAD } from "./gold-market";
import {
  borrowAprFromDrawnRate,
  borrowApyFromDrawnRate,
  liquidationBonusRange,
  oraclePriceToUsd,
  priceAaveGoldPosition,
  suggestedAaveBorrowAtomic,
  toValue,
} from "./gold-math";

// These tests pin the port to the chain. Every fixture below was read from the
// Gold spoke on Ethereum at block 25938062 (2026-09-09) with
// `getUserAccountData`, `getUserSuppliedAssets`, `getUserTotalDebt` and the
// oracle, and the expected figures are what the spoke itself returned and what
// Aave's indexer showed for the same two addresses in the same minute. The
// scale of Value (1e26 per USD) is the whole risk: a wrong exponent misreads a
// $55k position by twenty-six orders of magnitude and every other number
// follows it.

// Oracle prices, 8 decimals, same block.
const XAUT_PRICE = 439_851_000_000n; // $4,398.51
const USDC_PRICE = 99_993_000n; // $0.99993
const FRXUSD_PRICE = 99_974_888n; // $0.99974888

const CF = 7_500n;

// ── fixture A: 0xbE0ca442D6B7D81E0FAa7dbFd09331019F893f89 ──────────────────
//
// 12.697666 XAUt, one debt of 15,038.698273909715399956 frxUSD (18 decimals).
// Chain: healthFactor 2786054269051040778, totalCollateralValue
// 5585081087766000000000000000000 (Value), indexer: $55,850.8109 collateral,
// $15,034.9218 debt, liquidation price $1,578.7596, max borrowing power
// $41,888.1082.
const A = {
  collateral: 12_697_666n,
  frxusdDebt: 15_038_698_273_909_715_399_956n,
  healthFactorWad: 2_786_054_269_051_040_778n,
  collateralValue: 5_585_081_087_766_000_000_000_000_000_000n,
};

// The account data and the per-reserve debt were separate calls a few seconds
// apart, and debt accrues every block: at 3% to 4% a year, one 12-second block
// moves these health factors by 3e-8 to 7e-8. Agreement inside one block of
// interest is agreement; the port and the contract compute the same thing.
const ONE_BLOCK_OF_INTEREST = 1e-7;

// ── fixture B: 0xF87ef7E740Aea6fA01971E62c7D5DC01504200a5 ──────────────────
//
// 0.414887 XAUt, two debts: 300.014412 USDC and 0.000259314109265156 frxUSD.
// Chain: healthFactor 4562307776553672859. Indexer: $1,824.8846 collateral,
// $299.9937 debt, liquidation price $964.0976, remaining borrowing power
// $1,068.6698.
const B = {
  collateral: 414_887n,
  usdcDebt: 300_014_412n,
  frxusdDebt: 259_314_109_265_156n,
  healthFactorWad: 4_562_307_776_553_672_859n,
};

const xaut = (atomic: bigint, usingAsCollateral = true) => ({
  atomic,
  decimals: 6,
  price: XAUT_PRICE,
  collateralFactorBps: CF,
  usingAsCollateral,
});

describe("toValue", () => {
  it("matches the spoke's totalCollateralValue for fixture A", () => {
    expect(toValue(A.collateral, 6, XAUT_PRICE)).toBe(A.collateralValue);
  });

  it("scales so that 1e26 is one dollar", () => {
    // One USDC at exactly $1.
    expect(toValue(1_000_000n, 6, 100_000_000n)).toBe(VALUE_PER_USD);
    // One 18-decimal token at exactly $1.
    expect(toValue(10n ** 18n, 18, 100_000_000n)).toBe(VALUE_PER_USD);
  });
});

describe("priceAaveGoldPosition", () => {
  it("reproduces the chain's health factor for fixture A", () => {
    const math = priceAaveGoldPosition({
      collateral: xaut(A.collateral),
      debts: [{ atomic: A.frxusdDebt, decimals: 18, price: FRXUSD_PRICE }],
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    const chain = Number(A.healthFactorWad) / Number(WAD);
    expect(math.healthFactor).not.toBeNull();
    expect(Math.abs(math.healthFactor! - chain)).toBeLessThan(ONE_BLOCK_OF_INTEREST);
  });

  it("matches the indexer's dollar figures and liquidation price for A", () => {
    const math = priceAaveGoldPosition({
      collateral: xaut(A.collateral),
      debts: [{ atomic: A.frxusdDebt, decimals: 18, price: FRXUSD_PRICE }],
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    expect(Number(math.collateralValueUsd) / 1e8).toBeCloseTo(55_850.8109, 3);
    expect(Number(math.totalDebtValueUsd) / 1e8).toBeCloseTo(15_034.9218, 3);
    expect(math.liquidationPrice).toBeCloseTo(1_578.7596, 3);
    // Max borrowing power is collateral × CF, in USDC at its own price.
    const maxUsd =
      (Number(math.maxBorrowAtomic) / 1e6) * (Number(USDC_PRICE) / 1e8);
    expect(maxUsd).toBeCloseTo(41_888.1082, 2);
  });

  it("reproduces the chain's health factor with two debts for fixture B", () => {
    const usdc = { atomic: B.usdcDebt, decimals: 6, price: USDC_PRICE };
    const math = priceAaveGoldPosition({
      collateral: xaut(B.collateral),
      debts: [usdc, { atomic: B.frxusdDebt, decimals: 18, price: FRXUSD_PRICE }],
      marketDebt: usdc,
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    const chain = Number(B.healthFactorWad) / Number(WAD);
    expect(Math.abs(math.healthFactor! - chain)).toBeLessThan(ONE_BLOCK_OF_INTEREST);
    expect(math.debtAtomic).toBe(B.usdcDebt);
    expect(math.liquidationPrice).toBeCloseTo(964.0976, 3);
    const remainingUsd =
      (Number(math.availableToBorrowAtomic) / 1e6) * (Number(USDC_PRICE) / 1e8);
    expect(remainingUsd).toBeCloseTo(1_068.6698, 2);
  });

  it("borrowing the full headroom lands exactly on health 1.0", () => {
    const math = priceAaveGoldPosition({
      collateral: xaut(B.collateral),
      debts: [],
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    expect(math.healthFactor).toBeNull();
    const after = priceAaveGoldPosition({
      collateral: xaut(B.collateral),
      debts: [{ atomic: math.maxBorrowAtomic, decimals: 6, price: USDC_PRICE }],
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    // Rounded down, so at or just above the threshold, never below it.
    expect(after.healthFactorWad!).toBeGreaterThanOrEqual(WAD);
    expect(after.healthFactor!).toBeLessThan(1.000001);
    // One more atomic unit of debt and the contract would revert.
    const over = priceAaveGoldPosition({
      collateral: xaut(B.collateral),
      debts: [{ atomic: math.maxBorrowAtomic + 1n, decimals: 6, price: USDC_PRICE }],
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    expect(over.healthFactorWad!).toBeLessThan(WAD);
    expect(after.availableToBorrowAtomic).toBe(0n);
  });

  it("withdrawable collateral leaves the debt exactly covered", () => {
    const usdc = { atomic: B.usdcDebt, decimals: 6, price: USDC_PRICE };
    const math = priceAaveGoldPosition({
      collateral: xaut(B.collateral),
      debts: [usdc],
      marketDebt: usdc,
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    const remaining = B.collateral - math.withdrawableCollateralAtomic;
    const after = priceAaveGoldPosition({
      collateral: xaut(remaining),
      debts: [usdc],
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    expect(after.healthFactorWad!).toBeGreaterThanOrEqual(WAD);
    // Removing one more unit crosses the line.
    const tooFar = priceAaveGoldPosition({
      collateral: xaut(remaining - 1n),
      debts: [usdc],
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    expect(tooFar.healthFactorWad!).toBeLessThan(WAD);
  });

  it("counts nothing for collateral that is not enabled", () => {
    const usdc = { atomic: B.usdcDebt, decimals: 6, price: USDC_PRICE };
    const math = priceAaveGoldPosition({
      collateral: xaut(B.collateral, false),
      debts: [usdc],
      marketDebt: usdc,
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    expect(math.collateralValueUsd).toBe(0n);
    expect(math.availableToBorrowAtomic).toBe(0n);
    expect(math.withdrawableCollateralAtomic).toBe(0n);
    expect(math.healthFactorWad).toBe(0n);
    expect(math.liquidationPrice).toBeNull();
  });

  it("frees all collateral when there is no debt", () => {
    const math = priceAaveGoldPosition({
      collateral: xaut(B.collateral),
      debts: [],
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    expect(math.withdrawableCollateralAtomic).toBe(B.collateral);
    expect(math.ltv).toBe(0);
    expect(math.liquidationPrice).toBeNull();
  });
});

describe("rates and bonuses", () => {
  it("reads the hub's USDC drawn rate as 3.83% simple, 3.90% compounded", () => {
    const rate = 38_271_054_824_919_520_238_135_562n; // read 2026-09-09
    expect(borrowAprFromDrawnRate(rate)).toBeCloseTo(0.038271, 6);
    expect(borrowApyFromDrawnRate(rate)).toBeCloseTo(0.039013, 5);
  });

  it("derives the 5.99% to 6.66% bonus band from the spoke's config", () => {
    const band = liquidationBonusRange({
      maxLiquidationBonusBps: 10_666n,
      liquidationBonusFactorBps: 9_000n,
    });
    expect(band.maxBps).toBe(666);
    expect(band.minBps).toBe(599);
  });

  it("converts an 8-decimal oracle price to dollars", () => {
    expect(oraclePriceToUsd(XAUT_PRICE)).toBeCloseTo(4_398.51, 6);
  });

  it("suggests a buffered borrow below the ceiling", () => {
    const math = priceAaveGoldPosition({
      collateral: xaut(B.collateral),
      debts: [],
      debtDecimals: 6,
      debtPrice: USDC_PRICE,
    });
    const suggested = suggestedAaveBorrowAtomic(math);
    expect(suggested).toBeLessThan(math.availableToBorrowAtomic);
    expect(suggested).toBe((math.availableToBorrowAtomic * 8_000n) / BPS);
  });
});
