// Live check for the shMON staking venue on Monad (lib/shmonad). Hits the
// real endpoints, so no app server is needed.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/shmonad-check.mts [evmHolder]
//
// Pass an EVM address that holds shMON to also estimate gas for the exit
// paths from it and to read its unstake request. Without one the script scans
// recent Transfer logs for an externally owned holder and uses that.
//
// Environment: MONAD_RPC_URL (optional, the app's paid endpoint),
// MONAD_HISTORY_RPC_URL (optional, defaults to the public node),
// TRUSTWARE_API_KEY (needed for section 5). SHMONAD_CHECK_TRUSTWARE_RETRIES
// and SHMONAD_CHECK_TRUSTWARE_DELAY_MS tune how long a Trustware outage is
// waited out (defaults: 3 retries, 5 minutes apart).
//
// What it proves, in order of how badly each would hurt if wrong:
//
//   1. The registry matches the chain: name, symbol, 18 decimals, and
//      asset() is the native-MON alias. A wrong address here sends MON to a
//      contract that keeps it.
//   2. The exchange rate and the three previews the card shows. net + fee
//      must equal gross on previewRedeemDetailed.
//   3. The instant-exit fee curve: lib/shmonad/math.ts reproduces
//      getCurrentUnstakeFeeRateRay from getFeeCurveParams and the
//      utilization.
//   4. The APY derivation: share price now against a week ago and a day ago,
//      through the history endpoint. Records which windows each endpoint can
//      serve.
//   5. Trustware routes every leg the venue uses: Solana USDC to native MON
//      (the stake), native MON to Solana USDC (the way home), the same-chain
//      fallbacks, and the direct USDC-to-shMON quote for the record. Route
//      calls create intents and move nothing; nothing is signed.
//   6. Gas and calldata: a deposit with value == assets estimates, one with
//      value != assets reverts, and the exit paths estimate from a holder.
//   7. The epoch counters, printed so a change is visible.
//
// Exit code is non-zero when any asserted section fails. Section 5 failing
// on an upstream outage is reported as such.

import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  type Hex,
} from "viem";

import { USDC_MINT } from "../lib/jupiter/constants";
import {
  MONAD_CHAIN_ID,
  MONAD_NATIVE_TOKEN,
  MONAD_RPC_URL,
  MONAD_USDC,
} from "../lib/morpho/constants";
import { SHMON_ABI } from "../lib/shmonad/abi";
import {
  APY_FALLBACK_WINDOW_SECONDS,
  APY_WINDOW_SECONDS,
  MONAD_BLOCK_SECONDS_APPROX,
  MONAD_HISTORY_RPC_URL,
  SHMON_ADDRESS,
  SHMON_ASSET_ALIAS,
  SHMON_DECIMALS,
} from "../lib/shmonad/constants";
import {
  apyFromGrowth,
  feeRateAtUtilization,
  feeRateFromRay,
  rateMonPerShare,
} from "../lib/shmonad/math";
import {
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_SOLANA_CHAIN,
} from "../lib/trustware/constants";

const PUBLIC_RPC = "https://rpc.monad.xyz";
const SOL_ADDR = "HYyEoLDLMmL2wtKczx6JLNeUc7RqUnXGUUnPudwiAbN4";
const EVM_DUMMY = "0x1111111111111111111111111111111111111111";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const ONE = 10n ** 18n;

// Two calls IShMonad exposes that the app never needs, read here so the epoch
// picture is on record.
const EXTRA_ABI = [
  {
    type: "function",
    name: "getEpochInfo",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "epochNumber", type: "uint256" },
      { name: "epochStartBlock", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getGlobalPending",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "pendingStaking", type: "uint120" },
      { name: "pendingUnstaking", type: "uint120" },
    ],
  },
] as const;

