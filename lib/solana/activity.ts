"use client";

import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";
import { SOL_MINT, USDC_MINT } from "@/lib/jupiter/constants";
import { xstockByMint } from "@/lib/jupiter/xstocks";

export type ActivityKind =
  | "swap"
  | "send"
  | "receive"
  | "borrow"
  | "other";

export interface ActivityDelta {
  mint: string;
  symbol: string;
  deltaUi: number;
}

export interface ActivityEntry {
  signature: string;
  blockTime: number | null;
  slot: number;
  kind: ActivityKind;
  deltas: ActivityDelta[];
  succeeded: boolean;
  feeSol: number;
}

// Jupiter Lend borrow program (and its sibling refinance/flashloan programs)
// emit an inflow of the borrowed token with no offsetting outflow from the
// user, which would otherwise be misclassified as a "receive". The borrow
// program ID is the canonical Jupiter Lend Borrow program on mainnet.
const JUPITER_LEND_PROGRAM_IDS = new Set<string>([
  "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgcZmCC3ucVh",
]);

export async function fetchRecentActivity(
  walletAddress: string,
  connection: Connection,
  limit = 25,
): Promise<ActivityEntry[]> {
  const owner = new PublicKey(walletAddress);
  const sigs = await connection.getSignaturesForAddress(owner, { limit });
  if (sigs.length === 0) return [];

  const signatures = sigs.map((s) => s.signature);
  const parsed = await connection.getParsedTransactions(signatures, {
    maxSupportedTransactionVersion: 0,
  });

  const entries: ActivityEntry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const tx = parsed[i];
    const meta = sigs[i];
    if (!tx) {
      entries.push({
        signature: meta.signature,
        blockTime: meta.blockTime ?? null,
        slot: meta.slot,
        kind: "other",
        deltas: [],
        succeeded: meta.err == null,
        feeSol: 0,
      });
      continue;
    }
    entries.push(buildEntry(tx, walletAddress));
  }
  return entries;
}

function buildEntry(
  tx: ParsedTransactionWithMeta,
  walletAddress: string,
): ActivityEntry {
  const sig = tx.transaction.signatures[0];
  const blockTime = tx.blockTime ?? null;
  const slot = tx.slot;
  const succeeded = tx.meta?.err == null;
  const feeSol = (tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL;

  const deltas = computeDeltas(tx, walletAddress);
  const involvesLendProgram = txInvokesAny(tx, JUPITER_LEND_PROGRAM_IDS);
  const kind = classify(deltas, involvesLendProgram);

  return {
    signature: sig,
    blockTime,
    slot,
    kind,
    deltas,
    succeeded,
    feeSol,
  };
}

function computeDeltas(
  tx: ParsedTransactionWithMeta,
  walletAddress: string,
): ActivityDelta[] {
  const out: ActivityDelta[] = [];

  // SOL delta from native lamport balances. The wallet's account is the
  // payer at index 0 in non-versioned tx, but with v0 we use accountKeys.
  const accountKeys = tx.transaction.message.accountKeys;
  const walletIdx = accountKeys.findIndex(
    (k) => k.pubkey.toBase58() === walletAddress,
  );
  if (walletIdx >= 0 && tx.meta) {
    const pre = tx.meta.preBalances[walletIdx] ?? 0;
    const post = tx.meta.postBalances[walletIdx] ?? 0;
    const lamportsDelta = post - pre;
    if (lamportsDelta !== 0) {
      // Strip the network fee from the SOL delta so a $0 swap doesn't render as
      // "you sent 0.000005 SOL". The fee shows separately on the row.
      const feePaid = walletIdx === 0 ? (tx.meta.fee ?? 0) : 0;
      const adjusted = lamportsDelta + feePaid;
      if (adjusted !== 0) {
        out.push({
          mint: SOL_MINT,
          symbol: "SOL",
          deltaUi: adjusted / LAMPORTS_PER_SOL,
        });
      }
    }
  }

  // Token deltas (SPL + Token-2022). Each pre/post entry has owner + mint;
  // we filter to the wallet's entries and diff matching mints.
  const pre = (tx.meta?.preTokenBalances ?? []) as TokenBalance[];
  const post = (tx.meta?.postTokenBalances ?? []) as TokenBalance[];
  const byKey = new Map<
    string,
    { mint: string; preUi: number; postUi: number; decimals: number }
  >();
  function upsert(b: TokenBalance, isPost: boolean) {
    if (b.owner !== walletAddress) return;
    const key = `${b.mint}`;
    const ui = b.uiTokenAmount.uiAmount ?? 0;
    const existing = byKey.get(key);
    if (existing) {
      if (isPost) existing.postUi = ui;
      else existing.preUi = ui;
    } else {
      byKey.set(key, {
        mint: b.mint,
        preUi: isPost ? 0 : ui,
        postUi: isPost ? ui : 0,
        decimals: b.uiTokenAmount.decimals,
      });
    }
  }
  for (const b of pre) upsert(b, false);
  for (const b of post) upsert(b, true);

  for (const { mint, preUi, postUi } of byKey.values()) {
    const delta = postUi - preUi;
    if (delta === 0) continue;
    out.push({
      mint,
      symbol: resolveSymbol(mint),
      deltaUi: delta,
    });
  }

  // Stable order: largest absolute USD-ish value first by absolute amount.
  // We don't have prices here; abs delta is a serviceable proxy for "headline" amount.
  out.sort((a, b) => Math.abs(b.deltaUi) - Math.abs(a.deltaUi));
  return out;
}

function resolveSymbol(mint: string): string {
  if (mint === SOL_MINT) return "SOL";
  if (mint === USDC_MINT) return "USDC";
  const x = xstockByMint(mint);
  if (x) return x.symbol;
  return shortMint(mint);
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function classify(
  deltas: ActivityDelta[],
  involvesLendProgram: boolean,
): ActivityKind {
  // Ignore dust SOL deltas (rent + fee residue) for classification, but keep them
  // in the entry so the UI can still show fee-only txs.
  const significant = deltas.filter(
    (d) => Math.abs(d.deltaUi) > minDust(d.mint),
  );
  if (significant.length === 0) return "other";

  const positives = significant.filter((d) => d.deltaUi > 0);
  const negatives = significant.filter((d) => d.deltaUi < 0);

  if (involvesLendProgram) {
    return "borrow";
  }
  if (positives.length > 0 && negatives.length > 0) return "swap";
  if (positives.length > 0) return "receive";
  if (negatives.length > 0) return "send";
  return "other";
}

function minDust(mint: string): number {
  if (mint === SOL_MINT) return 0.00001;
  if (mint === USDC_MINT) return 0.005;
  return 0.000001;
}

function txInvokesAny(
  tx: ParsedTransactionWithMeta,
  programIds: Set<string>,
): boolean {
  const instructions = tx.transaction.message.instructions;
  for (const ix of instructions) {
    if (programIds.has(ix.programId.toBase58())) return true;
  }
  const inner = tx.meta?.innerInstructions ?? [];
  for (const group of inner) {
    for (const ix of group.instructions) {
      if (programIds.has(ix.programId.toBase58())) return true;
    }
  }
  return false;
}
