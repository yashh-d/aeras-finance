"use client";

import { useState } from "react";

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
        className="flex shrink-0 items-center justify-center rounded-full bg-aeras-surface text-[9px] font-semibold tracking-tight text-aeras-500"
        style={{ width: size, height: size }}
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
