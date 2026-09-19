"use client";

// The on-chain legs a strategy is assembled from. Each function does one
// signed thing and returns what landed, so a ticket can chain them into steps
// and a failed step can be retried without redoing the ones before it.
//
// Every leg reads the wallet's real balance before it acts rather than
// trusting the previous leg's quote: a swap delivers somewhere between the
// quoted and the guaranteed-minimum output, and the RPC a deposit simulates
// against can lag the swap's own confirmation by a few slots. Sizing off the
// quote once produced a deposit for more than the wallet held.

import BN from "bn.js";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import type { BorrowRoute } from "@/lib/borrow/route";
import {
  buildOperateTx,
  findExistingNftId,
  positionNftStorageKey,
  readStoredNftId,
  toAtomicBN,
  type XStockBorrowVault,
} from "@/lib/jupiter/borrow";
import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { buildEarnDepositTx, earnAssetByMint } from "@/lib/jupiter/earn";
import { buildMultiplyTx, type SwapQuote } from "@/lib/jupiter/multiply";
import {
  executeUltraOrder,
  fetchUltraOrderViaProxy,
} from "@/lib/jupiter/ultra";
import type { XStock } from "@/lib/jupiter/xstocks";
import { buildKaminoBorrowTx, buildKaminoDepositTx } from "@/lib/kamino/borrow";
import { buildKaminoVaultTx } from "@/lib/kamino/kvaults";
import type { KaminoCollateralReserve } from "@/lib/kamino/reserves";
import { awaitTokenBalance } from "@/lib/solana/await-balance";
import { atomicToUiString, getConnection } from "@/lib/solana/balances";
import {
  SolanaSendError,
  sendAndConfirm,
  type ConfirmWindow,
} from "@/lib/solana/send-confirm";

import type { UsdcEarnOption } from "./rates";

// Signs a base64 transaction and hands back the signed bytes as base64. The
// shape useSignSolanaTxBase64 returns; passed in so this file stays hook-free.
export type SignTx = (b64Tx: string) => Promise<string>;

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function tokenProgramFor(xstock: XStock): PublicKey {
  return xstock.tokenProgram === "token-2022"
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

// Exact ATA balance in atomic units. Zero for an account that does not exist
// yet, which is the state of every asset the wallet has never held.
export async function readAtaBalanceAtomic(args: {
  mint: string;
  owner: string;
  programId: PublicKey;
  connection?: Connection;
}): Promise<bigint> {
  const conn = args.connection ?? getConnection();
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(args.mint),
    new PublicKey(args.owner),
    false,
    args.programId,
  );
  try {
    const res = await conn.getTokenAccountBalance(ata, "processed");
    return BigInt(res.value.amount);
  } catch {
    return 0n;
  }
}

async function signAndSend(
  signTx: SignTx,
  b64Tx: string,
  window?: ConfirmWindow,
): Promise<string> {
  const signed = await signTx(b64Tx);
  return sendAndConfirm(getConnection(), base64ToBytes(signed), window);
}

// ── Buy ──────────────────────────────────────────────────────────────────────

export interface BuyResult {
  signature: string;
  // What the wallet actually gained, in the asset's atomic units.
  boughtAtomic: bigint;
  boughtUi: number;
  // USD the order was priced at, from Ultra's own valuation of the output.
  outUsdValue: number;
}

// Buy an asset with USDC on Jupiter Ultra and wait until the wallet shows it.
export async function buyWithUsdc(args: {
  walletAddress: string;
  xstock: XStock;
  usdcAtomic: bigint;
  signTx: SignTx;
}): Promise<BuyResult> {
  const { walletAddress, xstock, usdcAtomic, signTx } = args;
  const programId = tokenProgramFor(xstock);
  const before = await readAtaBalanceAtomic({
    mint: xstock.mint,
    owner: walletAddress,
    programId,
  });

  const order = await fetchUltraOrderViaProxy({
    inputMint: USDC_MINT,
    outputMint: xstock.mint,
    amount: usdcAtomic.toString(),
    taker: walletAddress,
  });
  if (order.error || order.errorMessage) {
    throw new Error(order.errorMessage ?? order.error ?? "Quote failed");
  }
  if (!order.transaction || !order.requestId) {
    throw new Error("Quote missing transaction or requestId");
  }

  const signed = await signTx(order.transaction);
  const result = await executeUltraOrder({
    signedTransaction: signed,
    requestId: order.requestId,
  });
  if (result.status !== "Success" || !result.signature) {
    throw new Error(result.error ?? "Swap failed");
  }

  // The swap's guaranteed floor, which is what to wait for. Ultra reports the
  // real output in `outputAmountResult`, but the RPC has to show it before the
  // next leg can spend it, so the wait happens either way.
  const minOut =
    (BigInt(order.outAmount) * BigInt(10_000 - order.slippageBps)) / 10_000n;
  const target = before + (result.outputAmountResult
    ? BigInt(result.outputAmountResult)
    : minOut);
  const after = BigInt(
    await awaitTokenBalance({
      mint: xstock.mint,
      owner: walletAddress,
      atLeastAtomic: target.toString(),
      programId,
    }),
  );
  const boughtAtomic = after - before;
  if (boughtAtomic <= 0n) {
    throw new Error(
      `The swap confirmed (${result.signature}) but the ${xstock.symbol} has not shown up in the wallet yet. Refresh and try the next step again.`,
    );
  }
  return {
    signature: result.signature,
    boughtAtomic,
    boughtUi: Number(atomicToUiString(boughtAtomic.toString(), xstock.decimals)),
    outUsdValue: order.outUsdValue,
  };
}

