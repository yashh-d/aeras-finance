"use client";

// Field and stat primitives for an expanded borrow market, in the shape the
// Jupiter Lend and Kamino cards draw them. Those two carry their own copies;
// this module is what a new market card imports so it reads as the same kind
// of card.

export function NumberField({
  label,
  value,
  onChange,
  right,
  balanceLabel,
  onMax,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  right: string;
  balanceLabel?: string;
  onMax?: () => void;
}) {
  return (
    <div>
      {(label || balanceLabel) && (
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            {label}
          </label>
          {balanceLabel && (
            <span className="font-mono text-[11px] text-white/50">
              {balanceLabel}
              {onMax && (
                <button
                  type="button"
                  onClick={onMax}
                  className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
                >
                  Max
                </button>
              )}
            </span>
          )}
        </div>
      )}
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
          {right}
        </span>
      </div>
    </div>
  );
}

// A labelled figure with a status dot, as the position cards draw them.
export function DotStat({
  label,
  value,
  sub,
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
  dot?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-white/50">
        {dot && (
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        )}
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-white">
        {value}
        {sub && <span className="text-white/50"> · {sub}</span>}
      </div>
    </div>
  );
}
