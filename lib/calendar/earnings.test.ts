import { describe, expect, it } from "vitest";

import { XSTOCKS } from "@/lib/jupiter/xstocks";

import {
  buildEarningsRow,
  earningsCompanies,
  earningsViews,
  parseAnnouncementDate,
  parseConsensus,
  parseMoney,
  parseUsDate,
  verdictOf,
  type EarningsRow,
} from "./earnings";

const apple = XSTOCKS.find((x) => x.symbol === "AAPLx")!;

// Captured from Nasdaq on 2026-09-10.
const DATE = {
  data: {
    reportText:
      "Apple Inc. Common Stock is estimated to report earnings on  10/29/2026. The upcoming earnings date is derived from an algorithm based on a company's historical reporting dates. Our vendor, Zacks Investment Research, might revise this date in the future, once the company announces the actual earnings date. According to Zacks Investment Research, based on  7 analysts' forecasts, the consensus EPS forecast for the quarter is $1.98.  The reported EPS for the same quarter last year was $1.85.",
    heading: "AAPL Earnings Date",
    announcement: "Earnings announcement* for AAPL: Oct 29, 2026",
  },
  status: { rCode: 200 },
};

const SURPRISE = {
  data: {
    earningsSurpriseTable: {
      rows: [
        { fiscalQtrEnd: "Jun 2026", dateReported: "7/30/2026", eps: 1.91, consensusForecast: "1.88", percentageSurprise: "1.6" },
        { fiscalQtrEnd: "Mar 2026", dateReported: "4/30/2026", eps: 2.01, consensusForecast: "1.92", percentageSurprise: "4.69" },
      ],
    },
  },
};

describe("earningsCompanies", () => {
  it("is the equity rows only, never a fund or a metal", () => {
    const symbols = earningsCompanies().map((x) => x.symbol);
    expect(symbols).toContain("AAPLx");
    expect(symbols).not.toContain("SPYx");
    expect(symbols).not.toContain("GLDx");
    expect(symbols).not.toContain("PAXG");
  });
});

describe("buildEarningsRow", () => {
  it("reads Apple's next date, consensus and last print", () => {
    const row = buildEarningsRow(apple, DATE, SURPRISE);
    expect(row).toMatchObject({
      symbol: "AAPL",
      mint: apple.mint,
      nextAt: Date.UTC(2026, 9, 29),
      nextEstimated: true,
      nextConsensus: 1.98,
    });
    expect(row.last).toEqual({
      reportedAt: Date.UTC(2026, 6, 30),
      fiscalQuarter: "Jun 2026",
      eps: 1.91,
      consensus: 1.88,
      surprisePct: 1.6,
      verdict: "beat",
    });
  });

  it("copes with a vendor that has no next date yet", () => {
    const row = buildEarningsRow(
      apple,
      {
        data: {
          announcement: "Earnings announcement* for NVDA: ",
          reportText: "Our vendor, Zacks Investment Research, hasn't provided us with the upcoming earnings date.",
        },
      },
      SURPRISE,
    );
    expect(row.nextAt).toBeNull();
    expect(row.nextConsensus).toBeNull();
    expect(row.nextEstimated).toBe(false);
    expect(row.last?.eps).toBe(1.91);
  });

  it("survives empty bodies", () => {
    const row = buildEarningsRow(apple, null, { data: null });
    expect(row.nextAt).toBeNull();
    expect(row.last).toBeNull();
  });
});

describe("parsers", () => {
  it("reads US dates and month-name announcements", () => {
    expect(parseUsDate("7/30/2026")).toBe(Date.UTC(2026, 6, 30));
    expect(parseUsDate("2026-07-30")).toBeNull();
    expect(parseAnnouncementDate("Earnings announcement* for MSFT: Nov 4, 2026")).toBe(Date.UTC(2026, 10, 4));
    expect(parseAnnouncementDate("Earnings announcement* for NVDA: ")).toBeNull();
  });

  it("reads money in each of Nasdaq's spellings", () => {
    expect(parseMoney("$1.98")).toBe(1.98);
    expect(parseMoney("($0.16)")).toBe(-0.16);
    expect(parseMoney("-0.39")).toBe(-0.39);
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("n/a")).toBeNull();
  });

  it("finds the consensus sentence", () => {
    expect(parseConsensus(DATE.data.reportText)).toBe(1.98);
    expect(parseConsensus("the consensus EPS forecast for the quarter is ($0.03).")).toBe(-0.03);
    expect(parseConsensus("nothing here")).toBeNull();
  });

  it("calls the verdict", () => {
    expect(verdictOf(1.6)).toBe("beat");
    expect(verdictOf(-87.5)).toBe("miss");
    expect(verdictOf(0)).toBe("met");
    expect(verdictOf(null)).toBeNull();
  });
});

describe("earningsViews", () => {
  const now = Date.UTC(2026, 8, 10);
  function row(symbol: string, fields: Partial<EarningsRow>): EarningsRow {
    return { symbol, mint: symbol, name: symbol, nextAt: null, nextEstimated: true, nextConsensus: null, last: null, ...fields };
  }
  const report = (daysAgo: number, surprisePct: number) => ({
    reportedAt: now - daysAgo * 86_400_000,
    fiscalQuarter: "Jun 2026",
    eps: 1,
    consensus: 1,
    surprisePct,
    verdict: verdictOf(surprisePct),
  });

  it("leads with recent prints newest first, then upcoming soonest first, then the unknown", () => {
    const views = earningsViews(
      [
        row("LATE", { nextAt: now + 40 * 86_400_000 }),
        row("OLD", { last: report(60, 2), nextAt: now + 30 * 86_400_000 }),
        row("FRESH", { last: report(8, -3) }),
        row("NONE", {}),
        row("SOON", { nextAt: now + 2 * 86_400_000, last: report(90, 1) }),
        row("FRESHER", { last: report(1, 5) }),
      ],
      now,
    );
    expect(views.map((v) => `${v.kind}:${v.row.symbol}`)).toEqual([
      "reported:FRESHER",
      "reported:FRESH",
      "upcoming:SOON",
      "upcoming:OLD",
      "upcoming:LATE",
      "unknown:NONE",
    ]);
  });
});
