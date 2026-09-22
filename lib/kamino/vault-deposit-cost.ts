// What a first K-Vault deposit costs in rent, and whether the wallet covers it.
// The Jupiter Lend counterpart is lib/jupiter/earn-deposit-cost.ts; the shape
// they share is lib/borrow/setup-cost.ts.
//
// KTX builds the deposit, so what it allocates is read off the instructions it
// returns rather than derived from seeds. Fetched for a fresh wallet on
// 2026-09-21, a deposit is: an associated-token create for the share account,
// the kvault deposit, then two farm instructions, initialize_user and stake,
// because a deposit auto-stakes its shares into the vault's farm. The SOL vault
// also wraps first: a wSOL create, a System transfer of the deposit and a sync.
//
// Two of those allocate. The ATA create, when the share account is missing,
// and initialize_user, which creates the farm's per-user state: 920 bytes on
// chain (account C8vZEqNpk52Nt7Y6usu4J1hwgqrtGZvhgSK7a6MTx4sb, read 2026-09-21),
// 0.0053 SOL at today's rent and the larger of the two by a factor of three.
// KTX includes initialize_user only for a wallet the farm does not know yet,
// so its presence is the signal, and the user-state account it names is what
// to price. Only the SIZE is a constant; the lamports come from the chain.
//
// Re-run `npx tsx scripts/earn-deposit-cost-check.mts` after any KTX or farms
// program change: a moved discriminator or account index would silently price
// a first deposit as free and put the raw simulation error back on screen.

import { PublicKey, type Connection } from "@solana/web3.js";

import {
  rentFor,
  toSetupCost,
  type SetupCost,
  type SetupCostItem,
} from "@/lib/borrow/setup-cost";
import { SOL_MINT } from "@/lib/jupiter/constants";
import { associatedTokenAccountRent } from "@/lib/solana/token-account-rent";
import {
  fetchKvaultInstructions,
  type KaminoVaultMeta,
  type KtxInstruction,
} from "./kvaults";

export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const KAMINO_FARMS_PROGRAM_ADDRESS =
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr";

// Anchor discriminator: sha256("global:initialize_user")[..8]. The check
// script recomputes it and matches it against live KTX output.
export const FARMS_INITIALIZE_USER_DISCRIMINATOR = "6f11b9fa3c7a26fe";

// initialize_user's accounts, in order: authority, payer, owner, delegatee,
// user_state, farm_state, system_program, rent.
const FARMS_INITIALIZE_USER_ACCOUNTS = 8;
const FARMS_USER_STATE_INDEX = 4;

// An associated-token create, idempotent or not: payer, ata, owner, mint,
// system_program, token_program. Data is empty for Create and [1] for
// CreateIdempotent; KTX sends the latter.
const ATA_CREATE_ACCOUNTS = 6;
const ATA_INDEX = 1;
const ATA_MINT_INDEX = 3;
const ATA_TOKEN_PROGRAM_INDEX = 5;

export const FARM_USER_STATE_SIZE = 920;

export type KvaultAllocation =
  | {
      kind: "token_account";
      address: string;
      mint: string;
      tokenProgram: string;
    }
  | { kind: "farm_user_state"; address: string };

// The accounts these instructions would create if they do not exist. Pure, so
// it is unit tested against captured KTX output.
export function kvaultAllocations(
  instructions: readonly KtxInstruction[],
): KvaultAllocation[] {
  const out: KvaultAllocation[] = [];
  for (const ix of instructions) {
    const data = Buffer.from(ix.data ?? "", "base64");

    if (
      ix.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS &&
      ix.accounts.length === ATA_CREATE_ACCOUNTS &&
      data.length <= 1 &&
      (data.length === 0 || data[0] === 0 || data[0] === 1)
    ) {
      out.push({
        kind: "token_account",
        address: ix.accounts[ATA_INDEX].address,
        mint: ix.accounts[ATA_MINT_INDEX].address,
        tokenProgram: ix.accounts[ATA_TOKEN_PROGRAM_INDEX].address,
      });
      continue;
    }

    if (
      ix.programAddress === KAMINO_FARMS_PROGRAM_ADDRESS &&
      ix.accounts.length === FARMS_INITIALIZE_USER_ACCOUNTS &&
      data.subarray(0, 8).toString("hex") ===
        FARMS_INITIALIZE_USER_DISCRIMINATOR
    ) {
      out.push({
        kind: "farm_user_state",
        address: ix.accounts[FARMS_USER_STATE_INDEX].address,
      });
    }
  }
  return out;
}

// Price the setup this deposit still owes. One KTX round trip for the
// instructions, one RPC round trip for existence and balance.
export async function estimateKaminoVaultDepositCost({
  connection,
  walletAddress,
  vault,
  amountAtomic,
}: {
  connection: Connection;
  walletAddress: string;
  vault: KaminoVaultMeta;
  // The deposit, in token atomic units. KTX bakes it into the instructions,
  // and for the SOL vault it also comes out of the balance that pays the rent.
  amountAtomic: string;
}): Promise<SetupCost> {
  const { instructions } = await fetchKvaultInstructions({
    action: "deposit",
    walletAddress,
    vault,
    amountAtomic,
  });
  const allocations = kvaultAllocations(instructions);
  const owner = new PublicKey(walletAddress);

  const [infos, balance, floorLamports] = await Promise.all([
    allocations.length === 0
      ? Promise.resolve([])
      : connection.getMultipleAccountsInfo(
          allocations.map((a) => new PublicKey(a.address)),
          { commitment: "confirmed", dataSlice: { offset: 0, length: 0 } },
        ),
    connection.getBalance(owner, "confirmed"),
    rentFor(connection, 0),
  ]);

  const items: SetupCostItem[] = [];
  for (let i = 0; i < allocations.length; i++) {
    if (infos[i]) continue;
    const allocation = allocations[i];
    if (allocation.kind === "farm_user_state") {
      items.push({
        label: "Your account in the vault's rewards farm",
        lamports: await rentFor(connection, FARM_USER_STATE_SIZE),
      });
      continue;
    }
    items.push({
      label:
        allocation.mint === SOL_MINT
          ? "A wrapped SOL account for the deposit"
          : `A token account to hold your ${vault.name} shares`,
      lamports: await associatedTokenAccountRent(
        connection,
        new PublicKey(allocation.mint),
        new PublicKey(allocation.tokenProgram),
      ),
    });
  }

  // A SOL deposit leaves the wallet in the same transaction that pays the
  // rent, so what is left to pay with is the balance less the deposit.
  const haveLamports =
    vault.tokenMint === SOL_MINT
      ? Math.max(0, balance - Number(amountAtomic))
      : balance;

  return toSetupCost({
    venueLabel: "Kamino",
    items,
    haveLamports,
    floorLamports,
  });
}
