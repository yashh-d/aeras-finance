import { describe, expect, it } from "vitest";

import { computeHighlights } from "./highlights";
import {
  parseFinancials,
  parseInsiders,
  parseNumber,
  parseQuote,
  parseStatement,
  parseSummary,
} from "./nasdaq";

describe("parseNumber", () => {
  it("reads every spelling Nasdaq uses", () => {
    expect(parseNumber("$109,417,000")).toBe(109_417_000);
    expect(parseNumber("-$2,455,000")).toBe(-2_455_000);
    expect(parseNumber("+2.39%")).toBe(2.39);
    expect(parseNumber("(1.25)")).toBe(-1.25);
    expect(parseNumber("29,442,046.728355")).toBeCloseTo(29_442_046.728355);
    expect(parseNumber(1.5)).toBe(1.5);
  });
  it("is null for blanks and dashes", () => {
    expect(parseNumber("--")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("N/A")).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });
});

// Trimmed from Nasdaq's answers for AAPL on 2026-09-11.
const INFO = {
  data: {
    symbol: "AAPL",
    primaryData: {
      lastSalePrice: "$334.39",
      netChange: "+7.82",
      percentageChange: "+2.39%",
      lastTradeTimestamp: "Sep 11, 2026 12:53 PM ET",
      volume: "29,442,046.728355",
    },
    secondaryData: null,
    marketStatus: "Open",
    keyStats: {
      fiftyTwoWeekHighLow: { label: "52 Week Range:", value: "226.65 - 344.57" },
      dayrange: { label: "High/Low:", value: "326.30 - 336.22" },
    },
  },
};

const STATEMENT = {
  headers: { value1: "Quarterly Ending:", value2: "6/27/2026", value3: "3/28/2026" },
  rows: [
    { value1: "Total Revenue", value2: "$109,417,000", value3: "$95,359,000" },
    { value1: "Operating Expenses", value2: "", value3: "" },
    { value1: "Non-Recurring Items", value2: "--", value3: "--" },
  ],
};

describe("parseQuote and parseSummary", () => {
  it("reads the regular session and leaves extended null when there is none", () => {
    const q = parseQuote(INFO, "AAPL");
    expect(q).toMatchObject({
      last: 334.39,
      change: 7.82,
      changePct: 2.39,
      marketStatus: "Open",
      extended: null,
      dayRange: "326.30 - 336.22",
    });
    expect(q.volume).toBeCloseTo(29_442_046.73, 1);
  });

  it("reads an after-hours print when Nasdaq sends one", () => {
    const q = parseQuote(
      { data: { ...INFO.data, marketStatus: "After Hours", secondaryData: { lastSalePrice: "$335.10", netChange: "+0.71", percentageChange: "+0.21%", lastTradeTimestamp: "Sep 11, 2026 7:59 PM ET" } } },
      "AAPL",
    );
    expect(q.extended).toEqual({ last: 335.1, change: 0.71, changePct: 0.21, at: "Sep 11, 2026 7:59 PM ET" });
  });

  it("reads the summary's labelled pairs", () => {
    const s = parseSummary({
      data: {
        summaryData: {
          Sector: { label: "Sector", value: "Technology" },
          MarketCap: { label: "Market Cap", value: "4,880,147,850,200" },
          PreviousClose: { label: "Previous Close", value: "$326.57" },
          Yield: { label: "Current Yield", value: "0.33%" },
        },
      },
    });
    expect(s).toMatchObject({ sector: "Technology", marketCapUsd: 4_880_147_850_200, previousClose: 326.57, dividendYieldPct: 0.33, industry: null });
  });
});

describe("parseStatement", () => {
  it("scales thousands to dollars, keeps dashes null and marks section rows", () => {
    const { periods, rows } = parseStatement(STATEMENT, 1000);
    expect(periods).toEqual(["6/27/2026", "3/28/2026"]);
    expect(rows[0]).toEqual({ label: "Total Revenue", values: [109_417_000_000, 95_359_000_000], group: false });
    expect(rows[1]).toEqual({ label: "Operating Expenses", values: [null, null], group: true });
    expect(rows[2]).toEqual({ label: "Non-Recurring Items", values: [null, null], group: false });
  });
});

