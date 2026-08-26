import { ONDO_DEPOSIT_NETWORK, ONDO_EQUITY_HAIRCUT } from "./constants";
import { findMarket, type OndoCatalog, type OndoCollateralAsset } from "./markets";
import type { OndoMarket } from "./types";

// What Ondo will actually credit as margin, and what it is worth once credited.
//
// The set is **discovered from the live token config**, not hardcoded. Ondo
// added CRCLon, SPCXon and SNDKon between 2026-08-10 and 2026-08-25 without
// touching their prose docs, which still list three assets. A hardcoded list
// would have silently refused the new ones, and refusing collateral a user
// holds is the same class of bug as accepting collateral that earns nothing.
//
// The registry below carries only what the API does not return: the haircut,
// the per-account cap, and a label. Everything else, including whether an asset
// exists at all, comes from `GET /v1/markets`.
//
// Three facts make this harder than reading a list:
//
//   1. **A deposit address is not a collateral check.** `provision_address`
//      returns a valid address for TSLAon, which is not accepted collateral,
//      and only rejects a symbol Ondo has never heard of. Measured 2026-08-25.
//      So the token config is the gate, and this module is where that gate is.
//   2. **Credited value needs a market to mark against.** Ondo prices deposited
//      collateral at "the mark price for the corresponding market on the
//      exchange". GLDon and SLVon have no such market: Ondo lists XAU and XAG,
//      spot metals, not the GLD and SLV ETFs. They can be deposited, but we
//      cannot compute what they are worth as margin before the fact, so we do
//      not pretend to.
//   3. **Denominations do not always line up.** SLVon quotes near $62.87
//      against XAG's $69.23/oz, which is right for a ~0.9 oz SLV share. GLDon
//      implies ~$2,300, about half an ounce, which is not a GLD share. SNDKon
//      quotes at roughly half of SNDK's mark. Whatever the cause, a token's
//      denomination is never assumed here: value is either marked against a
//      real market or reported as unknown.

export interface OndoCollateral {
  symbol: string;
  label: string;
  contractAddress: string;
  decimals: number;
  // Discount applied before the holding counts as margin.
  haircut: number;
  // Per-account cap in tokens. Quantity above it deposits and withdraws
  // normally but credits no additional margin. Null where Ondo has published
  // no figure, which is every asset outside the original three.
  capTokens: number | null;
  // The market this is marked against, when one exists.
  pricingMarket: string | null;
  markPriceUsd: string | null;
  // False when we cannot value it up front: no pricing market. Still
  // depositable, just not projectable.
  priceable: boolean;
  // False when Ondo lists an asset this registry has never seen. Surfaced
  // rather than dropped, because a new collateral type is news.
  known: boolean;
  // False when Ondo's docs do not name this as accepted collateral. The token
  // is in their live config and routable, but the haircut, the cap, and
  // whether it credits margin at all are unconfirmed. Funding still works and
  // says so; nothing sizes a position against it silently.
  documented: boolean;
}

interface CollateralMeta {
  label: string;
  haircut: number;
  capTokens: number | null;
  // Whether Ondo's own documentation names this as accepted collateral, with a
  // published haircut and cap. See the note on `documented` below: this is the
  // difference between a figure Ondo stated and one we inferred.
  documented: boolean;
}

// Caps and haircuts come from Ondo's funding and collateral docs.
//
// **Ondo's docs and Ondo's API disagree about this list, and the gap is not
// small.** `tokenizedcollateral` says "Supported assets at launch: QQQon and
// SPYon", and `funding-your-account.md` publishes a haircut and cap for USDC,
// SPYon and QQQon only. The live `tokenConfig` carries eight assets. Every
// previous disagreement of this kind in this integration resolved in favour of
// the API (SPY and QQQ re-enabled, fees cut, three collateral assets added, all
// undocumented), and "at launch" is explicitly a point-in-time statement, so
// the API is probably ahead again. Probably is not good enough to bridge
// someone's money on, so the difference is recorded rather than flattened.
//
// `documented: false` means: Ondo lists the token, we can route to it, and we
// have no published confirmation it credits margin or at what haircut. The
// 10% below is an assumption inherited from the equity assets, not a fact.
const META: Record<string, CollateralMeta> = {
  USDC: { label: "USD Coin", haircut: 0, capTokens: null, documented: true },
  SPYon: { label: "S&P 500 (SPY)", haircut: ONDO_EQUITY_HAIRCUT, capTokens: 146, documented: true },
  QQQon: { label: "Nasdaq 100 (QQQ)", haircut: ONDO_EQUITY_HAIRCUT, capTokens: 166, documented: true },
  CRCLon: { label: "Circle", haircut: ONDO_EQUITY_HAIRCUT, capTokens: null, documented: false },
  SPCXon: { label: "SpaceX", haircut: ONDO_EQUITY_HAIRCUT, capTokens: null, documented: false },
  SNDKon: { label: "SanDisk", haircut: ONDO_EQUITY_HAIRCUT, capTokens: null, documented: false },
  GLDon: { label: "Gold (GLD)", haircut: ONDO_EQUITY_HAIRCUT, capTokens: null, documented: false },
  SLVon: { label: "Silver (SLV)", haircut: ONDO_EQUITY_HAIRCUT, capTokens: null, documented: false },
};

