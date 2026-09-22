// Nasdaq's site API answers with display strings: "$109,417,000", "+2.39%",
// "--". These read them into the shapes in types.ts. Every parser takes the
// raw body loosely typed and copes with a missing field, because the site API
// has no contract and a shape change should degrade a tile to a dash rather
// than fail the whole section.

import type {
  CompanyDividends,
  CompanyFiling,
  CompanyFinancials,
  CompanyProfile,
  CompanyQuote,
  CompanySummary,
  EpsQuarter,
  InsiderTrade,
  StatementRow,
} from "./types";

// "$1,234.5", "-$2,455,000", "(1.2)", "+2.39%", "53.36", "--", "N/A".
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s === "" || s === "--" || s === "N/A" || s === "NA") return null;
  const negative = s.startsWith("-") || (s.startsWith("(") && s.endsWith(")"));
  const digits = s.replace(/[^0-9.]/g, "");
  if (digits === "" || !/^\d*\.?\d+$/.test(digits)) return null;
  const n = Number(digits);
  return negative ? -n : n;
}

type Loose = Record<string, unknown> | null | undefined;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function get(o: Loose, key: string): unknown {
  return o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined;
}

function labelled(o: Loose, key: string): unknown {
  // Summary and profile fields are { label, value } pairs.
  return get(get(o, key) as Loose, "value");
}

// The array at a path, or an empty one when any step is missing.
function rowsAt(o: Loose, ...path: string[]): unknown[] {
  let cur: unknown = o;
  for (const key of path) cur = get(cur as Loose, key);
  return Array.isArray(cur) ? cur : [];
}

export function parseQuote(body: Loose, ticker: string): CompanyQuote {
  const data = get(body, "data") as Loose;
  const primary = get(data, "primaryData") as Loose;
  const secondary = get(data, "secondaryData") as Loose;
  const keyStats = get(data, "keyStats") as Loose;
  return {
    ticker,
    last: parseNumber(get(primary, "lastSalePrice")),
    change: parseNumber(get(primary, "netChange")),
    changePct: parseNumber(get(primary, "percentageChange")),
    volume: parseNumber(get(primary, "volume")),
    marketStatus: str(get(data, "marketStatus")) ?? "Unknown",
    lastTradeAt: str(get(primary, "lastTradeTimestamp")),
    extended: secondary
      ? {
          last: parseNumber(get(secondary, "lastSalePrice")),
          change: parseNumber(get(secondary, "netChange")),
          changePct: parseNumber(get(secondary, "percentageChange")),
          at: str(get(secondary, "lastTradeTimestamp")),
        }
      : null,
    dayRange: str(labelled(keyStats, "dayrange")),
    fiftyTwoWeekRange: str(labelled(keyStats, "fiftyTwoWeekHighLow")),
  };
}

export function parseSummary(body: Loose): CompanySummary {
  const sd = get(get(body, "data") as Loose, "summaryData") as Loose;
  return {
    sector: str(labelled(sd, "Sector")),
    industry: str(labelled(sd, "Industry")),
    marketCapUsd: parseNumber(labelled(sd, "MarketCap")),
    previousClose: parseNumber(labelled(sd, "PreviousClose")),
    averageVolume: parseNumber(labelled(sd, "AverageVolume") ?? labelled(sd, "FiftyDayAvgDailyVol")),
    oneYearTarget: parseNumber(labelled(sd, "OneYrTarget")),
    dividendYieldPct: parseNumber(labelled(sd, "Yield")),
    annualDividend: parseNumber(labelled(sd, "AnnualizedDividend")),
    exDividendDate: str(labelled(sd, "ExDividendDate")),
    expenseRatioPct: parseNumber(labelled(sd, "ExpenseRatio")),
  };
}

// The four statement tables share one shape: headers {value1: "Quarterly
// Ending:", value2: date, ...} and rows {value1: label, value2: figure, ...}.
// Figures are in thousands of dollars; ratios are percents and are left as
// they are.
export function parseStatement(table: Loose, scale: number): { periods: string[]; rows: StatementRow[] } {
  const headers = get(table, "headers") as Loose;
  const periods: string[] = [];
  for (let i = 2; i <= 9; i++) {
    const h = str(get(headers, `value${i}`));
    if (h) periods.push(h);
  }
  const rawRows = rowsAt(table, "rows");
  const rows: StatementRow[] = [];
  for (const raw of rawRows) {
    const r = raw as Loose;
    const label = str(get(r, "value1"));
    if (!label) continue;
    const values = periods.map((_, i) => {
      const n = parseNumber(get(r, `value${i + 2}`));
      return n == null ? null : n * scale;
    });
    const cells = periods.map((_, i) => str(get(r, `value${i + 2}`)));
    // A row Nasdaq wrote with every cell empty is a section heading; "--" in
    // every cell is a real row with nothing reported.
    const group = cells.every((c) => c == null);
    rows.push({ label, values, group });
  }
  return { periods, rows };
}

