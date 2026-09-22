// Live check for the Aave V4 Gold spoke: borrow USDC against XAUt on Ethereum.
// Hits the real endpoints, so no app server is needed.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/aave-gold-check.mts [evmAddress]
//
// Pass an EVM address to also price that wallet's position and compare it with
// Aave's indexer.
//
// What it proves, in order of how badly each would hurt if wrong:
//
//   1. The proxies in lib/aave/gold-market.ts still point at the implementations
//      pinned there, at the same revision. The Spoke is upgradeable by
//      governance, unlike a Morpho market, so an upgrade is the first thing to
//      notice rather than the last.
//   2. Reserve 0 is XAUt at 6 decimals on the Core hub with the pinned asset
//      id, and reserve 1 is USDC. Reserve ids are spoke-local integers, so a
//      wrong one addresses the wrong asset rather than failing.
//   3. The oracle is the spoke's own, prices in 8 decimals, and prices XAUt from
//      Chainlink XAU/USD. Liquidations use the oracle, not the market.
//   4. The Value scale (1e26 per USD) reproduces the contract's own account
//      data for a live position, and the port's health matches the contract's.
//   5. The caps and flags read as expected, and the signature gateway (the
//      phase-2 gasless route) is still an active position manager.
//   6. Trustware still routes the funding legs and the way home.

import { decodeFunctionResult, encodeFunctionData, formatUnits, type Hex } from "viem";

import { AAVE_HUB_ABI, AAVE_ORACLE_ABI, AAVE_SPOKE_ABI } from "../lib/aave/gold-abi";
import {
  AAVE_CORE_HUB_IMPL,
  AAVE_GOLD_MARKETS,
  AAVE_GOLD_ORACLE,
  AAVE_GOLD_SPOKE_IMPL,
  AAVE_GOLD_SPOKE_REVISION,
  AAVE_SIGNATURE_GATEWAY,
  AAVE_V4_GRAPHQL,
  CHAINLINK_XAU_USD,
  ETHEREUM_NATIVE_TOKEN,
  ETHEREUM_RPC_URL,
  ORACLE_DECIMALS,
  USDC,
  WAD,
  XAUT,
} from "../lib/aave/gold-market";
import {
  borrowAprFromDrawnRate,
  borrowApyFromDrawnRate,
  liquidationBonusRange,
  oraclePriceToUsd,
  priceAaveGoldPosition,
  toValue,
} from "../lib/aave/gold-math";
import { GOLD_COLLATERAL_SOURCES } from "../lib/morpho/gold-sources";

const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_PROBE = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_PROBE = "0x2E1b1C1e6D9F0d0E9d3f7b0c0a0f1e2d3c4b5a69";
const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const UINT256_MAX = 2n ** 256n - 1n;

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(ETHEREUM_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

const ethCall = (to: string, data: Hex) =>
  rpc("eth_call", [{ to, data }, "latest"]) as Promise<Hex>;

type Abi = typeof AAVE_SPOKE_ABI | typeof AAVE_HUB_ABI | typeof AAVE_ORACLE_ABI;
async function read<TAbi extends Abi, TName extends TAbi[number]["name"]>(
  abi: TAbi,
  to: string,
  functionName: TName,
  args: readonly unknown[] = [],
) {
  const data = encodeFunctionData({
    abi,
    functionName,
    args,
  } as Parameters<typeof encodeFunctionData>[0]);
  const hex = await ethCall(to, data);
  return decodeFunctionResult({
    abi,
    functionName,
    data: hex,
  } as Parameters<typeof decodeFunctionResult>[0]);
}

interface QuoteEstimate {
  toAmount?: string;
  toAmountMin?: string;
  toAmountUsd?: number | string;
  fromAmountUsd?: number | string;
}

type QuoteResult =
  | { ok: true; status: number; estimate: QuoteEstimate }
  | { ok: false; status: number; estimate: null };

async function trustwareQuote(body: Record<string, unknown>): Promise<QuoteResult> {
  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) throw new Error("TRUSTWARE_API_KEY is not set");
  for (let i = 0; i < 3; i++) {
    const res = await fetch("https://api.trustware.io/api/v1/routes/quote", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ slippage: 1, ...body }),
    });
    const text = await res.text();
    try {
      const json = JSON.parse(text) as {
        data?: { estimate?: QuoteEstimate };
        estimate?: QuoteEstimate;
      };
      const estimate = json.data?.estimate ?? json.estimate;
      return estimate?.toAmount
        ? { ok: true, status: res.status, estimate }
        : { ok: false, status: res.status, estimate: null };
    } catch {
      await new Promise((r) => setTimeout(r, 1_200));
    }
  }
  return { ok: false, status: 502, estimate: null };
}

