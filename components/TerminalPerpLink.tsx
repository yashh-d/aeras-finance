"use client";

// The pointer from an asset to its perp, beside the ticket: what the market
// is and how far it can be levered, as the venue states it. A press switches
// the ticket to perps mode rather than leaving the Terminal.

import { ArrowRight } from "lucide-react";

import { AssetLogo } from "@/components/AssetLogo";
import type { XStock } from "@/lib/jupiter/xstocks";
import type { LighterMarket } from "@/lib/lighter/types";

export function TerminalPerpLink({
  xstock,
  market,
  onOpen,
}: {
  xstock: XStock;
  market: LighterMarket;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 text-left transition-colors hover:text-white"
    >
      <AssetLogo xstock={xstock} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium tracking-tight text-white">
          Trade {market.symbol}-PERP
          <ArrowRight className="size-3.5 text-white/50" />
        </div>
        <div className="text-xs text-white/50">
          Long or short {market.symbol} with up to{" "}
          <span className="font-medium text-white/80">{market.maxLeverage}x</span> leverage on Lighter
        </div>
      </div>
    </button>
  );
}
