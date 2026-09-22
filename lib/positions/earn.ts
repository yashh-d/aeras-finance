// The earn side of the positions model: what the account has deposited into a
// vault, and what those deposits are worth.
//
// Split out of use-positions.ts so two surfaces can read it without either one
// paying for the other. The Portfolio tab wants every venue, including borrow,
// hedge and perps; the wallet card wants vaults and nothing else, and pulling
// the whole model in would have made Home fetch seven venues and a borrow
// summary to draw three rows.
//
// The row-building is the SAME function for both, not a second copy. The one
// thing this file must never become is a parallel opinion about what a deposit
// is worth: that is exactly the drift lib/solana/holdings.ts keeps growing
// comments about.

import {
  fetchEarnVaultsViaProxy,
  fetchEarnWalletBalances,
  positionAssetsAtomic,
  sharesAtomic,
  EARN_ASSETS,
  type EarnVaultState,
} from "@/lib/jupiter/earn";
import { fetchGliderPortfolio } from "@/lib/glider/client";
import { GLIDER_STRATEGY_NAME } from "@/lib/glider/constants";
import type { GliderPortfolioView } from "@/lib/glider/types";
import { assetIdentity } from "@/lib/jupiter/xstocks";
import {
  atomicToDecimalString,
  fetchKaminoVaultsViaProxy,
  fetchKaminoPositionsViaProxy,
  sharesToTokensAtomic,
  KAMINO_EARN_VAULTS,
  type KaminoVaultState,
} from "@/lib/kamino/kvaults";
import {
  fetchMorphoPositions,
  fetchMorphoMetrics,
  type MorphoPosition,
  type MorphoVaultMetric,
} from "@/lib/morpho/client";
import { MONAD_USDC_VAULTS } from "@/lib/morpho/vaults";
import {
  fetchMonUsd,
  fetchShmonMetrics,
  fetchShmonPosition,
  type ShmonMetrics,
  type ShmonPosition,
} from "@/lib/shmonad/client";
import { SHMON_SYMBOL } from "@/lib/shmonad/constants";
import { fetchUniswapPositions, type UniswapPositionsPayload } from "@/lib/uniswap/client";
import { UNISWAP_CHAINS, baseToken, uniswapPoolById } from "@/lib/uniswap/pools";
import { getConnection } from "@/lib/solana/balances";
import { VENUE_LOGOS, tokenLogoBySymbol } from "@/lib/tokens/logos";
import type { PositionRow } from "@/lib/positions/types";

const USDC_DECIMALS = 6;

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

// Everything earnRows reads. A subset of the Portfolio tab's VenueSnapshot,
// which is why that one is assignable to this and the tab can keep passing its
// own.
export interface EarnSnapshot {
  earnVaults: EarnVaultState[];
  earnShares: Record<string, string>;
  kaminoVaults: Map<string, KaminoVaultState>;
  kaminoShares: Map<string, string>;
  morphoPositions: Map<string, MorphoPosition>;
  morphoMetrics: Map<string, MorphoVaultMetric>;
  // shMON staking on Monad. Optional so the older snapshot shapes (and the
  // tests built on them) stay valid; null when the wallet holds none.
  shmon?: ShmonEarnRead | null;
  // The Bitwise Mag7X portfolio on Glider, on Base. Optional for the same
  // reason; null when the user has none or the server has no Glider key.
  glider?: GliderPortfolioView | null;
  // Uniswap liquidity positions on the four chains lib/uniswap lists. Read
  // through the positions route off the Privy token; null when there is no
  // EVM wallet or the read failed.
  uniswap?: UniswapPositionsPayload | null;
}

// The shMON position with what prices it: the rate and APY from the metrics
// route, and USD per MON from the native price feed. Metrics and price are
// only read when the wallet actually holds shares, so the common case costs
// one position read.
export interface ShmonEarnRead {
  position: ShmonPosition;
  metrics: ShmonMetrics | null;
  monUsd: number | null;
}

