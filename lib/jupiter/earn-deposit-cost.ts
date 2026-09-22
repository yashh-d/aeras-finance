// What a first Jupiter Lend Earn deposit costs in rent, and whether the wallet
// covers it. The borrow-side counterpart is ./first-position.ts; the Kamino
// vault counterpart is lib/kamino/vault-deposit-cost.ts. All three share the
// shape in lib/borrow/setup-cost.ts.
//
// A deposit (buildDepositIxs in ./earn.ts) allocates at most two accounts,
// both token accounts owned by the user: the associated token account for the
// vault's share token, which the Lend SDK's getDepositIxs creates when it is
// missing, and for the SOL vault a wrapped-SOL account the deposit funds. Both
// live under the ASSET's token program, because the SDK derives the share ATA
// from the asset mint's owner (getDepositContext reads `tokenProgram` off the
// asset). That is why USDG, a Token-2022 mint, gets a Token-2022 share account
// and pays more rent than the classic rows, and why the size is computed from
// the mint rather than assumed to be 165.
//
// Nothing per-user beyond that: Lend Earn tracks a position as a share balance,
// not as an account, so a second deposit into the same vault costs nothing.

import { PublicKey, type Connection } from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  rentFor,
  toSetupCost,
  type SetupCost,
  type SetupCostItem,
} from "@/lib/borrow/setup-cost";
import { associatedTokenAccountRent } from "@/lib/solana/token-account-rent";
import type { EarnAssetMeta } from "./earn";

// The SDK derives every ATA with allowOwnerOffCurve; matched here so the
// address checked is the one the deposit will write to. See ./earn.ts.
const ALLOW_OWNER_OFF_CURVE = true;

export async function estimateJupiterEarnDepositCost({
  connection,
  walletAddress,
  meta,
  amountAtomic,
}: {
  connection: Connection;
  walletAddress: string;
  meta: EarnAssetMeta;
  // The deposit, in the asset's atomic units. Only the SOL vault reads it: a
  // SOL deposit spends the same balance the rent comes out of.
  amountAtomic: string;
}): Promise<SetupCost> {
  const owner = new PublicKey(walletAddress);
  const asset = new PublicKey(meta.assetMint);
  const shareMint = new PublicKey(meta.jlTokenMint);

  // The token program is whichever owns the asset mint, which is what the SDK
  // reads too. The wrapped-SOL mint is classic.
  const assetInfo = await connection.getAccountInfo(asset, {
    commitment: "confirmed",
    dataSlice: { offset: 0, length: 0 },
  });
  const tokenProgram = assetInfo?.owner ?? TOKEN_PROGRAM_ID;

  const shareAta = getAssociatedTokenAddressSync(
    shareMint,
    owner,
    ALLOW_OWNER_OFF_CURVE,
    tokenProgram,
  );
  const addresses = [shareAta];
  if (meta.isNativeSol) {
    addresses.push(
      getAssociatedTokenAddressSync(
        NATIVE_MINT,
        owner,
        ALLOW_OWNER_OFF_CURVE,
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  const [infos, balance, floorLamports] = await Promise.all([
    connection.getMultipleAccountsInfo(addresses, {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 0 },
    }),
    connection.getBalance(owner, "confirmed"),
    rentFor(connection, 0),
  ]);
  const [shareInfo, wsolInfo] = infos;

  const items: SetupCostItem[] = [];
  if (!shareInfo) {
    items.push({
      label: `A token account to hold your ${meta.symbol} vault shares`,
      lamports: await associatedTokenAccountRent(
        connection,
        shareMint,
        tokenProgram,
      ),
    });
  }
  if (meta.isNativeSol && !wsolInfo) {
    items.push({
      label: "A wrapped SOL account for the deposit",
      lamports: await rentFor(connection, ACCOUNT_SIZE),
    });
  }

  // A SOL deposit leaves the wallet in the same transaction that pays the
  // rent, so what is left to pay with is the balance less the deposit.
  const haveLamports = meta.isNativeSol
    ? Math.max(0, balance - Number(amountAtomic))
    : balance;

  return toSetupCost({
    venueLabel: "Jupiter Lend",
    items,
    haveLamports,
    floorLamports,
  });
}
