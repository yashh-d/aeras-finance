"use client";

// Every open position the app can put a user into, gathered into one list.
//
// Each product surface already reads its own venue, and each reads it in the
// terms that surface needs: Borrow wants headroom and health, Earn wants a rate,
// Hedge wants coverage against a holding. Home asks a smaller question than any
// of them, "what am I currently in", so this hook flattens all four into one row
// shape and leaves the per-venue detail to the tab that owns it. Nothing here
// builds a transaction; every figure is display math.
//
// Reads are shared rather than repeated. The borrow snapshot is cached in
// lib/borrow/use-borrow-summary.ts, and Lighter's account state in
// lib/lighter/client.ts, so mounting this card next to the borrow panel on Home
// costs no extra chain reads. Kamino, Morpho and Jupiter Lend earn are proxy
// fetches behind our own routes.
//
// Hedge and perps come from the same two venues and are separated here rather
// than at the source, because the venue has no notion of the difference: a hedge
// is a short on a market that offsets something the user is long. That test is
// the only thing that tells the two groups apart, and it is stated once, in
// isHedgeOf below.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useBorrowSummary,
  type OpenBorrowPosition,
} from "@/lib/borrow/use-borrow-summary";
import {
  EARN_ASSETS,
  fetchEarnVaultsViaProxy,
  fetchEarnWalletBalances,
  positionAssetsAtomic,
  sharesAtomic,
  type EarnVaultState,
} from "@/lib/jupiter/earn";
import { fetchLiveVaultStateViaProxy } from "@/lib/jupiter/borrow";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { assetIdentity, XSTOCKS, type XStock } from "@/lib/jupiter/xstocks";
import { KAMINO_USDC_BORROW } from "@/lib/kamino/reserves";
import type { KaminoReserveMetric } from "@/app/api/kamino/reserves/metrics/route";
import {
  KAMINO_EARN_VAULTS,
  atomicToDecimalString,
  fetchKaminoPositionsViaProxy,
  fetchKaminoVaultsViaProxy,
  sharesToTokensAtomic,
  type KaminoVaultState,
} from "@/lib/kamino/kvaults";
import { fetchLighterAccountState } from "@/lib/lighter/client";
import { hedgeRouteFor as lighterHedgeRouteFor } from "@/lib/lighter/hedge";
import type { LighterPosition } from "@/lib/lighter/types";
import { fetchGoldPositions, type GoldPosition } from "@/lib/morpho/gold-client";
import { fetchMorphoMetrics, fetchMorphoPositions } from "@/lib/morpho/client";
import type { MorphoPosition, MorphoVaultMetric } from "@/lib/morpho/client";
import { MONAD_USDC_VAULTS } from "@/lib/morpho/vaults";
import { fetchOndoAccount } from "@/lib/ondo/client";
import { hedgeRouteFor as ondoHedgeRouteFor } from "@/lib/ondo/hedge";
import type { OndoPosition } from "@/lib/ondo/types";
import { getConnection, type AccountBalances } from "@/lib/solana/balances";
import { VENUE_LOGOS, tokenLogoBySymbol } from "@/lib/tokens/logos";

export type PositionKind = "borrow" | "earn" | "hedge" | "perps";

export type PositionTone = "neutral" | "positive" | "negative" | "warning";

export interface PositionRow {
  key: string;
  kind: PositionKind;
  // The asset or market the position is in. Drawn as the row's title.
  symbol: string;
  // Where it is held, and on what chain when that is not Solana.
  venue: string;
  venueLogo?: string;
  // Token identity for the row's logo. Absent for a perp on something we do not
  // list as a token, which falls back to a monogram.
  asset?: Pick<XStock, "symbol" | "name" | "logo">;
  // The position in dollars. Debt owed for a borrow, deposited value for earn,
  // notional for a perp. Groups total this, which is why each group states what
  // its own total means.
  usd: number;
  // Size and direction, under the title.
  detail: string;
  // The one figure worth reading next to the value: a rate, a health factor,
  // coverage, unrealized PnL. Null when the venue gives us none.
  note: string | null;
  tone: PositionTone;
}