export const EMPTY_EARN_SNAPSHOT: EarnSnapshot = {
  earnVaults: [],
  earnShares: {},
  kaminoVaults: new Map(),
  kaminoShares: new Map(),
  morphoPositions: new Map(),
  morphoMetrics: new Map(),
};

// A venue that is down returns nothing rather than failing the whole read. One
// unreachable vault provider should cost its own rows, not the card.
async function settled<T>(work: Promise<T>, label: string, fallback: T): Promise<T> {
  try {
    return await work;
  } catch (err) {
    console.error(`[earn ${label}]`, err);
    return fallback;
  }
}

// The three vault venues, read in parallel. Jupiter Lend and Kamino are Solana
// reads keyed by the Solana wallet; Morpho's vault shares sit in the embedded
// EVM wallet on Monad, so it is silent without one.
export async function readEarnVenues(
  walletAddress: string | undefined,
  evmAddress: string | undefined,
): Promise<EarnSnapshot> {
  const [earn, kamino, morpho, shmon, glider, uniswap] = await Promise.all([
    settled(
      (async () => {
        if (!walletAddress) return { vaults: [], shares: {} };
        const connection = getConnection();
        const [vaults, balances] = await Promise.all([
          fetchEarnVaultsViaProxy(),
          fetchEarnWalletBalances(walletAddress, connection),
        ]);
        return { vaults, shares: balances.byMint };
      })(),
      "jupiter earn",
      { vaults: [] as EarnVaultState[], shares: {} as Record<string, string> },
    ),
    settled(
      (async () => {
        if (!walletAddress) {
          return { vaults: [] as KaminoVaultState[], shares: new Map<string, string>() };
        }
        const [vaults, positions] = await Promise.all([
          fetchKaminoVaultsViaProxy(),
          fetchKaminoPositionsViaProxy(walletAddress),
        ]);
        return {
          vaults,
          shares: new Map(
            [...positions.values()].map((p) => [
              p.vaultAddress,
              p.totalSharesAtomic,
            ]),
          ),
        };
      })(),
      "kamino kvaults",
      { vaults: [] as KaminoVaultState[], shares: new Map<string, string>() },
    ),
    settled(
      (async () => {
        if (!evmAddress) {
          return {
            positions: new Map<string, MorphoPosition>(),
            metrics: new Map<string, MorphoVaultMetric>(),
          };
        }
        const [{ positions }, metrics] = await Promise.all([
          fetchMorphoPositions(evmAddress),
          fetchMorphoMetrics(),
        ]);
        return { positions, metrics };
      })(),
      "morpho monad",
      {
        positions: new Map<string, MorphoPosition>(),
        metrics: new Map<string, MorphoVaultMetric>(),
      },
    ),
    settled(
      (async (): Promise<ShmonEarnRead | null> => {
        if (!evmAddress) return null;
        const position = await fetchShmonPosition(evmAddress);
        if (BigInt(position.sharesAtomic) === 0n) return null;
        const [metrics, monUsd] = await Promise.all([
          fetchShmonMetrics().catch(() => null),
          fetchMonUsd(),
        ]);
        return { position, metrics, monUsd };
      })(),
      "shmon monad",
      null,
    ),
    settled(
      (async (): Promise<GliderPortfolioView | null> => {
        // Read through our own route, which resolves the portfolio from the
        // signed-in identity; the EVM address only says whether there can
        // be one. Null is the ordinary answer.
        if (!evmAddress) return null;
        const read = await fetchGliderPortfolio();
        return read.portfolio;
      })(),
      "glider base",
      null,
    ),
    settled(
      (async (): Promise<UniswapPositionsPayload | null> => {
        if (!evmAddress) return null;
        return fetchUniswapPositions();
      })(),
      "uniswap",
      null,
    ),
  ]);

  return {
    earnVaults: earn.vaults,
    earnShares: earn.shares,
    kaminoVaults: new Map(kamino.vaults.map((v) => [v.address, v])),
    kaminoShares: kamino.shares,
    morphoPositions: morpho.positions,
    morphoMetrics: morpho.metrics,
    shmon,
    glider,
    uniswap,
  };
}

