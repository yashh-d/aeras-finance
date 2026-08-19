"use client";

import { useState } from "react";

import { OpenLimitOrders } from "@/components/OpenLimitOrders";
import { SwapForm } from "@/components/SwapForm";
import { TriggerForm } from "@/components/TriggerForm";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { useTriggerAuth } from "@/lib/jupiter/use-trigger-auth";
import type { XStock } from "@/lib/jupiter/xstocks";
import type { AccountBalances } from "@/lib/solana/balances";

// Buy and sell one asset, at market or on a trigger, with the wallet's open
// orders for it underneath. Shared by the Markets row expansion and the Home
// asset detail so both trade through the same form rather than drifting apart.
export function AssetTradePanel({
  xstock,
  prices,
  balances,
  walletAddress,
  auth,
  onRefresh,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  walletAddress: string | null;
  auth: ReturnType<typeof useTriggerAuth>;
  onRefresh: () => void;
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

  return (
    <>
      <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
        {(["market", "limit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
              tab === t
                ? "bg-aeras-blue text-white"
                : "text-white/60 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "market" ? (
        <SwapForm
          ticker={xstock}
          walletAddress={walletAddress}
          prices={prices}
          balances={balances}
          onBalanceChange={onRefresh}
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
        />
      )}

      <OpenLimitOrders
        ticker={xstock}
        auth={auth}
        refreshKey={ordersRefresh}
        onChanged={onRefresh}
      />
    </>
  );
}
