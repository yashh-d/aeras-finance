"use client";

// The order ticket both perps venues render.
//
// Presentational only. It owns the direction toggle and the amount field,
// because those are the form's own state, and takes everything venue-specific
// as props: the summary rows, the warnings, whether leverage is adjustable and
// what the disabled state should say. That split is what lets Lighter and Ondo
// share one form without the form knowing anything about either venue, which is
// the line CLAUDE.md draws for the hedge tab and this keeps.
//
// Direction is a segmented control at the top with a single action button at
// the bottom, rather than a Long button beside a Short button. The pair reads
// as two equal choices made at the moment of submitting; the toggle makes the
// direction a decision you make first and can see you have made, and it leaves
// one primary action that can carry the market's name.
//
// The order it reads in, top to bottom: what you have, what you are spending,
// the action, then what it works out to. The summary sits BELOW the action
// rather than above it, which is the one thing about the layout worth arguing
// for. Those rows are a check on a decision already made, and putting seven of
// them between the amount and the button pushed the button off a short screen
// and made the ticket feel like a form to complete rather than a trade to
// place.
//
// Two things in the reference this was modelled on are deliberately absent.
// There is no Market/Limit switch, because both venues place market orders only
// here and a Limit tab that silently placed a market order would be worse than
// no tab. And there is no stop-loss, take-profit or reduce-only control,
// because none is built on the open path. Adding any of them is a feature, not
// a restyle.

import type { CSSProperties } from "react";

import { INSET_PANEL } from "@/lib/ui/surface";

const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.14em] text-white/35";

export type TicketSide = "long" | "short";

export interface TicketRow {
  label: string;
  value: string;
  // Rendered dimmer, for a figure that is an estimate rather than a quote.
  muted?: boolean;
  // Only read in `context`. A control that belongs on the figure it acts on,
  // which is what Add and Withdraw are to available margin.
  action?: React.ReactNode;
}

export interface TicketLeverage {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  saving?: boolean;
}

export interface TicketSizing {
  // The largest notional the account can open right now. The slider is a
  // fraction of this, so a venue that cannot compute one omits sizing entirely
  // rather than passing zero and rendering a control that does nothing.
  maxUsd: number;
}

