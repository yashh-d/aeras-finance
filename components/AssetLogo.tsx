"use client";

import { useState } from "react";

import type { XStock } from "@/lib/jupiter/xstocks";

// Renders a company logo for an asset, falling back to a symbol monogram when
// no logo is set or the image fails to load. Logos vary in shape (square marks
// and horizontal wordmarks), so the image is centered with object-contain and
// never distorted.
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
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-aeras-border bg-white"
      style={{ width: size, height: size, padding: Math.round(size * 0.18) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={xstock.logo}
        alt={`${xstock.name} logo`}
        className="h-full w-full object-contain"
        onError={() => setErrored(true)}
      />
    </div>
  );
}