export function earnRows(snapshot: EarnSnapshot): PositionRow[] {
  const rows: PositionRow[] = [];

  // Jupiter Lend earn. Shares are held in the wallet, so the position is the
  // share balance converted at the vault's current assets-per-share.
  const vaultByMint = new Map(
    snapshot.earnVaults.map((v) => [v.assetMint, v]),
  );
  for (const meta of EARN_ASSETS) {
    const vault = vaultByMint.get(meta.assetMint);
    const shares = sharesAtomic(meta, {
      byMint: snapshot.earnShares,
      solLamports: "0",
    });
    if (shares === "0") continue;
    const assets = positionAssetsAtomic(shares, vault, meta.decimals);
    const amount = Number(atomicToDecimalString(assets.toString(), meta.decimals));
    if (!(amount > 0)) continue;
    rows.push({
      key: `earn:jupiter:${meta.vaultId}`,
      kind: "earn",
      symbol: meta.symbol,
      venue: "Jupiter Lend",
      venueLogo: VENUE_LOGOS.jupiter,
      asset: assetIdentity(meta.assetMint, meta.symbol),
      usd: amount * (vault?.assetPriceUsd ?? 0),
      amount,
      detail: `${amount.toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })} ${meta.symbol}`,
      note: vault ? `${pct(vault.apy)} APY` : null,
      tone: "positive",
    });
  }

  // Kamino K-Vaults. Deposits auto-stake, so the position comes from Kamino's
  // own positions endpoint rather than from a share-token balance.
  for (const meta of KAMINO_EARN_VAULTS) {
    const shares = snapshot.kaminoShares.get(meta.address);
    if (!shares || shares === "0") continue;
    const state = snapshot.kaminoVaults.get(meta.address);
    const tokens = sharesToTokensAtomic(shares, state, meta);
    const amount = Number(atomicToDecimalString(tokens, meta.tokenDecimals));
    if (!(amount > 0)) continue;
    // Share price, not token price: a SOL vault's share is worth about 77 USD
    // because it holds about 1.04 SOL.
    const sharesUi = Number(
      atomicToDecimalString(shares, meta.sharesDecimals),
    );
    rows.push({
      key: `earn:kamino:${meta.address}`,
      kind: "earn",
      symbol: meta.name,
      venue: "Kamino",
      venueLogo: VENUE_LOGOS.kamino,
      asset: assetIdentity(meta.tokenMint, meta.name),
      usd: sharesUi * (state?.sharePriceUsd ?? 0),
      amount,
      detail: `${amount.toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })} deposited`,
      note: state ? `${pct(state.apy)} APY` : null,
      tone: "positive",
    });
  }

  // Morpho on Monad. The one earn position that settles off Solana: the shares
  // sit in the embedded EVM wallet, so the chain is named.
  for (const vault of MONAD_USDC_VAULTS) {
    const position = snapshot.morphoPositions.get(vault.address.toLowerCase());
    if (!position) continue;
    const amount = Number(position.assetsAtomic) / 10 ** USDC_DECIMALS;
    if (!(amount > 0)) continue;
    const apy = snapshot.morphoMetrics.get(vault.address.toLowerCase())?.netApy;
    rows.push({
      key: `earn:morpho:${vault.address}`,
      kind: "earn",
      symbol: vault.name,
      venue: "Morpho · Monad",
      venueLogo: VENUE_LOGOS.morpho,
      asset: {
        symbol: "USDC",
        name: "USD Coin",
        logo: tokenLogoBySymbol("USDC"),
      },
      usd: amount,
      amount,
      detail: `${amount.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })} USDC`,
      note: apy != null ? `${pct(apy)} APY` : null,
      tone: "positive",
    });
  }

  // shMON staking on Monad. Shares in the embedded EVM wallet, denominated in
  // MON: the amount is shMON, the dollar figure is shares at the exchange
  // rate at the MON price. No price means no dollar figure, never zero, so
  // the row still appears with its quantity.
  const shmon = snapshot.shmon;
  if (shmon) {
    const shares = Number(shmon.position.sharesAtomic) / 1e18;
    const mon = Number(shmon.position.monAtomic) / 1e18;
    if (shares > 0) {
      const apy = shmon.metrics?.apy ?? null;
      rows.push({
        key: "earn:shmonad",
        kind: "earn",
        earnKind: "stake",
        symbol: SHMON_SYMBOL,
        venue: "shMON staking · Monad",
        venueLogo: VENUE_LOGOS.shmonad,
        asset: {
          symbol: SHMON_SYMBOL,
          name: "shMON",
          logo: tokenLogoBySymbol(SHMON_SYMBOL),
        },
        usd: shmon.monUsd != null ? mon * shmon.monUsd : 0,
        amount: shares,
        detail: `${shares.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} shMON, ${mon.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} MON`,
        note: apy != null ? `${pct(apy)} APY` : null,
        tone: "positive",
      });
    }
  }

  // Bitwise Mag7X on Glider. Eight Coinbase tokenized stocks in a smart
  // account on Base, valued by Glider. The chain is named because it is the
  // one earn position whose holdings are equities rather than a stable.
  const glider = snapshot.glider;
  if (glider && glider.totalValueUsd > 0) {
    const held = glider.assets.filter((a) => a.holding && a.balance > 0).length;
    const all = glider.performance?.windows.find((w) => w.window === "all");
    rows.push({
      key: "earn:glider",
      kind: "earn",
      earnKind: "vault",
      symbol: GLIDER_STRATEGY_NAME,
      venue: "Glider · Base",
      venueLogo: VENUE_LOGOS.glider,
      asset: { symbol: "MAG7X", name: GLIDER_STRATEGY_NAME, logo: VENUE_LOGOS.glider },
      usd: glider.totalValueUsd,
      detail:
        held > 0
          ? `${held} of ${glider.assets.filter((a) => a.holding).length || 8} holdings`
          : glider.idleUsdc > 0
            ? `${glider.idleUsdc.toFixed(2)} USDC waiting for the next rebalance`
            : "Mag7X",
      note: all
        ? `${all.percentChange >= 0 ? "+" : ""}${all.percentChange.toFixed(2)}% since deposit`
        : null,
      tone: all && all.percentChange < 0 ? "negative" : "positive",
    });
  }

  // Uniswap liquidity positions. Each is two tokens in a pool on one of four
  // chains, valued at the pool's own price; the amount is left unset because
  // the row is not a quantity of one asset. The note is the one thing worth
  // reading next to the value: whether the price is still inside the range.
  for (const position of snapshot.uniswap?.positions ?? []) {
    const pool = uniswapPoolById(position.chainId, position.poolId);
    if (!pool) continue;
    const chain = UNISWAP_CHAINS[pool.chainId];
    const base = baseToken(pool) ?? pool.token0;
    const a0 = Number(position.amount0) / 10 ** pool.token0.decimals;
    const a1 = Number(position.amount1) / 10 ** pool.token1.decimals;
    rows.push({
      key: `earn:uniswap:${position.key}`,
      kind: "earn",
      symbol: pool.label,
      venue: `Uniswap · ${chain.label}`,
      venueLogo: VENUE_LOGOS.uniswap,
      asset: { symbol: base.symbol, name: base.name, logo: base.logo },
      usd: position.valueUsd ?? 0,
      detail: `${a0.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${pool.token0.symbol} + ${a1.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${pool.token1.symbol}`,
      note: position.inRange
        ? position.feesUsd != null && position.feesUsd > 0
          ? `in range, $${position.feesUsd.toFixed(2)} fees to claim`
          : "in range"
        : "out of range, earning nothing",
      tone: position.inRange ? "positive" : "warning",
    });
  }

  return rows.sort((a, b) => b.usd - a.usd);
}