const failures: string[] = [];
function check(section: string, ok: boolean, what: string) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${what}`);
  if (!ok) failures.push(`${section}: ${what}`);
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────

async function rpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

type Fn = Parameters<typeof encodeFunctionData<typeof SHMON_ABI>>[0]["functionName"];

async function view<F extends Fn>(
  url: string,
  functionName: F,
  args: unknown[] = [],
  block: string = "latest",
) {
  const data = encodeFunctionData({
    abi: SHMON_ABI,
    functionName,
    // The ABI is const-typed; the script passes plain values.
    args: args as never,
  } as never);
  const out = (await rpc(url, "eth_call", [{ to: SHMON_ADDRESS, data }, block])) as Hex;
  return decodeFunctionResult({ abi: SHMON_ABI, functionName, data: out } as never);
}

async function blockTimestamp(url: string, block: string): Promise<number> {
  const b = (await rpc(url, "eth_getBlockByNumber", [block, false])) as { timestamp: string } | null;
  if (!b) throw new Error(`block ${block} not found`);
  return parseInt(b.timestamp, 16);
}

// ── sections ─────────────────────────────────────────────────────────────

async function section1() {
  console.log("\n=== 1. Registry vs chain ===");
  const [name, symbol, decimals, asset] = await Promise.all([
    view(PUBLIC_RPC, "name") as Promise<string>,
    view(PUBLIC_RPC, "symbol") as Promise<string>,
    view(PUBLIC_RPC, "decimals") as Promise<number>,
    view(PUBLIC_RPC, "asset") as Promise<string>,
  ]);
  console.log(`  ${SHMON_ADDRESS}: name=${name} symbol=${symbol} decimals=${decimals} asset=${asset}`);
  check("1", name === "ShMonad", "name() is ShMonad");
  check("1", symbol === "shMON", "symbol() is shMON");
  check("1", Number(decimals) === SHMON_DECIMALS, `decimals() is ${SHMON_DECIMALS}`);
  check("1", asset.toLowerCase() === SHMON_ASSET_ALIAS.toLowerCase(), "asset() is the native-MON alias");
}

async function section2() {
  console.log("\n=== 2. Exchange rate and previews (1e18) ===");
  const [toAssets, toShares, prevDep, prevRedeem, prevUnstake, detailed, totalAssets, totalSupply] =
    await Promise.all([
      view(PUBLIC_RPC, "convertToAssets", [ONE]) as Promise<bigint>,
      view(PUBLIC_RPC, "convertToShares", [ONE]) as Promise<bigint>,
      view(PUBLIC_RPC, "previewDeposit", [ONE]) as Promise<bigint>,
      view(PUBLIC_RPC, "previewRedeem", [ONE]) as Promise<bigint>,
      view(PUBLIC_RPC, "previewUnstake", [ONE]) as Promise<bigint>,
      view(PUBLIC_RPC, "previewRedeemDetailed", [ONE]) as Promise<readonly [bigint, bigint, bigint]>,
      view(PUBLIC_RPC, "totalAssets") as Promise<bigint>,
      view(PUBLIC_RPC, "totalSupply") as Promise<bigint>,
    ]);
  const [gross, fee, net] = detailed;
  console.log(`  convertToAssets   ${formatUnits(toAssets, 18)} MON per shMON`);
  console.log(`  convertToShares   ${formatUnits(toShares, 18)} shMON per MON`);
  console.log(`  previewDeposit    ${formatUnits(prevDep, 18)} shMON per MON`);
  console.log(`  previewRedeem     ${formatUnits(prevRedeem, 18)} MON (instant, net)`);
  console.log(`  previewUnstake    ${formatUnits(prevUnstake, 18)} MON (queued)`);
  console.log(`  previewRedeemDetailed gross=${formatUnits(gross, 18)} fee=${formatUnits(fee, 18)} net=${formatUnits(net, 18)}`);
  console.log(`  totalAssets ${Math.round(Number(formatUnits(totalAssets, 18))).toLocaleString()} MON, totalSupply ${Math.round(Number(formatUnits(totalSupply, 18))).toLocaleString()} shMON`);
  check("2", gross === fee + net, "previewRedeemDetailed: gross == fee + net");
  check("2", net <= toAssets, "instant net is at or under convertToAssets");
  check("2", rateMonPerShare(toAssets) > 1, "rate is above 1 MON per shMON");
  return { toAssets, prevDep };
}

async function section3() {
  console.log("\n=== 3. Instant-exit fee curve ===");
  const [[slope, yInt], utilWad, feeRay, [utilized, allocated, available, utilWad2]] =
    await Promise.all([
      view(PUBLIC_RPC, "getFeeCurveParams") as Promise<readonly [bigint, bigint]>,
      view(PUBLIC_RPC, "getAtomicUtilizationWad") as Promise<bigint>,
      view(PUBLIC_RPC, "getCurrentUnstakeFeeRateRay") as Promise<bigint>,
      view(PUBLIC_RPC, "getAtomicPoolUtilization") as Promise<readonly [bigint, bigint, bigint, bigint]>,
    ]);
  const derived = feeRateAtUtilization(slope, yInt, utilWad);
  const rel = Math.abs(Number(derived - feeRay)) / Number(feeRay);
  console.log(`  slope=${feeRateFromRay(slope) * 100}% intercept=${feeRateFromRay(yInt) * 100}% cap=${(feeRateFromRay(slope + yInt) * 100).toFixed(3)}%`);
  console.log(`  utilization=${(Number(utilWad) / 1e16).toFixed(2)}% fee now=${(feeRateFromRay(feeRay) * 100).toFixed(4)}% derived=${(feeRateFromRay(derived) * 100).toFixed(4)}% (rel diff ${rel.toExponential(2)})`);
  console.log(`  pool utilized=${Math.round(Number(formatUnits(utilized, 18))).toLocaleString()} allocated=${Math.round(Number(formatUnits(allocated, 18))).toLocaleString()} available=${Math.round(Number(formatUnits(available, 18))).toLocaleString()} MON (utilizationWad ${(Number(utilWad2) / 1e16).toFixed(2)}%)`);
  check("3", rel < 1e-6, "math reproduces the contract's fee rate");
  check("3", available > 0n, "atomic pool has liquidity");
  return { available };
}

async function apyWindow(url: string, label: string, windowSeconds: number) {
  const latestHex = (await rpc(url, "eth_blockNumber", [])) as string;
  const latest = parseInt(latestHex, 16);
  const nowTs = await blockTimestamp(url, "latest");
  const guess = latest - Math.round(windowSeconds / MONAD_BLOCK_SECONDS_APPROX);
  const block = `0x${guess.toString(16)}`;
  try {
    const [px0, ts0, px1] = await Promise.all([
      view(url, "convertToAssets", [ONE], block) as Promise<bigint>,
      blockTimestamp(url, block),
      view(url, "convertToAssets", [ONE]) as Promise<bigint>,
    ]);
    const dt = nowTs - ts0;
    const r = apyFromGrowth(px0, px1, dt);
    console.log(`  ${label}: block ${guess} (${(dt / 3600).toFixed(1)} h ago) ${formatUnits(px0, 18)} -> ${formatUnits(px1, 18)} growth ${(r!.growth * 100).toFixed(4)}% APR ${(r!.apr * 100).toFixed(2)}% APY ${(r!.apy * 100).toFixed(2)}%`);
    return r;
  } catch (err) {
    console.log(`  ${label}: not served (${err instanceof Error ? err.message.slice(0, 90) : String(err)})`);
    return null;
  }
}

async function section4() {
  console.log("\n=== 4. APY from share price growth ===");
  console.log(`  history endpoint: ${MONAD_HISTORY_RPC_URL}`);
  const week = await apyWindow(MONAD_HISTORY_RPC_URL, "7-day", APY_WINDOW_SECONDS);
  const day = await apyWindow(MONAD_HISTORY_RPC_URL, "1-day", APY_FALLBACK_WINDOW_SECONDS);
  if (process.env.MONAD_RPC_URL && MONAD_RPC_URL !== MONAD_HISTORY_RPC_URL) {
    console.log("  paid endpoint (MONAD_RPC_URL), for the record:");
    await apyWindow(MONAD_RPC_URL, "7-day", APY_WINDOW_SECONDS);
    await apyWindow(MONAD_RPC_URL, "1-day", APY_FALLBACK_WINDOW_SECONDS);
  }
  const best = week ?? day;
  check("4", best != null, "at least one window is served by the history endpoint");
  check("4", best != null && best.apy > 0 && best.apy < 0.5, "APY is between 0 and 50%");
}

// ── Trustware ─────────────────────────────────────────────────────────────

function apiKey(): string | null {
  return process.env.TRUSTWARE_API_KEY ?? null;
}

async function tw(endpoint: "quote" | "route", body: unknown) {
  const res = await fetch(`${TRUSTWARE_API_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey()! },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function estimateOf(json: Record<string, unknown> | null) {
  const d = (json?.data ?? json ?? {}) as Record<string, unknown>;
  const route = (d.route ?? d) as Record<string, unknown>;
  const est = (d.estimate ?? route.estimate ?? {}) as Record<string, string>;
  return { d, route, est };
}