export interface PositionGroup {
  kind: PositionKind;
  label: string;
  rows: PositionRow[];
  totalUsd: number;
  // Totals mean different things per group, so each one says so rather than
  // stacking four unlabelled dollar figures that do not add up to anything.
  totalLabel: string;
}

export interface PositionsView {
  groups: PositionGroup[];
  count: number;
  // True only until the first read of every venue lands. A refresh must not
  // blank rows out from under someone reading them.
  loading: boolean;
  refresh: () => Promise<void>;
}

// Nothing here reads borrow capacity, so the convertible-holdings scan the
// borrow panel feeds in is not needed. A module constant rather than a literal,
// so the summary's capacity memo is not invalidated on every render.
const NO_EQUIVALENTS: never[] = [];

const USDC_DECIMALS = 6;

// ── Venue reads ────────────────────────────────────────────────────────────

interface VenueSnapshot {
  earnVaults: EarnVaultState[];
  earnShares: Record<string, string>;
  kaminoVaults: Map<string, KaminoVaultState>;
  kaminoShares: Map<string, string>;
  morphoPositions: Map<string, MorphoPosition>;
  morphoMetrics: Map<string, MorphoVaultMetric>;
  gold: GoldPosition[];
  lighter: LighterPosition[];
  ondo: OndoPosition[];
}

const EMPTY_SNAPSHOT: VenueSnapshot = {
  earnVaults: [],
  earnShares: {},
  kaminoVaults: new Map(),
  kaminoShares: new Map(),
  morphoPositions: new Map(),
  morphoMetrics: new Map(),
  gold: [],
  lighter: [],
  ondo: [],
};

// One venue failing is not the card failing. A user with a Lighter position and
// an unreachable Kamino proxy should still see the Lighter position, so every
// read settles independently and a rejection degrades to nothing for that venue.
async function settled<T>(work: Promise<T>, label: string, fallback: T): Promise<T> {
  try {
    return await work;
  } catch (err) {
    console.error(`[positions ${label}]`, err);
    return fallback;
  }
}

async function readVenues(
  walletAddress: string | undefined,
  evmAddress: string | undefined,
): Promise<VenueSnapshot> {
  const [earn, kamino, morpho, gold, lighter, ondo] = await Promise.all([
    // Jupiter Lend earn. The vault list is public; the shares are a Solana read.
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
      (async () => {
        if (!evmAddress) return [] as GoldPosition[];
        const { positions } = await fetchGoldPositions(evmAddress);
        return [...positions.values()];
      })(),
      "morpho gold",
      [] as GoldPosition[],
    ),
    settled(
      (async () => {
        if (!evmAddress) return [] as LighterPosition[];
        const state = await fetchLighterAccountState(evmAddress);
        return state.detail?.positions ?? [];
      })(),
      "lighter",
      [] as LighterPosition[],
    ),
    settled(
      (async () => {
        // Null means no SIWE session, which is the ordinary state for a user who
        // has never traded on Ondo rather than a failure to report.
        const account = await fetchOndoAccount();
        return account?.positions ?? [];
      })(),
      "ondo",
      [] as OndoPosition[],
    ),
  ]);

  return {
    earnVaults: earn.vaults,
    earnShares: earn.shares,
    kaminoVaults: new Map(kamino.vaults.map((v) => [v.address, v])),
    kaminoShares: kamino.shares,
    morphoPositions: morpho.positions,
    morphoMetrics: morpho.metrics,
    gold,
    lighter,
    ondo,
  };
}

