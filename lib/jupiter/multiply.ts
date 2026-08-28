import BN from "bn.js";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

import { toAtomicBN, type XStockBorrowVault } from "./borrow";

// Leveraged looping ("multiply") and deleveraging ("unwind") for the xStock →
// USDC borrow vaults. Both compose a Jupiter Lend flashloan, a Jupiter Lite
// swap, and a vault operate call into a single atomic transaction:
//
//   Multiply: flashloan USDC → swap USDC→xStock → deposit all xStock + borrow
//             USDC → repay flashloan.
//   Unwind:   flashloan xStock → swap xStock→USDC → repay debt + withdraw
//             collateral → repay flashloan.
//
// The SDK is dynamically imported so Anchor stays out of the SSR bundle, matching
// lib/jupiter/borrow.ts.

// Instruction count is high (flashloan + swap route + operate). Reserve headroom
// so the transaction never dies on the default 200k CU limit.
const COMPUTE_UNIT_LIMIT = 1_400_000;

// Solana's MAX_TX_ACCOUNT_LOCKS. A transaction may lock at most 64 accounts,
// and **address lookup tables do not help here**: an ALT compresses the message
// bytes, but every address it resolves still gets locked. Passing more ALTs was
// the obvious first thing to try and it cannot work, which is worth stating so
// nobody tries it again.
//
// A loop transaction is a flashloan borrow + a Jupiter swap + a vault operate +
// a flashloan payback. Left alone, Jupiter will happily spend the entire budget
// on the swap route by itself (its own `maxAccounts` default is 64), and the
// Lend instructions then push the total past the limit. The runtime rejects it
// at simulation with "Transaction locked too many accounts", which names no
// instruction and carries empty logs.
const MAX_TX_ACCOUNT_LOCKS = 64;

// Opening bid for the swap's share of that budget.
//
// Measured on mainnet by scripts/jupiter-loop-accounts-check.mts (TSLAx/USDC,
// 2026-08-28): the Lend half — flashloan borrow, vault operate, flashloan
// payback — locks 44 accounts on its own, a single-hop swap route locks 18, and
// the two share 10, for 52 total. So the swap has only about 20 net-new
// accounts of headroom, and a route of roughly 30 accounts is the ceiling once
// the overlap is credited back. 28 leaves a little margin under that.
//
// The Lend side taking 69% of the budget is the whole reason this is tight, and
// it is not something this file can negotiate.
//
// Not a hard cap either way: Jupiter documents `maxAccounts` as a rough
// estimate, so the real count is measured on the compiled message below and the
// budget is walked down from here if it still does not fit.
// Exported so the panel can preview on the same terms it will execute on. A
// preview quoted without the budget prices a route the transaction will not
// use, and the exposure, LTV and liquidation figures drawn from it would be
// numbers no one is going to get.
export const SWAP_ACCOUNT_BUDGET = 28;

// Floor for that walk. Jupiter's own docs warn that below ~50 routing quality
// degrades and very low values return no route at all, so there is a point
// where refusing beats sending a quote nobody would accept.
const MIN_SWAP_ACCOUNT_BUDGET = 16;

// Shed this much beyond the measured overshoot on a retry. The swap route and
// the Lend instructions share accounts (the signer, both mints, the token
// programs), so dropping N accounts from the route does not always drop N from
// the total, and a retry that lands exactly on 64 would still be at the mercy
// of a route change between quote and send.
const ACCOUNT_BUDGET_SAFETY = 3;

// What the runtime will actually lock: every static key, plus every address
// resolved through a lookup table.
function countLockedAccounts(message: {
  staticAccountKeys: unknown[];
  addressTableLookups: { writableIndexes: number[]; readonlyIndexes: number[] }[];
}): number {
  return message.addressTableLookups.reduce(
    (total, lookup) =>
      total + lookup.writableIndexes.length + lookup.readonlyIndexes.length,
    message.staticAccountKeys.length,
  );
}

// ── Swap quote / instructions (Jupiter Lite via our proxy) ──────────────────

export interface SwapRoutePlanStep {
  swapInfo?: unknown;
  percent?: number;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  // Minimum output honoured after slippage. Safe to rely on for sizing.
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan?: SwapRoutePlanStep[];
  error?: string;
}

interface JupInstructionJson {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string;
}

interface SwapInstructionsResponse {
  setupInstructions?: JupInstructionJson[];
  swapInstruction: JupInstructionJson;
  cleanupInstruction?: JupInstructionJson;
  addressLookupTableAddresses?: string[];
  error?: string;
}

