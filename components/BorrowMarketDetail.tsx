"use client";

import { AssetLogo } from "@/components/AssetLogo";
import { assetIdentity } from "@/lib/jupiter/xstocks";

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