// ── Borrow detail ──────────────────────────────────────────────────────────
//
// The summary knows what is owed and what is posted. It does not know what the
// debt is growing at, nor the price the vault liquidates against, and both are
// what a borrower actually wants at a glance. Read separately and only for
// markets the account is actually in, so a user with no borrows pays for none of
// it. Keyed by OpenBorrowPosition.key.
interface BorrowDetail {
  // Annualised borrow rate as a percent (7.81 = 7.81%).
  aprPct: Record<string, number>;
  // The vault's own oracle price for the collateral. Preferred over the Jupiter
  // price map for the LTV, because it is the mark liquidation is judged on.
  oraclePriceUsd: Record<string, number>;
}

const EMPTY_BORROW_DETAIL: BorrowDetail = { aprPct: {}, oraclePriceUsd: {} };

// Every Kamino borrower draws from the same USDC reserve, so its borrow APY is
// the rate on every Kamino row. One call, made only when a Kamino position
// exists.
async function kaminoUsdcBorrowApy(): Promise<number | null> {
  const res = await fetch("/api/kamino/reserves/metrics", { cache: "no-store" });
  if (!res.ok) return null;
  const { reserves } = (await res.json()) as { reserves: KaminoReserveMetric[] };
  const usdc = reserves.find((r) => r.reserve === KAMINO_USDC_BORROW.reserve);
  return usdc ? usdc.borrowApy : null;
}

async function readBorrowDetail(
  open: OpenBorrowPosition[],
): Promise<BorrowDetail> {
  const aprPct: Record<string, number> = {};
  const oraclePriceUsd: Record<string, number> = {};

  await Promise.all(
    open.map(async (p) => {
      if (p.ref.venue !== "jupiter") return;
      try {
        const live = await fetchLiveVaultStateViaProxy(p.ref.vault.vaultId);
        aprPct[p.key] = live.borrowRateAnnual * 100;
        oraclePriceUsd[p.key] = live.oraclePriceUsd;
      } catch (err) {
        console.error("[positions borrow vault]", err);
      }
    }),
  );

  if (open.some((p) => p.ref.venue === "kamino")) {
    try {
      const apy = await kaminoUsdcBorrowApy();
      if (apy != null) {
        for (const p of open) {
          if (p.ref.venue === "kamino") aprPct[p.key] = apy * 100;
        }
      }
    } catch (err) {
      console.error("[positions kamino rate]", err);
    }
  }

  return { aprPct, oraclePriceUsd };
}

// ── Row construction ───────────────────────────────────────────────────────

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function healthTone(health: number | null): PositionTone {
  if (health == null) return "neutral";
  if (health < 1.1) return "negative";
  if (health < 1.5) return "warning";
  return "positive";
}

// Health factor: how far the position's LTV sits below the threshold that
// liquidates it. 1.0 is at the threshold, so anything under it is liquidatable
// and a larger number is safer. The same definition on both Solana venues and on
// the Morpho gold market, which reports its own.
function healthFrom(ltvPct: number, liquidationLtvPct: number): number | null {
  if (!(ltvPct > 0) || !(liquidationLtvPct > 0)) return null;
  return liquidationLtvPct / ltvPct;
}