export async function fetchSwapQuoteViaProxy(args: {
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
  maxAccounts?: number;
}): Promise<SwapQuote> {
  const url = new URL("/api/jupiter/swap/quote", window.location.origin);
  url.searchParams.set("inputMint", args.inputMint);
  url.searchParams.set("outputMint", args.outputMint);
  url.searchParams.set("amount", args.amountAtomic);
  url.searchParams.set("slippageBps", String(args.slippageBps));
  if (args.maxAccounts != null) {
    url.searchParams.set("maxAccounts", String(args.maxAccounts));
  }

  const res = await fetch(url.toString(), { cache: "no-store" });
  const body = await res.json();
  if (!res.ok || body.error || !body.routePlan) {
    throw new Error(body?.error ?? `Swap quote failed: ${res.status}`);
  }
  return body as SwapQuote;
}

async function fetchSwapInstructionsViaProxy(
  quoteResponse: SwapQuote,
  userPublicKey: string,
): Promise<SwapInstructionsResponse> {
  const res = await fetch("/api/jupiter/swap/instructions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse, userPublicKey }),
  });
  const body = await res.json();
  if (!res.ok || body.error || !body.swapInstruction) {
    throw new Error(body?.error ?? `Swap instructions failed: ${res.status}`);
  }
  return body as SwapInstructionsResponse;
}

function jupIxToTransactionInstruction(
  ix: JupInstructionJson,
): TransactionInstruction {
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

async function getAddressLookupTableAccounts(
  connection: Connection,
  keys: string[],
): Promise<AddressLookupTableAccount[]> {
  if (!keys?.length) return [];
  const infos = await connection.getMultipleAccountsInfo(
    keys.map((k) => new PublicKey(k)),
  );
  return infos.reduce((acc, info, i) => {
    if (info) {
      acc.push(
        new AddressLookupTableAccount({
          key: new PublicKey(keys[i]),
          state: AddressLookupTableAccount.deserialize(info.data),
        }),
      );
    }
    return acc;
  }, [] as AddressLookupTableAccount[]);
}

// ── Leverage math ───────────────────────────────────────────────────────────

// Highest leverage we let a user target on a vault. Derived from the collateral
// factor with a safety buffer so the resulting LTV lands below CF even after
// swap slippage. collateralFactor is in tenths of a percent (650 = 65%).
export function maxLeverageForVault(vault: XStockBorrowVault): number {
  const cf = vault.collateralFactor / 1000;
  const targetLtv = Math.max(0, cf - 0.05);
  // L such that (L-1)/L = targetLtv  =>  L = 1 / (1 - targetLtv).
  return 1 / (1 - targetLtv);
}

// USDC to borrow (and flashloan) to reach `leverage` on a base collateral value.
// exposure target = L * base; borrowed = (L - 1) * base.
export function borrowUsdForLeverage(
  baseCollateralUsd: number,
  leverage: number,
): number {
  return baseCollateralUsd * (leverage - 1);
}

// ── Multiply ─────────────────────────────────────────────────────────────────

export interface BuildMultiplyArgs {
  vault: XStockBorrowVault;
  // 0 to create a new position NFT; otherwise the existing position id.
  positionId: number;
  // Collateral already in the wallet that seeds the loop, in collateral atomic.
  initialCollateralAtomic: BN;
  // USDC to flashloan and borrow, in USDC atomic.
  borrowUsdcAtomic: BN;
  signerAddress: string;
  connection: Connection;
  slippageBps: number;
}

export interface BuildMultiplyResult {
  base64Tx: string;
  // Newly created position NFT id when positionId was 0.
  nftId: number | undefined;
  quote: SwapQuote;
}

export async function buildMultiplyTx({
  vault,
  positionId,
  initialCollateralAtomic,
  borrowUsdcAtomic,
  signerAddress,
  connection,
  slippageBps,
}: BuildMultiplyArgs): Promise<BuildMultiplyResult> {
  const { getFlashBorrowIx, getFlashPaybackIx } = await import(
    "@jup-ag/lend/flashloan"
  );
  const { getOperateIx } = await import("@jup-ag/lend/borrow");
  const { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } =
    await import("@solana/web3.js");

  const signer = new PublicKey(signerAddress);
  const usdc = new PublicKey(vault.borrowMint);

  const flashParams = {
    connection,
    signer,
    asset: usdc,
    amount: borrowUsdcAtomic,
  };
  // Fetched once, outside the fitting loop below: both depend only on the
  // borrow amount, which a re-quote does not change.
  const [flashBorrowIx, flashPaybackIx] = await Promise.all([
    getFlashBorrowIx(flashParams),
    getFlashPaybackIx(flashParams),
  ]);

  let budget = SWAP_ACCOUNT_BUDGET;

  // Quote, build, count, and shrink the route's account budget until the
  // transaction fits under the lock limit. Usually one pass: the retry exists
  // because `maxAccounts` steers the router rather than binding it, and because
  // how much the route overlaps the Lend instructions is not knowable up front.
  for (;;) {
    const quote = await fetchSwapQuoteViaProxy({
      inputMint: vault.borrowMint,
      outputMint: vault.collateralMint,
      amountAtomic: borrowUsdcAtomic.toString(),
      slippageBps,
      maxAccounts: budget,
    });

    // Deposit the swap's guaranteed minimum, not the expected out, so the vault
    // deposit can never ask the ATA for more collateral than the swap delivered.
    const swapMinOut = new BN(quote.otherAmountThreshold);
    const supplyAmount = initialCollateralAtomic.add(swapMinOut);

    const swapRes = await fetchSwapInstructionsViaProxy(quote, signerAddress);
    const swapIx = jupIxToTransactionInstruction(swapRes.swapInstruction);
    const setupIxs = (swapRes.setupInstructions ?? []).map(
      jupIxToTransactionInstruction,
    );

    const { ixs: operateIxs, addressLookupTableAccounts, nftId } =
      await getOperateIx({
        vaultId: vault.vaultId,
        positionId,
        colAmount: supplyAmount,
        debtAmount: borrowUsdcAtomic,
        connection,
        signer,
      });
    if (!operateIxs?.length) {
      throw new Error("Jupiter Lend SDK returned no operate instructions");
    }

    const swapAlts = await getAddressLookupTableAccounts(
      connection,
      swapRes.addressLookupTableAddresses ?? [],
    );
    const allAlts = [...(addressLookupTableAccounts ?? []), ...swapAlts];

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
        flashBorrowIx,
        ...setupIxs,
        swapIx,
        ...operateIxs,
        flashPaybackIx,
      ],
    }).compileToV0Message(allAlts);

    const locked = countLockedAccounts(message);
    if (locked <= MAX_TX_ACCOUNT_LOCKS) {
      const tx = new VersionedTransaction(message);
      return {
        base64Tx: Buffer.from(tx.serialize()).toString("base64"),
        nftId,
        quote,
      };
    }

    const next = budget - (locked - MAX_TX_ACCOUNT_LOCKS) - ACCOUNT_BUDGET_SAFETY;
    if (next < MIN_SWAP_ACCOUNT_BUDGET) {
      throw new Error(
        `No route for this loop fits in one transaction (${locked} accounts, limit ${MAX_TX_ACCOUNT_LOCKS}). ` +
          `${vault.collateralSymbol} liquidity is split across too many pools right now. Try a smaller amount or lower leverage.`,
      );
    }
    budget = next;
  }
}

