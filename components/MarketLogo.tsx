"use client";

import { useState } from "react";

import { marketBadge, marketLogo } from "@/lib/tokens/market-logos";

// Logo for a perps market, or a coloured monogram when the market has no mark.
//
// The monogram is not a failure state. Spot metals and index products have no
// logo anywhere, and the venue itself draws them this way: "Au" on gold, "100"
// on its index blue. A broken image would be a failure state, so a file that
// 404s falls through to the same badge.
export function MarketLogo({
  market,
  size = 28,
}: {
  market: string;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const src = marketLogo(market);

  if (!src || errored) {
    const badge = marketBadge(market);
    return (
      <div
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-full font-semibold leading-none"
        style={{
          width: size,
          height: size,
          background: badge.background,
          color: badge.foreground,
          // Three-character labels ("100") need to step down or they overflow
          // the circle at small sizes.
          fontSize: Math.round(size * (badge.label.length > 2 ? 0.3 : 0.38)),
        }}
      >
        {badge.label}
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="h-full w-full object-cover"
        onError={() => setErrored(true)}
      />
    </div>
  );
}
