"use client";

// The ticket's borrow mode: the Borrow tab's own card for this asset, mounted
// here so the loan is opened, added to, repaid and closed without leaving
// the Terminal. Nothing about the money path is copied. `VaultCard` (Jupiter
// Lend) and `KaminoBorrowCard` are the same components the tab expands under
// a market row, fed the same hooks the tab feeds them: the cross-chain
// equivalents scan, the account-wide borrow summary (which carries the
// Kamino obligation), and the live market stats.
//
// An asset listed at both venues gets a venue toggle above the card. One card
// at a time, because each mounts its own live reads on expand, exactly as the
// tab only ever expands one row.

import { useCallback, useMemo, useState } from "react";

import { VaultCard } from "@/components/BorrowPanel";
import { KaminoBorrowCard } from "@/components/KaminoBorrowCard";
import { useBorrowMarketStats } from "@/lib/borrow/use-market-stats";
import { useBorrowSummary } from "@/lib/borrow/use-borrow-summary";
import { vaultByCollateralMint } from "@/lib/jupiter/borrow";
import { SOL_MINT } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { XStock } from "@/lib/jupiter/xstocks";
import { kaminoCollateralByMint } from "@/lib/kamino/reserves";
import type { AccountBalances } from "@/lib/solana/balances";
import { borrowMarketsFor, type BorrowVenue } from "@/lib/terminal/borrow-markets";
import { groupEquivalentsByVault } from "@/lib/trustware/selection";
import { useEquivalentBalances } from "@/lib/trustware/use-equivalents";

export function TerminalBorrow({
  xstock,
  prices,
  balances,
  walletAddress,
  onRefresh,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  walletAddress: string | null;
  onRefresh: () => Promise<void> | void;
}) {
  // The hooks below need a wallet, so the no-wallet state is decided before
  // any of them run.
  if (!walletAddress) {
    return (
      <p className="text-sm text-white/50">
        Waiting for embedded Solana wallet to provision...
      </p>
    );
  }
  return (
    <BorrowForms
      xstock={xstock}
      prices={prices}
      balances={balances}
      walletAddress={walletAddress}
      onRefresh={onRefresh}
    />
  );
}

function BorrowForms({
  xstock,
  prices,
  balances,
  walletAddress,
  onRefresh,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  walletAddress: string;
  onRefresh: () => Promise<void> | void;
}) {
  const markets = borrowMarketsFor(xstock.mint);
  const [chosen, setChosen] = useState<BorrowVenue | null>(null);
  // The venue on screen: the chosen one when the asset has it, else the
  // first listed, which is the order the Borrow tab uses.
  const venue: BorrowVenue | null =
    markets.find((m) => m.venue === chosen)?.venue ?? markets[0]?.venue ?? null;

  const equivalents = useEquivalentBalances(walletAddress);
  const equivalentsByVault = useMemo(
    () => groupEquivalentsByVault(equivalents.held),
    [equivalents.held],
  );
  const summary = useBorrowSummary({
    walletAddress,
    prices,
    balances,
    equivalents: equivalents.held,
  });
  const { stats } = useBorrowMarketStats();

  // A settled borrow or repay changes both the wallet and the headline
  // figures, as on the tab. Both awaited, as the tab does: a card that awaits
  // this before re-reading its own position wants the summary's settle loop
  // to have finished too, so the owed and available figures it draws are the
  // post-action ones.
  const summaryRefresh = summary.refresh;
  const refreshAll = useCallback(async () => {
    await Promise.all([onRefresh(), summaryRefresh()]);
  }, [onRefresh, summaryRefresh]);

  const held = balances?.xstocks[xstock.mint] ?? 0;
  const heldAtomic = balances?.xstocksAtomic[xstock.mint] ?? "0";
  const vault = vaultByCollateralMint(xstock.mint);
  const reserve = kaminoCollateralByMint(xstock.mint);

  if (!venue) {
    return <p className="text-sm text-white/40">No lending market takes {xstock.symbol}.</p>;
  }

  return (
    <div className="space-y-4">
      {markets.length > 1 && (
        <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
          {markets.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setChosen(m.venue)}
              aria-pressed={venue === m.venue}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                venue === m.venue ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
              }`}
            >
              {m.venue}
            </button>
          ))}
        </div>
      )}

      {venue === "Jupiter Lend" && vault && (
        <VaultCard
          vault={vault}
          walletAddress={walletAddress}
          walletUsdc={balances?.usdc ?? 0}
          solanaUsdcAtomic={balances?.usdcAtomic ?? "0"}
          solBalance={balances?.sol ?? 0}
          solPriceUsd={prices?.[SOL_MINT]?.usdPrice ?? null}
          collateralBalance={held}
          collateralBalanceAtomic={heldAtomic}
          heldEquivalents={equivalentsByVault.get(vault.vaultId) ?? []}
          evmAddress={equivalents.evmAddress}
          onEquivalentsChanged={equivalents.refresh}
          prices={prices}
          stat={stats.get(markets.find((m) => m.venue === "Jupiter Lend")!.key)}
          onRefresh={refreshAll}
          sliderOnly
        />
      )}

      {venue === "Kamino" && reserve && (
        <KaminoBorrowCard
          collateral={reserve}
          walletAddress={walletAddress}
          walletUsdc={balances?.usdc ?? 0}
          solanaUsdcAtomic={balances?.usdcAtomic ?? "0"}
          solBalance={balances?.sol ?? 0}
          solPriceUsd={prices?.[SOL_MINT]?.usdPrice ?? null}
          collateralBalance={held}
          collateralBalanceAtomic={heldAtomic}
          prices={prices}
          stat={stats.get(markets.find((m) => m.venue === "Kamino")!.key)}
          initialPosition={summary.kaminoPosition}
          onRefresh={refreshAll}
          onPositionChange={summaryRefresh}
          sliderOnly
        />
      )}
    </div>
  );
}
