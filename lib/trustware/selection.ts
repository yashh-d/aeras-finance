// Pure selection rules for the borrow surface's convert-then-deposit path.
//
// These decide what the user is shown and what gets converted, and they run
// before the planner ever prices a route. They live here rather than inline in
// the panel so they can be exercised against real balances without React: an
// off-by-one in the dust threshold or a wrong rescale is a bug that shows up as
// a needless cross-chain conversion, which is expensive and slow to notice.

import { XSTOCK_BORROW_VAULTS } from "@/lib/jupiter/borrow";
import { atomicToUi, rescaleAtomic } from "./amounts";
import { sourcesForVaultId } from "./equivalents";
import type { HeldEquivalent } from "./planner";

// Decimal places the collateral amount fields render.
export const DISPLAY_DECIMALS = 4;

// Round down to the displayed precision. Used wherever a balance is written
// into an amount field: rounding up there would put a number in the box that is
// larger than the balance it came from, and the field would fail its own
// validity check.
export function floorToDisplay(n: number): string {
  const scale = 10 ** DISPLAY_DECIMALS;
  return (Math.floor(n * scale) / scale).toString();
}

// Holdings grouped by the vault they can be converted into. A user holding
// TSLAon on Ethereum can open the TSLAx vault with no TSLAx on Solana at all,
// so this feeds vault eligibility as well as the deposit itself.
export function groupEquivalentsByVault(
  held: HeldEquivalent[],
): Map<number, HeldEquivalent[]> {
  const byVault = new Map<number, HeldEquivalent[]>();
  for (const vault of XSTOCK_BORROW_VAULTS) {
    const eligible = sourcesForVaultId(vault.vaultId);
    const matches = held.filter((h) =>
      eligible.some(
        (e) => e.chain === h.source.chain && e.token === h.source.token,
      ),
    );
    if (matches.length > 0) byVault.set(vault.vaultId, matches);
  }
  return byVault;
}

// Most that could be converted into a vault's collateral, as a 1:1 notional
// before fees, in collateral atomic units.
//
// This is the single largest holding, not the sum, because a conversion is
// never split across two sources: two routes means two sets of fees and two
// ways to fail. It widens the deposit field's ceiling only; the planner does
// the real, priced check at submit time and can still come back short.
export function largestConvertibleAtomic(
  held: HeldEquivalent[],
  collateralDecimals: number,
): string {
  let best = 0n;
  for (const h of held) {
    const scaled = BigInt(
      rescaleAtomic(h.balanceAtomic, h.source.decimals, collateralDecimals),
    );
    if (scaled > best) best = scaled;
  }
  return best.toString();
}

export function largestConvertibleUi(
  held: HeldEquivalent[],
  collateralDecimals: number,
): number {
  return Number(
    atomicToUi(largestConvertibleAtomic(held, collateralDecimals), collateralDecimals),
  );
}

// Everything convertible into a vault's collateral, summed, as a 1:1 notional
// before fees.
//
// This is the unified balance the borrow surface offers. A single conversion
// still never splits across sources; the deposit runs one conversion per source
// in sequence instead (see lib/trustware/unified.ts), which is what makes the
// sum spendable rather than merely displayable.
export function totalConvertibleAtomic(
  held: HeldEquivalent[],
  collateralDecimals: number,
): string {
  let total = 0n;
  for (const h of held) {
    total += BigInt(
      rescaleAtomic(h.balanceAtomic, h.source.decimals, collateralDecimals),
    );
  }
  return total.toString();
}

export function totalConvertibleUi(
  held: HeldEquivalent[],
  collateralDecimals: number,
): number {
  return Number(
    atomicToUi(totalConvertibleAtomic(held, collateralDecimals), collateralDecimals),
  );
}

// One unit of the amount field's display precision, in collateral atomic units.
// A shortfall smaller than this is a rounding artifact of rendering 4 decimals,
// not a real gap.
export function dustAtomic(collateralDecimals: number): string {
  const exp = Math.max(0, collateralDecimals - DISPLAY_DECIMALS);
  return (10n ** BigInt(exp)).toString();
}

// Whether a deposit actually needs a cross-chain conversion.
//
// The shortfall has to clear the dust threshold: the collateral field renders 4
// decimals, so a "max" can round to a hair more than the wallet holds, and
// running a bridged conversion to cover a display artifact would be absurd. The
// caller's clamp already handles that case for free.
export function needsConversion(args: {
  requestedAtomic: string;
  onSolanaAtomic: string;
  collateralDecimals: number;
  heldCount: number;
}): boolean {
  if (args.heldCount === 0) return false;
  const shortfall = BigInt(args.requestedAtomic) - BigInt(args.onSolanaAtomic);
  return shortfall > BigInt(dustAtomic(args.collateralDecimals));
}
