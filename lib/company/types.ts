// What the Terminal's asset detail shows about the underlying company, in the
// shapes the page draws. All of it comes from Nasdaq's site API, normalised
// server-side in nasdaq.ts so the page never sees a "$109,417,000" string.

export type CompanySection =
  | "quote"
  | "summary"
  | "financials"
  | "profile"
  | "dividends"
  | "insiders"
  | "filings";

export interface CompanyQuote {
  ticker: string;
  // The exchange's own last sale and its move over the regular session.
  last: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  // "Open", "Closed", "After Hours", "Pre Market", as Nasdaq writes it.
  marketStatus: string;
  lastTradeAt: string | null;
  // The extended-hours print, when there is one. Null during the regular
  // session and for names with no after-hours trade.
  extended: {
    last: number | null;
    change: number | null;
    changePct: number | null;
    at: string | null;
  } | null;
  dayRange: string | null;
  fiftyTwoWeekRange: string | null;
}

export interface CompanySummary {
  sector: string | null;
  industry: string | null;
  marketCapUsd: number | null;
  previousClose: number | null;
  averageVolume: number | null;
  oneYearTarget: number | null;
  dividendYieldPct: number | null;
  annualDividend: number | null;
  exDividendDate: string | null;
  // Funds only.
  expenseRatioPct: number | null;
}

export interface StatementRow {
  label: string;
  // One per period, oldest last, in USD (or percent for the ratios table).
  // Null where Nasdaq wrote "--".
  values: (number | null)[];
  // A section label in the source table ("Current Assets"), with no figures.
  group: boolean;
}

export interface EpsQuarter {
  // "Jun 2026", as the source writes the fiscal quarter.
  quarter: string;
  eps: number | null;
  consensus: number | null;
  surprisePct: number | null;
}

export interface CompanyFinancials {
  // Quarter end dates, latest first, as Nasdaq writes them ("6/27/2026").
  periods: string[];
  income: StatementRow[];
  balance: StatementRow[];
  cashFlow: StatementRow[];
  ratios: StatementRow[];
  // Reported quarters, latest first, and the consensus for the quarters ahead.
  epsActual: EpsQuarter[];
  epsForecast: EpsQuarter[];
}

export interface CompanyProfile {
  name: string;
  description: string;
  sector: string | null;
  industry: string | null;
  region: string | null;
  website: string | null;
}

export interface DividendEvent {
  exDate: string;
  type: string;
  amount: number | null;
  declared: string | null;
  record: string | null;
  paid: string | null;
}

export interface CompanyDividends {
  yieldPct: number | null;
  annual: number | null;
  exDate: string | null;
  payDate: string | null;
  payoutRatioPct: number | null;
  history: DividendEvent[];
}

export interface InsiderTrade {
  insider: string;
  relation: string;
  date: string;
  type: string;
  ownType: string;
  shares: number | null;
  price: number | null;
  held: number | null;
}

export interface CompanyFiling {
  form: string;
  filed: string;
  period: string | null;
  reportingOwner: string | null;
  url: string | null;
}

export interface SectionResponse<T> {
  data: T;
  fetchedAt: number;
  stale: boolean;
}
