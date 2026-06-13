import BN from "bn.js";
import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { USDC_MINT } from "./constants";

const JUPITER_LEND_PROGRAM_ID = new PublicKey(
  "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi",
);
// Anchor discriminator for the `position` account type from the IDL.
const POSITION_DISCRIMINATOR = Buffer.from([
  170, 188, 143, 228, 122, 64, 247, 208,
]);

// xStock → USDC vaults that exist on mainnet today. JupUSD pairs (81-84) are out of scope for v1.
// Source: https://api.jup.ag/lend/v1/borrow/vaults (verified 2026-05-21).
export interface XStockBorrowVault {
  vaultId: number;
  collateralSymbol: "TSLAx" | "SPYx" | "QQQx" | "NVDAx";
  collateralMint: string;
  collateralDecimals: number;
  borrowSymbol: "USDC";
  borrowMint: string;
  borrowDecimals: number;
  // PDA of the on-chain VaultState account. Used to read cached exchange prices.
  vaultStateAddress: string;
  // Tenths of a percent: 800 means 80%.
  collateralFactor: number;
  liquidationThreshold: number;
  liquidationMaxLimit: number;
}

const COLLATERAL_DECIMALS = 8; // xStocks are 8-decimal Token-2022
const USDC_DECIMALS = 6;

export const XSTOCK_BORROW_VAULTS: readonly XStockBorrowVault[] = [
  {
    vaultId: 77,
    collateralSymbol: "TSLAx",
    collateralMint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    collateralDecimals: COLLATERAL_DECIMALS,
    borrowSymbol: "USDC",
    borrowMint: USDC_MINT,
    borrowDecimals: USDC_DECIMALS,
    vaultStateAddress: "Hs4oBSGMJqAEKnKrwmhcaznNJJMnuwsurgbYeCX25oZP",
    collateralFactor: 650,
    liquidationThreshold: 750,
    liquidationMaxLimit: 900,
  },
  {
    vaultId: 78,
    collateralSymbol: "SPYx",
    collateralMint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    collateralDecimals: COLLATERAL_DECIMALS,
    borrowSymbol: "USDC",
    borrowMint: USDC_MINT,
    borrowDecimals: USDC_DECIMALS,
    vaultStateAddress: "2tTCSrD9NhHUqiNXpu2xrvhHeo3hXLfCrkEjDA2xkq4Y",
    collateralFactor: 750,
    liquidationThreshold: 850,
    liquidationMaxLimit: 900,
  },
  {
    vaultId: 79,
    collateralSymbol: "QQQx",
    collateralMint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    collateralDecimals: COLLATERAL_DECIMALS,
    borrowSymbol: "USDC",
    borrowMint: USDC_MINT,
    borrowDecimals: USDC_DECIMALS,
    vaultStateAddress: "BdETSYbU13DVcTVYR9AG7ghEhSjbqbk5uZz7nRZ5gRLZ",
    collateralFactor: 750,
    liquidationThreshold: 850,
    liquidationMaxLimit: 900,
  },
  {
    vaultId: 80,
    collateralSymbol: "NVDAx",
    collateralMint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    collateralDecimals: COLLATERAL_DECIMALS,
    borrowSymbol: "USDC",
    borrowMint: USDC_MINT,
    borrowDecimals: USDC_DECIMALS,
    vaultStateAddress: "8GmQKSaHvjuYpEDPNXsDJQGud8jWr6J19Rcro7Ve5SUB",
    collateralFactor: 650,
    liquidationThreshold: 750,
    liquidationMaxLimit: 900,
  },
] as const;

export function vaultByCollateralMint(
  collateralMint: string,
): XStockBorrowVault | undefined {
  return XSTOCK_BORROW_VAULTS.find((v) => v.collateralMint === collateralMint);
}

export function vaultById(vaultId: number): XStockBorrowVault | undefined {
  return XSTOCK_BORROW_VAULTS.find((v) => v.vaultId === vaultId);
}