// ── Unwind (full close) ──────────────────────────────────────────────────────

export interface BuildUnwindArgs {
  vault: XStockBorrowVault;
  positionId: number;
  // Live on-chain position amounts (real mint atomic units).
  collateralAtomic: BN;
  debtAtomic: BN;
  oraclePriceUsd: number;
  signerAddress: string;
  connection: Connection;
  slippageBps: number;
}

export interface BuildUnwindResult {
  base64Tx: string;
  quote: SwapQuote;
  // Collateral flash-borrowed and swapped to cover the debt, in collateral atomic.
  flashCollateralAtomic: BN;
}

// Buffer over the raw debt when sizing how much collateral to sell. Covers swap
// slippage plus interest that accrues between quote and execution.
const UNWIND_COVER_BUFFER = 1.06;

export async function buildUnwindTx({
  vault,
  positionId,
  collateralAtomic,
  debtAtomic,
  oraclePriceUsd,
  signerAddress,
  connection,
  slippageBps,
}: BuildUnwindArgs): Promise<BuildUnwindResult> {
  const { getFlashBorrowIx, getFlashPaybackIx } = await import(
    "@jup-ag/lend/flashloan"
  );
  const { getOperateIx, MAX_REPAY_AMOUNT, MAX_WITHDRAW_AMOUNT } = await import(
    "@jup-ag/lend/borrow"
  );
  const { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } =
    await import("@solana/web3.js");

  if (oraclePriceUsd <= 0) {
    throw new Error("Missing oracle price to size the unwind swap");
  }
  const signer = new PublicKey(signerAddress);
  const collateral = new PublicKey(vault.collateralMint);

  // Size the collateral to sell so the USDC out covers the full debt. Start from
  // debt / price with a buffer, then confirm the quote's guaranteed minimum out
  // clears the debt, scaling up (capped at total collateral) if it does not.
  const debtUi = Number(debtAtomic.toString()) / 10 ** vault.borrowDecimals;

  // Same account-lock budget as the multiply path, and for the same reason: an
  // unwind is also flashloan + swap + operate in one transaction. The sizing
  // loop below sits inside the fitting loop because a smaller route can return
  // a worse guaranteed out, which changes how much collateral has to be sold.
  let budget = SWAP_ACCOUNT_BUDGET;

  for (;;) {
    let flashCollateralUi = (debtUi / oraclePriceUsd) * UNWIND_COVER_BUFFER;
    let flashCollateralAtomic = clampBN(
      toAtomicBN(flashCollateralUi, vault.collateralDecimals),
      new BN(1),
      collateralAtomic,
    );

    let quote: SwapQuote | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      quote = await fetchSwapQuoteViaProxy({
        inputMint: vault.collateralMint,
        outputMint: vault.borrowMint,
        amountAtomic: flashCollateralAtomic.toString(),
        slippageBps,
        maxAccounts: budget,
      });
      const minUsdcOut = new BN(quote.otherAmountThreshold);
      if (minUsdcOut.gte(debtAtomic) || flashCollateralAtomic.eq(collateralAtomic)) {
        break;
      }
      // Guaranteed out fell short. Scale the input up proportionally, capped at the
      // full collateral balance.
      const shortfall = debtAtomic.mul(new BN(1000)).div(minUsdcOut).toNumber() / 1000;
      flashCollateralUi = flashCollateralUi * Math.max(shortfall, 1.02);
      flashCollateralAtomic = clampBN(
        toAtomicBN(flashCollateralUi, vault.collateralDecimals),
        new BN(1),
        collateralAtomic,
      );
    }
    if (!quote) throw new Error("Could not price the unwind swap");

    const flashParams = {
      connection,
      signer,
      asset: collateral,
      amount: flashCollateralAtomic,
    };
    const [flashBorrowIx, flashPaybackIx] = await Promise.all([
      getFlashBorrowIx(flashParams),
      getFlashPaybackIx(flashParams),
    ]);

    const swapRes = await fetchSwapInstructionsViaProxy(quote, signerAddress);
    const swapIx = jupIxToTransactionInstruction(swapRes.swapInstruction);
    const setupIxs = (swapRes.setupInstructions ?? []).map(
      jupIxToTransactionInstruction,
    );

    const { ixs: operateIxs, addressLookupTableAccounts } = await getOperateIx({
      vaultId: vault.vaultId,
      positionId,
      colAmount: MAX_WITHDRAW_AMOUNT,
      debtAmount: MAX_REPAY_AMOUNT,
      connection,
      signer,
    });
    if (!operateIxs?.length) {
      throw new Error("Jupiter Lend SDK returned no operate instructions");
    }

    const swapAlts = await getAddressLookupTableAccounts(
      connection,
      swapRes.addressLookupTableAddresses ?? [],
    );
    const allAlts = [...(addressLookupTableAccounts ?? []), ...swapAlts];

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
        flashBorrowIx,
        ...setupIxs,
        swapIx,
        ...operateIxs,
        flashPaybackIx,
      ],
    }).compileToV0Message(allAlts);

    const locked = countLockedAccounts(message);
    if (locked <= MAX_TX_ACCOUNT_LOCKS) {
      const tx = new VersionedTransaction(message);
      return {
        base64Tx: Buffer.from(tx.serialize()).toString("base64"),
        quote,
        flashCollateralAtomic,
      };
    }

    const next = budget - (locked - MAX_TX_ACCOUNT_LOCKS) - ACCOUNT_BUDGET_SAFETY;
    if (next < MIN_SWAP_ACCOUNT_BUDGET) {
      throw new Error(
        `No route for this unwind fits in one transaction (${locked} accounts, limit ${MAX_TX_ACCOUNT_LOCKS}). ` +
          `${vault.collateralSymbol} liquidity is split across too many pools right now. Try again shortly.`,
      );
    }
    budget = next;
  }
}

function clampBN(value: BN, min: BN, max: BN): BN {
  if (value.lt(min)) return min;
  if (value.gt(max)) return max;
  return value;
}
