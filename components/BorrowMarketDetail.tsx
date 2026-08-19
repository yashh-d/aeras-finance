"use client";

import { AssetLogo } from "@/components/AssetLogo";
import { assetIdentity } from "@/lib/jupiter/xstocks";
import { formatUsdCompact } from "@/lib/borrow/use-market-stats";

export type BorrowMode = "borrow" | "repay";

// Head of an expanded market: what this market will lend you, what you already
// owe it, and which of the two actions is on screen below.
export function MarketDetailHeader({
  mint,
  symbol,
  borrowSymbol,
  availableUsd,
  owedUsd,
  mode,
  onModeChange,
  canRepay,
}: {
  mint: string;
  symbol: string;
  borrowSymbol: string;
  // Still drawable from this market, after existing debt. Null while the vault
  // state or price needed to size it is still loading.
  availableUsd: number | null;
  owedUsd: number;
  mode: BorrowMode;
  onModeChange: (mode: BorrowMode) => void;
  canRepay: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <AssetLogo xstock={assetIdentity(mint, symbol)} size={44} />
        <div className="font-light text-xl tracking-tight text-white">
          {symbol}
        </div>
      </div>

      <div className="space-y-1 text-center">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Available to borrow
        </div>
        <div className="font-mono text-[2.25rem] font-light leading-none tracking-tight tabular-nums text-white">
          {availableUsd == null ? "—" : `$${availableUsd.toFixed(2)}`}
        </div>
        <div className="text-xs text-white/50">
          You currently owe{" "}
          <span className="font-mono tabular-nums text-white">
            ${owedUsd.toFixed(2)}
          </span>{" "}
          in {borrowSymbol}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ModeButton
          label="Repay"
          active={mode === "repay"}
          disabled={!canRepay}
          onClick={() => onModeChange("repay")}
        />
        <ModeButton
          label="Borrow"
          active={mode === "borrow"}
          onClick={() => onModeChange("borrow")}
        />
      </div>
      {!canRepay && mode === "repay" && (
        <p className="text-center text-[11px] text-white/50">
          Nothing to repay in this market yet.
        </p>
      )}
    </div>
  );
}

function ModeButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-full px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-aeras-blue text-white hover:bg-aeras-blue-medium"
          : "border border-white/15 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

// Market-level facts, as tiles. Deliberately about the market rather than the
// user, so it reads the same whether or not they hold a position. The header
// above already answers "what can I draw"; this answers "how big and how deep is
// the market I would be drawing from".
export function MarketStatGrid({
  aprPct,
  priceUsd,
  suppliedUsd,
  borrowedUsd,
  liquidityUsd,
  maxLtvPct,
  borrowSymbol,
}: {
  aprPct: number | null;
  priceUsd: number | null;
  suppliedUsd: number | null;
  borrowedUsd: number | null;
  // Undrawn borrow-asset liquidity across the venue. Distinct from the header's
  // "available to borrow", which is this capped by the user's own collateral.
  liquidityUsd: number | null;
  maxLtvPct: number;
  borrowSymbol: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatTile
        label={`Borrow APY · ${borrowSymbol}`}
        value={aprPct == null ? "—" : `${aprPct.toFixed(2)}%`}
      />
      <StatTile
        label="Price"
        value={priceUsd == null ? "—" : `$${priceUsd.toFixed(2)}`}
      />
      <StatTile
        label="Total market supplied"
        value={suppliedUsd == null ? "—" : formatUsdCompact(suppliedUsd)}
      />
      <StatTile
        label="Total market borrowed"
        value={borrowedUsd == null ? "—" : formatUsdCompact(borrowedUsd)}
      />
      <StatTile
        label={`${borrowSymbol} liquidity`}
        value={liquidityUsd == null ? "—" : formatUsdCompact(liquidityUsd)}
      />
      <StatTile label="Max LTV" value={`${maxLtvPct.toFixed(0)}%`} />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        {label}
      </div>
      <div className="mt-1.5 font-mono text-lg font-light tabular-nums text-white">
        {value}
      </div>
    </div>
  );
}
