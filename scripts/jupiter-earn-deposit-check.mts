// Live check for the Jupiter Lend Earn deposit path.
//
//   npx tsx scripts/jupiter-earn-deposit-check.mts [walletAddress]
//
// Deposits used to be built with a compute unit LIMIT and no unit PRICE, which
// raises the ceiling without buying a place in the queue: every one went out at
// zero priority and was the first thing dropped when the network got busy. The
// build also discarded lastValidBlockHeight, so the caller had no way to tell a
// transaction still in flight from a dead one and fell back to a flat 30-second
// timeout. This checks both are fixed, and that the transaction still simulates
// cleanly.
//
// Pass a wallet holding the asset to get a real simulation. Without one the
// simulation fails on funds, which says nothing either way.

import { Connection, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { readFileSync } from "node:fs";

import { EARN_ASSETS, buildEarnDepositTx } from "../lib/jupiter/earn";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const WALLET = process.argv[2] ?? "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
const ASSET = EARN_ASSETS[0]; // USDC
const AMOUNT = new BN(1_000_000); // 1 USDC

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` -- ${detail}` : ""}`);
}

function rpcUrl(): string {
  if (process.env.NEXT_PUBLIC_SOLANA_RPC_URL) {
    return process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  }
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const url = env
    .match(/^NEXT_PUBLIC_SOLANA_RPC_URL=(.*)$/m)?.[1]
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!url) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not set");
  return url;
}

const conn = new Connection(rpcUrl(), "confirmed");
console.log(`vault: Jupiter Lend ${ASSET.symbol} (vaultId ${ASSET.vaultId})`);
console.log(`wallet: ${WALLET}\n`);

const built = await buildEarnDepositTx({
  meta: ASSET,
  amountAtomic: AMOUNT,
  signerAddress: WALLET,
  connection: conn,
});

const tx = VersionedTransaction.deserialize(
  Buffer.from(built.transaction, "base64"),
);
const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());

let unitLimit = 0;
let unitPrice = 0n;
for (const ix of tx.message.compiledInstructions) {
  if (keys[ix.programIdIndex] !== COMPUTE_BUDGET) continue;
  const data = Buffer.from(ix.data);
  if (data[0] === 2) unitLimit = data.readUInt32LE(1);
  if (data[0] === 3) unitPrice = data.readBigUInt64LE(1);
}

console.log("compute budget:");
check("sets a compute unit limit", unitLimit > 0, `${unitLimit} units`);
check(
  "sets a compute unit price above zero",
  unitPrice > 0n,
  `${unitPrice} microLamports/CU`,
);
const feeLamports = (Number(unitPrice) * unitLimit) / 1_000_000;
console.log(
  `         priority fee = ${Math.round(feeLamports)} lamports (${(feeLamports / 1e9).toFixed(6)} SOL)`,
);
check(
  "priority fee stays inside its cap",
  feeLamports <= 2_000_000,
  `${Math.round(feeLamports)} lamports vs 2000000 cap`,
);

console.log("\nconfirmation window:");
check("returns a blockhash", !!built.blockhash);
const blockhashValid = await conn.isBlockhashValid(built.blockhash, {
  commitment: "confirmed",
});
check("blockhash is live", blockhashValid.value === true);
const height = await conn.getBlockHeight("confirmed");
check(
  "lastValidBlockHeight gives a full lifetime, not a 30s timer",
  built.lastValidBlockHeight - height > 100,
  `${built.lastValidBlockHeight - height} blocks of runway`,
);

console.log("\nsimulation:");
const sim = await conn.simulateTransaction(tx, {
  sigVerify: false,
  replaceRecentBlockhash: true,
});
console.log(
  `         err=${JSON.stringify(sim.value.err)} units=${sim.value.unitsConsumed}`,
);
if (sim.value.err) {
  console.log(
    "         (pass a wallet holding the asset to exercise a real deposit)",
  );
  for (const line of sim.value.logs?.slice(-4) ?? []) {
    console.log(`         ${line}`);
  }
}
check("deposit simulates without error", !sim.value.err);
if (!sim.value.err) {
  check(
    "requested unit limit covers measured consumption",
    !!sim.value.unitsConsumed && unitLimit > sim.value.unitsConsumed,
    `limit ${unitLimit} vs consumed ${sim.value.unitsConsumed}`,
  );
}

console.log(
  `\n${failures === 0 ? "PASS" : `FAIL (${failures})`}: Jupiter Lend deposit build`,
);
process.exit(failures === 0 ? 0 : 1);