export function PerpsTicket({
  symbol,
  side,
  onSide,
  context = [],
  amount,
  onAmount,
  presets,
  sizing,
  leverage,
  rows,
  warnings = [],
  tradable,
  busy,
  submittable,
  disabledReason,
  onSubmit,
  footnote,
}: {
  // Names the action button, so the user reads what they are about to do
  // rather than a bare "Buy".
  symbol: string;
  // Controlled by the caller rather than held here, because a liquidation
  // estimate is direction-dependent: the rows have to be able to change with
  // the toggle.
  side: TicketSide;
  onSide: (next: TicketSide) => void;
  // State of the account, above the amount. What you can spend and what you
  // are already in on this market, which are the two facts that decide whether
  // the number you are about to type is a sensible one.
  context?: TicketRow[];
  amount: string;
  onAmount: (next: string) => void;
  presets: readonly number[];
  // Sizing as a fraction of what the account can actually open. Two-way with
  // the amount field, which stays authoritative: typing moves the slider, and
  // the slider never caps what can be typed.
  sizing?: TicketSizing;
  // Omitted by a venue that cannot set leverage. Lighter is one: doing so is a
  // transaction there rather than an API call, so the ticket reports the
  // market's own maximum as a row instead of offering a control that lies.
  leverage?: TicketLeverage;
  rows: TicketRow[];
  // Amber, above the action. Sizing caps and margin shortfalls.
  warnings?: string[];
  tradable: boolean;
  busy: boolean;
  // False when the amount itself is unusable, separate from `tradable`, which
  // is about the account.
  submittable: boolean;
  disabledReason?: string;
  onSubmit: (side: TicketSide) => void;
  footnote?: string;
}) {
  const long = side === "long";

  // Where the slider sits, read off the amount rather than held separately.
  // Keeping a second copy of this in state meant the thumb stopped agreeing
  // with the field the moment a preset button was pressed.
  const entered = Number(amount);
  const percent =
    sizing && sizing.maxUsd > 0 && Number.isFinite(entered)
      ? Math.min(100, Math.max(0, (entered / sizing.maxUsd) * 100))
      : 0;

  function onPercent(next: number) {
    if (!sizing || sizing.maxUsd <= 0) return;
    // 100% takes the maximum exactly. Rounding it like every other step leaves
    // a few cents on the table and reads as the control being unable to reach
    // its own end.
    const value = next >= 100 ? sizing.maxUsd : (next / 100) * sizing.maxUsd;
    onAmount(String(Number(value.toFixed(2))));
  }

  return (
    <div className={`${INSET_PANEL} p-4`}>
      <div className="flex rounded-full border border-white/10 bg-black/30 p-1">
        {(["long", "short"] as const).map((s) => {
          const active = side === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSide(s)}
              className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                active
                  ? s === "long"
                    ? "bg-aeras-positive text-white"
                    : "bg-aeras-negative text-white"
                  : "text-white/45 hover:text-white/75"
              }`}
            >
              {s === "long" ? "Buy / Long" : "Sell / Short"}
            </button>
          );
        })}
      </div>

      {context.length > 0 && (
        <div className="mt-3 space-y-1.5 text-[11px]">
          {context.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-white/40">{row.label}</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`font-mono tabular-nums ${
                    row.muted ? "text-white/45" : "text-white/80"
                  }`}
                >
                  {row.value}
                </span>
                {row.action}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <div className={LABEL}>Amount (USD)</div>
        <div className="mt-1.5 flex items-center rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 focus-within:border-white/25">
          <span className="mr-1.5 text-lg text-white/30">$</span>
          <input
            value={amount}
            onChange={(e) => onAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            placeholder="0"
            className="w-full bg-transparent font-mono text-2xl tabular-nums text-white outline-none placeholder:text-white/20"
          />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {presets.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onAmount(String(n))}
              className="rounded-lg border border-white/10 py-1.5 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white"
            >
              ${n.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      {sizing && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className={LABEL}>Size</span>
            <span className="font-mono text-[11px] tabular-nums text-white/50">
              {percent.toFixed(0)}% of {usd(sizing.maxUsd)}
            </span>
          </div>
          <div className="mt-2">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(percent)}
              disabled={sizing.maxUsd <= 0}
              onChange={(e) => onPercent(Number(e.target.value))}
              // Unitless 0-1, read by .aeras-range to place the fill edge under
              // the thumb's centre.
              style={{ "--range-progress": percent / 100 } as CSSProperties}
              className="aeras-range"
            />
          </div>
        </div>
      )}

      {leverage && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className={LABEL}>Leverage</span>
            <span className="font-mono text-sm tabular-nums text-white">
              {leverage.value}×
            </span>
          </div>
          <div className="mt-2">
            <input
              type="range"
              min={leverage.min}
              max={leverage.max}
              step={1}
              value={leverage.value}
              disabled={leverage.saving}
              onChange={(e) => leverage.onChange(Number(e.target.value))}
              // Unitless 0-1, read by .aeras-range to place the fill edge under
              // the thumb's centre. Clamped because the maximum is the market's
              // and can drop when the user switches market while a higher
              // value is selected.
              style={
                {
                  "--range-progress":
                    leverage.max > leverage.min
                      ? Math.min(
                          1,
                          Math.max(
                            0,
                            (leverage.value - leverage.min) /
                              (leverage.max - leverage.min),
                          ),
                        )
                      : 0,
                } as CSSProperties
              }
              className="aeras-range"
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-white/40">
            <span>{leverage.min}×</span>
            <span>{leverage.max}× max</span>
          </div>
        </div>
      )}

      {warnings.map((warning) => (
        <p
          key={warning}
          className="mt-3 text-[11px] leading-relaxed text-aeras-warning"
        >
          {warning}
        </p>
      ))}

      <button
        type="button"
        onClick={() => onSubmit(side)}
        disabled={!tradable || busy || !submittable}
        className={`mt-4 w-full rounded-full px-4 py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30 ${
          long
            ? "bg-aeras-positive hover:bg-aeras-positive/90"
            : "bg-aeras-negative hover:bg-aeras-negative/90"
        }`}
      >
        {busy ? "Working…" : `${long ? "Long" : "Short"} ${symbol}`}
      </button>

      {!tradable && disabledReason && (
        <p className="mt-2 text-center text-[11px] text-white/35">
          {disabledReason}
        </p>
      )}

      <div className="mt-3 space-y-1.5 rounded-xl bg-black/25 px-3 py-3 text-[11px]">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3">
            <span className="text-white/40">{row.label}</span>
            <span
              className={`font-mono tabular-nums ${
                row.muted ? "text-white/45" : "text-white/80"
              }`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {footnote && (
        <p className="mt-3 text-[11px] leading-relaxed text-white/30">
          {footnote}
        </p>
      )}
    </div>
  );
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}
