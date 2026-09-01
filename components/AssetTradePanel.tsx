"use client";

import { useState } from "react";

import { OpenLimitOrders } from "@/components/OpenLimitOrders";
import { SwapForm } from "@/components/SwapForm";
import { TriggerForm } from "@/components/TriggerForm";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { useTriggerAuth } from "@/lib/jupiter/use-trigger-auth";
import type { XStock } from "@/lib/jupiter/xstocks";
import type { AccountBalances } from "@/lib/solana/balances";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";

// Buy and sell one asset, at market or on a trigger, with the wallet's open
// orders for it underneath. Shared by the Markets row expansion and the Home
// asset detail so both trade through the same form rather than drifting apart.
export function AssetTradePanel({
  xstock,
  prices,
  balances,
  scan,
  walletAddress,
  auth,
  onRefresh,
  autoFocus = false,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  // Passed through to the buy ticket, which offers off-Solana USDC as a way
  // to pay. Optional so a caller without a scan still renders.
  scan?: WalletScan;
  walletAddress: string | null;
  auth: ReturnType<typeof useTriggerAuth>;
  onRefresh: () => void;
  // Put the caret in the amount as soon as the ticket appears. On for Home,
  // where opening an asset is already the decision to trade it; off for the
  // Markets row expansion, which happens inside a scrolling list.
  autoFocus?: boolean;
}) {
  const [tab, setTab] = useState<"market" | "limit">("market");
  // Bumped after a limit order is placed so the open-orders list refetches.
  const [ordersRefresh, setOrdersRefresh] = useState(0);

  if (!walletAddress) {
    return (
      <p className="text-sm text-white/50">
        Waiting for embedded Solana wallet to provision...
      </p>
    );
  }

  // Passed into whichever form is showing, which seats it next to buy/sell.
  // Quieter than that control on purpose: direction is the primary choice and
  // two filled segments side by side read as equal weight.
  const modeToggle = (
    <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
      {(["market", "limit"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setTab(t)}
          className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${
            tab === t
              ? "bg-white/10 text-white"
              : "text-white/50 hover:text-white"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {tab === "market" ? (
        <SwapForm
          ticker={xstock}
          walletAddress={walletAddress}
          prices={prices}
          balances={balances}
          scan={scan}
          onBalanceChange={onRefresh}
          modeToggle={modeToggle}
          autoFocus={autoFocus}
        />
      ) : (
        <TriggerForm
          ticker={xstock}
          walletAddress={walletAddress}
          prices={prices}
          balances={balances}
          auth={auth}
          onBalanceChange={onRefresh}
          onOrderPlaced={() => setOrdersRefresh((n) => n + 1)}
          modeToggle={modeToggle}
          autoFocus={autoFocus}
        />
      )}

      {/* On the limit tab this is part of the job, so it stays visible even
          with nothing in it. On the market tab it only appears if the wallet
          actually has orders open on this asset. */}
      <OpenLimitOrders
        ticker={xstock}
        auth={auth}
        refreshKey={ordersRefresh}
        onChanged={onRefresh}
        showWhenEmpty={tab === "limit"}
      />
    </>
  );
}