async function indexerPosition(spoke: string, user: string) {
  const spokeId = Buffer.from(`1::${spoke}`).toString("base64");
  const res = await fetch(AAVE_V4_GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query:
        "query($req: UserPositionRequest!) { userPosition(request: $req) { healthFactor { current } totalCollateral { current { value } } totalDebt { current { value } } liquidationPrice { value } remainingBorrowingPower { value } } }",
      variables: { req: { userSpoke: { spoke: spokeId, user } } },
    }),
  });
  const json = (await res.json()) as {
    data?: {
      userPosition: {
        healthFactor: { current: string };
        totalCollateral: { current: { value: string } };
        totalDebt: { current: { value: string } };
        liquidationPrice: { value: string } | null;
        remainingBorrowingPower: { value: string };
      } | null;
    };
  };
  return json.data?.userPosition ?? null;
}

async function main() {
  const wallet = process.argv[2];

  for (const market of AAVE_GOLD_MARKETS) {
    console.log(`\n=== ${market.name} (Aave V4 Gold spoke, Ethereum) ===`);

    // ── 1. the proxies and their implementations ───────────────────────────
    const spokeImpl = (await rpc("eth_getStorageAt", [market.spoke, EIP1967_IMPL_SLOT, "latest"])) as string;
    const hubImpl = (await rpc("eth_getStorageAt", [market.hub, EIP1967_IMPL_SLOT, "latest"])) as string;
    const implOf = (slot: string) => `0x${slot.slice(-40)}`.toLowerCase();
    check(implOf(spokeImpl) === AAVE_GOLD_SPOKE_IMPL.toLowerCase(), "spoke implementation is the pinned one", implOf(spokeImpl));
    check(implOf(hubImpl) === AAVE_CORE_HUB_IMPL.toLowerCase(), "hub implementation is the pinned one", implOf(hubImpl));
    const revision = (await read(AAVE_SPOKE_ABI, market.spoke, "SPOKE_REVISION")) as bigint;
    check(revision === AAVE_GOLD_SPOKE_REVISION, "spoke revision", String(revision));

    // ── 2. the reserves ────────────────────────────────────────────────────
    const coll = (await read(AAVE_SPOKE_ABI, market.spoke, "getReserve", [market.collateral.reserveId])) as {
      underlying: string; hub: string; assetId: number; decimals: number; dynamicConfigKey: number;
    };
    const debt = (await read(AAVE_SPOKE_ABI, market.spoke, "getReserve", [market.debt.reserveId])) as typeof coll;
    check(coll.underlying.toLowerCase() === XAUT.address.toLowerCase(), "reserve 0 underlying is XAUt", coll.underlying);
    check(coll.decimals === XAUT.decimals, "XAUt is 6 decimals on the spoke", String(coll.decimals));
    check(coll.hub.toLowerCase() === market.hub.toLowerCase(), "XAUt reserve draws on the Core hub", coll.hub);
    check(BigInt(coll.assetId) === market.collateral.assetId, "XAUt hub asset id", String(coll.assetId));
    check(debt.underlying.toLowerCase() === USDC.address.toLowerCase(), "reserve 1 underlying is USDC", debt.underlying);
    check(debt.decimals === USDC.decimals, "USDC is 6 decimals on the spoke", String(debt.decimals));
    check(BigInt(debt.assetId) === market.debt.assetId, "USDC hub asset id", String(debt.assetId));

    const [hubUnderlying, hubDecimals] = (await read(AAVE_HUB_ABI, market.hub, "getAssetUnderlyingAndDecimals", [market.debt.assetId])) as [string, number];
    check(hubUnderlying.toLowerCase() === USDC.address.toLowerCase() && hubDecimals === 6, "hub agrees on USDC asset id", hubUnderlying);

    const collCfg = (await read(AAVE_SPOKE_ABI, market.spoke, "getReserveConfig", [market.collateral.reserveId])) as { paused: boolean; frozen: boolean; borrowable: boolean; collateralRisk: number };
    const debtCfg = (await read(AAVE_SPOKE_ABI, market.spoke, "getReserveConfig", [market.debt.reserveId])) as typeof collCfg;
    check(!collCfg.paused && !collCfg.frozen, "XAUt reserve open for supply", `paused=${collCfg.paused} frozen=${collCfg.frozen}`);
    check(!collCfg.borrowable, "XAUt is not borrowable (supplied gold earns nothing)", String(collCfg.borrowable));
    check(debtCfg.borrowable && !debtCfg.paused && !debtCfg.frozen, "USDC reserve open for borrowing");
    console.log(`  XAUt collateral risk: ${collCfg.collateralRisk} bps (risk premium on top of the rate)`);

    const dyn = (await read(AAVE_SPOKE_ABI, market.spoke, "getDynamicReserveConfig", [market.collateral.reserveId, coll.dynamicConfigKey])) as { collateralFactor: number; maxLiquidationBonus: number; liquidationFee: number };
    const liq = (await read(AAVE_SPOKE_ABI, market.spoke, "getLiquidationConfig")) as { targetHealthFactor: bigint; healthFactorForMaxBonus: bigint; liquidationBonusFactor: number };
    const band = liquidationBonusRange({ maxLiquidationBonusBps: BigInt(dyn.maxLiquidationBonus), liquidationBonusFactorBps: BigInt(liq.liquidationBonusFactor) });
    console.log(`  collateral factor ${dyn.collateralFactor / 100}% (config key ${coll.dynamicConfigKey}), liquidation bonus ${band.minBps / 100}% to ${band.maxBps / 100}%, fee ${dyn.liquidationFee / 100}% of bonus, target health ${Number(liq.targetHealthFactor) / Number(WAD)}`);
    check(dyn.collateralFactor > 0 && dyn.collateralFactor < 10_000, "collateral factor is a sane fraction");

    // ── 3. the oracle ──────────────────────────────────────────────────────
    const oracle = (await read(AAVE_SPOKE_ABI, market.spoke, "ORACLE")) as string;
    check(oracle.toLowerCase() === AAVE_GOLD_ORACLE.toLowerCase(), "spoke oracle is the pinned one", oracle);
    const decimals = (await read(AAVE_ORACLE_ABI, oracle, "decimals")) as number;
    check(decimals === ORACLE_DECIMALS, "oracle decimals", String(decimals));
    const source = (await read(AAVE_ORACLE_ABI, oracle, "getReserveSource", [market.collateral.reserveId])) as string;
    check(source.toLowerCase() === CHAINLINK_XAU_USD.toLowerCase(), "XAUt priced by Chainlink XAU/USD", source);
    const xautPrice = (await read(AAVE_ORACLE_ABI, oracle, "getReservePrice", [market.collateral.reserveId])) as bigint;
    const usdcPrice = (await read(AAVE_ORACLE_ABI, oracle, "getReservePrice", [market.debt.reserveId])) as bigint;
    const unitPrice = oraclePriceToUsd(xautPrice);
    console.log(`  oracle: 1 XAUt = $${unitPrice.toFixed(2)}, 1 USDC = $${oraclePriceToUsd(usdcPrice).toFixed(5)}`);
    check(unitPrice > 1_000 && unitPrice < 20_000, "gold price is in a plausible range");

    // A live market quote for the same unit, so a stale or broken feed shows
    // up as a gap.
    const spot = await trustwareQuote({
      fromChain: "1", fromToken: XAUT.address, toChain: "1", toToken: USDC.address,
      fromAmount: (10n ** BigInt(XAUT.decimals)).toString(), fromAddress: EVM_PROBE, toAddress: EVM_PROBE,
    });
    if (spot.ok) {
      const quoted = Number(spot.estimate.toAmount) / 10 ** USDC.decimals;
      const drift = Math.abs(quoted - unitPrice) / unitPrice;
      console.log(`  market quote: 1 XAUt = ${quoted.toFixed(2)} USDC  (oracle drift ${(drift * 100).toFixed(2)}%)`);
      check(drift < 0.05, "oracle within 5% of market", `${(drift * 100).toFixed(2)}%`);
    } else {
      console.log(`  market quote: unavailable (HTTP ${spot.status}) — gold as a route SOURCE is the known upstream failure`);
    }

    // ── 4. rate, caps and headroom ─────────────────────────────────────────
    const rate = (await read(AAVE_HUB_ABI, market.hub, "getAssetDrawnRate", [market.debt.assetId])) as bigint;
    const hubLiquidity = (await read(AAVE_HUB_ABI, market.hub, "getAssetLiquidity", [market.debt.assetId])) as bigint;
    const debtSpoke = (await read(AAVE_HUB_ABI, market.hub, "getSpokeConfig", [market.debt.assetId, market.spoke])) as { drawCap: bigint; addCap: bigint; active: boolean; halted: boolean };
    const debtOwed = (await read(AAVE_HUB_ABI, market.hub, "getSpokeTotalOwed", [market.debt.assetId, market.spoke])) as bigint;
    const collSpoke = (await read(AAVE_HUB_ABI, market.hub, "getSpokeConfig", [market.collateral.assetId, market.spoke])) as typeof debtSpoke;
    const collAdded = (await read(AAVE_HUB_ABI, market.hub, "getSpokeAddedAssets", [market.collateral.assetId, market.spoke])) as bigint;
    const drawCap = BigInt(debtSpoke.drawCap) * 10n ** BigInt(USDC.decimals);
    const headroom = drawCap > debtOwed ? drawCap - debtOwed : 0n;
    const addCap = BigInt(collSpoke.addCap) * 10n ** BigInt(XAUT.decimals);
    console.log(`  USDC rate: ${(borrowAprFromDrawnRate(rate) * 100).toFixed(2)}% simple, ${(borrowApyFromDrawnRate(rate) * 100).toFixed(2)}% compounded`);
    console.log(`  USDC borrowable: min(hub liquidity ${formatUnits(hubLiquidity, 6)}, spoke headroom ${formatUnits(headroom, 6)} of cap ${formatUnits(drawCap, 6)})`);
    console.log(`  XAUt supply: ${formatUnits(collAdded, 6)} of cap ${formatUnits(addCap, 6)} (${formatUnits(addCap > collAdded ? addCap - collAdded : 0n, 6)} free)`);
    check(debtSpoke.active && !debtSpoke.halted, "spoke active on the hub for USDC");
    check(collSpoke.active && !collSpoke.halted, "spoke active on the hub for XAUt");
    check(hubLiquidity > 0n && headroom > 0n, "USDC can be drawn right now");

    const gatewayActive = (await read(AAVE_SPOKE_ABI, market.spoke, "isPositionManagerActive", [AAVE_SIGNATURE_GATEWAY])) as boolean;
    check(gatewayActive, "signature gateway active (phase-2 gasless route)");

    // ── 5. the Value scale, against the contract ───────────────────────────
    //
    // Any address with a position will do; the dead address proves the empty
    // shape and a real one proves the scale. The value unit is the whole risk.
    const probe = wallet ?? "0x000000000000000000000000000000000000dEaD";
    const acct = (await read(AAVE_SPOKE_ABI, market.spoke, "getUserAccountData", [probe])) as {
      healthFactor: bigint; totalCollateralValue: bigint; totalDebtValueRay: bigint; riskPremium: bigint;
    };
    const supplied = (await read(AAVE_SPOKE_ABI, market.spoke, "getUserSuppliedAssets", [market.collateral.reserveId, probe])) as bigint;
    const [usingAsCollateral] = (await read(AAVE_SPOKE_ABI, market.spoke, "getUserReserveStatus", [market.collateral.reserveId, probe])) as [boolean, boolean];
    const usdcDebt = (await read(AAVE_SPOKE_ABI, market.spoke, "getUserTotalDebt", [market.debt.reserveId, probe])) as bigint;
    if (supplied > 0n && usingAsCollateral) {
      const ours = toValue(supplied, XAUT.decimals, xautPrice);
      const gap = ours > acct.totalCollateralValue ? ours - acct.totalCollateralValue : acct.totalCollateralValue - ours;
      // Prices can tick between the two calls; agreement within 0.1% proves
      // the scale, and an exponent error would be off by a factor of a billion.
      check(gap * 1000n < acct.totalCollateralValue, "Value scale reproduces totalCollateralValue", `ours ${ours} chain ${acct.totalCollateralValue}`);
    } else {
      check(acct.totalCollateralValue === 0n && acct.healthFactor === UINT256_MAX, "empty position reads as zero collateral and max health");
    }

    if (wallet) {
      console.log(`\n  --- position for ${wallet} ---`);
      const debts = usdcDebt > 0n ? [{ atomic: usdcDebt, decimals: USDC.decimals, price: usdcPrice }] : [];
      const math = priceAaveGoldPosition({
        collateral: { atomic: supplied, decimals: XAUT.decimals, price: xautPrice, collateralFactorBps: BigInt(dyn.collateralFactor), usingAsCollateral },
        debts,
        marketDebt: debts[0],
        debtDecimals: USDC.decimals,
        debtPrice: usdcPrice,
      });
      const chainHealth = acct.healthFactor === UINT256_MAX ? null : Number(acct.healthFactor) / Number(WAD);
      console.log(`  collateral ${formatUnits(supplied, 6)} XAUt (enabled: ${usingAsCollateral}), USDC debt ${formatUnits(usdcDebt, 6)}`);
      console.log(`  health: chain ${chainHealth ?? "no debt"}, port ${math.healthFactor ?? "no debt"}`);
      console.log(`  available to borrow ${formatUnits(math.availableToBorrowAtomic, 6)} USDC, withdrawable ${formatUnits(math.withdrawableCollateralAtomic, 6)} XAUt, liquidation at ${math.liquidationPrice == null ? "n/a" : `$${math.liquidationPrice.toFixed(2)}`}`);
      if (chainHealth != null && math.healthFactor != null) {
        // The USDC-only port cannot see debt on other reserves; a gap here
        // with debts elsewhere is expected and the route handles it.
        check(Math.abs(chainHealth - math.healthFactor) < 1e-6 || acct.totalDebtValueRay > toValue(usdcDebt * 10n ** 27n, 6, usdcPrice), "port health matches the contract (or other reserves carry debt)", `${chainHealth} vs ${math.healthFactor}`);
      }
      try {
        const idx = await indexerPosition(market.spoke, wallet);
        if (idx) {
          console.log(`  indexer: health ${idx.healthFactor.current}, collateral $${idx.totalCollateral.current.value}, debt $${idx.totalDebt.current.value}, liquidation ${idx.liquidationPrice?.value ?? "n/a"}, remaining $${idx.remainingBorrowingPower.value}`);
          if (chainHealth != null) check(Math.abs(Number(idx.healthFactor.current) - chainHealth) < 1e-3, "indexer agrees with the chain on health");
        } else {
          console.log("  indexer: no position");
        }
      } catch (err) {
        console.log(`  indexer: unavailable (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

  // ── 6. Trustware: funding legs and the way home ───────────────────────────
  console.log("\n=== Trustware routes ===");
  const market = AAVE_GOLD_MARKETS[0];

  const buy = await trustwareQuote({
    fromChain: "solana-mainnet-beta", fromToken: USDC_SOL,
    toChain: "1", toToken: XAUT.address,
    fromAmount: "500000000", fromAddress: SOLANA_PROBE, toAddress: EVM_PROBE,
    fromAmountUSD: "500",
  });
  check(buy.ok, "Solana USDC -> XAUt on Ethereum (the buy, and the second hop)",
    buy.ok ? `500 USDC -> ${formatUnits(BigInt(buy.estimate.toAmount!), 6)} XAUt` : `HTTP ${buy.status}`);

  const gas = await trustwareQuote({
    fromChain: "solana-mainnet-beta", fromToken: USDC_SOL,
    toChain: "1", toToken: ETHEREUM_NATIVE_TOKEN,
    fromAmount: "20000000", fromAddress: SOLANA_PROBE, toAddress: EVM_PROBE,
    fromAmountUSD: "20",
  });
  check(gas.ok, "Solana USDC -> native ETH (gas top-up, 0xEeee sentinel)",
    gas.ok ? `20 USDC -> ${formatUnits(BigInt(gas.estimate.toAmount!), 18)} ETH` : `HTTP ${gas.status}`);

  const home = await trustwareQuote({
    fromChain: "1", fromToken: market.debtToken.address,
    toChain: "solana-mainnet-beta", toToken: USDC_SOL,
    fromAmount: "1000000000", fromAddress: EVM_PROBE, toAddress: SOLANA_PROBE,
  });
  check(home.ok, "Ethereum USDC -> Solana USDC (the borrowed loan comes home)",
    home.ok ? `1000 USDC -> ${formatUnits(BigInt(home.estimate.toAmount!), 6)} USDC` : `HTTP ${home.status}`);

  console.log("\n  per-source: [direct] source -> XAUt(eth)   [hop 1] source -> USDC(sol)");
  for (const source of GOLD_COLLATERAL_SOURCES) {
    const amount = (10n ** BigInt(source.decimals)).toString();
    const common = {
      fromChain: source.chain, fromToken: source.token, fromAmount: amount,
      fromAddress: source.kind === "solana" ? SOLANA_PROBE : EVM_PROBE,
      fromAmountUSD: String(source.approxUnitUsd),
    };
    const direct = await trustwareQuote({ ...common, toChain: "1", toToken: XAUT.address, toAddress: EVM_PROBE });
    const hop1 = await trustwareQuote({ ...common, toChain: "solana-mainnet-beta", toToken: USDC_SOL, toAddress: SOLANA_PROBE });
    const directTxt = direct.ok ? `${formatUnits(BigInt(direct.estimate.toAmount!), 6)} XAUt` : `HTTP ${direct.status}`;
    const hopTxt = hop1.ok ? `$${Number(hop1.estimate.toAmountUsd ?? 0).toFixed(2)}` : `HTTP ${hop1.status}`;
    console.log(`    ${source.symbol.padEnd(7)} ${source.chainLabel.padEnd(9)} direct=${directTxt.padEnd(14)} hop1=${hopTxt}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
