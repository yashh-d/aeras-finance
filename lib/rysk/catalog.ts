import { isMissingQuote, RYSK_STABLES } from "./constants";
import type {
  RyskAssetsResponse,
  RyskCollateralChoice,
  RyskCatalog,
  RyskCombination,
  RyskInventoryResponse,
  RyskOption,
  RyskProductRef,
  RyskUnderlying,
} from "./types";

// Joining /api/assets and /api/inventory into one option chain.
//
// Inventory is the strike ladder but it refers to every token by bare address
// and carries no chain id at all. Assets is the only place decimals, symbols and
// chain ids exist. So the chain a strike settles on is derived by resolving its
// token addresses, not read directly. That is safe because no address in the
// assets catalog appears on more than one chain, which is checked in
// scripts/rysk-check.mts rather than assumed here.

interface TokenInfo {
  chainId: number;
  symbol: string;
  decimals: number;
}

function buildTokenIndex(assets: RyskAssetsResponse): Map<string, TokenInfo> {
  const index = new Map<string, TokenInfo>();

  for (const [chainId, list] of Object.entries(assets)) {
    if (!Array.isArray(list)) continue;
    for (const asset of list) {
      index.set(asset.address.toLowerCase(), {
        chainId: Number(chainId),
        symbol: asset.symbol,
        decimals: asset.decimals,
      });
    }
  }

  // Stables back every put and price every strike, but they are not tradeable
  // underlyings so they never appear in /api/assets. Added last so a real asset
  // entry always wins.
  for (const [address, stable] of Object.entries(RYSK_STABLES)) {
    if (!index.has(address)) index.set(address, stable);
  }

  return index;
}

function toCollateralChoice(
  product: RyskProductRef,
  tokens: Map<string, TokenInfo>,
): RyskCollateralChoice | null {
  const asset = tokens.get(product.asset.toLowerCase());
  const collateral = tokens.get(product.collateralAsset.toLowerCase());

  // A collateral option we cannot name or scale is dropped rather than shown
  // with a placeholder. Sizing a deposit against unknown decimals is the failure
  // that actually costs money.
  if (!asset || !collateral) return null;

  return {
    chainId: asset.chainId,
    asset: product.asset,
    assetSymbol: asset.symbol,
    strikeAsset: product.strikeAsset,
    collateralAsset: product.collateralAsset,
    collateralSymbol: collateral.symbol,
    collateralDecimals: collateral.decimals,
  };
}

function toOption(
  underlying: string,
  combination: RyskCombination,
  tokens: Map<string, TokenInfo>,
): RyskOption | null {
  const collaterals = combination.products
    .map((product) => toCollateralChoice(product, tokens))
    .filter((choice): choice is RyskCollateralChoice => choice !== null);

  // No resolvable way to post collateral means no sellable option, whatever the
  // ladder says.
  if (collaterals.length === 0) return null;

  return {
    underlying,
    isPut: combination.isPut,
    strike: combination.strike,
    expiry: combination.expiration_timestamp,
    expiryLabel: combination.expiry,
    daysToExpiry: combination.timeToExpiryDays,
    delta: combination.delta,
    indexPrice: combination.index,
    bid: isMissingQuote(combination.bid) ? null : combination.bid,
    ask: isMissingQuote(combination.ask) ? null : combination.ask,
    indicativeApy: combination.apy,
    collaterals,
    quotedAt: combination.timestamp,
  };
}

const byStrike = (a: RyskOption, b: RyskOption) =>
  a.expiry - b.expiry || a.strike - b.strike;

export function buildCatalog(
  assets: RyskAssetsResponse,
  inventory: RyskInventoryResponse,
): RyskCatalog {
  const tokens = buildTokenIndex(assets);
  const underlyings: RyskUnderlying[] = [];

  for (const [symbol, entry] of Object.entries(inventory)) {
    const combinations = Object.values(entry.combinations ?? {});

    // XRP and ZEC are listed with no combinations at all. An underlying with an
    // empty ladder is not a market, so it is left out entirely rather than
    // rendered as an empty tab.
    if (combinations.length === 0) continue;

    const options = combinations
      .map((combination) => toOption(symbol, combination, tokens))
      .filter((option): option is RyskOption => option !== null);

    if (options.length === 0) continue;

    const chainIds = [
      ...new Set(options.flatMap((o) => o.collaterals.map((c) => c.chainId))),
    ].sort((a, b) => a - b);

    underlyings.push({
      symbol,
      // Every combination carries the same spot, so the first is representative.
      indexPrice: options[0].indexPrice,
      chainIds,
      expiries: [...new Set(options.map((o) => o.expiry))].sort((a, b) => a - b),
      calls: options.filter((o) => !o.isPut).sort(byStrike),
      puts: options.filter((o) => o.isPut).sort(byStrike),
    });
  }

  underlyings.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return { underlyings, fetchedAt: Date.now() };
}

export function findUnderlying(
  catalog: RyskCatalog,
  symbol: string,
): RyskUnderlying | undefined {
  return catalog.underlyings.find((u) => u.symbol === symbol);
}

// Covered calls need a call ladder, cash-secured puts a put ladder. An
// underlying can offer one without the other: PUMP and PURR list calls only.
export function optionsFor(
  underlying: RyskUnderlying,
  isPut: boolean,
): RyskOption[] {
  return isPut ? underlying.puts : underlying.calls;
}

export function expiriesFor(
  underlying: RyskUnderlying,
  isPut: boolean,
): number[] {
  return [...new Set(optionsFor(underlying, isPut).map((o) => o.expiry))].sort(
    (a, b) => a - b,
  );
}
