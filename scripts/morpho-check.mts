// Live check for the Monad Morpho earn read path. Verifies the indexer metrics
// and an on-chain ERC-4626 read for the curated vaults, hitting the real
// endpoints (no app server needed).
//
//   npx tsx scripts/morpho-check.mts [evmAddressForPositionRead]
//
// Pass an EVM address to also read that wallet's share balance in each vault.

import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  type Hex,
} from "viem";

import { MONAD_RPC_URL, MORPHO_BLUE_API_URL, MONAD_CHAIN_ID } from "../lib/morpho/constants";
import { MONAD_USDC_VAULTS } from "../lib/morpho/vaults";

const ABI = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "s", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function ethCall(to: string, data: Hex): Promise<Hex> {
  const res = await fetch(MONAD_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  const json = (await res.json()) as { result?: Hex; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as Hex;
}

async function main() {
  const wallet = process.argv[2];

  console.log("=== Morpho indexer (Monad chainId", MONAD_CHAIN_ID, ") ===");
  // The curated vaults are Morpho Vaults V2, served by the `vaultV2s` query.
  // The `vaults` query is V1-only and returns their near-empty V1 twins.
  const gql = await fetch(MORPHO_BLUE_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query($a:[String!],$c:[Int!]){vaultV2s(first:50,where:{address_in:$a,chainId_in:$c}){items{address name listed netApy avgNetApy totalAssetsUsd}}}`,
      variables: { a: MONAD_USDC_VAULTS.map((v) => v.address), c: [MONAD_CHAIN_ID] },
    }),
  }).then((r) => r.json());
  for (const it of gql.data.vaultV2s.items) {
    console.log(
      `  ${it.name.padEnd(28)} netApy=${((it.netApy ?? 0) * 100).toFixed(2)}%  avg=${((it.avgNetApy ?? 0) * 100).toFixed(2)}%  tvl=$${Math.round(it.totalAssetsUsd ?? 0).toLocaleString()}  listed=${it.listed}`,
    );
  }

  console.log("\n=== On-chain ERC-4626 reads (Monad RPC) ===");
  for (const v of MONAD_USDC_VAULTS) {
    const assetHex = await ethCall(v.address, encodeFunctionData({ abi: ABI, functionName: "asset", args: [] }));
    const asset = decodeFunctionResult({ abi: ABI, functionName: "asset", data: assetHex });
    const ok = (asset as string).toLowerCase() === v.asset.address.toLowerCase();
    console.log(`  ${v.name.padEnd(28)} asset()=${asset} ${ok ? "OK" : "MISMATCH!"}`);

    if (wallet) {
      const balHex = await ethCall(v.address, encodeFunctionData({ abi: ABI, functionName: "balanceOf", args: [wallet as `0x${string}`] }));
      const shares = decodeFunctionResult({ abi: ABI, functionName: "balanceOf", data: balHex }) as bigint;
      let usdc = 0n;
      if (shares > 0n) {
        const aHex = await ethCall(v.address, encodeFunctionData({ abi: ABI, functionName: "convertToAssets", args: [shares] }));
        usdc = decodeFunctionResult({ abi: ABI, functionName: "convertToAssets", data: aHex }) as bigint;
      }
      console.log(`      position: ${formatUnits(shares, v.shareDecimals)} shares = ${formatUnits(usdc, v.asset.decimals)} USDC`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
