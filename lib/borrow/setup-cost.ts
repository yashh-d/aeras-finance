// What it costs to open a FIRST position at a lending venue, and whether the
// wallet can cover it.
//
// Solana charges rent to keep an account alive. A venue that tracks per-user
// state has to allocate that state the first time you use it, and the user pays
// for it out of their SOL. On Kamino that is a UserMetadata account, an address
// lookup table and an obligation; on Jupiter Lend it is a position record, an
// NFT mint and the token account that holds the NFT. Later positions at the
// same venue reuse those accounts and cost nothing.
//
// This was a live failure, not a hypothetical. An embedded wallet holding
// 990,000 lamports tried to open a Kamino position and the transaction died
// inside CreateLookupTable with "insufficient lamports 990000, need 1165272",
// which reached the user as a raw simulation dump. The wallet was not slightly
// short, it was 31x short, and nothing on screen had said the position cost
// anything beyond the collateral.
//
// Two rules fall out of that and both matter:
//
// 1. **Never hardcode a lamport figure.** Mainnet rent has come down: the RPC
//    currently returns 810,624 for a zero-byte account where the constant every
//    doc quotes is 890,880, and the live Kamino accounts sampled while building
//    this hold more lamports than today's rent requires. Sizes are stable, so
//    sizes are the constants and the price is always read from the chain.
//
// 2. **Price per venue, never once.** Kamino costs 0.030500 SOL and Jupiter
//    Lend 0.004446 SOL, a 7x spread. One shared "about $2" number would be
//    wrong for both.

import type { Connection } from "@solana/web3.js";

// One account this transaction has to allocate, priced at today's rent.
export interface SetupCostItem {
  // What the account is, in words the user can act on. Not the account name.
  label: string;
  lamports: number;
}

export interface SetupCost {
  venueLabel: "Kamino" | "Jupiter Lend";
  // Only the accounts that do NOT already exist. Empty means this is not the
  // user's first position here and there is nothing to pay.
  items: SetupCostItem[];
  rentLamports: number;
  feeLamports: number;
  totalLamports: number;
  haveLamports: number;
  // Zero when the wallet covers the total. Positive is the gap to close.
  shortfallLamports: number;
}

// Network fees for the signatures that open a position, with headroom.
//
// The base fee is 5,000 lamports per signature and opening a position is two
// transactions at both venues, so 10,000 is the floor. This is deliberately
// several times that: the fee is real but tiny next to the rent, and quoting a
// number that turns out to be a few thousand lamports light would put the user
// back in front of the same failure they came here to avoid.
const FEE_ALLOWANCE_LAMPORTS = 30_000;

// Left in the wallet rather than spent, so a user who funds exactly enough to
// open can still sign the repay and withdraw that close the position later.
// Draining someone to zero to open a loan strands them inside it.
//
// This is a floor on the reserve, not the reserve itself. The runtime refuses
// any transaction that leaves the fee payer above zero but below the rent-exempt
// minimum for an empty account ("Transaction results in an account (0) with
// insufficient funds for rent"), and the payer always ends above zero because
// the fee is never an exact drain. So the reserve is the larger of this and
// that minimum, which the estimators read from the chain and pass in. Before
// they did, a wallet funded to exactly the priced total ended a few hundred
// thousand lamports under the floor and failed on the very transaction the
// funding was meant to unblock.
const RESERVE_LAMPORTS = 20_000;

// Rent is a pure function of account size and does not move within a session,
// so each size is priced once. Module scope: the estimate runs on every Borrow
// click and both venues ask for overlapping sizes.
const rentCache = new Map<number, number>();

export async function rentFor(
  connection: Connection,
  size: number,
): Promise<number> {
  const cached = rentCache.get(size);
  if (cached != null) return cached;
  const lamports = await connection.getMinimumBalanceForRentExemption(size);
  rentCache.set(size, lamports);
  return lamports;
}