// Ondo names its tokenized equities {TICKER}on and its markets {TICKER}-USD.P.
// Deriving the market rather than mapping it is what lets a collateral asset
// Ondo adds tomorrow be priced without a code change. It is verified against
// the live catalog before use, so a derivation that does not correspond to a
// real market resolves to null instead of a broken lookup.
export function pricingMarketFor(symbol: string, markets: OndoMarket[]): OndoMarket | undefined {
  if (symbol === "USDC") return undefined;

  const ticker = symbol.endsWith("on") ? symbol.slice(0, -2) : symbol;
  return findMarket(markets, `${ticker}-USD.P`);
}

// The collateral Ondo credits, joined to what it is worth right now.
//
// Everything in the live token config is included. USDC is the quote currency
// and has no market of its own, so it is priceable by definition at 1.
export function creditableCollateral(
  assets: OndoCollateralAsset[],
  markets: OndoMarket[],
): OndoCollateral[] {
  return assets.flatMap((asset) => {
    const onchain = asset.networks.find((n) => n.network === ONDO_DEPOSIT_NETWORK);
    // Ondo credits deposits on Ethereum only. An asset listed on no network we
    // can reach is not collateral we can offer, whatever the config says.
    if (!onchain) return [];

    const meta = META[asset.symbol];
    const market = pricingMarketFor(asset.symbol, markets);
    const isUsdc = asset.symbol === "USDC";

    return [
      {
        symbol: asset.symbol,
        label: meta?.label ?? asset.symbol,
        contractAddress: onchain.contractAddress,
        decimals: onchain.decimals,
        haircut: meta?.haircut ?? ONDO_EQUITY_HAIRCUT,
        capTokens: meta?.capTokens ?? null,
        pricingMarket: market?.market ?? null,
        markPriceUsd: isUsdc ? "1" : (market?.price ?? null),
        priceable: isUsdc || (market !== undefined && Number(market.price) > 0),
        known: meta !== undefined,
        documented: meta?.documented ?? false,
      },
    ];
  });
}

export function collateralBySymbol(
  collateral: OndoCollateral[],
  symbol: string,
): OndoCollateral | undefined {
  return collateral.find((c) => c.symbol === symbol);
}

// The catalog plus the resolved collateral view, which is what the browser is
// served. Kept as an extension of OndoCatalog rather than folded into it so
// this module can depend on markets.ts without markets.ts depending back.
export interface OndoCatalogWithCollateral extends OndoCatalog {
  creditable: OndoCollateral[];
}

export interface CreditedMargin {
  // Market value of the holding before the haircut.
  marketValueUsd: number;
  // What actually counts toward the margin balance.
  creditedUsd: number;
  // Tokens above the per-account cap, which credit nothing.
  uncreditedTokens: number;
  capReached: boolean;
}

// quantity x mark price x (1 - haircut), with everything above the cap worth
// zero margin. Returns null for an asset with no pricing market rather than
// guessing: a projected margin figure that turns out wrong is worse than an
// honest "confirmed once it lands".
export function creditedMargin(
  asset: OndoCollateral,
  quantityTokens: number,
): CreditedMargin | null {
  const mark = Number(asset.markPriceUsd);
  if (!asset.priceable || !(mark > 0) || !(quantityTokens > 0)) return null;

  const capped =
    asset.capTokens === null ? quantityTokens : Math.min(quantityTokens, asset.capTokens);

  return {
    marketValueUsd: quantityTokens * mark,
    creditedUsd: capped * mark * (1 - asset.haircut),
    uncreditedTokens: quantityTokens - capped,
    capReached: asset.capTokens !== null && quantityTokens > asset.capTokens,
  };
}

// The largest deposit of this asset that still earns margin, in USD. Depositing
// past it is not a loss, the tokens are withdrawable, but it buys nothing.
export function collateralCeilingUsd(asset: OndoCollateral): number | null {
  const mark = Number(asset.markPriceUsd);
  if (asset.capTokens === null || !(mark > 0)) return null;
  return asset.capTokens * mark;
}

// Ethereum addresses of every asset Ondo credits, lowercased.
//
// This duplicates the live token config on purpose. It is the allowlist the
// Trustware proxy validates a funding destination against, and that guard has
// to be a fixed set resolved server-side rather than whatever an upstream API
// said this second, or the proxy becomes an open bridge to any address a
// caller names. scripts/ondo-collateral-check.mts asserts it still matches
// Ondo, so drift fails loudly instead of silently widening or narrowing it.
export const ONDO_MARGIN_TOKENS: Record<string, string> = {
  USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  SPYon: "0xfedc5f4a6c38211c1338aa411018dfaf26612c08",
  QQQon: "0x0e397938c1aa0680954093495b70a9f5e2249aba",
  GLDon: "0x423d42e505e64f99b6e277eb7ed324cc5606f139",
  SLVon: "0xf3e4872e6a4cf365888d93b6146a2baa7348f1a4",
  CRCLon: "0x3632dea96a953c11dac2f00b4a05a32cd1063fae",
  SPCXon: "0xc9eef266834730340a55b6cc24621b31baf55581",
  SNDKon: "0x71e2400cf1cb83204f33794ed326636a71a9aafc",
};

export const ONDO_MARGIN_TOKEN_ADDRESSES = new Set(Object.values(ONDO_MARGIN_TOKENS));