function req(
  fromChain: string,
  toChain: string,
  fromToken: string,
  toToken: string,
  fromAmount: string,
  fromAddress: string,
  toAddress: string,
) {
  return { fromChain, toChain, fromToken, toToken, fromAmount, fromAddress, toAddress, slippage: 1 };
}

async function quoteLine(label: string, body: unknown, toDecimals: number, toSymbol: string) {
  const { status, json, text } = await tw("quote", body);
  if (status === 502 || status === 503 || status === 504 || !json) {
    console.log(`  ${label}: ${status} ${json ? JSON.stringify(json).slice(0, 160) : "non-JSON (edge error page)"}`);
    return { ok: false, outage: status >= 500, est: null as Record<string, string> | null };
  }
  const { route, est } = estimateOf(json);
  const to = est.toAmount ? formatUnits(BigInt(est.toAmount), toDecimals) : "-";
  const min = est.toAmountMin ? formatUnits(BigInt(est.toAmountMin), toDecimals) : "-";
  console.log(`  ${label}: ${status} provider=${route.provider ?? "-"} to=${to} ${toSymbol} min=${min} feesUsd=${est.totalFeesUsd ?? "-"} toUsd=${est.toAmountUsd ?? "-"}` + (status !== 200 ? ` body=${text.slice(0, 200)}` : ""));
  return { ok: status === 200 && Boolean(est.toAmount), outage: false, est };
}

