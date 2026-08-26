// Live check for the Kamino K-Vault deposit path.
//
//   npx tsx scripts/kamino-deposit-check.mts [walletAddress]
//
// The app no longer signs the transaction KTX builds. It asks KTX for the raw
// instructions and composes the transaction itself, so that a deposit carries a
// priority fee and a blockhash fetched moments before signing. This checks that
// the swap was semantically free: that the composed transaction invokes exactly
// the same programs, over exactly the same accounts, with exactly the same
// instruction data as the one KTX would have handed us -- plus the two
// ComputeBudget instructions, and nothing else.
//
// Pass a wallet that holds the vault's token to also compare simulation
// results. Without one, both sides fail simulation identically, which still
// shows the composed message is well formed and reaches the program.

import {
  AddressLookupTableAccount,
  Connection,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";

import {
  KAMINO_EARN_VAULTS,
  composeKvaultTx,
  type KtxInstruction,
} from "../lib/kamino/kvaults";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const KTX_BASE = "https://api.kamino.finance/ktx/kvault";

// Any address works for a structural comparison; both sides get the same one.
const WALLET = process.argv[2] ?? "KUMtRazMP7vwvc2kthnGZ9Cq6ZsGRiYC97snMYepNx9";
const VAULT = KAMINO_EARN_VAULTS[0]; // RWA USDC
const UI_AMOUNT = "1";

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

async function ktx(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${KTX_BASE}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "aeras-finance/0.1",
    },
    body: JSON.stringify({
      wallet: WALLET,
      kvault: VAULT.address,
      amount: UI_AMOUNT,
    }),
  });
  const payload = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`KTX ${path} -> ${res.status}`);
  return payload;
}

// Resolve a transaction's lookup tables and decompile it back to plain
// instructions, so the two sides can be compared on resolved accounts rather
// than on index numbers that legitimately differ.
async function decompile(
  conn: Connection,
  tx: VersionedTransaction,
): Promise<TransactionInstruction[]> {
  const tables: AddressLookupTableAccount[] = [];
  for (const lookup of tx.message.addressTableLookups) {
    const fetched = await conn.getAddressLookupTable(lookup.accountKey);
    if (!fetched.value) throw new Error(`missing LUT ${lookup.accountKey}`);
    tables.push(fetched.value);
  }
  return TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: tables,
  }).instructions;
}

function fingerprint(ix: TransactionInstruction): string {
  const accounts = ix.keys
    .map(
      (k) =>
        `${k.pubkey.toBase58()}:${k.isSigner ? "S" : "-"}${k.isWritable ? "W" : "-"}`,
    )
    .join(",");
  return `${ix.programId.toBase58()}|${accounts}|${Buffer.from(ix.data).toString("base64")}`;
}

const conn = new Connection(rpcUrl(), "confirmed");
console.log(`vault: ${VAULT.name} (${VAULT.address})`);
console.log(`wallet: ${WALLET}\n`);

// --- The transaction KTX builds, which the app used to sign as-is ------------
const builtPayload = await ktx("deposit");
const ktxTx = VersionedTransaction.deserialize(
  Buffer.from(builtPayload.transaction as string, "base64"),
);
const ktxIxs = await decompile(conn, ktxTx);

const ktxHasComputeBudget = ktxIxs.some(
  (ix) => ix.programId.toBase58() === COMPUTE_BUDGET,
);
console.log("KTX /deposit:");
check(
  "KTX still bakes in no ComputeBudget instruction",
  !ktxHasComputeBudget,
  ktxHasComputeBudget
    ? "KTX now sets its own -- re-check whether composing is still needed"
    : `${ktxIxs.length} instructions, zero priority fee`,
);

// --- The transaction the app now composes ------------------------------------
const raw = await ktx("deposit-instructions");
const composed = await composeKvaultTx({
  instructions: raw.instructions as KtxInstruction[],
  lutsByAddress: (raw.lutsByAddress ?? {}) as Record<string, string[]>,
  walletAddress: WALLET,
  connection: conn,
});
const ourTx = VersionedTransaction.deserialize(
  Buffer.from(composed.transaction, "base64"),
);
const ourIxs = await decompile(conn, ourTx);

