// Live check for the Aave venue on Ethereum: the two stata tokens and the two
// Umbrella stake tokens in lib/aave/vaults.ts. Hits the real endpoints, so no
// app server is needed.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/aave-check.mts [evmAddress]
//
// Pass an EVM address to also read that wallet's positions, cooldown state and
// pending rewards.
//
// What it proves, in order of how badly each would hurt if wrong:
//
//   1. The registry matches the chain. Each vault's `asset()` is the token the
//      form deposits, each stake token's `asset()` is the stata token the
//      registry names, each stata token's `aToken()` is the aToken the registry
//      names, and every share token is 6 decimals. A wrong address here sends
//      a deposit to a contract that takes it and gives back something else.
//   2. The batch helper is wired to the rewards controller the registry names
//      and is not paused; an Umbrella deposit goes through it.
//   3. The rate math reproduces what Aave shows. The supply APY is derived
//      from the Pool's own liquidity rate, and each Umbrella reward stream is
//      priced through the Aave oracle. Compare the printed figures with
//      app.aave.com and app.aave.com/staking before shipping.
//   4. The cooldown and unstake window are what the copy says (20 days and 2
//      days at launch). They are governance parameters and are read live by
//      the app; this just makes a change visible.
//   5. Trustware still routes every funding and return leg the venue uses.
//
// The addresses were taken from @bgd-labs/aave-address-book 4.44.22 in a
// session that could not reach Ethereum, so the first run of this script IS
// the verification. Do not ship the venue until it passes.

import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  type Hex,
} from "viem";

import {
  AAVE_ORACLE_ABI,
  AAVE_POOL_ABI,
  ATOKEN_ABI,
  BATCH_HELPER_ABI,
  ERC20_META_ABI,
  ERC4626_ABI,
  REWARDS_CONTROLLER_ABI,
  STAKE_TOKEN_ABI,
  STATA_TOKEN_ABI,
} from "../lib/aave/abi";
import {
  AAVE_ORACLE,
  AAVE_V3_POOL,
  ETHEREUM_CHAIN_ID,
  ETHEREUM_NATIVE_TOKEN,
  ETHEREUM_RPC_URL,
  ETHEREUM_USDC,
  ETHEREUM_USDT,
  UMBRELLA_BATCH_HELPER,
  UMBRELLA_REWARDS_CONTROLLER,
} from "../lib/aave/constants";
import {
  cooldownPhase,
  formatDuration,
  rewardAprFromEmission,
  supplyApyFromLiquidityRate,
} from "../lib/aave/math";
import { AAVE_VAULTS } from "../lib/aave/vaults";
import { USDC_MINT } from "../lib/jupiter/constants";
import {
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_SOLANA_CHAIN,
} from "../lib/trustware/constants";

const SOLANA_PROBE = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_PROBE = "0x2E1b1C1e6D9F0d0E9d3f7b0c0a0f1e2d3c4b5a69";

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function view<const A extends readonly unknown[]>(abi: A, to: string, fn: string, args: any[] = []): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = encodeFunctionData({ abi: abi as any, functionName: fn, args });
  const out = await ethCall(to, data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return decodeFunctionResult({ abi: abi as any, functionName: fn, data: out });
}

