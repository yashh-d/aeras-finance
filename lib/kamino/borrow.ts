import {
  KAMINO_USDC_BORROW,
  kaminoCollateralByMint,
  type KaminoCollateralReserve,
} from "./reserves";

// Convert a UI float to atomic base units as a decimal string. Kamino's KTX API
// takes amounts as integer strings. Kept string-based to avoid float rounding on
// large values. Mirrors lib/jupiter/borrow.toAtomicBN but returns a string.
export function toAtomicString(amount: number, decimals: number): string {
  const [whole, frac = ""] = amount.toString().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+/, "") || "0";
  return combined;
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

// Build an unsigned base64 transaction that borrows `borrowUi` USDC against an
// already-deposited obligation. Throws KaminoKtxError with code
// KLEND_OBLIGATION_NOT_FOUND if the user has not deposited collateral yet.
export async function buildKaminoBorrowTx({
  walletAddress,
  borrowUi,
}: {
  walletAddress: string;
  borrowUi: number;
}): Promise<string> {
  return buildViaKtx(
    "borrow",
    walletAddress,
    KAMINO_USDC_BORROW.reserve,
    String(borrowUi),
  );
}

// Convenience for callers that hold a collateral mint rather than a reserve
// record. Returns undefined for unsupported (non-curated) mints.
export function kaminoCollateralForMint(
  collateralMint: string,
): KaminoCollateralReserve | undefined {
  return kaminoCollateralByMint(collateralMint);
}
