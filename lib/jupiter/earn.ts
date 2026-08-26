import BN from "bn.js";
import {
  Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { resolvePriorityFee } from "@/lib/solana/priority-fee";
import type { BuiltTransaction } from "@/lib/solana/send-confirm";

import { SOL_MINT, USDC_MINT } from "./constants";

// Jupiter Lend Earn vaults. Deposit an asset, receive a jlToken share, redeem it
// later for the asset plus accrued interest. Shares are ERC-4626-style: the
// share count never changes, the assets-per-share ratio grows.
//
// Source: https://api.jup.ag/lend/v1/earn/tokens (verified 2026-07-27).
// Ordered by TVL at verification time. Mints are pinned here rather than taken
// from the API response so a compromised or changed upstream cannot redirect a
// deposit to an unverified mint.
export interface EarnAssetMeta {
  vaultId: number;
  symbol: string;
  name: string;
  assetMint: string;
  jlTokenMint: string;
  decimals: number;
  // Native SOL: the vault holds wrapped SOL, so deposits wrap and withdrawals
  // unwrap. Every other asset is a plain SPL transfer.
  isNativeSol?: boolean;
}

export const EARN_ASSETS: readonly EarnAssetMeta[] = [
  {
    vaultId: 2,
    symbol: "USDC",
    name: "USD Coin",
    assetMint: USDC_MINT,
    jlTokenMint: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D",
    decimals: 6,
  },
  {
    vaultId: 9,
    symbol: "JupUSD",
    name: "Jupiter USD",
    assetMint: "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
    jlTokenMint: "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk",
    decimals: 6,
  },
  {
    vaultId: 4,
    symbol: "USDT",
    name: "Tether USD",
    assetMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    jlTokenMint: "Cmn4v2wipYV41dkakDvCgFJpxhtaaKt11NyWV8pjSE8A",
    decimals: 6,
  },
  {
    vaultId: 3,
    symbol: "SOL",
    name: "Solana",
    assetMint: SOL_MINT,
    jlTokenMint: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU",
    decimals: 9,
    isNativeSol: true,
  },
  {
    vaultId: 6,
    symbol: "USDS",
    name: "USDS",
    assetMint: "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
    jlTokenMint: "j14XLJZSVMcUYpAfajdZRpnfHUpJieZHS4aPektLWvh",
    decimals: 6,
  },
  {
    vaultId: 1,
    symbol: "EURC",
    name: "Euro Coin",
    assetMint: "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
    jlTokenMint: "GcV9tEj62VncGithz4o4N9x6HWXARxuRgEAYk9zahNA8",
    decimals: 6,
  },
  {
    vaultId: 5,
    symbol: "USDG",
    name: "Global Dollar",
    assetMint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    jlTokenMint: "9fvHrYNw1A8Evpcj7X2yy4k4fT7nNHcA9L6UsamNHAif",
    decimals: 6,
  },
] as const;

export function earnAssetByMint(mint: string): EarnAssetMeta | undefined {
  return EARN_ASSETS.find((a) => a.assetMint === mint);
}

// ── Live vault state ───────────────────────────────────────────────────────

export interface EarnVaultState {
  assetMint: string;
  // Decimal rates (0.0489 = 4.89%). `apy` is what the vault actually pays:
  // base supply rate plus any active rewards program.
  supplyApy: number;
  rewardsApy: number;
  apy: number;
  // Underlying assets held by the vault, in asset-atomic units.
  totalAssetsAtomic: string;
  // USD price of the underlying, as reported by Jupiter.
  assetPriceUsd: number;
  tvlUsd: number;
  // Assets returned per share, decimal. Grows with accrued interest. Display
  // only — use `convertToAssetsAtomic` for anything that becomes an amount.
  assetsPerShare: number;
  // Same ratio, unscaled: assets per share × 10^decimals.
  convertToAssetsAtomic: string;
  // Ceiling on what the vault can pay out right now. Jupiter Lend applies an
  // expanding withdrawal limit, so a large position may not be fully
  // withdrawable in a single transaction even when the vault is solvent.
  withdrawableAtomic: string;
}

interface RawEarnToken {
  address: string;
  assetAddress: string;
  decimals: number;
  supplyRate?: string;
  rewardsRate?: string;
  totalRate?: string;
  totalAssets?: string;
  convertToAssets?: string;
  asset?: { price?: string };
  liquiditySupplyData?: { withdrawable?: string };
}

// Rates come back in hundredths of a percent: "416" is 4.16%.
const RATE_SCALE = 10_000;

export function parseEarnToken(raw: RawEarnToken): EarnVaultState {
  const meta = earnAssetByMint(raw.assetAddress);
  if (!meta) {
    throw new Error(`Unknown earn asset ${raw.assetAddress}`);
  }
  const supplyApy = Number(raw.supplyRate ?? 0) / RATE_SCALE;
  const rewardsApy = Number(raw.rewardsRate ?? 0) / RATE_SCALE;
  // Prefer the upstream total so we inherit any future rate component we do not
  // know about, and fall back to the sum of the parts.
  const apy = raw.totalRate
    ? Number(raw.totalRate) / RATE_SCALE
    : supplyApy + rewardsApy;

  const assetPriceUsd = Number(raw.asset?.price ?? 0);
  const totalAssetsAtomic = raw.totalAssets ?? "0";
  const scale = 10 ** meta.decimals;
  // Float division is display-only here. Never feed these into instruction math.
  const tvlUsd = (Number(totalAssetsAtomic) / scale) * assetPriceUsd;
  const convertToAssetsAtomic = raw.convertToAssets ?? String(scale);
  const assetsPerShare = Number(convertToAssetsAtomic) / scale;

  return {
    assetMint: meta.assetMint,
    supplyApy,
    rewardsApy,
    apy,
    totalAssetsAtomic,
    assetPriceUsd,
    tvlUsd,
    assetsPerShare,
    convertToAssetsAtomic,
    withdrawableAtomic: raw.liquiditySupplyData?.withdrawable ?? "0",
  };
}

export async function fetchEarnVaultsViaProxy(): Promise<EarnVaultState[]> {
  const res = await fetch("/api/jupiter/earn/tokens", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Earn tokens proxy failed: ${res.status}`);
  }
  const raw = (await res.json()) as RawEarnToken[];
  return raw.map(parseEarnToken);
}

// ── User balances ──────────────────────────────────────────────────────────

export interface EarnWalletBalances {
  // mint -> exact atomic amount. Covers both the underlying assets and the
  // jlToken shares, keyed by mint so callers do not need to know which token
  // program each one lives under.
  byMint: Record<string, string>;
  // Native SOL, in lamports.
  solLamports: string;
}

// Leave enough SOL behind to cover fees and the rent for any ATA a deposit or
// withdrawal has to create. Applied to the SOL row's Max only.
export const SOL_RESERVE_LAMPORTS = 15_000_000; // 0.015 SOL

// The Jupiter Lend SDK derives every ATA with allowOwnerOffCurve=true. Our own
// derivations have to match it exactly or a PDA-owned wallet would get a
// different wSOL account than the one the deposit instruction reads. Identical
// output for ordinary on-curve wallets.
const ALLOW_OWNER_OFF_CURVE = true;

export async function fetchEarnWalletBalances(
  walletAddress: string,
  connection: Connection,
): Promise<EarnWalletBalances> {
  const owner = new PublicKey(walletAddress);
  const [solLamports, legacy, token2022] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ]);

  // Pin every balance to the canonical associated token account. Reading "any
  // account holding this mint" can report more than the SDK is able to spend.
  const wanted = new Map<string, string>(); // ata -> mint
  for (const meta of EARN_ASSETS) {
    for (const mint of [meta.assetMint, meta.jlTokenMint]) {
      for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const ata = getAssociatedTokenAddressSync(
          new PublicKey(mint),
          owner,
          ALLOW_OWNER_OFF_CURVE,
          programId,
        ).toBase58();
        wanted.set(ata, mint);
      }
    }
  }

  const byMint: Record<string, string> = {};
  for (const acc of [...legacy.value, ...token2022.value]) {
    const mint = wanted.get(acc.pubkey.toBase58());
    if (!mint) continue;
    const info = acc.account.data.parsed.info;
    if (info.mint !== mint) continue;
    byMint[mint] = info.tokenAmount.amount ?? "0";
  }

  return { byMint, solLamports: String(solLamports) };
}

// Spendable balance of the deposit asset. For SOL this is the native balance
// minus a fee reserve, since the vault takes wrapped SOL and we wrap on deposit.
export function depositableAtomic(
  meta: EarnAssetMeta,
  balances: EarnWalletBalances | null,
): string {
  if (!balances) return "0";
  if (meta.isNativeSol) {
    const lamports = new BN(balances.solLamports);
    const reserve = new BN(SOL_RESERVE_LAMPORTS);
    return lamports.gt(reserve) ? lamports.sub(reserve).toString() : "0";
  }
  return balances.byMint[meta.assetMint] ?? "0";
}

export function sharesAtomic(
  meta: EarnAssetMeta,
  balances: EarnWalletBalances | null,
): string {
  return balances?.byMint[meta.jlTokenMint] ?? "0";
}

// Underlying value of a share balance, in asset-atomic units. Exact — this is
// what the withdrawal cap is compared against.
export function positionAssetsAtomic(
  shares: string,
  vault: EarnVaultState | undefined,
  decimals: number,
): BN {
  if (!vault || shares === "0") return new BN(0);
  return new BN(shares)
    .mul(new BN(vault.convertToAssetsAtomic))
    .div(new BN(10).pow(new BN(decimals)));
}

// String-safe UI amount -> atomic units. Deliberately avoids the float
// round-trip in toAtomicBN so a Max derived from an exact on-chain balance
// survives conversion unchanged.
export function uiToAtomic(amount: string, decimals: number): BN {
  const trimmed = amount.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return new BN(0);
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+/, "") || "0";
  return new BN(combined);
}

// ── Transaction builders ───────────────────────────────────────────────────

interface BuildArgs {
  meta: EarnAssetMeta;
  signerAddress: string;
  connection: Connection;
}

// Deposit and withdraw both fan out into the liquidity program, which runs past
// the 200k default on a cold account set.
const COMPUTE_UNIT_LIMIT = 400_000;

async function compileV0(
  ixs: TransactionInstruction[],
  signerAddress: string,
  connection: Connection,
): Promise<BuiltTransaction> {
  const { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } =
    await import("@solana/web3.js");
  const signer = new PublicKey(signerAddress);

  // A unit limit alone only raises the ceiling; it does not buy a place in the
  // queue. Without a unit PRICE these went out at zero priority and were the
  // first thing dropped whenever the network got busy.
  const microLamports = await resolvePriorityFee(connection, {
    accountKeys: accountKeysOf(ixs),
    computeUnitLimit: COMPUTE_UNIT_LIMIT,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      ...ixs,
    ],
  }).compileToV0Message();

  return {
    transaction: Buffer.from(
      new VersionedTransaction(message).serialize(),
    ).toString("base64"),
    blockhash,
    lastValidBlockHeight,
  };
}

// Unique account addresses touched by these instructions, for the fee
// estimator. Writable accounts are what actually drive contention, so they lead.
function accountKeysOf(ixs: TransactionInstruction[]): string[] {
  const writable = new Set<string>();
  const readonly = new Set<string>();
  for (const ix of ixs) {
    for (const key of ix.keys) {
      const addr = key.pubkey.toBase58();
      if (key.isWritable) writable.add(addr);
      else readonly.add(addr);
    }
  }
  return [...writable, ...readonly];
}

async function buildDepositIxs({
  meta,
  amountAtomic,
  signerAddress,
  connection,
}: BuildArgs & { amountAtomic: BN }): Promise<TransactionInstruction[]> {
  // Dynamic import keeps Anchor out of the SSR bundle, same as the borrow path.
  const { getDepositIxs } = await import("@jup-ag/lend/earn");
  const signer = new PublicKey(signerAddress);
  const asset = new PublicKey(meta.assetMint);
  const ixs: TransactionInstruction[] = [];

  if (meta.isNativeSol) {
    // The vault takes wrapped SOL. Create the wSOL account if needed, fund it
    // with exactly the deposit amount, and sync so the token balance matches.
    const wsolAta = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      signer,
      ALLOW_OWNER_OFF_CURVE,
      TOKEN_PROGRAM_ID,
    );
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        signer,
        wsolAta,
        signer,
        NATIVE_MINT,
        TOKEN_PROGRAM_ID,
      ),
      SystemProgram.transfer({
        fromPubkey: signer,
        toPubkey: wsolAta,
        lamports: BigInt(amountAtomic.toString()),
      }),
      createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID),
    );
  }

  const { ixs: depositIxs } = await getDepositIxs({
    amount: amountAtomic,
    asset,
    signer,
    connection,
  });
  ixs.push(...depositIxs);
  return ixs;
}

export async function buildEarnDepositTx(
  args: BuildArgs & { amountAtomic: BN },
): Promise<BuiltTransaction> {
  const ixs = await buildDepositIxs(args);
  return compileV0(ixs, args.signerAddress, args.connection);
}

// Withdraw a specific amount of the underlying asset. `redeemAll` below is the
// right call for "take everything out" — it avoids leaving share dust behind.
export async function buildEarnWithdrawTx({
  meta,
  amountAtomic,
  signerAddress,
  connection,
}: BuildArgs & { amountAtomic: BN }): Promise<BuiltTransaction> {
  const { getWithdrawIxs } = await import("@jup-ag/lend/earn");
  const signer = new PublicKey(signerAddress);
  const { ixs } = await getWithdrawIxs({
    amount: amountAtomic,
    asset: new PublicKey(meta.assetMint),
    signer,
    connection,
  });
  return compileV0(appendUnwrap(ixs, meta, signer), signerAddress, connection);
}

// Redeem an exact share balance. Because the position is denominated in shares,
// this is the only way to close it to zero: an asset-denominated withdraw of the
// displayed value rounds against the user and strands a few atomic units.
export async function buildEarnRedeemAllTx({
  meta,
  sharesAtomicAmount,
  signerAddress,
  connection,
}: BuildArgs & { sharesAtomicAmount: BN }): Promise<BuiltTransaction> {
  const { getRedeemIxs } = await import("@jup-ag/lend/earn");
  const signer = new PublicKey(signerAddress);
  const { ixs } = await getRedeemIxs({
    shares: sharesAtomicAmount,
    asset: new PublicKey(meta.assetMint),
    signer,
    connection,
  });
  return compileV0(appendUnwrap(ixs, meta, signer), signerAddress, connection);
}

// SOL withdrawals land as wrapped SOL. Close the wSOL account so the user gets
// spendable lamports back rather than a token balance they cannot pay fees with.
function appendUnwrap(
  ixs: TransactionInstruction[],
  meta: EarnAssetMeta,
  signer: PublicKey,
): TransactionInstruction[] {
  if (!meta.isNativeSol) return ixs;
  const wsolAta = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    signer,
    ALLOW_OWNER_OFF_CURVE,
    TOKEN_PROGRAM_ID,
  );
  return [
    ...ixs,
    createCloseAccountInstruction(wsolAta, signer, signer, [], TOKEN_PROGRAM_ID),
  ];
}