function borrowRows(
  open: OpenBorrowPosition[],
  detail: BorrowDetail,
  gold: GoldPosition[],
  prices: JupiterPriceMap | null,
): PositionRow[] {
  const rows: PositionRow[] = open.map((p) => {
    let health: number | null = null;

    if (p.ref.venue === "kamino") {
      // Kamino returns both figures off the obligation, priced at its own
      // oracle. Nothing to recompute.
      health = healthFrom(p.ref.position.ltvPct, p.ref.position.liquidationLtvPct);
    } else {
      // Jupiter gives a threshold per thousand (750 = 75%). The LTV is priced at
      // the vault's oracle where we have it, since that is the mark liquidation
      // is judged on, and falls back to the Jupiter price map when the vault
      // read failed.
      const price =
        detail.oraclePriceUsd[p.key] ??
        prices?.[p.collateralMint]?.usdPrice ??
        null;
      const collateralUsd = price != null ? p.collateralUi * price : 0;
      const ltvPct = collateralUsd > 0 ? (p.debtUi / collateralUsd) * 100 : 0;
      health = healthFrom(ltvPct, p.ref.vault.liquidationThreshold / 10);
    }

    // The rate the debt grows at. There is no separate accrued-interest figure
    // to show: neither venue reports the original principal, and the debt above
    // already has the interest in it.
    const apr = detail.aprPct[p.key];

    return {
      key: `borrow:${p.key}`,
      kind: "borrow" as const,
      symbol: p.collateralSymbol,
      venue: p.venueLabel,
      venueLogo:
        p.venueLabel === "Kamino" ? VENUE_LOGOS.kamino : VENUE_LOGOS.jupiter,
      asset: assetIdentity(p.collateralMint, p.collateralSymbol),
      usd: p.debtUi,
      detail:
        apr != null
          ? `${apr.toFixed(2)}% APR`
          : `${p.collateralUi.toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })} posted`,
      note: health != null ? `${health.toFixed(2)}× health` : null,
      tone: healthTone(health),
    };
  });

  // Morpho Blue on Ethereum. XAUt collateral against USDT, the one borrow that
  // does not settle on Solana, so the chain is named in the venue line.
  for (const g of gold) {
    const debt = Number(g.debtAtomic) / 10 ** USDC_DECIMALS;
    if (debt <= 0) continue;
    const collateral = Number(g.collateralAtomic) / 10 ** USDC_DECIMALS;
    rows.push({
      key: `borrow:gold:${g.id}`,
      kind: "borrow",
      symbol: "XAUt",
      venue: "Morpho · Ethereum",
      venueLogo: VENUE_LOGOS.morpho,
      asset: { symbol: "XAUt", name: "Tether Gold", logo: "/logos/xaut.png" },
      usd: debt,
      // Morpho Blue prices its own borrow rate off utilisation and does not
      // hand it back on the position read, so this row states the collateral
      // instead of a rate.
      detail: `${collateral.toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })} oz posted`,
      note:
        g.healthFactor != null ? `${g.healthFactor.toFixed(2)}× health` : null,
      tone: healthTone(g.healthFactor),
    });
  }

  return rows.sort((a, b) => b.usd - a.usd);
}

function earnRows(snapshot: VenueSnapshot): PositionRow[] {
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
      detail: `${amount.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })} USDC`,
      note: apy != null ? `${pct(apy)} APY` : null,
      tone: "positive",
    });
  }

  return rows.sort((a, b) => b.usd - a.usd);
}

// What the account is long in a given xStock, priced. Wallet balance plus
// anything of the same mint posted as borrow collateral: deposited stock is
// still price exposure, and a borrow-funded hedge is exactly the case where the
// stock has left the wallet at the moment the short matters most.
function exposureByMarket(
  balances: AccountBalances | null,
  collateralByMint: Record<string, number>,
  prices: JupiterPriceMap | null,
  marketOf: (xstock: XStock) => string | undefined,
): Map<string, { symbol: string; usd: number }> {
  const byMarket = new Map<string, { symbol: string; usd: number }>();
  for (const x of XSTOCKS) {
    const held =
      (balances?.xstocks[x.mint] ?? 0) + (collateralByMint[x.mint] ?? 0);
    if (held <= 0) continue;
    const market = marketOf(x);
    if (!market) continue;
    const price = prices?.[x.mint]?.usdPrice ?? 0;
    const existing = byMarket.get(market);
    const usd = held * price;
    // Two xStocks can route to one market. Sum rather than overwrite, or the
    // second one silently replaces the first.
    byMarket.set(market, {
      symbol: existing ? existing.symbol : x.symbol,
      usd: (existing?.usd ?? 0) + usd,
    });
  }
  return byMarket;
}

// The liquidation price is the health number on a perp, so it rides in the row's
// detail line. Both venues report zero, or nothing usable, for a position that
// cannot be liquidated by price, and a zero there would read as a real price.
function withLiquidation(base: string, liquidationPrice: number): string {
  if (!Number.isFinite(liquidationPrice) || liquidationPrice <= 0) return base;
  return `${base} · liq $${liquidationPrice.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`;
}

