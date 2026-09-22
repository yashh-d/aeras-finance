// How a quote's figures are written, shared by the tape, the strip and the
// stock cards so no two of them disagree about what counts as up.

import { formatUsdPrice } from "@/lib/format";

export function formatQuotePrice(price: number | null): string {
  return price == null ? "—" : `$${formatUsdPrice(price)}`;
}

export function formatChange(change: number | null): string {
  if (change == null) return "—";
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

export function changeColor(change: number | null): string {
  if (change == null) return "text-white/40";
  return change >= 0 ? "text-aeras-positive" : "text-aeras-negative";
}
