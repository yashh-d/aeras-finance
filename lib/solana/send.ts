"use client";

import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, USDC_MINT } from "@/lib/jupiter/constants";
import { xstockByMint } from "@/lib/jupiter/xstocks";
import { getConnection } from "@/lib/solana/balances";
import { resolvePriorityFee } from "@/lib/solana/priority-fee";
import { checkSolRent } from "@/lib/solana/rent";

// Solana base signature fee.
const BASE_FEE_LAMPORTS = 5_000;
// Rent for a fresh associated token account (constant per Solana rent params).
const ATA_RENT_LAMPORTS = 2_039_280;
// Compute unit limits per branch. Solana charges the priority fee on the
// requested limit, not on units consumed, so these stay close to the real
// cost: a system transfer runs about 150 units, and an ATA creation plus a
// Token-2022 transferChecked stays comfortably under 60k.
const SOL_TRANSFER_CU = 5_000;
const SPL_TRANSFER_CU = 80_000;

export type SendAsset =
  | { kind: "sol" }
  | { kind: "spl"; mint: string; decimals: number };

export interface BuildSendInput {
  sender: string;
  recipient: string;
  asset: SendAsset;
  uiAmount: number;
}

export interface BuildSendResult {
  transaction: Uint8Array;
  creatingAta: boolean;
  feeEstimateLamports: number;
}

export function getProgramIdForMint(mint: string): PublicKey {
  // USDC and other legacy SPL tokens use TOKEN_PROGRAM_ID.
  if (mint === USDC_MINT) return TOKEN_PROGRAM_ID;
  // Catalog assets carry their own program. This used to return Token-2022 for
  // anything in the catalog, which was true while every entry was a Backed
  // xStock and became false when the gold tokens landed: PAXG is Token-2022 and
  // XAUt0 is classic SPL. Deriving the wrong program produces a valid-looking
  // ATA address that holds nothing, so a send would fail on a balance the user
  // can see in the wallet.
  const asset = xstockByMint(mint);
  if (asset) {
    return asset.tokenProgram === "token-2022"
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
  }
  // Default to legacy if we don't recognize the mint.
  return TOKEN_PROGRAM_ID;
}

export async function buildSendTransaction(
  input: BuildSendInput,
): Promise<BuildSendResult> {
  const conn = getConnection();
  const senderPk = new PublicKey(input.sender);
  const recipientPk = new PublicKey(input.recipient);

  const instructions = [];
  let creatingAta = false;
  let computeUnitLimit: number;
  let rentLamports = 0;

  // Resolved inside the branch so the SOL path can check rent against the
  // fee; the price is read once per build.
  let microLamports: number;

  if (input.asset.kind === "sol") {
    const lamports = Math.round(input.uiAmount * LAMPORTS_PER_SOL);
    computeUnitLimit = SOL_TRANSFER_CU;
    microLamports = await resolvePriorityFee(conn, {
      accountKeys: [input.sender, input.recipient],
      computeUnitLimit,
    });
    const feeLamports =
      BASE_FEE_LAMPORTS + priorityLamports(microLamports, computeUnitLimit);

    // One read for both sides. A missing account reads as null, which is the
    // "fresh address" case the rent floor exists for.
    const [senderInfo, recipientInfo] = await conn.getMultipleAccountsInfo([
      senderPk,
      recipientPk,
    ]);
    checkSolRent({
      lamports,
      feeLamports,
      senderLamports: senderInfo?.lamports ?? 0,
      recipientLamports: recipientInfo?.lamports ?? 0,
    });

    instructions.push(
      SystemProgram.transfer({
        fromPubkey: senderPk,
        toPubkey: recipientPk,
        lamports,
      }),
    );
  } else {
    const { mint, decimals } = input.asset;
    const mintPk = new PublicKey(mint);
    const programId = getProgramIdForMint(mint);
    const amountAtomic = BigInt(
      Math.round(input.uiAmount * Math.pow(10, decimals)),
    );

    const sourceAta = getAssociatedTokenAddressSync(
      mintPk,
      senderPk,
      false,
      programId,
    );
    const destAta = getAssociatedTokenAddressSync(
      mintPk,
      recipientPk,
      false,
      programId,
    );

    computeUnitLimit = SPL_TRANSFER_CU;
    const [destInfo, priceResolved] = await Promise.all([
      conn.getAccountInfo(destAta),
      resolvePriorityFee(conn, {
        accountKeys: [sourceAta.toBase58(), destAta.toBase58(), input.sender],
        computeUnitLimit,
      }),
    ]);
    microLamports = priceResolved;

    if (!destInfo) {
      creatingAta = true;
      rentLamports = ATA_RENT_LAMPORTS;
      instructions.push(
        createAssociatedTokenAccountInstruction(
          senderPk,
          destAta,
          recipientPk,
          mintPk,
          programId,
        ),
      );
    }
    instructions.push(
      createTransferCheckedInstruction(
        sourceAta,
        mintPk,
        destAta,
        senderPk,
        amountAtomic,
        decimals,
        [],
        programId,
      ),
    );
  }

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: senderPk,
    recentBlockhash: blockhash,
    instructions: [
      // A limit alone raises the ceiling; the PRICE is what buys a place in
      // the leader's queue. Sends used to go out at zero priority.
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      ...instructions,
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  const serialized = tx.serialize();

  return {
    transaction: serialized,
    creatingAta,
    feeEstimateLamports:
      BASE_FEE_LAMPORTS +
      priorityLamports(microLamports, computeUnitLimit) +
      rentLamports,
  };
}

// Priority fee in lamports for a bid of `microLamports` per unit at `limit`.
function priorityLamports(microLamports: number, limit: number): number {
  return Math.ceil((microLamports * limit) / 1_000_000);
}