describe("computeHighlights", () => {
  const financials = parseFinancials(
    {
      data: {
        incomeStatementTable: {
          headers: { value1: "Q", value2: "6/27/2026", value3: "3/28/2026", value4: "12/27/2025", value5: "9/27/2025" },
          rows: [
            { value1: "Total Revenue", value2: "$100,000", value3: "$100,000", value4: "$100,000", value5: "$100,000" },
            { value1: "Operating Income", value2: "$30,000", value3: "$30,000", value4: "$30,000", value5: "$30,000" },
            { value1: "Net Income", value2: "$20,000", value3: "$20,000", value4: "$20,000", value5: "$20,000" },
          ],
        },
        balanceSheetTable: {
          headers: { value1: "Q", value2: "6/27/2026", value3: "3/28/2026", value4: "12/27/2025", value5: "9/27/2025" },
          rows: [{ value1: "Cash and Cash Equivalents", value2: "$5,000", value3: "$4,000", value4: "$3,000", value5: "$2,000" }],
        },
        cashFlowTable: {
          headers: { value1: "Q", value2: "6/27/2026", value3: "3/28/2026", value4: "12/27/2025", value5: "9/27/2025" },
          rows: [
            { value1: "Depreciation", value2: "$1,000", value3: "$1,000", value4: "$1,000", value5: "$1,000" },
            { value1: "Net Cash Flow-Operating", value2: "$25,000", value3: "$25,000", value4: "$25,000", value5: "$25,000" },
            { value1: "Capital Expenditures", value2: "-$5,000", value3: "-$5,000", value4: "-$5,000", value5: "-$5,000" },
          ],
        },
        financialRatiosTable: {
          headers: { value1: "Q", value2: "6/27/2026", value3: "3/28/2026", value4: "12/27/2025", value5: "9/27/2025" },
          rows: [
            { value1: "Gross Margin", value2: "50.05621%", value3: "49%", value4: "48%", value5: "47%" },
            { value1: "Profit Margin", value2: "27.2252%", value3: "26%", value4: "25%", value5: "24%" },
          ],
        },
      },
    },
    { data: { earningsSurpriseTable: { rows: [
      { fiscalQtrEnd: "Jun 2026", eps: 1.91, consensusForecast: "1.88", percentageSurprise: "1.6" },
      { fiscalQtrEnd: "Mar 2026", eps: 2.01, consensusForecast: "1.92", percentageSurprise: "4.69" },
      { fiscalQtrEnd: "Dec 2025", eps: 2.84, consensusForecast: "2.65", percentageSurprise: "7.17" },
      { fiscalQtrEnd: "Sep 2025", eps: 1.85, consensusForecast: "1.73", percentageSurprise: "6.94" },
    ] } } },
    { data: { quarterlyForecast: { rows: [
      { fiscalEnd: "Sep 2026", consensusEPSForecast: 1.98 },
      { fiscalEnd: "Dec 2026", consensusEPSForecast: 2.91 },
      { fiscalEnd: "Mar 2027", consensusEPSForecast: 2.16 },
      { fiscalEnd: "Jun 2027", consensusEPSForecast: 2.05 },
    ] } } },
  );

  it("sums flows over the quarters and takes the latest stock figures", () => {
    const h = computeHighlights(financials, 334.39);
    expect(h.quarters).toBe(4);
    expect(h.revenueTtm).toBe(400_000_000);
    expect(h.netIncomeTtm).toBe(80_000_000);
    expect(h.ebitdaTtm).toBe(124_000_000);
    expect(h.freeCashFlowTtm).toBe(80_000_000);
    expect(h.cash).toBe(5_000_000);
    expect(h.grossMarginPct).toBeCloseTo(50.056, 2);
    expect(h.netMarginPct).toBeCloseTo(27.225, 2);
    expect(h.epsTtm).toBeCloseTo(8.61, 5);
    expect(h.peRatio).toBeCloseTo(334.39 / 8.61, 4);
    expect(h.forwardPe).toBeCloseTo(334.39 / 9.1, 4);
  });

  it("gives nulls rather than guesses without a price or with fewer than four quarters of EPS", () => {
    expect(computeHighlights(financials, null).peRatio).toBeNull();
    const thin = { ...financials, epsActual: financials.epsActual.slice(0, 2) };
    expect(computeHighlights(thin, 300).epsTtm).toBeNull();
    expect(computeHighlights(thin, 300).peRatio).toBeNull();
  });

  it("carries the EPS history and forecast through", () => {
    expect(financials.epsActual[0]).toEqual({ quarter: "Jun 2026", eps: 1.91, consensus: 1.88, surprisePct: 1.6 });
    expect(financials.epsForecast[0]).toEqual({ quarter: "Sep 2026", eps: null, consensus: 1.98, surprisePct: null });
  });
});


describe("parseInsiders", () => {
  const row = { insider: "NEWSTEAD JENNIFER", relation: "Officer", lastDate: "9/01/2026", transactionType: "Automatic Sell", ownType: "Direct", sharesTraded: "1,439", lastPrice: "$317.01", sharesHeld: "35,790" };
  it("reads the nested table Nasdaq actually sends", () => {
    const trades = parseInsiders({ data: { transactionTable: { table: { rows: [row] } } } });
    expect(trades).toEqual([
      { insider: "NEWSTEAD JENNIFER", relation: "Officer", date: "9/01/2026", type: "Automatic Sell", ownType: "Direct", shares: 1439, price: 317.01, held: 35790 },
    ]);
  });
  it("accepts the flat shape too, and is empty for nothing", () => {
    expect(parseInsiders({ data: { transactionTable: { rows: [row] } } })).toHaveLength(1);
    expect(parseInsiders({ data: null })).toEqual([]);
  });
});
