// Identity of a borrow snapshot, for answering "has the change landed yet".
//
// Its own module rather than a helper inside the hook so the quantisation below
// can be pinned by tests without mounting React.

// Structural, not the hook's BorrowSnapshot: this reads four numbers and two
// strings, and typing it that way keeps the dependency pointing one way.
export interface SignableSnapshot {
  positions: readonly {
    key: string;
    collateralUi: number;
    debtUi: number;
  }[];
  pledged: readonly {
    mint: string;
    amountUi: number;
  }[];
}

// Debt and deposited collateral both accrue interest every slot. Comparing raw
// floats would therefore report a change on every read and end the settle loop
// on its first attempt, which is the bug the loop exists to fix.
//
// So quantise. A real deposit, borrow, repay or withdraw moves these by orders
// of magnitude more than one quantum; per-slot accrual on any position this app
// opens moves them by a small fraction of one. The exception is a position
// large enough to accrue a cent in the couple of seconds between two reads,
// which settles on its first read -- exactly the behaviour before the loop
// existed, so never worse.
const DEBT_QUANTUM = 100; // cents
const COLLATERAL_QUANTUM = 1e6; // millionths of a token

// `pledged` is included as well as `positions` because `positions` carries only
// markets with debt: without it, depositing or withdrawing collateral against
// no loan would look like nothing had changed.
export function snapshotSignature(snapshot: SignableSnapshot): string {
  const positions = snapshot.positions
    .map(
      (p) =>
        `${p.key}:${Math.round(p.collateralUi * COLLATERAL_QUANTUM)}:${Math.round(
          p.debtUi * DEBT_QUANTUM,
        )}`,
    )
    .sort();
  const pledged = snapshot.pledged
    .map((c) => `${c.mint}:${Math.round(c.amountUi * COLLATERAL_QUANTUM)}`)
    .sort();
  return [...positions, "|", ...pledged].join(",");
}