// ── Collateralise and borrow ─────────────────────────────────────────────────

// The position-NFT id to operate on: the stored binding, else a wallet scan,
// else 0 to mint a new one. Mirrors what the borrow card and looping panel do.
export async function resolveJupiterNftId(
  walletAddress: string,
  vault: XStockBorrowVault,
  connection: Connection,
): Promise<number> {
  const stored = readStoredNftId(walletAddress, vault.vaultId);
  if (stored != null) return stored;
  const found = await findExistingNftId(walletAddress, vault, connection);
  return found ?? 0;
}

export function persistJupiterNftId(
  walletAddress: string,
  vaultId: number,
  nftId: number,
): void {
  try {
    localStorage.setItem(positionNftStorageKey(walletAddress, vaultId), String(nftId));
  } catch {}
}

export interface DepositBorrowResult {
  signatures: string[];
  nftId?: number;
}

// Post the asset and draw USDC against it at the route's venue. One signature
// on Jupiter (deposit and borrow share an operate call), two on Kamino.
export async function depositAndBorrow(args: {
  route: BorrowRoute;
  walletAddress: string;
  collateralAtomic: bigint;
  borrowUsdc: number;
  signTx: SignTx;
  onProgress?: (message: string) => void;
}): Promise<DepositBorrowResult> {
  const { route, walletAddress, collateralAtomic, borrowUsdc, signTx } = args;
  const conn = getConnection();

  if (route.vault) {
    const vault = route.vault;
    args.onProgress?.(`Depositing ${vault.collateralSymbol} and borrowing USDC`);
    const positionId = await resolveJupiterNftId(walletAddress, vault, conn);
    const { base64Tx, nftId } = await buildOperateTx({
      vaultId: vault.vaultId,
      positionId,
      collateralDeltaAtomic: new BN(collateralAtomic.toString()),
      debtDeltaAtomic:
        borrowUsdc > 0 ? toAtomicBN(borrowUsdc, vault.borrowDecimals) : new BN(0),
      signerAddress: walletAddress,
      connection: conn,
    });
    const signature = await signAndSend(signTx, base64Tx);
    const finalNft = nftId ?? positionId;
    if (finalNft) persistJupiterNftId(walletAddress, vault.vaultId, finalNft);
    return { signatures: [signature], nftId: finalNft };
  }

  if (route.reserve) {
    return kaminoDepositAndBorrow({
      collateral: route.reserve,
      walletAddress,
      collateralAtomic,
      borrowUsdc,
      signTx,
      onProgress: args.onProgress,
    });
  }

  throw new Error(`No borrow venue for ${route.collateralSymbol}`);
}

async function kaminoDepositAndBorrow(args: {
  collateral: KaminoCollateralReserve;
  walletAddress: string;
  collateralAtomic: bigint;
  borrowUsdc: number;
  signTx: SignTx;
  onProgress?: (message: string) => void;
}): Promise<DepositBorrowResult> {
  const { collateral, walletAddress, collateralAtomic, borrowUsdc, signTx } = args;
  const signatures: string[] = [];

  args.onProgress?.(`Depositing ${collateral.symbol} on Kamino`);
  const depTx = await buildKaminoDepositTx({
    walletAddress,
    collateral,
    // KTX takes a decimal amount and scales it itself.
    collateralUi: Number(
      atomicToUiString(collateralAtomic.toString(), collateral.decimals),
    ),
  });
  signatures.push(await signAndSend(signTx, depTx));

  if (borrowUsdc > 0) {
    args.onProgress?.("Borrowing USDC on Kamino");
    const borrowTx = await buildKaminoBorrowTx({ walletAddress, borrowUi: borrowUsdc });
    signatures.push(await signAndSend(signTx, borrowTx));
  }
  return { signatures };
}

