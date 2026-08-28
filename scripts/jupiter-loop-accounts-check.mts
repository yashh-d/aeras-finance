// Live check for the account-lock budget on the leveraged looping path.
//
//   npx tsx scripts/jupiter-loop-accounts-check.mts [walletAddress] [borrowUsdc]
//
// Opening a loop failed in production with "Transaction locked too many
// accounts" and empty logs. Solana locks at most 64 accounts per transaction
// (MAX_TX_ACCOUNT_LOCKS), and address lookup tables do not help: an ALT shrinks
// the message bytes, but every address it resolves is still locked. The loop
// packs a flashloan borrow, a Jupiter swap route, a Lend vault operate and a
// flashloan payback into one transaction, and Jupiter's `maxAccounts` defaults
// to 64 — so the swap alone could claim the entire budget before the Lend
// instructions were added.
//
// This measures the real numbers against mainnet: what the route costs
// unbudgeted, what the Lend side costs, and whether the budgeted build fits.
// It builds and counts only. Nothing is signed or sent.

import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { readFileSync } from "node:fs";

import { XSTOCK_BORROW_VAULTS } from "../lib/jupiter/borrow";

const MAX_TX_ACCOUNT_LOCKS = 64;
const COMPUTE_UNIT_LIMIT = 1_400_000;
const LITE = "https://lite-api.jup.ag/swap/v1";

// Mirrors the constants in lib/jupiter/multiply.ts.
const SWAP_ACCOUNT_BUDGET = 28;
const MIN_SWAP_ACCOUNT_BUDGET = 16;

const WALLET = process.argv[2] ?? "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
// Defaults to roughly the size in the bug report: ~$10 of TSLAx at 2.5x.
const BORROW_USDC = Number(process.argv[3] ?? 15);
const VAULT = XSTOCK_BORROW_VAULTS.find((v) => v.collateralSymbol === "TSLAx")!;

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
  const url = env.match(/^NEXT_PUBLIC_SOLANA_RPC_URL=(.*)$/m)?.[1]?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not set");
  return url;
}

interface JupIx {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string;
}

function toIx(ix: JupIx): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

async function alts(
  connection: Connection,
  keys: string[],
): Promise<AddressLookupTableAccount[]> {
  if (!keys?.length) return [];
  const infos = await connection.getMultipleAccountsInfo(
    keys.map((k) => new PublicKey(k)),
  );
  const out: AddressLookupTableAccount[] = [];
  infos.forEach((info, i) => {
    if (info) {
      out.push(
        new AddressLookupTableAccount({
          key: new PublicKey(keys[i]),
          state: AddressLookupTableAccount.deserialize(info.data),
        }),
      );
    }
  });
  return out;
}

function countLocked(message: {
  staticAccountKeys: unknown[];
  addressTableLookups: { writableIndexes: number[]; readonlyIndexes: number[] }[];
}): number {
  return message.addressTableLookups.reduce(
    (t, l) => t + l.writableIndexes.length + l.readonlyIndexes.length,
    message.staticAccountKeys.length,
  );
}

async function quote(amountAtomic: string, maxAccounts?: number) {
  const url = new URL(`${LITE}/quote`);
  url.searchParams.set("inputMint", VAULT.borrowMint);
  url.searchParams.set("outputMint", VAULT.collateralMint);
  url.searchParams.set("amount", amountAtomic);
  url.searchParams.set("slippageBps", "100");
  if (maxAccounts != null) url.searchParams.set("maxAccounts", String(maxAccounts));
  const res = await fetch(url.toString());
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body?.error ?? `quote ${res.status}`);
  return body;
}

