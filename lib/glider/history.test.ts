import { describe, expect, it } from "vitest";

import { parseNasdaqDate, parseNasdaqHistory, parseNasdaqPrice } from "./history";

// Trimmed from Nasdaq's answer for AAPL on 2026-09-22, newest first as it
// arrives on the wire.
const payload = {
  data: {
    symbol: "AAPL",
    totalRecords: 2512,
    tradesTable: {
      asOf: null,
      headers: { date: "Date", close: "Close/Last" },
      rows: [
        { date: "09/18/2026", close: "$336.13", volume: "86,588,200", open: "$337.905", high: "$338.49", low: "$332.53" },
        { date: "09/17/2026", close: "$337.00", volume: "36,700,230", open: "$334.77", high: "$338.34", low: "$330.1833" },
        { date: "bad", close: "$1.00" },
        { date: "09/16/2026", close: "--" },
        { date: "09/21/2016", close: "$28.3875", volume: "143,807,600", open: "$28.4625", high: "$28.4973", low: "$28.1103" },
      ],
    },
  },
  status: { rCode: 200, bCodeMessage: null },
};

describe("parseNasdaqPrice", () => {
  it("reads dollar strings", () => {
    expect(parseNasdaqPrice("$1,234.56")).toBe(1234.56);
    expect(parseNasdaqPrice("$28.3875")).toBe(28.3875);
    expect(parseNasdaqPrice(12)).toBe(12);
  });
  it("is null for blanks", () => {
    expect(parseNasdaqPrice("--")).toBeNull();
    expect(parseNasdaqPrice("")).toBeNull();
    expect(parseNasdaqPrice(null)).toBeNull();
    expect(parseNasdaqPrice("N/A")).toBeNull();
  });
});

describe("parseNasdaqDate", () => {
  it("converts MM/DD/YYYY to ISO", () => {
    expect(parseNasdaqDate("09/18/2026")).toBe("2026-09-18");
  });
  it("refuses other spellings", () => {
    expect(parseNasdaqDate("2026-09-18")).toBeNull();
    expect(parseNasdaqDate("")).toBeNull();
  });
});

describe("parseNasdaqHistory", () => {
  it("returns an ascending series and drops rows it cannot read", () => {
    const series = parseNasdaqHistory(payload);
    expect(series).toEqual([
      { date: "2016-09-21", close: 28.3875 },
      { date: "2026-09-17", close: 337 },
      { date: "2026-09-18", close: 336.13 },
    ]);
  });
  it("is empty for a ticker Nasdaq does not cover", () => {
    expect(parseNasdaqHistory({ data: { totalRecords: 0, tradesTable: { rows: null } } })).toEqual([]);
    expect(parseNasdaqHistory({})).toEqual([]);
  });
});