const THOUSANDS = 1000;

export function parseFinancials(
  financials: Loose,
  surprise: Loose,
  forecast: Loose,
): CompanyFinancials {
  const data = get(financials, "data") as Loose;
  const income = parseStatement(get(data, "incomeStatementTable") as Loose, THOUSANDS);
  const balance = parseStatement(get(data, "balanceSheetTable") as Loose, THOUSANDS);
  const cashFlow = parseStatement(get(data, "cashFlowTable") as Loose, THOUSANDS);
  const ratios = parseStatement(get(data, "financialRatiosTable") as Loose, 1);

  const actualRows = rowsAt(surprise, "data", "earningsSurpriseTable", "rows");
  const epsActual: EpsQuarter[] = actualRows.map((raw) => {
    const r = raw as Loose;
    return {
      quarter: str(get(r, "fiscalQtrEnd")) ?? "",
      eps: parseNumber(get(r, "eps")),
      consensus: parseNumber(get(r, "consensusForecast")),
      surprisePct: parseNumber(get(r, "percentageSurprise")),
    };
  });

  const forecastRows = rowsAt(forecast, "data", "quarterlyForecast", "rows");
  const epsForecast: EpsQuarter[] = forecastRows.map((raw) => {
    const r = raw as Loose;
    return {
      quarter: str(get(r, "fiscalEnd")) ?? "",
      eps: null,
      consensus: parseNumber(get(r, "consensusEPSForecast")),
      surprisePct: null,
    };
  });

  return {
    periods: income.periods,
    income: income.rows,
    balance: balance.rows,
    cashFlow: cashFlow.rows,
    ratios: ratios.rows,
    epsActual,
    epsForecast,
  };
}

export function parseProfile(body: Loose, fallbackName: string): CompanyProfile {
  const data = get(body, "data") as Loose;
  return {
    name: str(labelled(data, "CompanyName")) ?? fallbackName,
    description: str(labelled(data, "CompanyDescription")) ?? "",
    sector: str(labelled(data, "Sector")),
    industry: str(labelled(data, "Industry")),
    region: str(labelled(data, "Region")),
    website: str(labelled(data, "CompanyUrl")),
  };
}

export function parseDividends(body: Loose): CompanyDividends {
  const data = get(body, "data") as Loose;
  const rows = rowsAt(data, "dividends", "rows");
  return {
    yieldPct: parseNumber(get(data, "yield")),
    annual: parseNumber(get(data, "annualizedDividend")),
    exDate: str(get(data, "exDividendDate")),
    payDate: str(get(data, "dividendPaymentDate")),
    payoutRatioPct: parseNumber(get(data, "payoutRatio")),
    history: rows
      .map((raw) => {
        const r = raw as Loose;
        return {
          exDate: str(get(r, "exOrEffDate")) ?? "",
          type: str(get(r, "type")) ?? "",
          amount: parseNumber(get(r, "amount")),
          declared: str(get(r, "declarationDate")),
          record: str(get(r, "recordDate")),
          paid: str(get(r, "paymentDate")),
        };
      })
      .filter((d) => d.exDate !== ""),
  };
}

export function parseInsiders(body: Loose): InsiderTrade[] {
  // Nasdaq nests the transaction rows one level deeper than the other
  // tables: data.transactionTable.table.rows. Read 2026-09-11; the flat
  // shape is tried second in case it ever moves up.
  const nested = rowsAt(body, "data", "transactionTable", "table", "rows");
  const rows = nested.length > 0 ? nested : rowsAt(body, "data", "transactionTable", "rows");
  return rows
    .map((raw) => {
      const r = raw as Loose;
      return {
        insider: str(get(r, "insider")) ?? "",
        relation: str(get(r, "relation")) ?? "",
        date: str(get(r, "lastDate")) ?? "",
        type: str(get(r, "transactionType")) ?? "",
        ownType: str(get(r, "ownType")) ?? "",
        shares: parseNumber(get(r, "sharesTraded")),
        price: parseNumber(get(r, "lastPrice")),
        held: parseNumber(get(r, "sharesHeld")),
      };
    })
    .filter((t) => t.insider !== "");
}

export function parseFilings(body: Loose): CompanyFiling[] {
  const rows = rowsAt(body, "data", "rows");
  return rows
    .map((raw) => {
      const r = raw as Loose;
      const view = get(r, "view") as Loose;
      return {
        form: str(get(r, "formType")) ?? "",
        filed: str(get(r, "filed")) ?? "",
        period: str(get(r, "period")),
        reportingOwner: str(get(r, "reportingOwner")),
        url: str(get(view, "htmlLink")) ?? str(get(view, "pdfLink")),
      };
    })
    .filter((f) => f.form !== "");
}
