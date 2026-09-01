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

// Copy for the badge's hover card. Sized to wrap to two lines at w-60; longer
// than this runs to three and the card stops reading as a caption on the mark.
// USDC rather than "stablecoins" because it is the single borrow asset at both
// venues (KAMINO_USDC_BORROW, and every Jupiter vault's borrowSymbol).
const LENDING_TITLE = "Usable as collateral";
const LENDING_BODY =
  "Post it as collateral and borrow USDC against it without selling.";
// How far left of the badge the hover card's own left edge sits. Left-anchored
// rather than centred: the badge is a few characters in from the card's padding
// and a 15rem card centred on it would hang off the card entirely.
const LENDING_TIP_INSET = 10;

// Marks an asset that can be borrowed against, in the asset lists on Home and
// Markets. Green rather than the blue used for interactive affordances: this is
// a property of the asset, not something to click.
export function LendingBadge({ size = 13 }: { size?: number }) {
  return (
    // The mark on its own says nothing about what it means, so it carries a
    // hover card. Spans with pointer events off, not a popover component: this
    // renders INSIDE the row button on both surfaces, where a focusable or
    // block-level child would be invalid markup and would eat the row's click.
    <span className="group/lend relative inline-flex shrink-0 items-center">
      <CircleDollarSign
        className="shrink-0 text-aeras-positive"
        style={{ width: size, height: size }}
        aria-label={`${LENDING_TITLE}. ${LENDING_BODY}`}
        role="img"
      />
      <span
        aria-hidden="true"
        style={{ left: -LENDING_TIP_INSET }}
        className="pointer-events-none absolute bottom-full z-30 mb-2 w-60 translate-y-1 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/lend:translate-y-0 group-hover/lend:opacity-100 motion-reduce:transition-none"
      >
        <span className="block rounded-xl border border-white/10 bg-aeras-900/95 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <span className="block text-[11px] font-medium tracking-tight text-white">
            {LENDING_TITLE}
          </span>
          <span className="mt-1 block text-[11px] leading-snug text-white/60">
            {LENDING_BODY}
          </span>
        </span>
        {/* Points back at the badge. Sized off `size` so it stays on the
            badge's centre at either of the two sizes callers pass. */}
        <span
          style={{ left: LENDING_TIP_INSET + size / 2 }}
          className="absolute top-full size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/10 bg-aeras-900"
        />
      </span>
    </span>
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