async function swapIxs(quoteResponse: unknown) {
  const res = await fetch(`${LITE}/swap-instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse, userPublicKey: WALLET }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body?.error ?? `swap-ix ${res.status}`);
  return body;
}

// Assemble the loop exactly as lib/jupiter/multiply.ts does and report the lock
// count, so the number here is the number the runtime would enforce.
async function build(connection: Connection, maxAccounts?: number) {
  const { getFlashBorrowIx, getFlashPaybackIx } = await import(
    "@jup-ag/lend/flashloan"
  );
  const { getOperateIx } = await import("@jup-ag/lend/borrow");

  const signer = new PublicKey(WALLET);
  const borrowAtomic = new BN(Math.round(BORROW_USDC * 10 ** VAULT.borrowDecimals));

  const flashParams = {
    connection,
    signer,
    asset: new PublicKey(VAULT.borrowMint),
    amount: borrowAtomic,
  };
  const [flashBorrowIx, flashPaybackIx] = await Promise.all([
    getFlashBorrowIx(flashParams),
    getFlashPaybackIx(flashParams),
  ]);

  const q = await quote(borrowAtomic.toString(), maxAccounts);
  const swapRes = await swapIxs(q);
  const swap = toIx(swapRes.swapInstruction);
  const setup = (swapRes.setupInstructions ?? []).map(toIx);

  const { ixs: operateIxs, addressLookupTableAccounts } = await getOperateIx({
    vaultId: VAULT.vaultId,
    positionId: 0,
    colAmount: new BN(q.otherAmountThreshold),
    debtAmount: borrowAtomic,
    connection,
    signer,
  });

  const allAlts = [
    ...(addressLookupTableAccounts ?? []),
    ...(await alts(connection, swapRes.addressLookupTableAddresses ?? [])),
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
      flashBorrowIx,
      ...setup,
      swap,
      ...operateIxs,
      flashPaybackIx,
    ],
  }).compileToV0Message(allAlts);

  // The Lend half on its own, to show how much of the budget is not the swap's
  // to spend.
  const lendOnly = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
      flashBorrowIx,
      ...operateIxs,
      flashPaybackIx,
    ],
  }).compileToV0Message(addressLookupTableAccounts ?? []);

  return {
    locked: countLocked(message),
    lendLocked: countLocked(lendOnly),
    hops: q.routePlan?.length ?? 0,
    bytes: new VersionedTransaction(message).serialize().length,
    outAmount: q.outAmount,
  };
}

async function main() {
  const connection = new Connection(rpcUrl(), "confirmed");
  console.log(
    `\nLoop account-lock check -- ${VAULT.collateralSymbol}, borrow $${BORROW_USDC}\n`,
  );

  const before = await build(connection);
  console.log(
    `unbudgeted: ${before.locked} locked (${before.hops} hop(s), ${before.bytes} bytes), Lend side alone ${before.lendLocked}`,
  );

  // Not an assertion. Whether the unbudgeted route overflows depends on which
  // pools Jupiter picks this minute: a single-hop route fits comfortably, and
  // the production failure came from a busier one. What matters is the
  // headroom, because that is what a more complex route has to fit inside.
  const headroom = MAX_TX_ACCOUNT_LOCKS - before.lendLocked;
  console.log(
    `Lend half takes ${before.lendLocked} of ${MAX_TX_ACCOUNT_LOCKS}, leaving ${headroom} net-new for the swap` +
      (before.locked > MAX_TX_ACCOUNT_LOCKS
        ? "  <-- unbudgeted route overflows right now"
        : ""),
  );
  check(
    "Lend half leaves room for a swap at all",
    headroom >= MIN_SWAP_ACCOUNT_BUDGET,
    `${headroom} accounts`,
  );

  const after = await build(connection, SWAP_ACCOUNT_BUDGET);
  console.log(
    `maxAccounts=${SWAP_ACCOUNT_BUDGET}: ${after.locked} locked (${after.hops} hop(s), ${after.bytes} bytes)`,
  );
  check(
    `budgeted build fits under ${MAX_TX_ACCOUNT_LOCKS}`,
    after.locked <= MAX_TX_ACCOUNT_LOCKS,
    `${after.locked} locked`,
  );
  check(
    "budgeted route still prices",
    Number(after.outAmount) > 0,
    `out ${after.outAmount}`,
  );

  const slip =
    (Number(before.outAmount) - Number(after.outAmount)) /
    Number(before.outAmount);
  console.log(
    `\npricing cost of the budget: ${(slip * 100).toFixed(3)}% vs the unbudgeted route`,
  );

  console.log(
    failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
