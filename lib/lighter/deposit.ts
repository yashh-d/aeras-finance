"use client";

// Funding a Lighter margin account from the Privy embedded Solana wallet.
//
// The address createIntentAddress hands back is a bare SPL token account, not a
// wallet: 165 bytes, owned by the token program, holding USDC on behalf of a PDA
// authority. Every other transfer in this app goes to a wallet and derives the
// associated token account from it, which is why lib/solana/send.ts cannot be
// reused here. Pointed at an intent address it would derive an ATA *of* a token
// account and deliver the USDC to an address Lighter never watches and nobody
// holds a key for. The transfer below names the destination directly and derives
// nothing.
//
// Because that destination arrives from an external API and is then paid real
// money, it is read back from chain before anything is signed: token program,
// USDC mint, initialized. An address that has been malformed, truncated in
// transit, or repurposed upstream fails here rather than after the funds moved.

import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { getConnection } from "@/lib/solana/balances";

import { toWireInteger } from "./sizing";

export type IntentAccountProblem =
  | "malformed"
  | "missing"
  | "not-a-token-account"
  | "wrong-mint"
  | "uninitialized";

export interface IntentAccountStatus {
  address: string;
  // The only field the deposit path is allowed to branch on.
  usable: boolean;
  problem?: IntentAccountProblem;
  // USDC sitting in the intent account right now. Non-zero means a deposit has
  // landed on Solana but Lighter has not yet credited the L2 balance, which is
  // the 15 to 20 minute window a user would otherwise read as lost funds.
  pendingUsdc?: string;
}

export const INTENT_PROBLEM_MESSAGE: Record<IntentAccountProblem, string> = {
  malformed: "Lighter returned a deposit address Solana cannot parse.",
  missing: "Lighter's deposit account does not exist on Solana yet.",
  "not-a-token-account":
    "Lighter's deposit address is not a token account. Funding is paused.",
  "wrong-mint": "Lighter's deposit account is not held in USDC. Funding is paused.",
  uninitialized:
    "Lighter's deposit account exists but is not initialized. Funding is paused.",
};

interface ParsedTokenAccount {
  mint?: string;
  state?: string;
  tokenAmount?: { amount?: string };
}

// Read the intent address back from chain and decide whether it can be paid.
//
// Deliberately returns a reason rather than throwing. The panel needs to explain
// why funding is unavailable, and the check script needs to assert that each bad
// shape is actually rejected.
export async function inspectIntentAccount(
  address: string,
): Promise<IntentAccountStatus> {
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(address);
  } catch {
    return { address, usable: false, problem: "malformed" };
  }

  const info = await getConnection().getParsedAccountInfo(pubkey);
  const value = info.value;
  if (!value) return { address, usable: false, problem: "missing" };

  // Owner is the program that controls the account. Anything but the token
  // program means this is a wallet, a PDA, or something else entirely, and the
  // transfer instruction below would fail or land somewhere unintended.
  if (!value.owner.equals(TOKEN_PROGRAM_ID)) {
    return { address, usable: false, problem: "not-a-token-account" };
  }

  const data = value.data;
  if (!("parsed" in data) || data.parsed?.type !== "account") {
    return { address, usable: false, problem: "not-a-token-account" };
  }

  const parsed = data.parsed.info as ParsedTokenAccount;
  if (parsed.mint !== USDC_MINT) {
    return { address, usable: false, problem: "wrong-mint" };
  }
  if (parsed.state !== "initialized") {
    return { address, usable: false, problem: "uninitialized" };
  }

  return {
    address,
    usable: true,
    pendingUsdc: parsed.tokenAmount?.amount ?? "0",
  };
}

export interface BuildLighterDepositInput {
  // The Privy embedded Solana wallet.
  sender: string;
  // Straight from createIntentAddress. Verified before use.
  intentAddress: string;
  amountUsdc: string;
}

export interface BuildLighterDepositResult {
  transaction: Uint8Array;
  amountAtomic: string;
}

// Build the USDC transfer that funds Lighter margin.
//
// Throws rather than returning a result when the destination fails inspection:
// there is no partial success worth representing, and a caller that ignored a
// soft failure here would sign away real money.
export async function buildLighterDepositTransaction(
  input: BuildLighterDepositInput,
): Promise<BuildLighterDepositResult> {
  const status = await inspectIntentAccount(input.intentAddress);
  if (!status.usable) {
    throw new Error(INTENT_PROBLEM_MESSAGE[status.problem ?? "missing"]);
  }

  const amountAtomic = toWireInteger(input.amountUsdc, USDC_DECIMALS);
  if (BigInt(amountAtomic) <= 0n) {
    throw new Error("Enter an amount to deposit.");
  }

  const senderPk = new PublicKey(input.sender);
  const mintPk = new PublicKey(USDC_MINT);
  const sourceAta = getAssociatedTokenAddressSync(
    mintPk,
    senderPk,
    false,
    TOKEN_PROGRAM_ID,
  );

  const conn = getConnection();
  const source = await conn.getTokenAccountBalance(sourceAta).catch(() => null);
  if (!source) {
    throw new Error("This wallet holds no USDC on Solana.");
  }
  if (BigInt(source.value.amount) < BigInt(amountAtomic)) {
    throw new Error("That is more USDC than this wallet holds.");
  }

  // The destination is used exactly as given. Deriving an associated token
  // address from it, the way a wallet-to-wallet send would, is the bug this
  // whole module exists to avoid.
  const instruction = createTransferCheckedInstruction(
    sourceAta,
    mintPk,
    new PublicKey(status.address),
    senderPk,
    BigInt(amountAtomic),
    USDC_DECIMALS,
    [],
    TOKEN_PROGRAM_ID,
  );

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: senderPk,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  return {
    transaction: new VersionedTransaction(message).serialize(),
    amountAtomic,
  };
}