async function section5(): Promise<void> {
  console.log("\n=== 5. Trustware legs ===");
  if (!apiKey()) {
    console.log("  TRUSTWARE_API_KEY not set; skipping.");
    check("5", false, "TRUSTWARE_API_KEY present");
    return;
  }
  const retries = Number(process.env.SHMONAD_CHECK_TRUSTWARE_RETRIES ?? 3);
  const delayMs = Number(process.env.SHMONAD_CHECK_TRUSTWARE_DELAY_MS ?? 300_000);
  const SOL = TRUSTWARE_SOLANA_CHAIN;
  const MONAD = String(MONAD_CHAIN_ID);

  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`  attempt ${attempt} of ${retries}`);
    let outage = false;
    const results: boolean[] = [];

    for (const usdc of ["5000000", "25000000", "100000000"]) {
      const r = await quoteLine(
        `Solana USDC ${formatUnits(BigInt(usdc), 6)} -> Monad native MON`,
        req(SOL, MONAD, USDC_MINT, MONAD_NATIVE_TOKEN, usdc, SOL_ADDR, EVM_DUMMY),
        18,
        "MON",
      );
      outage ||= r.outage;
      results.push(r.ok);
      if (r.est?.totalFeesUsd && r.est?.toAmountUsd) {
        const fees = Number(r.est.totalFeesUsd);
        const from = Number(formatUnits(BigInt(usdc), 6));
        console.log(`      fee share ${((fees / from) * 100).toFixed(2)}% of ${from} USDC`);
      }
    }
    {
      const r = await quoteLine(
        "Monad native MON 100 -> Solana USDC (the way home)",
        req(MONAD, SOL, MONAD_NATIVE_TOKEN, USDC_MINT, (100n * ONE).toString(), EVM_DUMMY, SOL_ADDR),
        6,
        "USDC",
      );
      outage ||= r.outage;
      results.push(r.ok);
    }
    // Fallbacks and the record.
    const fb1 = await quoteLine(
      "same-chain: Monad USDC 25 -> native MON",
      req(MONAD, MONAD, MONAD_USDC.address, MONAD_NATIVE_TOKEN, "25000000", EVM_DUMMY, EVM_DUMMY),
      18,
      "MON",
    );
    const fb2 = await quoteLine(
      "same-chain: native MON 100 -> Monad USDC",
      req(MONAD, MONAD, MONAD_NATIVE_TOKEN, MONAD_USDC.address, (100n * ONE).toString(), EVM_DUMMY, EVM_DUMMY),
      6,
      "USDC",
    );
    await quoteLine(
      "for the record: Solana USDC 25 -> shMON direct",
      req(SOL, MONAD, USDC_MINT, SHMON_ADDRESS, "25000000", SOL_ADDR, EVM_DUMMY),
      18,
      "shMON",
    );
    outage ||= fb1.outage || fb2.outage;

    if (!outage) {
      check("5", results.every(Boolean), "cross-chain quotes: Solana USDC -> MON (3 sizes) and MON -> Solana USDC");
      check("5", fb1.ok && fb2.ok, "same-chain fallbacks quote");

      // Route shapes. Intents are created; nothing is signed or moved.
      const solRoute = await tw("route", req(SOL, MONAD, USDC_MINT, MONAD_NATIVE_TOKEN, "25000000", SOL_ADDR, EVM_DUMMY));
      {
        const { d, route } = estimateOf(solRoute.json);
        const exec = route.execution as { transaction?: Record<string, unknown>; approvals?: unknown[] } | undefined;
        const data = exec?.transaction?.data as string | undefined;
        const b64 = Boolean(data) && !data!.startsWith("0x");
        console.log(`  route Solana USDC -> MON: ${solRoute.status} provider=${route.provider} intent=${d.intentId ?? "-"} tx keys=[${exec?.transaction ? Object.keys(exec.transaction).join(",") : "-"}] base64=${b64}`);
        check("5", solRoute.status === 200 && b64, "Solana-source route carries a base64 Solana transaction");
      }
      const monRoute = await tw("route", req(MONAD, SOL, MONAD_NATIVE_TOKEN, USDC_MINT, (100n * ONE).toString(), EVM_DUMMY, SOL_ADDR));
      {
        const { d, route } = estimateOf(monRoute.json);
        const exec = route.execution as { transaction?: Record<string, unknown>; approvals?: { amount?: string }[] } | undefined;
        const tx = exec?.transaction;
        const value = tx?.value as string | undefined;
        const usable = (exec?.approvals ?? []).filter((a) => a.amount && BigInt(a.amount) > 0n).length;
        console.log(`  route native MON -> Solana USDC: ${monRoute.status} provider=${route.provider} intent=${d.intentId ?? "-"} tx keys=[${tx ? Object.keys(tx).join(",") : "-"}] value=${value ?? "-"} usableApprovals=${usable}` + (monRoute.status !== 200 ? ` body=${monRoute.text.slice(0, 200)}` : ""));
        check(
          "5",
          monRoute.status === 200 && Boolean(value) && BigInt(value!) > 0n && usable === 0,
          "native-MON-source route carries value and needs no approval (D11 single leg)",
        );
      }
      return;
    }

    if (attempt < retries) {
      console.log(`  upstream outage (5xx edge page); waiting ${Math.round(delayMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  check("5", false, "Trustware answered 5xx on every attempt (outage); cross-chain legs unverified");
}

// ── gas ───────────────────────────────────────────────────────────────────

async function estimate(from: string, data: Hex, value: bigint): Promise<number> {
  const g = (await rpc(PUBLIC_RPC, "eth_estimateGas", [
    { from, to: SHMON_ADDRESS, data, value: `0x${value.toString(16)}` },
  ])) as string;
  return parseInt(g, 16);
}

async function findHolder(): Promise<string | null> {
  const latest = parseInt((await rpc(PUBLIC_RPC, "eth_blockNumber", [])) as string, 16);
  const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const seen = new Set<string>();
  for (let end = latest; end > latest - 6000; end -= 100) {
    const logs = (await rpc(PUBLIC_RPC, "eth_getLogs", [
      { address: SHMON_ADDRESS, fromBlock: `0x${(end - 99).toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: [topic] },
    ])) as { topics: string[] }[];
    for (const l of logs) {
      for (const a of [`0x${l.topics[2].slice(26)}`, `0x${l.topics[1].slice(26)}`]) {
        if (/^0x0{40}$/.test(a) || seen.has(a)) continue;
        seen.add(a);
        const code = (await rpc(PUBLIC_RPC, "eth_getCode", [a, "latest"])) as string;
        if (code !== "0x") continue;
        const bal = (await view(PUBLIC_RPC, "balanceOf", [a])) as bigint;
        if (bal > ONE) return a;
      }
    }
  }
  return null;
}

