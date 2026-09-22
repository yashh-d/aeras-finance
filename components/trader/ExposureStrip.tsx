"use client";

// A row of marks: what is bought, an arrow, what the loan becomes. The
// destination marks overlap like a hand of cards, so eight Mag 7 stocks
// take the width of three, and anything past `max` folds into "+n".

import { AssetLogo } from "@/components/AssetLogo";
import type { Mark } from "@/lib/trader/exposures";

export function ExposureStrip({
  from,
  to,
  size = 28,
  max = 8,
  className,
}: {
  from: Mark;
  to: Mark[];
  size?: number;
  max?: number;
  className?: string;
}) {
  const shown = to.slice(0, max);
  const rest = to.length - shown.length;
  const small = Math.round(size * 0.86);
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`} aria-label="Exposures">
      <span title={from.name} className="shrink-0">
        <AssetLogo xstock={from} size={size} />
      </span>
      {to.length > 0 && (
        <>
          <svg
            viewBox="0 0 16 16"
            width={12}
            height={12}
            aria-hidden="true"
            className="shrink-0 text-white/30"
          >
            <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="flex items-center">
            {shown.map((m, i) => (
              <span
                key={m.key}
                title={m.name}
                className="rounded-full ring-2 ring-[#0d0f11]"
                style={{ marginLeft: i === 0 ? 0 : -Math.round(small * 0.3) }}
              >
                <AssetLogo xstock={m} size={small} />
              </span>
            ))}
            {rest > 0 && (
              <span
                className="ml-1 font-mono text-[10px] tabular-nums text-white/40"
                title={to.slice(max).map((m) => m.name).join(", ")}
              >
                +{rest}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
