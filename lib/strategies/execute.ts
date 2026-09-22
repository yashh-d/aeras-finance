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
import { fetchGliderPortfolio } from "@/lib/glider/client";
import { ensureMag7xPortfolio } from "@/lib/glider/enroll";
import { exitMag7xToSolana } from "@/lib/glider/exit";
import { executeMag7xDeposit, planMag7xDeposit } from "@/lib/glider/fund";
import {
  buildOperateTx,
  fetchLiveVaultStateViaProxy,
  fetchPositionState,
  findExistingNftId,
  getMaxSentinels,
  positionNftStorageKey,
  readStoredNftId,
  toAtomicBN,
  type UserPositionState,
  type XStockBorrowVault,
} from "@/lib/jupiter/borrow";
import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import {
  buildEarnDepositTx,
  buildEarnWithdrawTx,
  earnAssetByMint,
  fetchEarnVaultsViaProxy,
  fetchEarnWalletBalances,
  positionAssetsAtomic,
  sharesAtomic,
} from "@/lib/jupiter/earn";
import {
  buildMultiplyTx,
  buildUnwindTx,
  type SwapQuote,
} from "@/lib/jupiter/multiply";
import {
  executeUltraOrder,
  fetchUltraOrderViaProxy,
} from "@/lib/jupiter/ultra";
import type { XStock } from "@/lib/jupiter/xstocks";
import { buildKaminoBorrowTx, buildKaminoDepositTx } from "@/lib/kamino/borrow";
import {
  buildKaminoVaultTx,
  fetchKaminoPositionsViaProxy,
  fetchKaminoVaultsViaProxy,
  sharesToTokensAtomic,
  tokensToSharesAtomic,
} from "@/lib/kamino/kvaults";
import {
  buildKaminoPartialRepayTx,
  buildKaminoPartialWithdrawTx,
  buildKaminoRepayTx,
  buildKaminoWithdrawTx,
  fetchKaminoPosition,
  type KaminoPosition,
} from "@/lib/kamino/positions";
import type { KaminoCollateralReserve } from "@/lib/kamino/reserves";
import { fetchMorphoPositions } from "@/lib/morpho/client";
import {
  withdrawFromMorphoVault,
  type EvmSigner,
  type MorphoTxProgress,
} from "@/lib/morpho/deposit";
import { depositUsdcWithFunding, sendMonadUsdcToSolana } from "@/lib/morpho/fund";
import { fetchMonUsd, fetchShmonPosition } from "@/lib/shmonad/client";
import { INSTANT_EXIT_TOLERANCE_BPS } from "@/lib/shmonad/constants";
import { stakeFromSolana } from "@/lib/shmonad/fund";
import { instantCapacityShares, withTolerance } from "@/lib/shmonad/math";
import { redeemInstant } from "@/lib/shmonad/stake";
import { maxReturnableMonAtomic, sendMonToSolana } from "@/lib/shmonad/unwind";
import { fetchUniswapPositions } from "@/lib/uniswap/client";
import { depositFromSolana as depositIntoPoolFromSolana } from "@/lib/uniswap/fund";
import { exitPositionToSolana } from "@/lib/uniswap/withdraw";
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

// What a Morpho-on-Monad leg needs beyond the Solana signer: the embedded EVM
// wallet for the approve and deposit, and a Solana sign-and-send for the
// Trustware funding legs. Both come from hooks, so the ticket passes them in.
export interface MonadSigners {
  evm: EvmSigner;
  solanaSignAndSend: (base64Tx: string) => Promise<string>;
}

function toMorphoReport(onProgress?: (message: string) => void) {
  return (p: MorphoTxProgress) => onProgress?.(p.message);
}

