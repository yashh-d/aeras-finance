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

      {/* A quiet switch, not two solid pills.
          The pills were the same size and weight as the submit button below,
          so an expanded market showed a big "Borrow" above a big
          "Borrow $14.12 against TSLAx" and it was not obvious which one did
          the thing. Choosing the mode is navigation; the action is at the
          bottom. This reads as a tab strip and leaves one prominent button on
          screen. */}
      <div className="flex items-center justify-center gap-6 border-b border-white/[0.06] text-xs">
        <ModeTab
          label="Borrow"
          active={mode === "borrow"}
          onClick={() => onModeChange("borrow")}
        />
        <ModeTab
          label="Repay"
          active={mode === "repay"}
          disabled={!canRepay}
          onClick={() => onModeChange("repay")}
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

// Still a real button with aria-pressed, so the control stays announced as a
// choice rather than reading as decorative text.
function ModeTab({
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
      // The active tab draws its own underline over the container's rule, so
      // the two sit on the same line rather than stacking a border under it.
      className={`-mb-px border-b-2 px-1 pb-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? "border-aeras-blue text-white"
          : "border-transparent text-white/40 hover:text-white/70"
      }`}
    >
      {label}
    </button>
  );
}

