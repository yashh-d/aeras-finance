"use client";

// Trader mode's body: the four sections, fed the same reads the Investor
// sections get from app/app/page.tsx. Nothing is fetched here that the page
// does not already hold, so a total in the sidebar and a figure on a card
// come from one read. See docs/trader-mode-plan.md.

import { PositionsPanel } from "@/components/PositionsPanel";
import { VenueNames } from "@/components/strategies/shared";
import { WalletPanel } from "@/components/WalletPanel";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { EarnPositionsView } from "@/lib/positions/use-earn-positions";
import type { AccountBalances } from "@/lib/solana/balances";
import type { PortfolioHolding } from "@/lib/solana/holdings";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import { GLASS_SURFACE } from "@/lib/ui/surface";

import { BuyEarnGrid } from "./BuyEarnGrid";
import { EarnGrid } from "./EarnGrid";
import { PlaysGrid } from "./PlaysGrid";
import { TraderHeader } from "./shared";

export type TraderSection = "earn" | "buy-earn" | "plays" | "portfolio";

export const TRADER_SECTIONS: readonly { id: TraderSection; label: string }[] = [
  { id: "earn", label: "Earn" },
  { id: "buy-earn", label: "Buy + Earn" },
  { id: "plays", label: "Strategies" },
  { id: "portfolio", label: "Portfolio" },
];

// Trader mode names no lending venue: the tickets it mounts read this
// context and drop "on Jupiter Lend" and "on Kamino" from their copy
// (docs/trader-mode-plan.md, D13). The venue still decides the route.
export function TraderShell(props: Parameters<typeof TraderBody>[0]) {
  return (
    <VenueNames.Provider value={false}>
      <TraderBody {...props} />
    </VenueNames.Provider>
  );
}

function TraderBody({
  section,
  walletAddress,
  balances,
  balancesError,
  balancesRefreshing,
  prices,
  scan,
  earn,
  holdings,
  totalUsd,
  onRefresh,
  onSettled,
  onSwitchToInvestor,
}: {
  section: TraderSection;
  walletAddress: string | undefined;
  balances: AccountBalances | null;
  balancesError: string | null;
  balancesRefreshing: boolean;
  prices: JupiterPriceMap | null;
  scan: WalletScan;
  earn: EarnPositionsView;
  holdings: PortfolioHolding[];
  totalUsd: number | null;
  onRefresh: () => Promise<void> | void;
  onSettled: () => Promise<void> | void;
  onSwitchToInvestor: () => void;
}) {
  if (section === "earn") {
    return (
      <EarnGrid
        walletAddress={walletAddress}
        balances={balances}
        earn={earn}
        onSettled={onSettled}
      />
    );
  }

  if (section === "buy-earn") {
    return walletAddress ? (
      <BuyEarnGrid
        walletAddress={walletAddress}
        balances={balances}
        prices={prices}
        onRefresh={onSettled}
      />
    ) : (
      <Provisioning />
    );
  }

  if (section === "plays") {
    return walletAddress ? (
      <PlaysGrid
        walletAddress={walletAddress}
        balances={balances}
        prices={prices}
        onRefresh={onSettled}
      />
    ) : (
      <Provisioning />
    );
  }

  if (!walletAddress) return <Provisioning />;

  return (
    <div className="space-y-6">
      <TraderHeader eyebrow="Portfolio" title="What you hold and what it earns">
        The wallet, every position across every venue, and the account&apos;s
        health. Funding starts here.
      </TraderHeader>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={`${GLASS_SURFACE} p-5 text-white lg:p-6`}>
          <WalletPanel
            walletAddress={walletAddress}
            balances={balances}
            balancesError={balancesError}
            balancesRefreshing={balancesRefreshing}
            prices={prices}
            scan={scan}
            earn={earn}
            onSent={onSettled}
            onRefresh={onRefresh}
          />
        </div>
        <div className={`${GLASS_SURFACE} p-5 text-white lg:col-span-2 lg:p-6`}>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Trader mode
          </div>
          <h3 className="mt-1.5 text-lg font-light tracking-tight text-white">
            Three ways to put money to work, one press each
          </h3>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <ModeNote title="Earn">
              USDC into a yield venue. Staking on Monad today, liquidity pools
              next.
            </ModeNote>
            <ModeNote title="Buy + Earn">
              Buy a tokenized stock, borrow USDC against it, and put the loan
              where it earns more than it costs.
            </ModeNote>
            <ModeNote title="Strategies">
              Named plays: a stock, a loan and a destination, chosen for a
              stated reason, run as one.
            </ModeNote>
          </dl>
          <p className="mt-5 text-xs text-white/45">
            Selling, sending, withdrawing to another wallet, hedging and perps
            live in Investor mode.{" "}
            <button
              type="button"
              onClick={onSwitchToInvestor}
              className="text-white/70 underline-offset-2 hover:text-white hover:underline"
            >
              Switch to Investor
            </button>
          </p>
        </div>
      </div>

      <PositionsPanel walletAddress={walletAddress} holdings={holdings} walletUsd={totalUsd} />
    </div>
  );
}

function ModeNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-white">{title}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-white/50">{children}</dd>
    </div>
  );
}

function Provisioning() {
  return (
    <p className="text-sm text-white/50">Waiting for embedded Solana wallet to provision...</p>
  );
}