async function section6(holderArg: string | undefined, poolAvailable: bigint) {
  console.log("\n=== 6. Gas and calldata ===");
  const dep = encodeFunctionData({ abi: SHMON_ABI, functionName: "deposit", args: [ONE, DEAD] });
  const gas = await estimate(DEAD, dep, ONE);
  const gasPrice = BigInt((await rpc(PUBLIC_RPC, "eth_gasPrice", [])) as string);
  console.log(`  deposit(1 MON) value==assets: ${gas} gas at ${Number(gasPrice) / 1e9} gwei = ${formatUnits(BigInt(gas) * gasPrice, 18)} MON`);
  check("6", gas > 40_000 && gas < 200_000, "deposit gas is in the expected band");
  let mismatchReverts = false;
  try {
    await estimate(DEAD, encodeFunctionData({ abi: SHMON_ABI, functionName: "deposit", args: [2n * ONE, DEAD] }), ONE);
  } catch {
    mismatchReverts = true;
  }
  check("6", mismatchReverts, "deposit with value != assets reverts");

  const holder = holderArg ?? (await findHolder());
  if (!holder) {
    console.log("  no externally owned holder found in the last 6,000 blocks; pass one as argv to measure the exit paths");
    return;
  }
  const bal = (await view(PUBLIC_RPC, "balanceOf", [holder])) as bigint;
  const [maxRedeem, maxWithdraw, unstake] = await Promise.all([
    view(PUBLIC_RPC, "maxRedeem", [holder]) as Promise<bigint>,
    view(PUBLIC_RPC, "maxWithdraw", [holder]) as Promise<bigint>,
    view(PUBLIC_RPC, "getUnstakeRequest", [holder]) as Promise<readonly [bigint, bigint]>,
  ]);
  console.log(`  holder ${holder}: ${formatUnits(bal, 18)} shMON; maxRedeem=${formatUnits(maxRedeem, 18)} maxWithdraw=${formatUnits(maxWithdraw, 18)} MON; unstake request amount=${formatUnits(unstake[0], 18)} MON completionEpoch=${unstake[1]}`);
  console.log(`  (pool available ${formatUnits(poolAvailable, 18)} MON; maxRedeem ${maxRedeem === bal ? "equals the balance" : maxRedeem === 0n ? "is zero" : "differs from the balance"})`);
  const half = bal / 2n;
  const paths: [string, Hex][] = [
    ["requestUnstake(half)", encodeFunctionData({ abi: SHMON_ABI, functionName: "requestUnstake", args: [half] })],
    ["redeem(half)", encodeFunctionData({ abi: SHMON_ABI, functionName: "redeem", args: [half, holder as `0x${string}`, holder as `0x${string}`] })],
    ["redeemWithSlippageProtection(half, 0)", encodeFunctionData({ abi: SHMON_ABI, functionName: "redeemWithSlippageProtection", args: [half, holder as `0x${string}`, holder as `0x${string}`, 0n] })],
    ["completeUnstake()", encodeFunctionData({ abi: SHMON_ABI, functionName: "completeUnstake" })],
  ];
  for (const [label, data] of paths) {
    try {
      console.log(`  ${label}: ${await estimate(holder, data, 0n)} gas`);
    } catch (err) {
      console.log(`  ${label}: reverts in estimate (${err instanceof Error ? err.message.slice(0, 120) : String(err)})`);
    }
  }
}