function coverageNote(shortUsd: number, exposureUsd: number): string {
  if (exposureUsd <= 0) return "Offsetting";
  return `${Math.round((shortUsd / exposureUsd) * 100)}% covered`;
}

function perpRows(
  snapshot: VenueSnapshot,
  balances: AccountBalances | null,
  collateralByMint: Record<string, number>,
  prices: JupiterPriceMap | null,
): { hedge: PositionRow[]; perps: PositionRow[] } {
  const hedge: PositionRow[] = [];
  const perps: PositionRow[] = [];

  const lighterExposure = exposureByMarket(
    balances,
    collateralByMint,
    prices,
    (x) => lighterHedgeRouteFor(x.symbol)?.market,
  );
  // Ondo routes an xStock to an exact market and, where the exact one is
  // disabled, to a proxy. A short on either is offsetting the same holding, so
  // both are indexed.
  const ondoExposure = new Map<string, { symbol: string; usd: number }>();
  for (const [market, entry] of exposureByMarket(
    balances,
    collateralByMint,
    prices,
    (x) => ondoHedgeRouteFor(x.symbol)?.market,
  )) {
    ondoExposure.set(market, entry);
  }
  for (const [market, entry] of exposureByMarket(
    balances,
    collateralByMint,
    prices,
    (x) => ondoHedgeRouteFor(x.symbol)?.proxyMarket,
  )) {
    if (!ondoExposure.has(market)) ondoExposure.set(market, entry);
  }

  for (const p of snapshot.lighter) {
    const notional = Math.abs(Number(p.notionalUsd));
    if (!(notional > 0)) continue;
    const pnl = Number(p.unrealizedPnlUsd);
    const offset = p.isShort ? lighterExposure.get(p.symbol) : undefined;
    const row: PositionRow = {
      key: `lighter:${p.marketId}`,
      kind: offset ? "hedge" : "perps",
      symbol: offset ? offset.symbol : p.symbol,
      venue: "Lighter",
      venueLogo: "/logos/lighter.png",
      asset: xstockLike(offset?.symbol ?? p.symbol),
      usd: notional,
      detail: withLiquidation(
        offset
          ? `Short ${p.size} ${p.symbol}`
          : `${p.isShort ? "Short" : "Long"} ${p.size}`,
        // "0" is what Lighter reports for a position that cannot be liquidated
        // by price, which is not a price to show.
        Number(p.liquidationPriceUsd),
      ),
      note: offset
        ? coverageNote(notional, offset.usd)
        : `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`,
      tone: offset ? "neutral" : pnl >= 0 ? "positive" : "negative",
    };
    (offset ? hedge : perps).push(row);
  }

  for (const p of snapshot.ondo) {
    const notional = Math.abs(Number(p.notionalValue));
    if (!(notional > 0)) continue;
    const pnl = Number(p.unrealizedPnl);
    const offset =
      p.direction === "short" ? ondoExposure.get(p.market) : undefined;
    const row: PositionRow = {
      key: `ondo:${p.market}`,
      kind: offset ? "hedge" : "perps",
      symbol: offset ? offset.symbol : p.market.replace(/-USD\.P$/, ""),
      venue: "Ondo",
      venueLogo: "/logos/ondo.png",
      asset: xstockLike(offset?.symbol ?? p.market.replace(/-USD\.P$/, "")),
      usd: notional,
      detail: withLiquidation(
        offset
          ? `Short ${p.netQuantity} ${p.market.replace(/-USD\.P$/, "")}`
          : `${p.direction === "short" ? "Short" : "Long"} ${p.netQuantity}`,
        Number(p.liquidationPrice),
      ),
      note: offset
        ? coverageNote(notional, offset.usd)
        : `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`,
      tone: offset ? "neutral" : pnl >= 0 ? "positive" : "negative",
    };
    (offset ? hedge : perps).push(row);
  }

  hedge.sort((a, b) => b.usd - a.usd);
  perps.sort((a, b) => b.usd - a.usd);
  return { hedge, perps };
}

