"use client";

// Pieces the three strategy tickets share: the USDC amount entry, the borrow
// ratio slider, the preview rows, and the step list that shows a run landing
// one signature at a time.

import type { CSSProperties } from "react";
import { Check, Loader2, X } from "lucide-react";

import { AmountField } from "@/components/AmountField";
import type { BorrowRoute } from "@/lib/borrow/route";
import { safeMaxBorrowRatio } from "@/lib/borrow/route";
import { SOLSCAN_TX_BASE } from "@/lib/jupiter/constants";
import { INSET_PANEL } from "@/lib/ui/surface";
import type { StrategyRun } from "@/lib/strategies/run";
import { leverageForRatio } from "@/lib/strategies/math";

export function fmtPct(decimal: number | null | undefined, digits = 2): string {
  if (decimal == null || !Number.isFinite(decimal)) return "—";
  return `${(decimal * 100).toFixed(digits)}%`;
}

export function fmtSignedPct(decimal: number | null | undefined, digits = 2): string {
  if (decimal == null || !Number.isFinite(decimal)) return "—";
  const sign = decimal > 0 ? "+" : "";
  return `${sign}${(decimal * 100).toFixed(digits)}%`;
}

export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(digits)}`;
}

export function fmtHealth(h: number): string {
  if (!Number.isFinite(h)) return "∞";
  return h.toFixed(2);
}

// Floor to a cent. Amounts that become a borrow or a deposit are floored so
// the chain is never asked for a fraction of an atomic unit more than exists.
export function floorCents(n: number): number {
  return Math.floor(n * 100) / 100;
}

export const PRIMARY_BUTTON =
  "w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40";

export const SECONDARY_BUTTON =
  "rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

// USDC in, with the wallet balance and a Max beside it.
export function UsdcAmount({
  value,
  onChange,
  balanceUsdc,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  balanceUsdc: number | null;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        Pay with
      </div>
      <AmountField
        value={value}
        onChange={onChange}
        prefix="$"
        unit={<span className="text-sm text-white/50">USDC</span>}
        ariaLabel="USDC amount"
        autoFocus={autoFocus}
      />
      <div className="flex items-center gap-2 text-xs text-white/50">
        <span>
          Available{" "}
          <span className="font-mono tabular-nums text-white/70">
            {balanceUsdc == null ? "—" : fmtUsd(floorCents(balanceUsdc))}
          </span>
        </span>
        {balanceUsdc != null && balanceUsdc > 0 && (
          <button
            type="button"
            onClick={() => onChange(floorCents(balanceUsdc).toFixed(2))}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/50 hover:bg-white/10 hover:text-white"
          >
            Max
          </button>
        )}
      </div>
    </div>
  );
}

// Debt as a fraction of what the asset is worth. Capped at the same 90%-of-CF
// ceiling the borrow forms use, and labelled with what it means for health.
export function RatioSlider({
  route,
  value,
  onChange,
  disabled,
}: {
  route: BorrowRoute;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const min = 0.05;
  const max = Math.floor(safeMaxBorrowRatio(route) * 100) / 100;
  const health = route.liquidationThreshold / value;
  const drop = Math.max(0, 1 - value / route.liquidationThreshold);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <span className="text-white/50">Borrow against it</span>
        <span className="font-mono tabular-nums text-white">
          {(value * 100).toFixed(0)}% of value
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={
          {
            "--range-progress": Math.min(
              1,
              Math.max(0, (value - min) / (max - min)),
            ),
          } as CSSProperties
        }
        className="aeras-range"
      />
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-white/50">
        <span>Health {fmtHealth(health)}</span>
        <span>{leverageForRatio(value).toFixed(2)}× if looped</span>
        <span>Liquidation at −{(drop * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

export function PreviewRow({
  label,
  value,
  warn,
  muted,
}: {
  label: string;
  value: string;
  warn?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-white/50">{label}</span>
      <span
        className={`font-mono tabular-nums ${
          warn ? "text-aeras-warning" : muted ? "text-white/60" : "text-white"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function PreviewBlock({ children }: { children: React.ReactNode }) {
  return <div className={`space-y-2 ${INSET_PANEL} px-3 py-3`}>{children}</div>;
}

export function Note({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn";
}) {
  return (
    <p
      className={`rounded-xl px-4 py-3 text-xs leading-relaxed ${
        tone === "warn"
          ? "border border-aeras-warning/30 bg-aeras-warning/10 text-white/70"
          : "border border-aeras-blue/30 bg-aeras-blue/15 text-white/60"
      }`}
    >
      {children}
    </p>
  );
}

// The run as it lands. Each step is one row: what it is, what it is doing
// right now, and the signatures it produced. A failed step carries its error
// and the one action that makes sense, which is to retry it.
export function StepList({ run }: { run: StrategyRun }) {
  if (run.steps.length === 0) return null;
  return (
    <div className={`space-y-2 ${INSET_PANEL} px-3 py-3`}>
      {run.steps.map((s, i) => (
        <div key={`${s.id}-${i}`} className="flex items-start gap-2.5 text-xs">
          <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
            {s.status === "done" ? (
              <Check className="size-3.5 text-aeras-positive" />
            ) : s.status === "running" ? (
              <Loader2 className="size-3.5 animate-spin text-white/70" />
            ) : s.status === "failed" ? (
              <X className="size-3.5 text-aeras-negative" />
            ) : (
              <span className="inline-block size-1.5 rounded-full bg-white/25" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div
              className={
                s.status === "pending" ? "text-white/40" : "text-white"
              }
            >
              {s.label}
            </div>
            {s.detail && s.status === "running" && (
              <div className="mt-0.5 text-white/50">{s.detail}</div>
            )}
            {s.error && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-aeras-negative">{s.error}</span>
                <button
                  type="button"
                  onClick={run.retry}
                  disabled={run.running}
                  className={SECONDARY_BUTTON}
                >
                  Retry this step
                </button>
              </div>
            )}
            {s.signatures.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-2">
                {s.signatures.map((sig) => (
                  <a
                    key={sig}
                    href={`${SOLSCAN_TX_BASE}${sig}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-white/50 underline-offset-2 hover:text-white hover:underline"
                  >
                    {sig.slice(0, 8)}…
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