// ── Earn ─────────────────────────────────────────────────────────────────────

// Put USDC into the chosen earn venue. Waits for the USDC to show in the
// wallet first, because it usually just arrived from a borrow.
export async function depositUsdcToEarn(args: {
  option: UsdcEarnOption;
  walletAddress: string;
  amountUsdc: number;
  signTx: SignTx;
}): Promise<{ signature: string }> {
  const { option, walletAddress, amountUsdc, signTx } = args;
  const conn = getConnection();
  const amountAtomic = toAtomicBN(amountUsdc, USDC_DECIMALS);

  const held = BigInt(
    await awaitTokenBalance({
      mint: USDC_MINT,
      owner: walletAddress,
      atLeastAtomic: amountAtomic.toString(),
      programId: TOKEN_PROGRAM_ID,
      timeoutMs: 30_000,
    }),
  );
  // Deposit what is there, up to the target. A few atomic units short is a
  // rounding artefact, not a reason to fail the strategy at its last step.
  const deposit = BN.min(amountAtomic, new BN(held.toString()));
  if (deposit.lten(0)) {
    throw new Error("No USDC in the wallet to deposit.");
  }

  if (option.venue === "jupiter") {
    const meta = earnAssetByMint(USDC_MINT);
    if (!meta) throw new Error("USDC is not an earn asset");
    const built = await buildEarnDepositTx({
      meta,
      amountAtomic: deposit,
      signerAddress: walletAddress,
      connection: conn,
    });
    return { signature: await signAndSend(signTx, built.transaction, built) };
  }

  if (!option.kaminoVault) throw new Error("Kamino vault record missing");
  if (new BN(option.kaminoVault.minDepositAtomic).gt(deposit)) {
    throw new Error(
      `Kamino's minimum deposit is ${atomicToUiString(option.kaminoVault.minDepositAtomic, USDC_DECIMALS)} USDC.`,
    );
  }
  const built = await buildKaminoVaultTx({
    action: "deposit",
    walletAddress,
    vault: option.kaminoVault,
    amountAtomic: deposit.toString(),
    connection: conn,
  });
  return { signature: await signAndSend(signTx, built.transaction, built) };
}

// ── Leverage ─────────────────────────────────────────────────────────────────

export interface LeverageResult {
  signature: string;
  nftId: number | undefined;
  quote: SwapQuote;
}

// One atomic transaction: flashloan the whole exposure, swap it into the
// asset, deposit, borrow the leveraged share, pay the flashloan back from the
// borrow plus the user's USDC.
export async function openLeverageFromUsdc(args: {
  vault: XStockBorrowVault;
  walletAddress: string;
  equityUsdc: number;
  borrowUsdc: number;
  slippageBps: number;
  signTx: SignTx;
}): Promise<LeverageResult> {
  const { vault, walletAddress, equityUsdc, borrowUsdc, slippageBps, signTx } = args;
  const conn = getConnection();
  const positionId = await resolveJupiterNftId(walletAddress, vault, conn);
  const { base64Tx, nftId, quote } = await buildMultiplyTx({
    vault,
    positionId,
    initialCollateralAtomic: new BN(0),
    borrowUsdcAtomic: toAtomicBN(borrowUsdc, vault.borrowDecimals),
    equityUsdcAtomic: toAtomicBN(equityUsdc, USDC_DECIMALS),
    signerAddress: walletAddress,
    connection: conn,
    slippageBps,
  });
  const signature = await signAndSend(signTx, base64Tx);
  const finalNft = nftId ?? (positionId || undefined);
  if (finalNft) persistJupiterNftId(walletAddress, vault.vaultId, finalNft);
  return { signature, nftId: finalNft, quote };
}

// ── Errors ───────────────────────────────────────────────────────────────────

// Same phrasing the looping panel uses, so a failure reads the same on both.
export function readableStrategyError(err: unknown): string {
  if (
    err instanceof SolanaSendError &&
    (err.kind === "expired" || err.kind === "unknown")
  ) {
    return err.message;
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (/insufficient funds|0x1\b/i.test(raw)) {
    return "Not enough balance to cover this step plus fees.";
  }
  if (/slippage|0x1771|exceeded/i.test(raw)) {
    return "Price moved past the slippage limit. Try again.";
  }
  if (/blockhash not found|block height exceeded/i.test(raw)) {
    return "The transaction expired before it landed. Try again.";
  }
  if (/User rejected|declined|denied/i.test(raw)) {
    return "Signature request was declined.";
  }
  return raw;
}