async function section7() {
  console.log("\n=== 7. Epoch counters ===");
  const internal = (await view(PUBLIC_RPC, "getInternalEpoch")) as bigint;
  const admin = (await view(PUBLIC_RPC, "getAdminValues")) as readonly [bigint, number, number, number, number, bigint];
  const info = decodeFunctionResult({
    abi: EXTRA_ABI,
    functionName: "getEpochInfo",
    data: (await rpc(PUBLIC_RPC, "eth_call", [
      { to: SHMON_ADDRESS, data: encodeFunctionData({ abi: EXTRA_ABI, functionName: "getEpochInfo" }) },
      "latest",
    ])) as Hex,
  });
  const pending = decodeFunctionResult({
    abi: EXTRA_ABI,
    functionName: "getGlobalPending",
    data: (await rpc(PUBLIC_RPC, "eth_call", [
      { to: SHMON_ADDRESS, data: encodeFunctionData({ abi: EXTRA_ABI, functionName: "getGlobalPending" }) },
      "latest",
    ])) as Hex,
  });
  console.log(`  getInternalEpoch=${internal} getEpochInfo=(${info[0]}, startBlock ${info[1]})`);
  console.log(`  getAdminValues: targetLiquidity ${admin[1]} bps, incentiveAlignment ${admin[2]} bps, stakingCommission ${admin[3]} bps, boostCommission ${admin[4]} bps`);
  console.log(`  getGlobalPending: staking ${formatUnits(pending[0], 18)} MON, unstaking ${formatUnits(pending[1], 18)} MON`);
  check("7", Number(admin[3]) <= 1_000, "staking commission is at most 10% (copy says 5%)");
}

async function main() {
  const holderArg = process.argv[2];
  const latest = parseInt((await rpc(PUBLIC_RPC, "eth_blockNumber", [])) as string, 16);
  const ts = await blockTimestamp(PUBLIC_RPC, "latest");
  console.log(`shMON check at block ${latest.toLocaleString()} (${new Date(ts * 1000).toISOString()}) via ${PUBLIC_RPC}`);

  await section1();
  await section2();
  const { available } = await section3();
  await section4();
  await section5();
  await section6(holderArg, available);
  await section7();

  console.log("\n=== Summary ===");
  if (failures.length === 0) {
    console.log("  all asserted sections passed");
  } else {
    for (const f of failures) console.log(`  FAIL ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
