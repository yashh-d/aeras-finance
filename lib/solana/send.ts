"use client";

import {
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

// Solana base signature fee + a small priority fee buffer.
const BASE_FEE_LAMPORTS = 5_000;
// Rent for a fresh associated token account (constant per Solana rent params).
const ATA_RENT_LAMPORTS = 2_039_280;

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
  // xStocks (Backed Finance) use Token-2022.
  if (mint === USDC_MINT) return TOKEN_PROGRAM_ID;
  if (xstockByMint(mint)) return TOKEN_2022_PROGRAM_ID;
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

  if (input.asset.kind === "sol") {
    const lamports = Math.round(input.uiAmount * LAMPORTS_PER_SOL);
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

    const destInfo = await conn.getAccountInfo(destAta);
    if (!destInfo) {
      creatingAta = true;
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
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  const serialized = tx.serialize();

  return {
    transaction: serialized,
    creatingAta,
    feeEstimateLamports:
      BASE_FEE_LAMPORTS + (creatingAta ? ATA_RENT_LAMPORTS : 0),
  };
}
