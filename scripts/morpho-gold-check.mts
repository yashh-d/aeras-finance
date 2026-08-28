// Live check for the Morpho Blue gold market: borrow USDT against XAUt on
// Ethereum. Hits the real endpoints, so no app server is needed.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/morpho-gold-check.mts [evmAddress]
//
// Pass an EVM address to also price that wallet's position.
//
// What it proves, in order of how badly each would hurt if wrong:
//
//   1. The market id in lib/morpho/gold-market.ts is the keccak of the five
//      params carried beside it, AND the singleton agrees. Morpho derives the
//      id by hashing the params, so a typo addresses a market that does not
//      exist and every call reverts. Loud, but only after the user signed.
//   2. XAUt really is 6 decimals on-chain. It is the exception in a codebase
//      where every other Ethereum ERC-20 is 18, and getting it wrong misprices
//      collateral by 10^12.
//   3. The market oracle and a live market quote agree on the gold price.
//      Liquidations use the oracle, not the market, so a wide gap is a real
//      risk signal rather than a bug in this file.
//   4. Trustware still routes the funding legs. The gold-source legs are known
//      broken upstream (see below) and are checked so the day they start
//      working is visible.

import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  keccak256,
  type Hex,
} from "viem";

import { MORPHO_BLUE_ABI, MORPHO_IRM_ABI, MORPHO_ORACLE_ABI } from "../lib/morpho/gold-abi";
import {
  ETHEREUM_NATIVE_TOKEN,
  ETHEREUM_RPC_URL,
  GOLD_MARKETS,
  MORPHO_BLUE,
  ORACLE_PRICE_SCALE,
  WAD,
  marketParamsTuple,
} from "../lib/morpho/gold-market";
import {
  accrueInterest,
  borrowApyFromRate,
  oraclePriceToUnitPrice,
  priceGoldPosition,
} from "../lib/morpho/gold-math";
import { GOLD_COLLATERAL_SOURCES } from "../lib/morpho/gold-sources";

const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_PROBE = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_PROBE = "0x2E1b1C1e6D9F0d0E9d3f7b0c0a0f1e2d3c4b5a69";

const DECIMALS_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

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

// The estimate fields this script reads. Trustware nests the estimate under
// `data` on some responses and at the top level on others, and reports USD
// figures sometimes as a number and sometimes as a string.
interface QuoteEstimate {
  toAmount?: string;
  toAmountMin?: string;
  toAmountUsd?: number | string;
  fromAmountUsd?: number | string;
}

type QuoteResult =
  | { ok: true; status: number; estimate: QuoteEstimate }
  | { ok: false; status: number; estimate: null };

async function trustwareQuote(
  body: Record<string, unknown>,
): Promise<QuoteResult> {
  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) throw new Error("TRUSTWARE_API_KEY is not set");
  // A failing route comes back as a Cloudflare 502 HTML page rather than JSON.
  // Retry so a genuinely transient blip is not filed as the known upstream
  // failure, and vice versa.
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