// A perp market symbol is a bare ticker ("TSLA", "BTC"), so it never matches an
// xStock mint. Match on the ticker instead, which gets the stock logo onto the
// row for anything we list and falls back to a monogram for everything else.
function xstockLike(symbol: string): Pick<XStock, "symbol" | "name" | "logo"> {
  const stock = XSTOCKS.find(
    (x) => x.symbol === symbol || x.symbol.replace(/x$/, "") === symbol,
  );
  if (stock) return stock;
  return { symbol, name: symbol, logo: tokenLogoBySymbol(symbol) };
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function usePositions({
  walletAddress,
  evmAddress,
  balances,
  prices,
}: {
  walletAddress: string | undefined;
  // The embedded EVM wallet. Owns the Lighter account, the Monad earn shares
  // and the Ethereum gold position, so three of the six venues are silent
  // without it.
  evmAddress: string | undefined;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
}): PositionsView {
  const summary = useBorrowSummary({
    walletAddress: walletAddress ?? "",
    prices,
    balances,
    equivalents: NO_EQUIVALENTS,
  });

  const [snapshot, setSnapshot] = useState<VenueSnapshot>(EMPTY_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);
  // Set while the component is on screen, so a read that lands after an unmount
  // is dropped rather than written back.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Awaits the venue reads rather than bumping a counter, so a caller can hold a
  // "refreshing" state for as long as the reads actually take. The borrow
  // summary drops its cached snapshot and re-reads on its own.
  const summaryRefresh = summary.refresh;
  const refresh = useCallback(async () => {
    summaryRefresh();
    const next = await readVenues(walletAddress, evmAddress);
    if (!live.current) return;
    setSnapshot(next);
    setLoaded(true);
  }, [summaryRefresh, walletAddress, evmAddress]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await readVenues(walletAddress, evmAddress);
      if (cancelled || !live.current) return;
      setSnapshot(next);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, evmAddress]);

  const { positions: borrowPositions, collateralByMint } = summary;

  // Rate and oracle price for the markets the account is actually in. Separate
  // from the venue sweep because it depends on the borrow summary landing first,
  // and it makes no calls at all for an account with no debt.
  const [borrowDetail, setBorrowDetail] =
    useState<BorrowDetail>(EMPTY_BORROW_DETAIL);

  useEffect(() => {
    if (borrowPositions.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = await readBorrowDetail(borrowPositions);
      if (cancelled || !live.current) return;
      setBorrowDetail(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [borrowPositions]);

  const groups = useMemo<PositionGroup[]>(() => {
    const borrow = borrowRows(
      borrowPositions,
      borrowDetail,
      snapshot.gold,
      prices,
    );
    const earn = earnRows(snapshot);
    const { hedge, perps } = perpRows(
      snapshot,
      balances,
      collateralByMint,
      prices,
    );
    const total = (rows: PositionRow[]) =>
      rows.reduce((sum, r) => sum + r.usd, 0);

    return [
      {
        kind: "borrow",
        label: "Borrow",
        rows: borrow,
        totalUsd: total(borrow),
        totalLabel: "owed",
      },
      {
        kind: "earn",
        label: "Earn",
        rows: earn,
        totalUsd: total(earn),
        totalLabel: "deposited",
      },
      {
        kind: "hedge",
        label: "Hedge",
        rows: hedge,
        totalUsd: total(hedge),
        totalLabel: "offset",
      },
      {
        kind: "perps",
        label: "Perps",
        rows: perps,
        totalUsd: total(perps),
        totalLabel: "notional",
      },
    ];
  }, [borrowPositions, borrowDetail, collateralByMint, snapshot, balances, prices]);

  return {
    groups,
    count: groups.reduce((n, g) => n + g.rows.length, 0),
    loading: (!loaded || summary.loading) && groups.every((g) => !g.rows.length),
    refresh,
  };
}
