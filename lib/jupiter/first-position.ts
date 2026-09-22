// What a first Jupiter Lend position costs in rent, and whether the wallet
// covers it. Kamino's counterpart is lib/kamino/first-position.ts; the two share
// the shape in lib/borrow/setup-cost.ts and nothing else, because what each
// venue allocates has nothing in common.
//
// Jupiter Lend tracks a position as an NFT. Opening one mints the NFT, creates
// the token account that holds it, and writes a position record. Those three
// are per position, not per user, so unlike Kamino this cost returns every time
// the user opens a position in a vault they have no live NFT for.
//
// That is exactly why findExistingNftId in ./borrow.ts exists, and why this
// module takes the already-resolved NFT id rather than looking it up: that scan
// is a getProgramAccounts over every position in the vault (825 in the TSLAx
// vault today) plus two token-account scans, and useBorrowSummary has already
// paid for it by the time a user clicks Borrow.

import { PublicKey, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  rentFor,
  toSetupCost,
  type SetupCost,
  type SetupCostItem,
} from "@/lib/borrow/setup-cost";
import { USDC_MINT } from "./constants";

// Sizes read off live mainnet accounts in the TSLAx vault (77) on 2026-09-05.
// Only sizes are constants here; rent is priced from the chain at call time.
//
//   Position  1FSerRAgRTWRRqt4V1njSoEJg9DYZbBnP7L4ZPSWbcs    71 B
//   NFT mint  3Dfu94Vj8KNm9pxnj1xGHpm51HBwrUJgYZxpVv1yJKM2   82 B
//   NFT token guJzjURviLiLEi6YXwvnpYSrxUQi6RxYJgLP2a8C4RG   165 B
//
// Together 0.004446 SOL at today's rent. Worth knowing if you are reading the
// comment on findExistingNftId that motivated the NFT-reuse scan: it says a new
// NFT costs "~0.015 SOL", which is 3.4x the measured figure. The scan is still
// worth doing, just for less than it claims.
const POSITION_SIZE = 71;
const NFT_MINT_SIZE = 82;
const NFT_TOKEN_ACCOUNT_SIZE = 165;

// A classic SPL token account. USDC is not Token-2022, so 165 is exact.
const TOKEN_ACCOUNT_SIZE = 165;

// Price the setup a borrow in this vault still owes.
//
// `existingNftId` is the caller's already-resolved answer to "does this wallet
// hold a position NFT in this vault": null means a new one gets minted and the
// rent is owed. Pass the value from useBorrowSummary or readStoredNftId rather
// than running the scan again.
export async function estimateJupiterSetupCost({
  connection,
  walletAddress,
  existingNftId,
}: {
  connection: Connection;
  walletAddress: string;
  existingNftId: number | null;
}): Promise<SetupCost> {
  const owner = new PublicKey(walletAddress);
  const usdcAta = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    owner,
    true,
    TOKEN_PROGRAM_ID,
  );

  const [usdcInfo, haveLamports, floorLamports] = await Promise.all([
    connection.getAccountInfo(usdcAta, {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 0 },
    }),
    connection.getBalance(owner, "confirmed"),
    rentFor(connection, 0),
  ]);

  const items: SetupCostItem[] = [];

  if (existingNftId == null) {
    // One line rather than three. The NFT, its mint and its token account are
    // created together or not at all, and naming all three invites the question
    // of which one the user is allowed to skip. None of them.
    const [positionRent, mintRent, tokenRent] = await Promise.all([
      rentFor(connection, POSITION_SIZE),
      rentFor(connection, NFT_MINT_SIZE),
      rentFor(connection, NFT_TOKEN_ACCOUNT_SIZE),
    ]);
    items.push({
      label: "The account that holds your loan",
      lamports: positionRent + mintRent + tokenRent,
    });
  }

  if (!usdcInfo) {
    items.push({
      label: "A USDC account to receive the loan",
      lamports: await rentFor(connection, TOKEN_ACCOUNT_SIZE),
    });
  }

  return toSetupCost({
    venueLabel: "Jupiter Lend",
    items,
    haveLamports,
    floorLamports,
  });
}