async function main() {
  const wallet = process.argv[2];

  for (const market of GOLD_MARKETS) {
    console.log(`\n=== ${market.name} (Ethereum) ===`);

    // ── 1. the id is the hash of the params ────────────────────────────────
    const params = marketParamsTuple(market);
    const derivedId = keccak256(
      encodeAbiParameters(
        [
          { type: "address" }, { type: "address" }, { type: "address" },
          { type: "address" }, { type: "uint256" },
        ],
        [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv],
      ),
    );
    check(
      derivedId.toLowerCase() === market.id.toLowerCase(),
      "market id is keccak(params)",
      derivedId.toLowerCase() === market.id.toLowerCase() ? "" : `derived ${derivedId}`,
    );

    // ── and the singleton agrees ───────────────────────────────────────────
    const paramsHex = await ethCall(
      MORPHO_BLUE,
      encodeFunctionData({ abi: MORPHO_BLUE_ABI, functionName: "idToMarketParams", args: [market.id as Hex] }),
    );
    const [loanToken, collateralToken, oracle, irm, lltv] = decodeFunctionResult({
      abi: MORPHO_BLUE_ABI, functionName: "idToMarketParams", data: paramsHex,
    });
    check(loanToken.toLowerCase() === params.loanToken.toLowerCase(), "loanToken matches chain", loanToken);
    check(collateralToken.toLowerCase() === params.collateralToken.toLowerCase(), "collateralToken matches chain", collateralToken);
    check(oracle.toLowerCase() === params.oracle.toLowerCase(), "oracle matches chain", oracle);
    check(irm.toLowerCase() === params.irm.toLowerCase(), "irm matches chain", irm);
    check(lltv === params.lltv, "lltv matches chain", `${(Number(lltv) / Number(WAD) * 100).toFixed(0)}%`);

    // ── 2. token decimals ──────────────────────────────────────────────────
    for (const token of [market.collateralToken, market.loanToken]) {
      const hex = await ethCall(token.address, encodeFunctionData({ abi: DECIMALS_ABI, functionName: "decimals" }));
      const onChain = decodeFunctionResult({ abi: DECIMALS_ABI, functionName: "decimals", data: hex });
      check(Number(onChain) === token.decimals, `${token.symbol} decimals`, `chain=${onChain} registry=${token.decimals}`);
    }

    // ── market state, accrued the way the contract accrues ─────────────────
    const marketHex = await ethCall(
      MORPHO_BLUE,
      encodeFunctionData({ abi: MORPHO_BLUE_ABI, functionName: "market", args: [market.id as Hex] }),
    );
    const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] =
      decodeFunctionResult({ abi: MORPHO_BLUE_ABI, functionName: "market", data: marketHex });
    const rawState = { totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee };

    const rateHex = await ethCall(
      irm,
      encodeFunctionData({ abi: MORPHO_IRM_ABI, functionName: "borrowRateView", args: [params, rawState] }),
    );
    const borrowRate = decodeFunctionResult({ abi: MORPHO_IRM_ABI, functionName: "borrowRateView", data: rateHex });

    const block = (await rpc("eth_getBlockByNumber", ["latest", false])) as { timestamp: string };
    const now = BigInt(block.timestamp);
    const state = accrueInterest(rawState, borrowRate, now);

    const oracleHex = await ethCall(oracle, encodeFunctionData({ abi: MORPHO_ORACLE_ABI, functionName: "price" }));
    const oraclePrice = decodeFunctionResult({ abi: MORPHO_ORACLE_ABI, functionName: "price", data: oracleHex });
    const unitPrice = oraclePriceToUnitPrice(oraclePrice, market.collateralToken.decimals, market.loanToken.decimals);

    const liquidity = state.totalSupplyAssets - state.totalBorrowAssets;
    const utilization = Number(state.totalBorrowAssets) / Number(state.totalSupplyAssets);
    console.log(
      `\n  supply ${formatUnits(state.totalSupplyAssets, 6)} USDT` +
      `  borrow ${formatUnits(state.totalBorrowAssets, 6)} USDT` +
      `  util ${(utilization * 100).toFixed(2)}%`,
    );
    console.log(
      `  borrowable now ${formatUnits(liquidity > 0n ? liquidity : 0n, 6)} USDT` +
      `  borrowAPY ${(borrowApyFromRate(borrowRate) * 100).toFixed(2)}%` +
      `  stale by ${now - rawState.lastUpdate}s`,
    );
    console.log(`  oracle: 1 ${market.collateralToken.symbol} = ${unitPrice.toFixed(2)} ${market.loanToken.symbol}`);
    check(liquidity > 0n, "market has borrowable liquidity");
    check(oraclePrice > 0n, "oracle returns a price");

    // ── 3. oracle vs a live market quote ───────────────────────────────────
    // One collateral unit sold for the loan asset, on the same chain.
    const oneUnit = (10n ** BigInt(market.collateralToken.decimals)).toString();
    const spot = await trustwareQuote({
      fromChain: "1", fromToken: market.collateralToken.address,
      toChain: "1", toToken: market.loanToken.address,
      fromAmount: oneUnit, fromAddress: EVM_PROBE, toAddress: EVM_PROBE,
    });
    if (spot.ok) {
      const quoted = Number(spot.estimate.toAmount) / 10 ** market.loanToken.decimals;
      const drift = Math.abs(quoted - unitPrice) / unitPrice;
      console.log(`  market quote: 1 ${market.collateralToken.symbol} = ${quoted.toFixed(2)} ${market.loanToken.symbol}  (oracle drift ${(drift * 100).toFixed(2)}%)`);
      check(drift < 0.05, "oracle within 5% of market", `${(drift * 100).toFixed(2)}%`);
    } else {
      console.log(`  market quote: unavailable (HTTP ${spot.status}) — gold as a route SOURCE is the known upstream failure`);
    }

    // ── 4. the wallet's position ───────────────────────────────────────────
    if (wallet) {
      const posHex = await ethCall(
        MORPHO_BLUE,
        encodeFunctionData({ abi: MORPHO_BLUE_ABI, functionName: "position", args: [market.id as Hex, wallet as `0x${string}`] }),
      );
      const [supplyShares, borrowShares, collateral] = decodeFunctionResult({
        abi: MORPHO_BLUE_ABI, functionName: "position", data: posHex,
      });
      const math = priceGoldPosition({
        market,
        position: { supplyShares, borrowShares, collateral },
        state,
        oraclePrice,
      });
      console.log(`\n  position for ${wallet}`);
      console.log(`    collateral ${formatUnits(math.collateralAtomic, market.collateralToken.decimals)} ${market.collateralToken.symbol} (worth ${formatUnits(math.collateralValueAtomic, market.loanToken.decimals)} ${market.loanToken.symbol})`);
      console.log(`    debt       ${formatUnits(math.debtAtomic, market.loanToken.decimals)} ${market.loanToken.symbol}`);
      console.log(`    LTV ${math.ltv === null ? "-" : `${(math.ltv * 100).toFixed(2)}%`}  health ${math.healthFactor === null ? "no debt" : math.healthFactor.toFixed(3)}`);
      if (math.liquidationOraclePrice !== null) {
        const liq = oraclePriceToUnitPrice(math.liquidationOraclePrice, market.collateralToken.decimals, market.loanToken.decimals);
        console.log(`    liquidated if gold falls to ${liq.toFixed(2)} ${market.loanToken.symbol} (now ${unitPrice.toFixed(2)})`);
      }
      // The invariant the contract enforces. If our math ever says healthy
      // where Morpho says otherwise, this is where it shows.
      check(math.debtAtomic <= math.maxBorrowAtomic, "position is solvent by our math");
    }
  }

  // ── 5. the funding legs ──────────────────────────────────────────────────
  console.log("\n=== Trustware funding legs ===");
  const market = GOLD_MARKETS[0];

  const buy = await trustwareQuote({
    fromChain: "solana-mainnet-beta", fromToken: USDC_SOL,
    toChain: "1", toToken: market.collateralToken.address,
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
    fromChain: "1", fromToken: market.loanToken.address,
    toChain: "solana-mainnet-beta", toToken: USDC_SOL,
    fromAmount: "500000000", fromAddress: EVM_PROBE, toAddress: SOLANA_PROBE,
  });
  check(home.ok, "Ethereum USDT -> Solana USDC (the borrowed loan comes home)",
    home.ok ? `500 USDT -> ${formatUnits(BigInt(home.estimate.toAmount!), 6)} USDC` : `HTTP ${home.status}`);

  // Each curated gold holding, both hops. The direct hop is the one Trustware
  // cannot currently solve; the two-hop fallback is what lib/morpho/gold-fund.ts
  // actually runs until it can.
  console.log("\n  per-source: [direct] source -> XAUt(eth)   [hop 1] source -> USDC(sol)");
  const routable: { source: (typeof GOLD_COLLATERAL_SOURCES)[number]; direct: boolean; hop1: boolean }[] = [];
  for (const source of GOLD_COLLATERAL_SOURCES) {
    const amount = (10n ** BigInt(source.decimals)).toString();
    const common = {
      fromChain: source.chain, fromToken: source.token, fromAmount: amount,
      fromAddress: source.kind === "solana" ? SOLANA_PROBE : EVM_PROBE,
      fromAmountUSD: String(source.approxUnitUsd),
    };
    const direct = await trustwareQuote({
      ...common, toChain: "1", toToken: market.collateralToken.address, toAddress: EVM_PROBE,
    });
    const hop1 = await trustwareQuote({
      ...common, toChain: "solana-mainnet-beta", toToken: USDC_SOL, toAddress: SOLANA_PROBE,
    });
    const directTxt = direct.ok
      ? `${formatUnits(BigInt(direct.estimate.toAmount!), 6)} XAUt`
      : `HTTP ${direct.status}`;
    // Trustware returns USD figures sometimes as a number and sometimes as a
    // string; the same ambiguity toNumberOrNull absorbs in lib/trustware.
    const hopTxt = hop1.ok
      ? `$${Number(hop1.estimate.toAmountUsd ?? 0).toFixed(2)}`
      : `HTTP ${hop1.status}`;
    console.log(`    ${source.symbol.padEnd(7)} ${source.chainLabel.padEnd(9)} direct=${directTxt.padEnd(14)} hop1=${hopTxt}`);
    routable.push({ source, direct: direct.ok, hop1: hop1.ok });
  }

  // Two different failures hide behind the same 502, and conflating them would
  // mean reporting a liquidity fact to Trustware as a bug:
  //
  //   Solana gold -> XAUt(eth) fails while Solana gold -> USDC(sol) and
  //   USDC(sol) -> XAUt(eth) both succeed. The solver cannot compose two legs
  //   it can each run. That one is worth raising upstream.
  //
  //   GLDx and GLDon on Ethereum and BNB fail in EVERY direction, including to
  //   USDC on their own chain. That reads as no DEX liquidity for those
  //   wrappers off Solana, which no backend fix changes.
  //
  // So only the Solana sources are required to pass. The EVM rows are reported,
  // not asserted, and the planner blocks them with a readable reason until the
  // day this prints an amount.
  for (const r of routable) {
    if (r.source.kind === "solana") {
      check(r.hop1, `${r.source.symbol} on Solana: fundable via the two-hop fallback`);
    } else if (!r.direct && !r.hop1) {
      console.log(`    note: ${r.source.symbol} on ${r.source.chainLabel} has no route in any direction (liquidity, not an outage)`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
