"use client";

// Presentation helpers for the Morpho gold card (components/GoldBorrowCard.tsx).
// The Aave card draws the Jupiter and Kamino shape instead and takes its
// primitives from components/borrow-fields.tsx.

import { formatUnits } from "viem";

export function fmt(
  atomic: string | bigint | undefined,
  decimals: number,
  digits = 2,
): string {
  if (atomic === undefined) return "—";
  const value = Number(formatUnits(BigInt(atomic), decimals));
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtUsd(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

// Health is the number that decides whether someone keeps their gold, so it is
// coloured rather than left as a neutral figure. The bands are the same ones
// the borrow slider's default buffer targets.
export function healthTone(health: number | null): string {
  if (health == null) return "text-white/70";
  if (health < 1.1) return "text-aeras-negative";
  if (health < 1.35) return "text-aeras-warning";
  return "text-aeras-positive";
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        {label}
      </div>
      <div className={`font-mono text-sm ${tone ?? "text-white"}`}>{value}</div>
      {sub && <div className="font-mono text-[10px] text-white/40">{sub}</div>}
    </div>
  );
}
