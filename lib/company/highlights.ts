// The ten tiles at the top of the Financials tab, derived from the statement
// tables and the earnings history. Flow figures (revenue, income, EBITDA,
// free cash flow) are summed over the quarters on hand, which Nasdaq gives as
// four, so they are trailing twelve months; stock figures (cash) and margins
// are the latest quarter. P/E is the price over the last four reported EPS,
// forward P/E over the next four consensus figures. Anything that cannot be
// computed is null and the tile draws a dash rather than a guess.

import type { CompanyFinancials, StatementRow } from "./types";

export interface Highlights {
  quarters: number;
  revenueTtm: number | null;
  netIncomeTtm: number | null;
  ebitdaTtm: number | null;
  freeCashFlowTtm: number | null;
  cash: number | null;
  grossMarginPct: number | null;
  netMarginPct: number | null;
  epsTtm: number | null;
  peRatio: number | null;
  forwardPe: number | null;
}

function row(rows: readonly StatementRow[], label: string): StatementRow | undefined {
  return rows.find((r) => r.label === label && !r.group);
}

function sum(values: readonly (number | null)[] | undefined): number | null {
  if (!values) return null;
  const present = values.filter((v): v is number => v != null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

function latest(values: readonly (number | null)[] | undefined): number | null {
  return values?.[0] ?? null;
}

function add(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : a + b;
}

export function computeHighlights(
  f: CompanyFinancials,
  price: number | null,
): Highlights {
  const revenue = sum(row(f.income, "Total Revenue")?.values);
  const netIncome = sum(row(f.income, "Net Income")?.values);
  const operating = sum(row(f.income, "Operating Income")?.values);
  const depreciation = sum(row(f.cashFlow, "Depreciation")?.values);
  const ocf = sum(row(f.cashFlow, "Net Cash Flow-Operating")?.values);
  // Capital expenditures are written negative, so free cash flow is a sum.
  const capex = sum(row(f.cashFlow, "Capital Expenditures")?.values);

  const epsTtm = f.epsActual.length >= 4 ? sum(f.epsActual.slice(0, 4).map((q) => q.eps)) : null;
  const forwardEps =
    f.epsForecast.length >= 4 ? sum(f.epsForecast.slice(0, 4).map((q) => q.consensus)) : null;

  return {
    quarters: f.periods.length,
    revenueTtm: revenue,
    netIncomeTtm: netIncome,
    ebitdaTtm: add(operating, depreciation),
    freeCashFlowTtm: add(ocf, capex),
    cash: latest(row(f.balance, "Cash and Cash Equivalents")?.values),
    grossMarginPct: latest(row(f.ratios, "Gross Margin")?.values),
    netMarginPct: latest(row(f.ratios, "Profit Margin")?.values),
    epsTtm,
    peRatio: price != null && epsTtm != null && epsTtm > 0 ? price / epsTtm : null,
    forwardPe: price != null && forwardEps != null && forwardEps > 0 ? price / forwardEps : null,
  };
}
