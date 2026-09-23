import { numberToAtomicString } from "@/lib/decimal";
import {
  KAMINO_USDC_BORROW,
  kaminoCollateralByMint,
  type KaminoCollateralReserve,
} from "./reserves";

// Convert a UI float to atomic base units as a decimal string. Kamino's KTX API
// takes amounts as integer strings. Kept string-based to avoid float rounding on
// large values. Mirrors lib/jupiter/borrow.toAtomicBN but returns a string.
export function toAtomicString(amount: number, decimals: number): string {
  return numberToAtomicString(amount, decimals);
}

type KtxAction = "deposit" | "borrow" | "repay" | "withdraw";

interface KtxResponse {
  transaction?: string;
  error?: string;
  code?: string;
}

// Error carrying Kamino's machine-readable code so callers can branch (e.g.
// KLEND_OBLIGATION_NOT_FOUND means "you must deposit before borrowing").
export class KaminoKtxError extends Error {
  code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "KaminoKtxError";
    this.code = code;
  }
}

async function buildViaKtx(
  action: KtxAction,
  wallet: string,
  reserve: string,
  atomicAmount: string,
): Promise<string> {
  const res = await fetch("/api/kamino/ktx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, wallet, reserve, amount: atomicAmount }),
  });
  const payload = (await res.json()) as KtxResponse;
  if (!res.ok || !payload.transaction) {
    throw new KaminoKtxError(
      payload.error ?? `Kamino ${action} failed (${res.status})`,
      payload.code,
    );
  }
  return payload.transaction;
}

// Build an unsigned base64 transaction that deposits `collateralUi` of an xStock
// into the xStocks Market. First-time depositors get their obligation created by
// this same transaction. Sign with useSignSolanaTxBase64, then send + confirm.
export async function buildKaminoDepositTx({
  walletAddress,
  collateral,
  collateralUi,
}: {
  walletAddress: string;
  collateral: KaminoCollateralReserve;
  collateralUi: number;
}): Promise<string> {
  // KTX takes a decimal token amount and applies the reserve's decimals itself.
  return buildViaKtx(
    "deposit",
    walletAddress,
    collateral.reserve,
    String(collateralUi),
  );
}

// How long to keep asking KTX for a borrow transaction after a deposit that has
// already confirmed. See buildKaminoBorrowTx.
const OBLIGATION_WAIT_MS = 45_000;
const OBLIGATION_POLL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Build an unsigned base64 transaction that borrows `borrowUi` USDC against an
// already-deposited obligation. Throws KaminoKtxError with code
// KLEND_OBLIGATION_NOT_FOUND if the user has not deposited collateral yet.
//
// `afterDeposit` exists because opening a first position is two transactions and
// KTX reads the chain between them. The deposit creates the obligation account;
// the borrow is built server-side by Kamino, off Kamino's own RPC, and that read
// lags our `confirmed` wait by a variable amount. So a wallet that has never
// touched this market deposits successfully and then gets a 400
// KLEND_OBLIGATION_NOT_FOUND on the borrow it asked for in the same breath,
// which the card can only render as "deposit before borrowing" -- advice the
// user has just followed. Retrying the whole form deposits a second time, which
// is what made this look like a vault that eats collateral and lends nothing.
//
// So: when a deposit has just landed, treat obligation-not-found as "not yet"
// rather than "never", and keep asking. Every other KTX error is still fatal on
// the first response, and a borrow with no deposit behind it (afterDeposit
// false) still fails immediately with the message that is actually true.
export async function buildKaminoBorrowTx({
  walletAddress,
  borrowUi,
  afterDeposit = false,
}: {
  walletAddress: string;
  borrowUi: number;
  // Set when this call follows a confirmed deposit in the same flow.
  afterDeposit?: boolean;
}): Promise<string> {
  const deadline = Date.now() + OBLIGATION_WAIT_MS;
  for (;;) {
    try {
      return await buildViaKtx(
        "borrow",
        walletAddress,
        KAMINO_USDC_BORROW.reserve,
        String(borrowUi),
      );
    } catch (err) {
      const notYet =
        afterDeposit &&
        err instanceof KaminoKtxError &&
        err.code === "KLEND_OBLIGATION_NOT_FOUND" &&
        Date.now() < deadline;
      if (!notYet) throw err;
      await sleep(OBLIGATION_POLL_MS);
    }
  }
}

// Convenience for callers that hold a collateral mint rather than a reserve
// record. Returns undefined for unsupported (non-curated) mints.
export function kaminoCollateralForMint(
  collateralMint: string,
): KaminoCollateralReserve | undefined {
  return kaminoCollateralByMint(collateralMint);
}