// Assemble the final figure once a venue has decided what it must allocate.
export function toSetupCost({
  venueLabel,
  items,
  haveLamports,
  floorLamports = 0,
}: {
  venueLabel: SetupCost["venueLabel"];
  items: SetupCostItem[];
  haveLamports: number;
  // Rent-exempt minimum for a zero-byte account, `rentFor(connection, 0)`.
  // What the fee payer has to be left holding. See RESERVE_LAMPORTS.
  floorLamports?: number;
}): SetupCost {
  const rentLamports = items.reduce((sum, i) => sum + i.lamports, 0);
  const reserveLamports = Math.max(RESERVE_LAMPORTS, floorLamports);
  // Nothing to allocate means nothing to warn about: this is not a first
  // position, so the ordinary flow applies and fees come out of the balance the
  // user already has.
  if (items.length === 0) {
    return {
      venueLabel,
      items,
      rentLamports: 0,
      feeLamports: 0,
      totalLamports: 0,
      haveLamports,
      shortfallLamports: 0,
    };
  }
  const totalLamports = rentLamports + FEE_ALLOWANCE_LAMPORTS;
  return {
    venueLabel,
    items,
    rentLamports,
    feeLamports: FEE_ALLOWANCE_LAMPORTS,
    totalLamports,
    haveLamports,
    shortfallLamports: Math.max(
      0,
      totalLamports + reserveLamports - haveLamports,
    ),
  };
}

// Did this transaction die for want of SOL? The two shapes the runtime uses:
// "insufficient lamports X, need Y" from a System Program allocation, and
// "Transaction results in an account (N) with insufficient funds for rent"
// when an account it touched would end below the rent-exempt floor. Callers
// that priced the cost up front use this to reopen the funding sheet instead
// of printing either sentence, since both mean the same thing to the user.
export function isLamportShortfall(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /insufficient lamports \d+, need \d+|insufficient funds for rent/i.test(
    message,
  );
}

// True when this borrow would allocate accounts the user has to pay rent for.
//
// This, not isBlocked, is what opens the sheet. A user about to spend $3.17 on
// accounts they did not ask for and will never see should be told so and get to
// decide, even when the balance covers it: the surprise is the charge, not the
// failure. Gating on affordability instead would only ever explain the cost to
// people too poor to pay it.
export function needsSetup(cost: SetupCost): boolean {
  return cost.items.length > 0;
}

// True when this is a first position AND the wallet cannot pay for it. Decides
// which action the sheet offers, buy SOL or continue, and whether a funding
// round actually cleared the gap.
export function isBlocked(cost: SetupCost): boolean {
  return needsSetup(cost) && cost.shortfallLamports > 0;
}

export const LAMPORTS_PER_SOL = 1_000_000_000;

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

// SOL is shown to 6 decimals throughout: rent figures differ in the fourth and
// fifth, so the usual 4 would render two different accounts as the same number.
export function formatSol(lamports: number): string {
  return lamportsToSol(lamports).toFixed(6);
}

// USD alongside the SOL, because "0.030500 SOL" tells almost no one whether to
// worry. Null price renders SOL alone rather than a guess.
export function formatSolUsd(
  lamports: number,
  solPriceUsd: number | null,
): string {
  const sol = `${formatSol(lamports)} SOL`;
  if (solPriceUsd == null) return sol;
  return `${sol} · $${(lamportsToSol(lamports) * solPriceUsd).toFixed(2)}`;
}

// Turn the chain's own out-of-SOL failure into something a person can act on.
//
// CLAUDE.md forbids putting a raw RPC error on screen, and this is the exact
// error that reached a user: a 400-character simulation dump ending in
// "custom program error: 0x1". The preflight above should mean nobody sees it,
// but a balance can move between the check and the signature, so this is the
// backstop. Returns null when the error is about something else, so callers
// fall through to their own handling rather than mislabelling every failure as
// a funding problem.
export function describeInsufficientLamports(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err);
  const match = /insufficient lamports (\d+), need (\d+)/.exec(message);
  if (!match) return null;
  const have = Number(match[1]);
  const need = Number(match[2]);
  if (!Number.isFinite(have) || !Number.isFinite(need)) return null;
  return `Not enough SOL to open this position. This step needs ${formatSol(
    need,
  )} SOL and the wallet holds ${formatSol(
    have,
  )}. Add SOL and try again. Your collateral was not moved.`;
}
