"use client";

// The Terminal's ticket: one asset, three ways to act on it.
//
// Spot is the same buy and sell the rest of the app runs, in the hero layout
// (see SwapForm). Perps is the Lighter ticket in its embedded form, on the
// perp whose underlying is this asset. Borrow is the Borrow tab's own card for
// the venue that takes the asset as collateral, run here. Modes that the
// asset does not have are not offered, so a bullion token shows spot alone
// and nothing about perps it cannot trade. A bare Lighter market, one with no
// catalog asset, has the perps mode alone.
//
// Which mode is open is the panel's state, not this component's, because the
// chart above it changes with the mode: an xStock and its perp are two
// markets with two prices.

import { AssetTradePanel } from "@/components/AssetTradePanel";
import { LighterPerpsSection } from "@/components/LighterPerpsSection";
import { TerminalAssetPicker } from "@/components/TerminalAssetPicker";
import { TerminalBorrow } from "@/components/TerminalBorrow";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { useTriggerAuth } from "@/lib/jupiter/use-trigger-auth";
import type { XStock } from "@/lib/jupiter/xstocks";
import type { LighterMarket } from "@/lib/lighter/types";
import type { UseLighterPerps } from "@/lib/lighter/use-lighter-perps";
import type { AccountBalances } from "@/lib/solana/balances";
import type { TerminalSelection } from "@/lib/terminal/selection";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";

export type TicketMode = "spot" | "perps" | "borrow";

const MODE_LABEL: Record<TicketMode, string> = {
  spot: "Spot",
  perps: "Perps",
  borrow: "Borrow",
};

export function TerminalTicket({
  selection,
  mode,
  modes,
  onMode,
  prices,
  balances,
  scan,
  walletAddress,
  auth,
  onRefresh,
  perpMarket,
  perpMarkets,
  perps,
  onPick,
  onPickerOpen,
  onLimitPriceChange,
}: {
  selection: TerminalSelection;
  mode: TicketMode;
  // The modes this selection has, in display order.
  modes: readonly TicketMode[];
  onMode: (next: TicketMode) => void;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  scan: WalletScan;
  walletAddress: string | null;
  auth: ReturnType<typeof useTriggerAuth>;
  onRefresh: () => void;
  // The Lighter market on this asset's underlying, when there is one.
  perpMarket: LighterMarket | null;
  // The whole tradeable catalog, for the picker's Perps group.
  perpMarkets: readonly LighterMarket[];
  // The perps account state. Null until the perps mode has been opened, since
  // the hook behind it polls and nothing should poll for a mode not on screen.
  perps: UseLighterPerps | null;
  // The picker in the header. See TerminalAssetPicker.
  onPick: (selection: TerminalSelection, mode: TicketMode) => void;
  onPickerOpen?: (open: boolean) => void;
  // The limit form's price, drawn on the chart. See TriggerForm.
  onLimitPriceChange?: (price: number | null, direction: "buy" | "sell") => void;
}) {
  const xstock: XStock | null = selection.kind === "asset" ? selection.xstock : null;
  const label = xstock ? xstock.symbol : `${selection.kind === "perp" ? selection.symbol : ""}-PERP`;
  return (
    <div className="space-y-4">
      <TerminalAssetPicker
        value={selection}
        mode={mode}
        prices={prices}
        perpMarkets={perpMarkets}
        onSelect={onPick}
        onOpenChange={onPickerOpen}
        variant="ticket"
      />

      {modes.length > 1 && (
        <div className="flex gap-4 border-b border-white/10">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              aria-pressed={mode === m}
              className={`-mb-px border-b-2 pb-2 text-sm transition-colors ${
                mode === m
                  ? "border-white text-white"
                  : "border-transparent text-white/50 hover:text-white/80"
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      {mode === "spot" && xstock && (
        <AssetTradePanel
          key={xstock.mint}
          xstock={xstock}
          prices={prices}
          balances={balances}
          scan={scan}
          walletAddress={walletAddress}
          auth={auth}
          onRefresh={onRefresh}
          variant="hero"
          onLimitPriceChange={onLimitPriceChange}
        />
      )}

      {mode === "perps" &&
        (perpMarket && perps ? (
          <>
            <p className="text-[11px] text-white/40">
              {perpMarket.symbol} perpetual on Lighter. Priced by its own book,
              not the xStock, and settled in USDC margin.
            </p>
            <LighterPerpsSection
              key={perpMarket.symbol}
              perps={perps}
              balances={balances}
              scan={scan}
              initialMarket={perpMarket.symbol}
              embedded
            />
          </>
        ) : (
          <p className="py-4 text-sm text-white/40">No perp market for {label}.</p>
        ))}

      {mode === "borrow" && xstock && (
        <TerminalBorrow
          xstock={xstock}
          prices={prices}
          balances={balances}
          walletAddress={walletAddress}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}