// Put USDC into the chosen earn venue. Waits for the USDC to show in the
// wallet first, because it usually just arrived from a borrow.
export async function depositUsdcToEarn(args: {
  option: UsdcEarnOption;
  walletAddress: string;
  amountUsdc: number;
  signTx: SignTx;
  // The embedded EVM wallet and a Solana sign-and-send, for the venues that
  // settle off Solana (Morpho and shMON on Monad, Mag7X on Base).
  monad?: MonadSigners;
  // The user's eligibility statement for Bitwise Mag7X, which the server
  // refuses enrollment without. Ignored by every other venue.
  gliderAttested?: boolean;
  onProgress?: (message: string) => void;
}): Promise<{ signature: string }> {
  const { option, walletAddress, amountUsdc, signTx } = args;
  const conn = getConnection();
  const amountAtomic = toAtomicBN(amountUsdc, USDC_DECIMALS);

  args.onProgress?.("Waiting for the USDC to land in the wallet");
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

  if (option.venue === "morpho") {
    if (!option.morphoVault) throw new Error("Morpho vault record missing");
    if (!args.monad) throw new Error("The Ethereum wallet is not ready yet.");
    // Solana USDC funds the deposit: Trustware moves it to Monad, tops up MON
    // gas if the wallet has none, then the vault deposit runs. The funding
    // takes fees off the delivered side, so the deposit is sized under the
    // amount so the plan can pay for itself out of the same USDC.
    const balances = await fetchMorphoPositions(args.monad.evm.address).catch(() => null);
    const monadUsdc = balances?.usdcBalanceAtomic ?? "0";
    const mon = balances?.monBalanceAtomic ?? "0";
    const feeHeadroomBps = 400n;
    const target =
      (BigInt(deposit.toString()) * (10_000n - feeHeadroomBps)) / 10_000n +
      BigInt(monadUsdc);
    const { txHash } = await depositUsdcWithFunding({
      vault: option.morphoVault,
      amountAtomic: target,
      monadUsdcAtomic: monadUsdc,
      solanaUsdcAtomic: held.toString(),
      monBalanceAtomic: mon,
      signer: args.monad.evm,
      solana: { address: walletAddress, signAndSendBase64: args.monad.solanaSignAndSend },
      onProgress: toMorphoReport(args.onProgress),
    });
    return { signature: txHash };
  }

  if (option.venue === "shmonad") {
    if (!args.monad) throw new Error("The Ethereum wallet is not ready yet.");
    // The borrowed USDC becomes native MON on Monad through Trustware, then
    // the payable deposit stakes what arrived less the gas reserve. Fees come
    // off the delivered side, so the whole amount is sent.
    const fresh = await fetchShmonPosition(args.monad.evm.address).catch(() => null);
    const { txHash } = await stakeFromSolana({
      usdcAtomic: BigInt(deposit.toString()),
      solanaUsdcAtomic: held.toString(),
      walletMonAtomic: fresh?.walletMonAtomic ?? "0",
      sharesPerMonAtomic: fresh?.sharesPerMonAtomic ?? "0",
      signer: args.monad.evm,
      solana: { address: walletAddress, signAndSendBase64: args.monad.solanaSignAndSend },
      onProgress: toMorphoReport(args.onProgress),
    });
    return { signature: txHash };
  }

  if (option.venue === "glider") {
    // Bitwise Mag7X. The borrowed USDC goes to Base by Trustware, delivered
    // straight to the user's Glider smart account (created here on first
    // use, one EVM signature), and Glider is asked to buy the holdings. The
    // signature returned is the Solana leg's, which Solscan can show.
    if (!args.monad) throw new Error("The Ethereum wallet is not ready yet.");
    const portfolio = await ensureMag7xPortfolio({
      evm: args.monad.evm,
      attested: args.gliderAttested ?? false,
      onProgress: args.onProgress,
    });
    const plan = await planMag7xDeposit({
      amountAtomic: BigInt(deposit.toString()),
      solanaAddress: walletAddress,
      solanaUsdcAtomic: held.toString(),
      portfolio,
    });
    if (plan.kind === "blocked") throw new Error(plan.reason);
    const r = await executeMag7xDeposit({
      plan,
      solana: { address: walletAddress, signAndSendBase64: args.monad.solanaSignAndSend },
      onProgress: (p) => args.onProgress?.(p.message),
    });
    return { signature: r.txHash };
  }

  if (option.venue === "uniswap") {
    // A Uniswap liquidity pool. Trustware moves the borrowed USDC to the
    // pool's chain, buys gas there if the wallet has none, balances the two
    // sides and mints the position. The hash is an EVM one, so the step
    // reports no Solscan signature.
    if (!option.uniswapPool) throw new Error("Uniswap pool record missing");
    if (!args.monad) throw new Error("The Ethereum wallet is not ready yet.");
    const { txHash } = await depositIntoPoolFromSolana({
      pool: option.uniswapPool,
      usdcAtomic: BigInt(deposit.toString()),
      solanaUsdcAtomic: held.toString(),
      prices: {},
      signer: args.monad.evm,
      solana: { address: walletAddress, signAndSendBase64: args.monad.solanaSignAndSend },
      onProgress: toMorphoReport(args.onProgress),
    });
    return { signature: txHash };
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

// ── Sell ─────────────────────────────────────────────────────────────────────

export interface SellResult {
  signature: string;
  // USDC the wallet gained, in USDC units.
  usdcOutUi: number;
}

// Sell an asset for USDC on Jupiter Ultra and wait until the USDC shows.
export async function sellForUsdc(args: {
  walletAddress: string;
  xstock: XStock;
  amountAtomic: bigint;
  signTx: SignTx;
}): Promise<SellResult> {
  const { walletAddress, xstock, amountAtomic, signTx } = args;
  const before = await readAtaBalanceAtomic({
    mint: USDC_MINT,
    owner: walletAddress,
    programId: TOKEN_PROGRAM_ID,
  });
  const order = await fetchUltraOrderViaProxy({
    inputMint: xstock.mint,
    outputMint: USDC_MINT,
    amount: amountAtomic.toString(),
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
  const minOut =
    (BigInt(order.outAmount) * BigInt(10_000 - order.slippageBps)) / 10_000n;
  const target =
    before + (result.outputAmountResult ? BigInt(result.outputAmountResult) : minOut);
  const after = BigInt(
    await awaitTokenBalance({
      mint: USDC_MINT,
      owner: walletAddress,
      atLeastAtomic: target.toString(),
      programId: TOKEN_PROGRAM_ID,
    }),
  );
  return {
    signature: result.signature,
    usdcOutUi: Number(atomicToUiString((after - before).toString(), USDC_DECIMALS)),
  };
}

// ── Position reads ───────────────────────────────────────────────────────────

export async function readJupiterPosition(
  walletAddress: string,
  vault: XStockBorrowVault,
): Promise<UserPositionState | null> {
  const conn = getConnection();
  const nftId = await resolveJupiterNftId(walletAddress, vault, conn);
  if (!nftId) return null;
  return fetchPositionState(vault, nftId, conn);
}

export async function readKaminoPosition(
  walletAddress: string,
): Promise<KaminoPosition | null> {
  return fetchKaminoPosition(walletAddress);
}

// ── Earn withdraw ────────────────────────────────────────────────────────────

// USDC held in the earn venue, in USDC units. Zero with no position.
export async function readEarnPositionUsdc(args: {
  option: UsdcEarnOption;
  walletAddress: string;
  evmAddress?: string;
}): Promise<number> {
  const { option, walletAddress } = args;
  if (option.venue === "morpho") {
    if (!option.morphoVault || !args.evmAddress) return 0;
    const r = await fetchMorphoPositions(args.evmAddress);
    const pos = r.positions.get(option.morphoVault.address.toLowerCase());
    return pos ? Number(atomicToUiString(pos.assetsAtomic, USDC_DECIMALS)) : 0;
  }
  if (option.venue === "glider") {
    // What Glider values the portfolio at, holdings and any idle USDC. A
    // liquidation pays somewhat less: Glider's swap fee, then the leg home.
    const read = await fetchGliderPortfolio();
    return read.portfolio?.totalValueUsd ?? 0;
  }
  if (option.venue === "shmonad") {
    // What the instant exit would pay, at the MON price: the figure a close
    // can actually spend. No price means no figure, which the close treats
    // as an error rather than as an empty position.
    if (!args.evmAddress) return 0;
    const [pos, monUsd] = await Promise.all([
      fetchShmonPosition(args.evmAddress),
      fetchMonUsd(),
    ]);
    if (BigInt(pos.sharesAtomic) === 0n) return 0;
    if (monUsd == null) throw new Error("The MON price is unavailable right now. Try again shortly.");
    return (Number(pos.instantNetMonAtomic) / 1e18) * monUsd;
  }
  if (option.venue === "uniswap") {
    // What the wallet's positions in this pool are worth now, fees
    // included. A position whose value the read could not price counts as
    // nothing rather than as a guess; the close then withdraws what it can
    // and says what came back.
    if (!option.uniswapPool || !args.evmAddress) return 0;
    const { positions } = await fetchUniswapPositions();
    const poolId = option.uniswapPool.id.toLowerCase();
    return positions
      .filter(
        (p) =>
          p.chainId === option.uniswapPool!.chainId && p.poolId.toLowerCase() === poolId,
      )
      .reduce((sum, p) => sum + (p.valueUsd ?? 0) + (p.feesUsd ?? 0), 0);
  }
  if (option.venue === "jupiter") {
    const meta = earnAssetByMint(USDC_MINT);
    if (!meta) return 0;
    const [balances, vaults] = await Promise.all([
      fetchEarnWalletBalances(walletAddress, getConnection()),
      fetchEarnVaultsViaProxy(),
    ]);
    const vault = vaults.find((v) => v.assetMint === USDC_MINT);
    if (!vault) return 0;
    const shares = sharesAtomic(meta, balances);
    const atomic = positionAssetsAtomic(shares, vault, meta.decimals);
    return Number(atomicToUiString(atomic.toString(), USDC_DECIMALS));
  }
  if (!option.kaminoVault) return 0;
  const [positions, vaults] = await Promise.all([
    fetchKaminoPositionsViaProxy(walletAddress),
    fetchKaminoVaultsViaProxy(),
  ]);
  const pos = positions.get(option.kaminoVault.address);
  const state = vaults.find((v) => v.address === option.kaminoVault!.address);
  if (!pos || !state) return 0;
  const tokens = sharesToTokensAtomic(pos.totalSharesAtomic, state, option.kaminoVault);
  return Number(atomicToUiString(tokens, USDC_DECIMALS));
}

// Take USDC back out of the earn venue. Capped at what is there.
export async function withdrawUsdcFromEarn(args: {
  option: UsdcEarnOption;
  walletAddress: string;
  amountUsdc: number;
  signTx: SignTx;
  monad?: MonadSigners;
  onProgress?: (message: string) => void;
}): Promise<{ signature: string | null; withdrawnUsdc: number }> {
  const { option, walletAddress, amountUsdc, signTx } = args;
  const conn = getConnection();
  const held = await readEarnPositionUsdc({
    option,
    walletAddress,
    evmAddress: args.monad?.evm.address,
  });
  const amount = Math.min(amountUsdc, held);
  if (amount <= 0) return { signature: null, withdrawnUsdc: 0 };
  const amountAtomic = toAtomicBN(amount, USDC_DECIMALS);

  if (option.venue === "glider") {
    // Whole position only. Glider's liquidate-all sells every holding to
    // USDC on Base; a partial in-kind withdrawal would strand a Coinbase
    // tokenized stock in the EVM wallet with no route home. The USDC then
    // comes back to Solana through lib/glider/exit.ts, buying a little Base
    // ETH for gas on the way when the wallet has none.
    if (!args.monad) throw new Error("The Ethereum wallet is not ready yet.");
    const read = await fetchGliderPortfolio();
    const r = await exitMag7xToSolana({
      evm: args.monad.evm,
      solana: { address: walletAddress, signAndSendBase64: args.monad.solanaSignAndSend },
      hasHoldings: (read.portfolio?.totalValueUsd ?? 0) - (read.portfolio?.idleUsdc ?? 0) > 1,
      onProgress: (p) => args.onProgress?.(p.message),
    });
    const delivered = r.deliveredAtomic ?? r.returnedAtomic;
    return { signature: null, withdrawnUsdc: Number(delivered) / 10 ** USDC_DECIMALS };
  }

  if (option.venue === "uniswap") {
    // Whole positions only. A liquidity position is a range, not a balance:
    // taking part of one leaves a smaller range in the same place rather
    // than freeing a chosen number of dollars, so a partial withdrawal
    // cannot be sized to a repayment. Every position in the pool is closed
    // and both sides come home as USDC.
    if (!option.uniswapPool) throw new Error("Uniswap pool record missing");
    if (!args.monad) throw new Error("The Ethereum wallet is not ready yet.");
    const pool = option.uniswapPool;
    const { positions } = await fetchUniswapPositions();
    const mine = positions.filter(
      (p) => p.chainId === pool.chainId && p.poolId.toLowerCase() === pool.id.toLowerCase(),
    );
    if (mine.length === 0) return { signature: null, withdrawnUsdc: 0 };
    let delivered = 0n;
    for (const position of mine) {
      const r = await exitPositionToSolana({
        pool,
        position,
        evm: args.monad.evm,
        solanaAddress: walletAddress,
        onProgress: toMorphoReport(args.onProgress),
      });
      delivered += r.deliveredAtomic;
    }
    return { signature: null, withdrawnUsdc: Number(delivered) / 10 ** USDC_DECIMALS };
  }

  if (option.venue === "shmonad") {
    if (!args.monad) throw new Error("The Ethereum wallet is not ready yet.");
    const report = toMorphoReport(args.onProgress);
    const evm = args.monad.evm;
    const pos = await fetchShmonPosition(evm.address);
    const shares = BigInt(pos.sharesAtomic);
    const before = BigInt(pos.walletMonAtomic);
    let redeemed = 0n;
    if (shares > 0n) {
      // The slice of the position the ask needs, as shares; everything when
      // the ask covers it, so no dust is left.
      const wantAll = amount >= held - 0.01;
      const want = wantAll
        ? shares
        : (shares * BigInt(Math.round((amount / held) * 1_000_000))) / 1_000_000n;
      const cap = instantCapacityShares(
        shares,
        BigInt(pos.poolAvailableMonAtomic),
        BigInt(pos.rateAtomic),
      );
      if (want > cap) {
        throw new Error(
          "The instant exit pool cannot pay this position right now. Queue an unstake " +
            "from the Earn tab and close once the MON has arrived.",
        );
      }
      const net = (BigInt(pos.instantNetMonAtomic) * want) / shares;
      await redeemInstant({
        sharesAtomic: want,
        minMonAtomic: withTolerance(net, INSTANT_EXIT_TOLERANCE_BPS),
        walletMonAtomic: BigInt(pos.walletMonAtomic),
        signer: evm,
        onProgress: report,
      });
      const after = await fetchShmonPosition(evm.address);
      redeemed = BigInt(after.walletMonAtomic) - before;
      pos.walletMonAtomic = after.walletMonAtomic;
    }
    // Then the leg home. With no shares left (a close retried after a queued
    // exit completed), the wallet's MON beyond the reserve is what goes.
    const returnable = maxReturnableMonAtomic(pos.walletMonAtomic);
    const send = shares > 0n && redeemed > 0n && redeemed < returnable ? redeemed : returnable;
    if (send <= 0n) return { signature: null, withdrawnUsdc: 0 };
    const { deliveredAtomic } = await sendMonToSolana({
      monAtomic: send,
      walletMonAtomic: pos.walletMonAtomic,
      evm,
      solanaAddress: walletAddress,
      onProgress: report,
    });
    return {
      signature: null,
      withdrawnUsdc: deliveredAtomic
        ? Number(atomicToUiString(deliveredAtomic, USDC_DECIMALS))
        : amount,
    };
  }

  if (option.venue === "morpho") {
    if (!option.morphoVault) throw new Error("Morpho vault record missing");
    if (!args.monad) throw new Error("The Ethereum wallet is not ready yet.");
    const report = toMorphoReport(args.onProgress);
    // Take everything when the ask covers the position, so no dust is left.
    const redeemAll = amount >= held - 0.01;
    await withdrawFromMorphoVault({
      vault: option.morphoVault,
      amountAtomic: BigInt(amountAtomic.toString()),
      redeemAll,
      signer: args.monad.evm,
      onProgress: report,
    });
    // Then the leg home, so the repay can spend it on Solana.
    const balances = await fetchMorphoPositions(args.monad.evm.address);
    const onMonad = BigInt(balances.usdcBalanceAtomic);
    const send = onMonad < BigInt(amountAtomic.toString()) ? onMonad : BigInt(amountAtomic.toString());
    const { deliveredAtomic } = await sendMonadUsdcToSolana({
      amountAtomic: send,
      monadUsdcAtomic: balances.usdcBalanceAtomic,
      monBalanceAtomic: balances.monBalanceAtomic,
      evm: args.monad.evm,
      solanaAddress: walletAddress,
      onProgress: report,
    });
    return {
      signature: null,
      withdrawnUsdc: deliveredAtomic
        ? Number(atomicToUiString(deliveredAtomic, USDC_DECIMALS))
        : amount,
    };
  }

  if (option.venue === "jupiter") {
    const meta = earnAssetByMint(USDC_MINT);
    if (!meta) throw new Error("USDC is not an earn asset");
    const built = await buildEarnWithdrawTx({
      meta,
      amountAtomic,
      signerAddress: walletAddress,
      connection: conn,
    });
    const signature = await signAndSend(signTx, built.transaction, built);
    return { signature, withdrawnUsdc: amount };
  }

  if (!option.kaminoVault) throw new Error("Kamino vault record missing");
  const vaults = await fetchKaminoVaultsViaProxy();
  const state = vaults.find((v) => v.address === option.kaminoVault!.address);
  const shares = tokensToSharesAtomic(amountAtomic.toString(), state, option.kaminoVault);
  if (shares === "0") throw new Error("Amount rounds to zero shares.");
  const built = await buildKaminoVaultTx({
    action: "withdraw",
    walletAddress,
    vault: option.kaminoVault,
    amountAtomic: shares,
    connection: conn,
  });
  const signature = await signAndSend(signTx, built.transaction, built);
  return { signature, withdrawnUsdc: amount };
}

// ── Repay and withdraw ───────────────────────────────────────────────────────

export type RepayAmount = { kind: "all" } | { kind: "usdc"; amount: number };
export type WithdrawAmount = { kind: "all" } | { kind: "atomic"; amount: bigint };

// Interest accrues between the read and the signature. A full repay is padded
// by this much; both venues cap the overshoot at the real debt.
const FULL_REPAY_PAD = 1.005;

// Pay down debt and take collateral back at the route's venue. One signature
// on Jupiter, two on Kamino. Waits for the USDC the repay needs to show in
// the wallet, because it usually just arrived from a sale or an earn withdraw.
export async function repayAndWithdraw(args: {
  route: BorrowRoute;
  walletAddress: string;
  repay: RepayAmount;
  withdraw: WithdrawAmount;
  signTx: SignTx;
  onProgress?: (message: string) => void;
}): Promise<{ signatures: string[] }> {
  const { route, walletAddress, repay, withdraw, signTx } = args;
  const conn = getConnection();

  if (route.vault) {
    const vault = route.vault;
    const position = await readJupiterPosition(walletAddress, vault);
    if (!position) throw new Error(`No ${vault.collateralSymbol} position found.`);
    const debtUi = Number(atomicToUiString(position.debtAtomic.toString(), vault.borrowDecimals));
    const needUsdc =
      repay.kind === "all" ? debtUi * FULL_REPAY_PAD : Math.min(repay.amount, debtUi);
    if (needUsdc > 0) {
      args.onProgress?.(`Waiting for ${needUsdc.toFixed(2)} USDC in the wallet`);
      const held = Number(
        atomicToUiString(
          await awaitTokenBalance({
            mint: USDC_MINT,
            owner: walletAddress,
            atLeastAtomic: toAtomicBN(needUsdc, USDC_DECIMALS).toString(),
            programId: TOKEN_PROGRAM_ID,
            timeoutMs: 30_000,
          }),
          USDC_DECIMALS,
        ),
      );
      if (held + 0.000001 < needUsdc) {
        throw new Error(
          `Repaying needs ${needUsdc.toFixed(2)} USDC and the wallet holds ${held.toFixed(2)}. Add USDC and retry.`,
        );
      }
    }
    const { maxRepay, maxWithdraw } = await getMaxSentinels();
    const debtDelta =
      repay.kind === "all"
        ? position.debtAtomic.isZero()
          ? new BN(0)
          : maxRepay
        : toAtomicBN(needUsdc, vault.borrowDecimals).neg();
    const colDelta =
      withdraw.kind === "all"
        ? position.collateralAtomic.isZero()
          ? new BN(0)
          : maxWithdraw
        : BN.min(new BN(withdraw.amount.toString()), position.collateralAtomic).neg();
    args.onProgress?.(`Repaying and withdrawing ${vault.collateralSymbol}`);
    const { base64Tx } = await buildOperateTx({
      vaultId: vault.vaultId,
      positionId: position.nftId,
      collateralDeltaAtomic: colDelta,
      debtDeltaAtomic: debtDelta,
      signerAddress: walletAddress,
      connection: conn,
    });
    return { signatures: [await signAndSend(signTx, base64Tx)] };
  }

  if (route.reserve) {
    const collateral = route.reserve;
    const position = await readKaminoPosition(walletAddress);
    if (!position) throw new Error("No Kamino position found.");
    const signatures: string[] = [];
    const needUsdc =
      repay.kind === "all"
        ? position.debtUsdc * FULL_REPAY_PAD
        : Math.min(repay.amount, position.debtUsdc);
    if (needUsdc > 0) {
      args.onProgress?.(`Waiting for ${needUsdc.toFixed(2)} USDC in the wallet`);
      await awaitTokenBalance({
        mint: USDC_MINT,
        owner: walletAddress,
        atLeastAtomic: toAtomicBN(needUsdc, USDC_DECIMALS).toString(),
        programId: TOKEN_PROGRAM_ID,
        timeoutMs: 30_000,
      });
      args.onProgress?.("Repaying USDC on Kamino");
      const tx =
        repay.kind === "all"
          ? await buildKaminoRepayTx(walletAddress, position.debtUsdc)
          : await buildKaminoPartialRepayTx(walletAddress, needUsdc);
      signatures.push(await signAndSend(signTx, tx));
    }
    args.onProgress?.(`Withdrawing ${collateral.symbol} from Kamino`);
    const tx =
      withdraw.kind === "all"
        ? await buildKaminoWithdrawTx(walletAddress, position)
        : await buildKaminoPartialWithdrawTx(
            walletAddress,
            collateral,
            withdraw.amount.toString(),
          );
    signatures.push(await signAndSend(signTx, tx));
    return { signatures };
  }

  throw new Error(`No borrow venue for ${route.collateralSymbol}`);
}

// ── Unwind leverage ──────────────────────────────────────────────────────────

// Close a leveraged Jupiter position in one transaction: flashloan the
// collateral, sell enough to cover the debt, repay, withdraw the rest.
export async function closeLeverage(args: {
  vault: XStockBorrowVault;
  walletAddress: string;
  slippageBps: number;
  signTx: SignTx;
}): Promise<{ signature: string }> {
  const { vault, walletAddress, slippageBps, signTx } = args;
  const conn = getConnection();
  const position = await readJupiterPosition(walletAddress, vault);
  if (!position || (position.collateralAtomic.isZero() && position.debtAtomic.isZero())) {
    throw new Error(`No open ${vault.collateralSymbol} position to close.`);
  }
  const live = await fetchLiveVaultStateViaProxy(vault.vaultId);
  const { base64Tx } = await buildUnwindTx({
    vault,
    positionId: position.nftId,
    collateralAtomic: position.collateralAtomic,
    debtAtomic: position.debtAtomic,
    oraclePriceUsd: live.oraclePriceUsd,
    signerAddress: walletAddress,
    connection: conn,
    slippageBps,
  });
  return { signature: await signAndSend(signTx, base64Tx) };
}
