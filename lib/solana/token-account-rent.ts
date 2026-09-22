// Rent for the associated token account of a mint, sized for its program.
//
// A classic SPL token account is 165 bytes, always. A Token-2022 one is not:
// the associated-token program adds ImmutableOwner to every ATA it creates,
// and the mint's own extensions can require more (a transfer-hook mint needs
// TransferHookAccount on each holder's account, and so on). Sizing the second
// kind at 165 under-prices the rent, and a sheet that under-prices sends the
// user back into the failure it was opened to prevent. So the mint is read and
// spl-token's rules are applied to it.
//
// Two of the Earn assets are Token-2022 (USDG and its jlUSDG share), which is
// why this exists at all.

import {
  ACCOUNT_SIZE,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getAccountLen,
  getAccountTypeOfMintType,
  getExtensionTypes,
  getMint,
} from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";

import { rentFor } from "@/lib/borrow/setup-cost";

export async function associatedTokenAccountSize(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey,
): Promise<number> {
  if (!programId.equals(TOKEN_2022_PROGRAM_ID)) return ACCOUNT_SIZE;
  const state = await getMint(connection, mint, "confirmed", programId);
  // spl-token's getAccountLenForMint does this mapping but leaves
  // ImmutableOwner out, which the ATA program adds unconditionally, and lets
  // the Uninitialized placeholder through for mint extensions with no account
  // counterpart, which getAccountLen would then count as four bytes each.
  const accountExtensions = getExtensionTypes(state.tlvData)
    .map(getAccountTypeOfMintType)
    .filter((t) => t !== ExtensionType.Uninitialized);
  if (!accountExtensions.includes(ExtensionType.ImmutableOwner)) {
    accountExtensions.push(ExtensionType.ImmutableOwner);
  }
  return getAccountLen(accountExtensions);
}

export async function associatedTokenAccountRent(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey,
): Promise<number> {
  return rentFor(
    connection,
    await associatedTokenAccountSize(connection, mint, programId),
  );
}
