"use client";

import { useState } from "react";
import { CircleDollarSign } from "lucide-react";

import type { XStock } from "@/lib/jupiter/xstocks";

// Renders a company logo for an asset, falling back to a symbol monogram when
// no logo is set or the image fails to load. The logos are full-bleed circular
// badges, so the image fills the circle edge-to-edge (object-cover) and the
// square corners are clipped by the rounded container.
export function AssetLogo({
  xstock,
  size = 32,
}: {
  xstock: Pick<XStock, "symbol" | "name" | "logo">;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  // "AAPLx" -> "AAPL"; keeps a readable monogram for assets without a logo.
  const monogram = xstock.symbol.replace(/x$/, "");

  if (!xstock.logo || errored) {
    return (
      <div
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-full bg-aeras-surface font-semibold leading-none tracking-tight text-aeras-500"
        style={{
          width: size,
          height: size,
          // Was a flat 9px, which fit while every monogram was four characters
          // or fewer. "XAUt0" is five and overflowed the circle. Steps down the
          // same way MarketLogo does for its three-character index badges.
          fontSize: monogram.length > 4 ? Math.round(size * 0.25) : 9,
        }}
      >
        {monogram}
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-aeras-border"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={xstock.logo}
        alt={`${xstock.name} logo`}
        className="h-full w-full object-cover"
        onError={() => setErrored(true)}
      />
    </div>
  );
}

// Marks an asset that can be borrowed against, in the asset lists on Home and
// Markets. Green rather than the blue used for interactive affordances: this is
// a property of the asset, not something to click.
export function LendingBadge({ size = 13 }: { size?: number }) {
  return (
    <CircleDollarSign
      className="shrink-0 text-aeras-positive"
      style={{ width: size, height: size }}
      aria-label="Can be lent against"
      role="img"
    />
  );
}

// Small square mark for a venue or chain, used in column headers and section
// labels. Square and borderless on purpose: at this size the circular AssetLogo
// badge reads as a bullet point rather than a logo.
export function VenueMark({ src, size = 14 }: { src: string; size?: number }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className="shrink-0 rounded-sm object-contain"
      style={{ width: size, height: size }}
    />
  );
}
