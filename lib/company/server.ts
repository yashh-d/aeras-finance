// Cached Nasdaq reads for the asset detail, one loader per section. Each
// section has its own lifetime: a quote is thirty seconds, financials six
// hours, a profile a day. Everything is served stale for a day past its
// lifetime when Nasdaq does not answer, and coalesced while in flight.

import { nasdaqJson } from "@/lib/calendar/earnings-server";

import type { NasdaqListing } from "./listing";
import {
  parseDividends,
  parseFilings,
  parseFinancials,
  parseInsiders,
  parseProfile,
  parseQuote,
  parseSummary,
} from "./nasdaq";
import type { CompanySection, SectionResponse } from "./types";

const TTL_MS: Record<CompanySection, number> = {
  quote: 30_000,
  summary: 10 * 60_000,
  financials: 6 * 60 * 60_000,
  profile: 24 * 60 * 60_000,
  dividends: 6 * 60 * 60_000,
  insiders: 60 * 60_000,
  filings: 60 * 60_000,
};
const STALE_MAX_MS = 24 * 60 * 60_000;

interface CacheEntry {
  data: unknown;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

type Loose = Record<string, unknown>;

async function read(
  section: CompanySection,
  listing: NasdaqListing,
  companyName: string,
): Promise<unknown> {
  const { ticker, assetClass } = listing;
  switch (section) {
    case "quote":
      return parseQuote(
        await nasdaqJson<Loose>(`/quote/${ticker}/info?assetclass=${assetClass}`),
        ticker,
      );
    case "summary":
      return parseSummary(
        await nasdaqJson<Loose>(`/quote/${ticker}/summary?assetclass=${assetClass}`),
      );
    case "financials": {
      const [financials, surprise, forecast] = await Promise.all([
        nasdaqJson<Loose>(`/company/${ticker}/financials?frequency=2`),
        nasdaqJson<Loose>(`/company/${ticker}/earnings-surprise`),
        nasdaqJson<Loose>(`/analyst/${ticker}/earnings-forecast`),
      ]);
      return parseFinancials(financials, surprise, forecast);
    }
    case "profile":
      return parseProfile(
        await nasdaqJson<Loose>(`/company/${ticker}/company-profile`),
        companyName,
      );
    case "dividends":
      return parseDividends(
        await nasdaqJson<Loose>(`/quote/${ticker}/dividends?assetclass=${assetClass}`),
      );
    case "insiders":
      return parseInsiders(
        await nasdaqJson<Loose>(
          `/company/${ticker}/insider-trades?limit=12&type=ALL&sortColumn=lastDate&sortOrder=DESC`,
        ),
      );
    case "filings":
      return parseFilings(
        await nasdaqJson<Loose>(
          `/company/${ticker}/sec-filings?limit=12&sortColumn=filed&sortOrder=desc&IsQuoteMedia=true`,
        ),
      );
  }
}

export async function loadSection(
  section: CompanySection,
  listing: NasdaqListing,
  companyName: string,
): Promise<SectionResponse<unknown>> {
  const key = `${section}:${listing.ticker}`;
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < TTL_MS[section]) {
    return { data: cached.data, fetchedAt: cached.fetchedAt, stale: false };
  }
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const entry: CacheEntry = {
        data: await read(section, listing, companyName),
        fetchedAt: Date.now(),
      };
      cache.set(key, entry);
      return entry;
    })().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }
  try {
    const fresh = await pending;
    return { data: fresh.data, fetchedAt: fresh.fetchedAt, stale: false };
  } catch (err) {
    if (cached && now - cached.fetchedAt < STALE_MAX_MS) {
      return { data: cached.data, fetchedAt: cached.fetchedAt, stale: true };
    }
    throw err;
  }
}