async function quote(req: Record<string, unknown>) {
  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) throw new Error("TRUSTWARE_API_KEY is not set");
  const res = await fetch(`${TRUSTWARE_API_BASE_URL}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ slippage: 1, ...req }),
  });
  const json = (await res.json()) as {
    estimate?: { toAmount?: string; toAmountMin?: string; totalFeesUsd?: string | number };
    data?: { estimate?: { toAmount?: string; toAmountMin?: string; totalFeesUsd?: string | number } };
    error?: string;
  };
  return { status: res.status, estimate: json.estimate ?? json.data?.estimate, error: json.error };
}

async function main() {
  const wallet = process.argv[2];

  console.log(`=== Registry vs chain (${ETHEREUM_RPC_URL}) ===`);
  for (const v of AAVE_VAULTS) {
    console.log(`\n  ${v.name} (${v.symbol}) ${v.address}`);
    const asset = (await view(ERC4626_ABI, v.address, "asset")) as string;
    const decimals = Number(await view(ERC4626_ABI, v.address, "decimals"));
    check(decimals === v.shareDecimals, "share decimals", `${decimals}`);
    if (v.kind === "supply") {
      check(same(asset, v.asset.address), "stata asset() is the deposit token", asset);
      const aToken = (await view(STATA_TOKEN_ABI, v.address, "aToken")) as string;
      check(same(aToken, v.aToken), "stata aToken() matches registry", aToken);
    } else {
      check(same(asset, v.stataToken), "stake asset() is the stata token", asset);
      const stataAsset = (await view(ERC4626_ABI, v.stataToken, "asset")) as string;
      check(same(stataAsset, v.asset.address), "stata asset() is the deposit token", stataAsset);
      const aToken = (await view(STATA_TOKEN_ABI, v.stataToken, "aToken")) as string;
      check(same(aToken, v.aToken), "stata aToken() matches registry", aToken);
      const paused = (await view(STAKE_TOKEN_ABI, v.address, "paused")) as boolean;
      check(!paused, "stake token not paused", paused ? "PAUSED" : "");
      const cooldown = Number(await view(STAKE_TOKEN_ABI, v.address, "getCooldown"));
      const window = Number(await view(STAKE_TOKEN_ABI, v.address, "getUnstakeWindow"));
      console.log(`       cooldown ${formatDuration(cooldown)} (${cooldown}s), unstake window ${formatDuration(window)} (${window}s)`);
      check(cooldown > 0 && window > 0, "cooldown and window set");
    }
  }

  console.log("\n=== Batch helper ===");
  const rc = (await view(BATCH_HELPER_ABI, UMBRELLA_BATCH_HELPER, "REWARDS_CONTROLLER")) as string;
  check(same(rc, UMBRELLA_REWARDS_CONTROLLER), "helper REWARDS_CONTROLLER matches registry", rc);
  const helperPaused = (await view(BATCH_HELPER_ABI, UMBRELLA_BATCH_HELPER, "paused")) as boolean;
  check(!helperPaused, "helper not paused");

  console.log("\n=== Rates ===");
  const priceByAsset = new Map<string, bigint>();
  for (const a of [ETHEREUM_USDC, ETHEREUM_USDT]) {
    const reserve = (await view(AAVE_POOL_ABI, AAVE_V3_POOL, "getReserveData", [a.address])) as {
      currentLiquidityRate: bigint;
      aTokenAddress: string;
    };
    const price = (await view(AAVE_ORACLE_ABI, AAVE_ORACLE, "getAssetPrice", [a.address])) as bigint;
    priceByAsset.set(a.address.toLowerCase(), price);
    const apy = supplyApyFromLiquidityRate(reserve.currentLiquidityRate);
    console.log(`  ${a.symbol}: supply APY ${(apy * 100).toFixed(3)}%  oracle $${Number(price) / 1e8}  aToken ${reserve.aTokenAddress}`);
    const registryAToken = AAVE_VAULTS.find((v) => v.asset.symbol === a.symbol)!.aToken;
    check(same(reserve.aTokenAddress, registryAToken), `${a.symbol} reserve aToken matches registry`);
    check(apy > 0 && apy < 0.5, `${a.symbol} supply APY is plausible`, `${(apy * 100).toFixed(2)}%`);
  }
  for (const v of AAVE_VAULTS.filter((x) => x.kind === "umbrella")) {
    const totalAssets = (await view(ERC4626_ABI, v.address, "totalAssets")) as bigint;
    const stataPrice = BigInt((await view(STATA_TOKEN_ABI, v.stataToken, "latestAnswer")) as bigint);
    const rewards = (await view(REWARDS_CONTROLLER_ABI, UMBRELLA_REWARDS_CONTROLLER, "getAllRewards", [v.address])) as string[];
    console.log(`  ${v.symbol}: staked ${formatUnits(totalAssets, 6)} (stata price $${Number(stataPrice) / 1e8}), ${rewards.length} reward stream(s)`);
    check(rewards.length > 0, `${v.symbol} has a reward stream configured`);
    let total = 0;
    for (const r of rewards) {
      const emission = (await view(REWARDS_CONTROLLER_ABI, UMBRELLA_REWARDS_CONTROLLER, "calculateCurrentEmission", [v.address, r])) as bigint;
      const symbol = (await view(ERC20_META_ABI, r, "symbol")) as string;
      const dec = Number(await view(ERC20_META_ABI, r, "decimals"));
      let underlying: string | null = null;
      try {
        underlying = (await view(ATOKEN_ABI, r, "UNDERLYING_ASSET_ADDRESS")) as string;
      } catch {
        // not an aToken
      }
      const price = underlying
        ? ((await view(AAVE_ORACLE_ABI, AAVE_ORACLE, "getAssetPrice", [underlying])) as bigint)
        : 0n;
      const apr = price > 0n
        ? rewardAprFromEmission({
            emissionPerSecond: emission,
            rewardDecimals: dec,
            rewardPriceE8: price,
            stakedAtomic: totalAssets,
            stakedDecimals: 6,
            stakedPriceE8: stataPrice,
          })
        : null;
      total += apr ?? 0;
      console.log(`     reward ${symbol} ${r}: ${formatUnits(emission, dec)}/s -> ${apr == null ? "unpriced" : `${(apr * 100).toFixed(3)}%`}${same(r, v.aToken) ? " (the vault's aToken, restakeable)" : ""}`);
      check(apr != null, `${v.symbol} reward ${symbol} is priceable through the Aave oracle`);
    }
    console.log(`     safety incentives total ${(total * 100).toFixed(3)}%  <- compare with app.aave.com/staking`);
  }

  if (wallet) {
    console.log(`\n=== Wallet ${wallet} ===`);
    const block = (await rpc("eth_getBlockByNumber", ["latest", false])) as { timestamp: string };
    const now = Number(BigInt(block.timestamp));
    const eth = BigInt((await rpc("eth_getBalance", [wallet, "latest"])) as string);
    console.log(`  ETH ${formatUnits(eth, 18)}`);
    for (const a of [ETHEREUM_USDC, ETHEREUM_USDT]) {
      const bal = (await view(erc20Abi, a.address, "balanceOf", [wallet])) as bigint;
      console.log(`  ${a.symbol} ${formatUnits(bal, 6)}`);
    }
    for (const v of AAVE_VAULTS) {
      const shares = (await view(ERC4626_ABI, v.address, "balanceOf", [wallet])) as bigint;
      if (shares === 0n) {
        console.log(`  ${v.symbol}: no position`);
        continue;
      }
      let assets = (await view(ERC4626_ABI, v.address, "convertToAssets", [shares])) as bigint;
      if (v.kind === "umbrella") {
        assets = (await view(ERC4626_ABI, v.stataToken, "convertToAssets", [assets])) as bigint;
        const snap = (await view(STAKE_TOKEN_ABI, v.address, "getStakerCooldown", [wallet])) as {
          amount: bigint;
          endOfCooldown: number;
          withdrawalWindow: number;
        };
        const phase = cooldownPhase(
          { amount: snap.amount, endOfCooldown: Number(snap.endOfCooldown), withdrawalWindow: Number(snap.withdrawalWindow) },
          now,
        );
        const [rt, ra] = (await view(REWARDS_CONTROLLER_ABI, UMBRELLA_REWARDS_CONTROLLER, "calculateCurrentUserRewards", [v.address, wallet])) as [string[], bigint[]];
        console.log(`  ${v.symbol}: ${formatUnits(shares, 6)} shares = ${formatUnits(assets, 6)} ${v.asset.symbol}; cooldown ${JSON.stringify(phase, (_, x) => (typeof x === "bigint" ? x.toString() : x))}; pending ${rt.map((t, i) => `${ra[i].toString()} of ${t}`).join(", ") || "none"}`);
      } else {
        const max = (await view(ERC4626_ABI, v.address, "maxWithdraw", [wallet])) as bigint;
        console.log(`  ${v.symbol}: ${formatUnits(shares, 6)} shares = ${formatUnits(assets, 6)} ${v.asset.symbol}; withdrawable now ${formatUnits(max, 6)}`);
      }
    }
  }

  console.log("\n=== Trustware legs ===");
  const legs: { label: string; req: Record<string, unknown> }[] = [
    {
      label: "Solana USDC -> Ethereum USDC (10)",
      req: { fromChain: TRUSTWARE_SOLANA_CHAIN, toChain: String(ETHEREUM_CHAIN_ID), fromToken: USDC_MINT, toToken: ETHEREUM_USDC.address, fromAmount: "10000000", fromAmountUSD: "10", fromAddress: SOLANA_PROBE, toAddress: EVM_PROBE },
    },
    {
      label: "Solana USDC -> Ethereum USDT (10)",
      req: { fromChain: TRUSTWARE_SOLANA_CHAIN, toChain: String(ETHEREUM_CHAIN_ID), fromToken: USDC_MINT, toToken: ETHEREUM_USDT.address, fromAmount: "10000000", fromAmountUSD: "10", fromAddress: SOLANA_PROBE, toAddress: EVM_PROBE },
    },
    {
      label: "Solana USDC -> native ETH (20)",
      req: { fromChain: TRUSTWARE_SOLANA_CHAIN, toChain: String(ETHEREUM_CHAIN_ID), fromToken: USDC_MINT, toToken: ETHEREUM_NATIVE_TOKEN, fromAmount: "20000000", fromAmountUSD: "20", fromAddress: SOLANA_PROBE, toAddress: EVM_PROBE },
    },
    {
      label: "Ethereum USDC -> Solana USDC (10)",
      req: { fromChain: String(ETHEREUM_CHAIN_ID), toChain: TRUSTWARE_SOLANA_CHAIN, fromToken: ETHEREUM_USDC.address, toToken: USDC_MINT, fromAmount: "10000000", fromAddress: EVM_PROBE, toAddress: SOLANA_PROBE },
    },
    {
      label: "Ethereum USDT -> Solana USDC (10)",
      req: { fromChain: String(ETHEREUM_CHAIN_ID), toChain: TRUSTWARE_SOLANA_CHAIN, fromToken: ETHEREUM_USDT.address, toToken: USDC_MINT, fromAmount: "10000000", fromAddress: EVM_PROBE, toAddress: SOLANA_PROBE },
    },
  ];
  for (const leg of legs) {
    try {
      const q = await quote(leg.req);
      const ok = q.status === 200 && Boolean(q.estimate?.toAmount);
      check(ok, leg.label, ok ? `out ${q.estimate!.toAmount} min ${q.estimate!.toAmountMin ?? "-"} fees $${q.estimate!.totalFeesUsd ?? "-"}` : `${q.status} ${q.error ?? ""}`);
    } catch (err) {
      check(false, leg.label, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
