import {
  KAMINO_USDC_BORROW,
  KAMINO_XSTOCK_COLLATERALS,
  type KaminoCollateralReserve,
} from "./reserves";
import { KaminoKtxError, toAtomicString } from "./borrow";
import type { KaminoObligationSummary } from "@/app/api/kamino/obligations/route";

export function kaminoCollateralByReserve(
  reserve: string,
): KaminoCollateralReserve | undefined {
  return KAMINO_XSTOCK_COLLATERALS.find((r) => r.reserve === reserve);
}

// A user's open Kamino position in the xStocks Market, mapped from the raw
// obligation into UI-ready numbers. Single-collateral (Vanilla) for v1.
export interface KaminoPosition {
  obligationAddress: string;
  collateral: KaminoCollateralReserve;
  collateralAtomic: string;
  collateralUi: number;
  collateralUsd: number;
  // Borrowed USDC. Kamino reports USD; USDC is a dollar stable so we treat 1:1.
  debtUsdc: number;
  // Loan-to-value and its liquidation ceiling, as percentages.
  ltvPct: number;
  liquidationLtvPct: number;
  // Implied oracle price of the collateral (USD per token) from the obligation.
  oraclePriceUsd: number | null;
}

function atomicToUi(atomic: string, decimals: number): number {
  const s = atomic.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals);
  return Number(`${whole}.${frac}`);
}

// Fetch and shape the caller's Kamino position, or null if they have none in
// this market. Only surfaces positions whose collateral is a curated reserve.
export async function fetchKaminoPosition(
  walletAddress: string,
): Promise<KaminoPosition | null> {
  const url = new URL("/api/kamino/obligations", window.location.origin);
  url.searchParams.set("wallet", walletAddress);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Kamino position read failed (${res.status})`);
  }
  const { obligation } = (await res.json()) as {
    obligation: KaminoObligationSummary | null;
  };
  if (!obligation || obligation.deposits.length === 0) return null;

  // v1 is single-collateral; take the first deposit whose reserve we recognise.
  const deposit = obligation.deposits.find((d) =>
    kaminoCollateralByReserve(d.reserve),
  );
  if (!deposit) return null;
  const collateral = kaminoCollateralByReserve(deposit.reserve)!;

  const collateralUi = atomicToUi(deposit.depositedAmount, collateral.decimals);
  const collateralUsd = Number(obligation.totalDepositUsd);
  const debtUsdc = Number(obligation.totalBorrowUsd);
  const ltvPct = Number(obligation.loanToValue) * 100;
  const liquidationLtvPct = Number(obligation.liquidationLtv) * 100;
  const oraclePriceUsd =
    collateralUi > 0 && collateralUsd > 0 ? collateralUsd / collateralUi : null;

  return {
    obligationAddress: obligation.obligationAddress,
    collateral,
    collateralAtomic: deposit.depositedAmount,
    collateralUi,
    collateralUsd,
    debtUsdc,
    ltvPct,
    liquidationLtvPct,
    oraclePriceUsd,
  };
}

// Build the base64 transactions to unwind a position: repay the USDC debt, then
// withdraw the collateral. Two signatures (Kamino has no atomic repay+withdraw
// over KTX). Repay is padded 0.5% over the reported debt so interest accrued
// between read and settlement is fully cleared; Kamino clamps repay to the
// actual outstanding debt and returns any excess.
const REPAY_BUFFER = 1.005;

export { KaminoKtxError };

async function buildViaKtx(
  action: "repay" | "withdraw",
  wallet: string,
  reserve: string,
  atomicAmount: string,
): Promise<string> {
  const res = await fetch("/api/kamino/ktx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, wallet, reserve, amount: atomicAmount }),
  });
  const payload = (await res.json()) as {
    transaction?: string;
    error?: string;
    code?: string;
  };
  if (!res.ok || !payload.transaction) {
    throw new KaminoKtxError(
      payload.error ?? `Kamino ${action} failed (${res.status})`,
      payload.code,
    );
  }
  return payload.transaction;
}

export async function buildKaminoRepayTx(
  walletAddress: string,
  debtUsdc: number,
): Promise<string> {
  const padded = debtUsdc * REPAY_BUFFER;
  const atomic = toAtomicString(padded, KAMINO_USDC_BORROW.decimals);
  return buildViaKtx("repay", walletAddress, KAMINO_USDC_BORROW.reserve, atomic);
}

export async function buildKaminoWithdrawTx(
  walletAddress: string,
  position: KaminoPosition,
): Promise<string> {
  return buildViaKtx(
    "withdraw",
    walletAddress,
    position.collateral.reserve,
    position.collateralAtomic,
  );
}
