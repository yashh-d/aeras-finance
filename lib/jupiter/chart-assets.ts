// What the Home charts can draw, beyond the buyable catalog.
//
// Two kinds of thing chart through Coingecko. The curated xStock catalog, keyed
// by mint, which is the only thing the chart route accepted until the Home
// charts grew a picker. And the entries below, which exist ONLY to be charted:
// nothing here is buyable, lendable or routable anywhere in the app, and the
// key is deliberately not a Solana mint so that no other module can mistake a
// row here for a token it may move. Where Coingecko lists a Solana mint for
// the coin it is recorded in a comment, verified 2026-09-08 against
// /coins/{id}.platforms.solana, and nowhere else.
//
// Perps are the third source and are not listed here: they come from the live
// Lighter catalog, which is state rather than configuration.

import { xstockByMint, XSTOCKS, type XStock } from "./xstocks";

export type ChartGroupId =
  | "equities"
  | "commodities"
  | "rwa"
  | "perps"
  | "crypto";

export interface ChartOnlyAsset {
  // "chart:<coingeckoId>". Never a mint.
  key: string;
  symbol: string;
  name: string;
  coingeckoId: string;
  group: Extract<ChartGroupId, "rwa" | "crypto">;
  logo?: string;
}

export const CHART_ONLY_ASSETS: readonly ChartOnlyAsset[] = [
  {
    key: "chart:bitcoin",
    symbol: "BTC",
    name: "Bitcoin",
    coingeckoId: "bitcoin",
    group: "crypto",
    logo: "/logos/markets/BTC.svg",
  },
  {
    key: "chart:ethereum",
    symbol: "ETH",
    name: "Ethereum",
    coingeckoId: "ethereum",
    group: "crypto",
    logo: "/logos/markets/ETH.svg",
  },
  {
    key: "chart:solana",
    symbol: "SOL",
    name: "Solana",
    coingeckoId: "solana",
    group: "crypto",
    logo: "/logos/solana.png",
  },
  // Ondo's tokenized treasury products. Both trade on Solana (USDY at
  // A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6, OUSG at
  // i7u4r16TcsJTgq1kAG8opmVZyVnAKBwLKu6ZPMwzxNc) but neither is in the
  // buyable catalog, so they are charted and nothing more.
  {
    key: "chart:usdy",
    symbol: "USDY",
    name: "Ondo Dollar Yield",
    coingeckoId: "ondo-us-dollar-yield",
    group: "rwa",
    logo: "/logos/ondo.png",
  },
  {
    key: "chart:ousg",
    symbol: "OUSG",
    name: "Ondo US Treasuries",
    coingeckoId: "ousg",
    group: "rwa",
    logo: "/logos/ondo.png",
  },
] as const;

// Anything a Coingecko-backed chart can be pointed at: a catalog asset or a
// chart-only one. The two are told apart by which identifier they carry.
export type ChartSubject =
  | Pick<XStock, "mint" | "symbol" | "name" | "logo">
  | ChartOnlyAsset;

// The string the chart route is asked for. A mint for catalog assets, the
// `chart:` key for the rest.
export function chartKeyOf(subject: ChartSubject): string {
  return "mint" in subject ? subject.mint : subject.key;
}

export function chartSubjectByKey(key: string): ChartSubject | undefined {
  return xstockByMint(key) ?? CHART_ONLY_ASSETS.find((a) => a.key === key);
}

// Server-side resolution for the chart route and fetchChart. Undefined means
// the key is not something the app charts, which the route turns into a 400
// before anything reaches Coingecko.
export function coingeckoIdForChartKey(key: string): string | undefined {
  return (
    xstockByMint(key)?.coingeckoId ??
    CHART_ONLY_ASSETS.find((a) => a.key === key)?.coingeckoId
  );
}

// What one Home chart slot points at.
export type ChartSelection =
  // A catalog mint or a chart-only key.
  | { kind: "asset"; key: string }
  // A Lighter market symbol. Resolved against the live catalog at render.
  | { kind: "perp"; symbol: string };

// One of each source on first paint: the catalog's first asset, which the
// Home grid also starts on, a perp, and a crypto majors line.
export const DEFAULT_CHART_SELECTIONS: readonly ChartSelection[] = [
  { kind: "asset", key: XSTOCKS[0].mint },
  { kind: "perp", symbol: "BTC" },
  { kind: "asset", key: "chart:solana" },
];

// A stable string for a selection, used as a row id and for equality.
export function chartSelectionId(selection: ChartSelection): string {
  return selection.kind === "asset"
    ? `asset:${selection.key}`
    : `perp:${selection.symbol}`;
}

// How many charts Home will stack. Each one polls Coingecko or Lighter on its
// own, and the free Coingecko tier is about thirty requests a minute shared
// with the sparklines, so the column stops growing well before that.
export const MAX_HOME_CHARTS = 6;

// What a newly added chart shows: the first catalog asset not already on
// screen, so adding a chart never duplicates one. Falls back to the first
// asset when everything is taken, which at MAX_HOME_CHARTS cannot happen.
export function nextChartSelection(
  current: readonly ChartSelection[],
): ChartSelection {
  const taken = new Set(current.map(chartSelectionId));
  for (const x of XSTOCKS) {
    const candidate: ChartSelection = { kind: "asset", key: x.mint };
    if (!taken.has(chartSelectionId(candidate))) return candidate;
  }
  return { kind: "asset", key: XSTOCKS[0].mint };
}

// Picker groups, in display order. The perps group is filled from the live
// Lighter catalog by the component, so its members are empty here.
export const CHART_GROUPS: readonly { id: ChartGroupId; label: string }[] = [
  { id: "equities", label: "Equities" },
  { id: "commodities", label: "Commodities" },
  { id: "rwa", label: "RWA" },
  { id: "perps", label: "Perps" },
  { id: "crypto", label: "Crypto" },
] as const;

export function chartGroupMembers(
  group: Exclude<ChartGroupId, "perps">,
): readonly ChartSubject[] {
  switch (group) {
    case "equities":
      return XSTOCKS.filter(
        (x) => x.category === "stocks" || x.category === "indices",
      );
    case "commodities":
      return XSTOCKS.filter((x) => x.category === "metals");
    case "rwa":
    case "crypto":
      return CHART_ONLY_ASSETS.filter((a) => a.group === group);
  }
}
