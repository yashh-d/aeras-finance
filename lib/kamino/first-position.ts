// What a first Kamino position costs in rent, and whether the wallet covers it.
//
// A first deposit into the xStocks Market allocates three accounts. All three
// are created by the same KTX transaction, so one missing account fails the
// whole thing, which is why they are priced together rather than one at a time.
//
// Every address here was validated against a live obligation on mainnet before
// this file existed. Re-run `npx tsx scripts/kamino-first-position-check.mts`
// after any klend upgrade: a changed seed would silently report "already set
// up" for every user and put the raw simulation error back on screen.

import { PublicKey, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { USDC_MINT } from "@/lib/jupiter/constants";
import {
  rentFor,
  toSetupCost,
  type SetupCost,
  type SetupCostItem,
} from "@/lib/borrow/setup-cost";
import { KAMINO_XSTOCKS_MARKET } from "./reserves";

export const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
);

// Account sizes, read off live mainnet accounts rather than an IDL. Only the
// SIZES are constants; the lamport price of each comes from the chain at call
// time. See the note in lib/borrow/setup-cost.ts on why.
//
// Measured 2026-09-05:
//   UserMetadata 5TzvCQRrYyZ56LbZtMxb9KLzwxB17eP1BAPsYG9Fpx9C   1032 B
//   Obligation   7QjzNh8KQcB6gH4VMwJLjUtt1WLiEGwtmHfVeWd7cBZW   3344 B
const USER_METADATA_SIZE = 1032;
const OBLIGATION_SIZE = 3344;

// An address lookup table starts at LOOKUP_TABLE_META_SIZE and grows as it is
// extended. Kamino creates one per user alongside UserMetadata and stores its
// address there, so the two are always created together and are charged
// together below.
//
// This is the account that actually failed in production. Rent for 56 bytes is
// 1,165,272 lamports, matching "need 1165272" in the failing transaction log to
// the lamport, which is what confirmed this whole model.
const LOOKUP_TABLE_SIZE = 56;

// A classic SPL token account. USDC is not Token-2022, so 165 is exact.
const TOKEN_ACCOUNT_SIZE = 165;

// PDA for the caller's Kamino UserMetadata. Seeds verified against a live
// account: derived 5TzvCQRr... for owner 9cfJLEBa... and found it on chain,
// 1032 bytes, owned by klend.
export function kaminoUserMetadataPda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_meta"), owner.toBuffer()],
    KLEND_PROGRAM_ID,
  )[0];
}

// PDA for a Vanilla (single-collateral) obligation, which is the only kind v1
// opens. Tag and id are both 0 for Vanilla; the two trailing seeds are the
// zero pubkey and carry the reserve pair for other obligation types.
//
// Verified by re-deriving a live obligation from its own stored owner and
// market: derivation returned 7QjzNh8KQcB6gH4VMwJLjUtt1WLiEGwtmHfVeWd7cBZW,
// which is the account it was read from.
export function kaminoVanillaObligationPda(
  owner: PublicKey,
  market: PublicKey = new PublicKey(KAMINO_XSTOCKS_MARKET),
): PublicKey {
  const zero = PublicKey.default.toBuffer();
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from([0]),
      Buffer.from([0]),
      owner.toBuffer(),
      market.toBuffer(),
      zero,
      zero,
    ],
    KLEND_PROGRAM_ID,
  )[0];
}

// Price the setup this wallet still owes at Kamino. One round trip: existence
// of all three accounts plus the SOL balance.
//
// The collateral's own token account is deliberately not priced. You cannot
// deposit a stock you do not hold, so by the time this runs that account
// necessarily exists. The USDC account can genuinely be missing, because
// borrowing USDC is how some users first receive it.
export async function estimateKaminoSetupCost({
  connection,
  walletAddress,
}: {
  connection: Connection;
  walletAddress: string;
}): Promise<SetupCost> {
  const owner = new PublicKey(walletAddress);
  const userMetadata = kaminoUserMetadataPda(owner);
  const obligation = kaminoVanillaObligationPda(owner);
  const usdcAta = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    owner,
    true,
    TOKEN_PROGRAM_ID,
  );

  const [infos, haveLamports, floorLamports] = await Promise.all([
    connection.getMultipleAccountsInfo([userMetadata, obligation, usdcAta], {
      commitment: "confirmed",
      // Existence is the whole question, so skip the account bodies. The
      // obligation alone is 3344 bytes and this runs on every Borrow click.
      dataSlice: { offset: 0, length: 0 },
    }),
    connection.getBalance(owner, "confirmed"),
    rentFor(connection, 0),
  ]);
  const [metadataInfo, obligationInfo, usdcInfo] = infos;

  const items: SetupCostItem[] = [];

  if (!metadataInfo) {
    // Charged as one line because the user cannot have one without the other,
    // and splitting them into two rows of $0.76 and $0.12 reads as more moving
    // parts than the decision actually has.
    const [metadataRent, lookupRent] = await Promise.all([
      rentFor(connection, USER_METADATA_SIZE),
      rentFor(connection, LOOKUP_TABLE_SIZE),
    ]);
    items.push({
      label: "Your Kamino account",
      lamports: metadataRent + lookupRent,
    });
  }

  if (!obligationInfo) {
    items.push({
      label: "The account that holds your loan",
      lamports: await rentFor(connection, OBLIGATION_SIZE),
    });
  }

  if (!usdcInfo) {
    items.push({
      label: "A USDC account to receive the loan",
      lamports: await rentFor(connection, TOKEN_ACCOUNT_SIZE),
    });
  }

  return toSetupCost({
    venueLabel: "Kamino",
    items,
    haveLamports,
    floorLamports,
  });
}
