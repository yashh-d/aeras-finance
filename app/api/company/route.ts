import { NextResponse } from "next/server";

import { listedAssetByTicker, sectionsFor } from "@/lib/company/listing";
import { loadSection } from "@/lib/company/server";
import type { CompanySection } from "@/lib/company/types";

export const dynamic = "force-dynamic";

// One section of the underlying company's data for one catalog asset, from
// Nasdaq's site API. The ticker has to be a catalog asset's listing and the
// section one that listing answers, so nothing a caller sends is proxied as
// a symbol Nasdaq has not been asked about on purpose.

const SECTIONS: readonly CompanySection[] = [
  "quote",
  "summary",
  "financials",
  "profile",
  "dividends",
  "insiders",
  "filings",
];

const MAX_AGE_S: Record<CompanySection, number> = {
  quote: 15,
  summary: 300,
  financials: 3600,
  profile: 3600,
  dividends: 3600,
  insiders: 600,
  filings: 600,
};

function isSection(value: string | null): value is CompanySection {
  return value != null && (SECTIONS as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "";
  const section = searchParams.get("section");

  const listed = listedAssetByTicker(ticker);
  if (!listed) {
    return NextResponse.json({ error: "ticker is not a listed catalog asset" }, { status: 400 });
  }
  if (!isSection(section) || !sectionsFor(listed.listing).includes(section)) {
    return NextResponse.json({ error: "section not available for this asset" }, { status: 400 });
  }

  try {
    const body = await loadSection(section, listed.listing, listed.xstock.name);
    return NextResponse.json(body, {
      headers: {
        "cache-control": `public, max-age=${MAX_AGE_S[section]}, s-maxage=${MAX_AGE_S[section]}`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