console.log("\ncomposed:");
const budgetIxs = ourIxs.filter(
  (ix) => ix.programId.toBase58() === COMPUTE_BUDGET,
);
const payloadIxs = ourIxs.filter(
  (ix) => ix.programId.toBase58() !== COMPUTE_BUDGET,
);

check("carries exactly two ComputeBudget instructions", budgetIxs.length === 2);
for (const ix of budgetIxs) {
  const data = Buffer.from(ix.data);
  if (data[0] === 2) {
    console.log(`         setComputeUnitLimit(${data.readUInt32LE(1)})`);
  } else if (data[0] === 3) {
    const price = data.readBigUInt64LE(1);
    check("compute unit price is above zero", price > 0n, `${price} microLamports/CU`);
    const limit = Buffer.from(
      budgetIxs.find((b) => Buffer.from(b.data)[0] === 2)?.data ?? [],
    );
    if (limit.length) {
      const lamports =
        (Number(price) * limit.readUInt32LE(1)) / 1_000_000;
      console.log(
        `         priority fee = ${Math.round(lamports)} lamports (${(lamports / 1e9).toFixed(6)} SOL)`,
      );
    }
  }
}

// --- The comparison that matters ---------------------------------------------
console.log("\nequivalence:");
const ktxPrints = ktxIxs.map(fingerprint);
const ourPrints = payloadIxs.map(fingerprint);

check(
  "same instruction count once ComputeBudget is set aside",
  ktxPrints.length === ourPrints.length,
  `KTX ${ktxPrints.length}, composed ${ourPrints.length}`,
);

const mismatches: string[] = [];
for (let i = 0; i < Math.max(ktxPrints.length, ourPrints.length); i++) {
  if (ktxPrints[i] !== ourPrints[i]) mismatches.push(`instruction ${i}`);
}
check(
  "every instruction identical in program, accounts and data",
  mismatches.length === 0,
  mismatches.join(", "),
);

check(
  "only the wallet is required to sign",
  ourIxs.every((ix) =>
    ix.keys.every((k) => !k.isSigner || k.pubkey.toBase58() === WALLET),
  ),
);

const blockhashValid = await conn.isBlockhashValid(composed.blockhash, {
  commitment: "confirmed",
});
check("composed blockhash is live", blockhashValid.value === true);

const height = await conn.getBlockHeight("confirmed");
check(
  "confirmation window is a full blockhash lifetime",
  composed.lastValidBlockHeight - height > 100,
  `${composed.lastValidBlockHeight - height} blocks of runway`,
);

// --- Simulation ---------------------------------------------------------------
console.log("\nsimulation:");
const [ktxSim, ourSim] = await Promise.all([
  conn.simulateTransaction(ktxTx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  }),
  conn.simulateTransaction(ourTx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  }),
]);
console.log(
  `         KTX      err=${JSON.stringify(ktxSim.value.err)} units=${ktxSim.value.unitsConsumed}`,
);
console.log(
  `         composed err=${JSON.stringify(ourSim.value.err)} units=${ourSim.value.unitsConsumed}`,
);
check(
  "both sides reach the same outcome",
  JSON.stringify(ktxSim.value.err) === JSON.stringify(ourSim.value.err),
  ourSim.value.err
    ? "both failed the same way (fund the wallet to check a live deposit)"
    : "both succeed",
);

if (!ourSim.value.err) {
  const limitIx = budgetIxs.find((b) => Buffer.from(b.data)[0] === 2);
  const limit = limitIx ? Buffer.from(limitIx.data).readUInt32LE(1) : 0;
  check(
    "requested unit limit covers measured consumption",
    !!ourSim.value.unitsConsumed && limit > ourSim.value.unitsConsumed,
    `limit ${limit} vs consumed ${ourSim.value.unitsConsumed}`,
  );
}

console.log(
  `\n${failures === 0 ? "PASS" : `FAIL (${failures})`}: Kamino deposit composition`,
);
process.exit(failures === 0 ? 0 : 1);