// Live vault state from Jupiter's public endpoint. We only surface what the UI uses.
export interface LiveVaultState {
  vaultId: number;
  // Oracle price in USD, decimal. Same conversion for operate vs liquidate is fine for display.
  oraclePriceUsd: number;
  // Annualised borrow rate, decimal (0.05 = 5%).
  borrowRateAnnual: number;
  // How much can still be borrowed from this vault, in atomic units of the borrow token.
  borrowableAtomic: string;
}

interface RawVault {
  id: number;
  oraclePrice: string;
  borrowRate: string;
  borrowable: string;
}

export async function fetchLiveVaultStateViaProxy(
  vaultId: number,
): Promise<LiveVaultState> {
  const url = new URL("/api/jupiter/borrow/vaults", window.location.origin);
  url.searchParams.set("vaultId", String(vaultId));
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Borrow vaults proxy failed: ${res.status}`);
  }
  const raw = (await res.json()) as RawVault;
  return parseLiveVault(raw);
}

export function parseLiveVault(raw: RawVault): LiveVaultState {
  // Jupiter returns oraclePrice scaled 1e15 for xStock vaults. Divide and trust the
  // float for display purposes only — never use this for tx math.
  const oraclePriceUsd = Number(raw.oraclePrice) / 1e15;
  // borrowRate is in tenths of a percent (e.g. "781" = 7.81%).
  const borrowRateAnnual = Number(raw.borrowRate) / 10_000;
  return {
    vaultId: raw.id,
    oraclePriceUsd,
    borrowRateAnnual,
    borrowableAtomic: raw.borrowable,
  };
}

// Convert a UI float to a BN of base units. Same logic as lib/jupiter/ultra.toAtomic,
// but BN-typed for the SDK.
export function toAtomicBN(amount: number, decimals: number): BN {
  const [whole, frac = ""] = amount.toString().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+/, "") || "0";
  return new BN(combined);
}

export function fromAtomicBN(amount: BN, decimals: number): number {
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals);
  return Number(`${whole}.${frac}`);
}

// Build an operate transaction (deposit/borrow/repay/withdraw) and return it as
// base64 ready to sign. positionId=0 means "create new position + first op in one tx".
// Pass negative BN amounts to withdraw / repay, or the SDK sentinels for max.
export interface BuildOperateArgs {
  vaultId: number;
  positionId: number;
  collateralDeltaAtomic: BN;
  debtDeltaAtomic: BN;
  signerAddress: string;
  connection: Connection;
}

// Returns the SDK's `MAX_REPAY_AMOUNT` and `MAX_WITHDRAW_AMOUNT` sentinels for
// use as debt/collateral deltas when closing a position fully. Dynamic import
// keeps Anchor out of the SSR bundle.
export async function getMaxSentinels(): Promise<{
  maxRepay: BN;
  maxWithdraw: BN;
}> {
  const { MAX_REPAY_AMOUNT, MAX_WITHDRAW_AMOUNT } = await import(
    "@jup-ag/lend/borrow"
  );
  return { maxRepay: MAX_REPAY_AMOUNT, maxWithdraw: MAX_WITHDRAW_AMOUNT };
}

export interface BuildOperateResult {
  base64Tx: string;
  // If positionId was 0, this is the newly-created position NFT id.
  nftId: number | undefined;
}

export async function buildOperateTx({
  vaultId,
  positionId,
  collateralDeltaAtomic,
  debtDeltaAtomic,
  signerAddress,
  connection,
}: BuildOperateArgs): Promise<BuildOperateResult> {
  // Dynamic import keeps the SDK out of the SSR bundle and avoids hydrating
  // anchor's `Buffer` dependency on the server.
  const { getOperateIx } = await import("@jup-ag/lend/borrow");
  const { TransactionMessage, VersionedTransaction } = await import(
    "@solana/web3.js"
  );

  const signer = new PublicKey(signerAddress);
  const { ixs, addressLookupTableAccounts, nftId } = await getOperateIx({
    vaultId,
    positionId,
    colAmount: collateralDeltaAtomic,
    debtAmount: debtDeltaAtomic,
    connection,
    signer,
  });
  if (!ixs?.length) {
    throw new Error("Jupiter Lend SDK returned no instructions");
  }

  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(addressLookupTableAccounts ?? []);

  const tx = new VersionedTransaction(message);
  const base64Tx = Buffer.from(tx.serialize()).toString("base64");
  return { base64Tx, nftId };
}

// Read the on-chain state of a known position. The caller tracks (vaultId -> nftId)
// in localStorage; v1 doesn't scan the wallet's NFTs to discover prior positions.
// Returned amounts are in real mint-atomic units (collateral in collateralDecimals,
// debt in borrowDecimals).
export interface UserPositionState {
  nftId: number;
  collateralAtomic: BN;
  debtAtomic: BN;
  isLiquidated: boolean;
}

const EXCHANGE_PRICES_PRECISION = new BN(10).pow(new BN(12));
// Jupiter Lend normalizes every asset to a 9-decimal protocol-internal precision
// regardless of mint decimals. Convert protocol units -> mint-atomic by dividing
// by 10^(PROTOCOL_PRECISION - mintDecimals).
const PROTOCOL_PRECISION = 9;

// VaultState account uses `repr: { kind: "c", packed: true }` (bytemuck).
// After the 8-byte Anchor discriminator, fields are packed without padding:
//   vaultId u16          | 8..10
//   branchLiquidated u8  | 10..11
//   topmostTick i32      | 11..15
//   currentBranchId u32  | 15..19
//   totalBranchId u32    | 19..23
//   totalSupply u64      | 23..31
//   totalBorrow u64      | 31..39
//   totalPositions u32   | 39..43
//   absorbedDebtAmount u128   | 43..59
//   absorbedColAmount u128    | 59..75
//   absorbedDustDebt u64      | 75..83
//   liquiditySupplyExchangePrice u64 | 83..91
//   liquidityBorrowExchangePrice u64 | 91..99
//   vaultSupplyExchangePrice u64     | 99..107
//   vaultBorrowExchangePrice u64     | 107..115
const VAULT_SUPPLY_EX_PRICE_OFFSET = 99;
const VAULT_BORROW_EX_PRICE_OFFSET = 107;

function readU64LE(buf: Uint8Array, offset: number): BN {
  // BN constructor takes "le" endianness and a byte-array slice.
  return new BN(buf.subarray(offset, offset + 8), "le");
}

export async function fetchVaultExchangePrices(
  vault: XStockBorrowVault,
  connection: Connection,
): Promise<{ supplyExPrice: BN; borrowExPrice: BN }> {
  const info = await connection.getAccountInfo(
    new PublicKey(vault.vaultStateAddress),
  );
  if (!info) {
    throw new Error(`VaultState ${vault.vaultStateAddress} not found`);
  }
  const data = info.data;
  return {
    supplyExPrice: readU64LE(data, VAULT_SUPPLY_EX_PRICE_OFFSET),
    borrowExPrice: readU64LE(data, VAULT_BORROW_EX_PRICE_OFFSET),
  };
}

// Scan the wallet's NFTs for an existing Jupiter Lend position-NFT in this
// vault. Used to auto-recover after localStorage is cleared so the next borrow
// reuses the existing NFT instead of paying ~0.015 SOL rent for a new one.
//
// Strategy: one getProgramAccounts call to enumerate Position accounts in this
// vault, cross-reference each `positionMint` with the user's NFT mints.
export async function findExistingNftId(
  walletAddress: string,
  vault: XStockBorrowVault,
  connection: Connection,
): Promise<number | null> {
  const owner = new PublicKey(walletAddress);

  // 1. Build a set of NFT-like mints the user owns (both legacy SPL and Token-2022).
  const userMints = new Set<string>();
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
      programId,
    });
    for (const acc of accounts.value) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info: any = acc.account.data.parsed.info;
      if (
        info.tokenAmount.uiAmount === 1 &&
        info.tokenAmount.decimals === 0
      ) {
        userMints.add(info.mint as string);
      }
    }
  }
  if (userMints.size === 0) return null;

  // 2. Enumerate Position accounts in this vault.
  const vaultIdBuf = Buffer.alloc(2);
  vaultIdBuf.writeUInt16LE(vault.vaultId);
  const positions = await connection.getProgramAccounts(
    JUPITER_LEND_PROGRAM_ID,
    {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(POSITION_DISCRIMINATOR) } },
        { memcmp: { offset: 8, bytes: bs58.encode(vaultIdBuf) } },
      ],
    },
  );

  // 3. Position layout (from IDL, packed): 8 disc + 2 vaultId + 4 nftId + 32 positionMint.
  //    Collect *every* position NFT the user owns in this vault, not just the
  //    first. A user can accumulate multiple NFTs here (e.g. localStorage got
  //    cleared between borrows, so a second position was opened), and closing a
  //    position only zeroes it — the NFT lives on. Returning the first match
  //    blindly can bind to a stale, emptied position and hide the live one.
  const candidateNftIds: number[] = [];
  for (const { account } of positions) {
    const data = account.data;
    if (data.length < 14 + 32) continue;
    const positionMint = new PublicKey(data.subarray(14, 14 + 32)).toBase58();
    if (userMints.has(positionMint)) {
      // nftId is u32 LE at offset 10.
      const nftId =
        (data[10] |
          (data[11] << 8) |
          (data[12] << 16) |
          (data[13] << 24)) >>>
        0;
      candidateNftIds.push(nftId);
    }
  }

  if (candidateNftIds.length === 0) return null;
  if (candidateNftIds.length === 1) return candidateNftIds[0];

  // Multiple position NFTs in this vault: pick the one that actually holds a
  // balance. Read each on-chain and prefer a non-empty position; if several are
  // non-empty, prefer the highest (most recently created) nftId; if all are
  // empty, return the highest so the next borrow reuses it (no extra rent).
  const sorted = [...candidateNftIds].sort((a, b) => b - a);
  let firstNonEmpty: number | null = null;
  for (const nftId of sorted) {
    try {
      const state = await fetchPositionState(vault, nftId, connection);
      if (
        state &&
        (state.collateralAtomic.gtn(0) || state.debtAtomic.gtn(0))
      ) {
        firstNonEmpty = nftId;
        break;
      }
    } catch {
      // Treat an unreadable candidate as empty and keep scanning.
    }
  }
  return firstNonEmpty ?? sorted[0];
}

export async function fetchPositionState(
  vault: XStockBorrowVault,
  nftId: number,
  connection: Connection,
): Promise<UserPositionState | null> {
  const { getCurrentPosition } = await import("@jup-ag/lend/borrow");

  let raw;
  try {
    raw = await getCurrentPosition({
      vaultId: vault.vaultId,
      positionId: nftId,
      connection,
    });
  } catch (err) {
    if (err instanceof Error && /Account does not exist|not found/i.test(err.message)) {
      return null;
    }
    throw err;
  }

  // Convert raw protocol units to real mint-atomic units:
  //   step 1: real_in_9dec = rawAtomic * exchangePrice / 1e12 (interest accrual)
  //   step 2: mint_atomic = real_in_9dec / 10^(9 - mintDecimals)
  const { supplyExPrice, borrowExPrice } = await fetchVaultExchangePrices(
    vault,
    connection,
  );
  const collateralScale = new BN(10).pow(
    new BN(PROTOCOL_PRECISION - vault.collateralDecimals),
  );
  const borrowScale = new BN(10).pow(
    new BN(PROTOCOL_PRECISION - vault.borrowDecimals),
  );

  const collateralAtomic = raw.colRaw
    .mul(supplyExPrice)
    .div(EXCHANGE_PRICES_PRECISION)
    .div(collateralScale);
  const debtAtomic = raw.debtRaw
    .mul(borrowExPrice)
    .div(EXCHANGE_PRICES_PRECISION)
    .div(borrowScale);

  return {
    nftId,
    collateralAtomic,
    debtAtomic,
    isLiquidated: raw.userLiquidationStatus,
  };
}
