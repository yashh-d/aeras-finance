"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AssetLogo } from "@/components/AssetLogo";
import { fetchChartViaProxy, type OhlcCandle } from "@/lib/jupiter/charts";
import type { XStock } from "@/lib/jupiter/xstocks";

const RANGES = ["1D", "1W", "1M", "3M"] as const;
type Range = (typeof RANGES)[number];

// Module-scoped cache of the last good candles per (mint, range). Survives
// component remounts and range toggles so switching assets/ranges renders the
// previous chart instantly and a failed refetch can fall back to it instead of
// blanking to an error screen.
const clientChartCache = new Map<string, OhlcCandle[]>();

// How often a chart with nothing to show retries on its own.
const AUTO_RETRY_MS = 15_000;

// An optional horizontal marker drawn across the chart. Used by the borrow
// preview to show the price at which a position would be closed, without the
// axis being cropped so tightly that the line falls off-screen.
export interface PriceChartMarker {
  price: number;
  label: string;
}

export function PriceChart({
  ticker,
  marker,
  // Tailwind height class for the plot area. Defaults to the compact size the
  // dashboard cards use; an expanded row passes something taller, since the
  // point of drilling in is to actually read the chart.
  heightClass = "h-32",
  // Drop the name/price/change heading. Set where the surrounding view already
  // names the asset and shows its price, so the chart does not restate both a
  // second time with a slightly different number.
  showHeading = true,
  // Drop just the logo badge, keeping the heading. Narrower than showHeading and
  // set for a different reason: the Markets row draws its own logo immediately
  // above the chart, so a second one lands a few pixels below the first.
  showLogo = true,
}: {
  ticker: XStock;
  marker?: PriceChartMarker;
  heightClass?: string;
  showHeading?: boolean;
  showLogo?: boolean;
}) {
  const [range, setRange] = useState<Range>("1D");
  const [candles, setCandles] = useState<OhlcCandle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped to force a refetch (auto-retry / manual retry) without changing the
  // ticker or range.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${ticker.mint}:${range}`;
    const cachedNow = clientChartCache.get(cacheKey);
    // Show last-good data immediately while we refetch in the background. Only
    // fall back to the spinner when we have nothing cached for this view.
    if (cachedNow) {
      setCandles(cachedNow);
      setError(null);
      setLoading(false);
    } else {
      setCandles(null);
      setError(null);
      setLoading(true);
    }

    fetchChartViaProxy(ticker.mint, range)
      .then((data) => {
        if (cancelled) return;
        clientChartCache.set(cacheKey, data);
        setCandles(data);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        // Keep whatever we last rendered. Surface the error only when there is
        // no cached data to fall back to, so a transient failure never wipes a
        // chart that was loading fine.
        if (!clientChartCache.has(cacheKey)) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ticker.mint, range, reloadTick]);

  // Self-heal: while a chart is stuck with nothing to show, keep retrying so it
  // recovers on its own once Coingecko's rate limit clears.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setReloadTick((n) => n + 1), AUTO_RETRY_MS);
    return () => clearTimeout(id);
  }, [error]);

  const first = candles?.[0]?.c;
  const last = candles?.[candles.length - 1]?.c;
  const change =
    first != null && last != null && first !== 0
      ? ((last - first) / first) * 100
      : null;
  const positive = change == null ? null : change >= 0;
  const stroke = positive == null ? "#6f7174" : positive ? "#119b62" : "#d93232";
  const fillId = `chartFill-${positive ? "up" : "down"}`;

  return (
    <div className="space-y-3">
      <div
        className={`flex ${
          showHeading
            ? // Centred, not baseline-aligned. The heading carries a logo badge
              // now, and a flex row starting with an image has no text baseline
              // to share, so the browser synthesises one from the badge's bottom
              // edge and drops the range switch a row below the price.
              "items-center justify-between"
            : "items-baseline justify-end"
        }`}
      >
        {showHeading && (
          // Logo beside the name, same pairing and sizing the asset rows use, so
          // the chart heading reads as the same asset the list above named.
          <div className="flex items-center gap-2.5">
            {showLogo && <AssetLogo xstock={ticker} size={32} />}
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
                {ticker.name} price
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-mono text-2xl font-light tracking-tight text-white tabular-nums">
                  {last != null ? `$${formatPrice(last)}` : "—"}
                </span>
                {change != null && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      positive ? "text-aeras-positive" : "text-aeras-negative"
                    }`}
                  >
                    {positive ? "+" : ""}
                    {change.toFixed(2)}% · {range}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        {/* Plain text rather than a bordered pill group: at four options the
            container and the filled active state read as a control panel above
            the chart instead of a range switch. */}
        <div className="flex gap-3 text-xs font-medium">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`tabular-nums transition-colors ${
                r === range ? "text-white" : "text-white/35 hover:text-white/70"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className={`${heightClass} w-full`}>
        {error ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <span className="text-xs font-medium text-white/60">
              {/rate limit/i.test(error)
                ? "Price history rate-limited"
                : "Price history unavailable"}
            </span>
            <span className="mt-1 text-[11px] text-white/50">
              Live oracle price is still available.
            </span>
            <button
              type="button"
              onClick={() => setReloadTick((n) => n + 1)}
              className="mt-2 text-[11px] font-medium text-white/70 underline-offset-2 hover:text-white hover:underline"
            >
              Retry now
            </button>
          </div>
        ) : loading || !candles || candles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-white/50">
            {loading ? "Loading…" : "No data"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {/* 2px on the right so the last point is not clipped.
                Both axes are hidden, so at right:0 the series ends exactly on
                the SVG boundary and the 1.25px stroke centred there loses its
                outer half — measured at 0.63px. It showed up once the Markets
                chart lost its card padding and started running flush to the
                column edge. 2px contains the overhang and reads as flush; 8px
                left a visible gap. */}
            <AreaChart data={candles} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis
                dataKey="c"
                domain={
                  marker
                    ? [
                        (dataMin: number) =>
                          Math.min(dataMin, marker.price) * 0.995,
                        (dataMax: number) =>
                          Math.max(dataMax, marker.price) * 1.005,
                      ]
                    : ["dataMin", "dataMax"]
                }
                hide
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="c"
                stroke={stroke}
                strokeWidth={1.25}
                fill={`url(#${fillId})`}
                isAnimationActive={false}
              />
              {marker && (
                <ReferenceLine
                  y={marker.price}
                  stroke="#c47b00"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  label={{
                    value: `${marker.label} $${formatPrice(marker.price)}`,
                    position: "insideBottomLeft",
                    fill: "#e0a53d",
                    fontSize: 10,
                    offset: 6,
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: OhlcCandle }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const c = payload[0].payload;
  return (
    // Opaque rather than a translucent glass fill: this floats over the plot
    // area, so a see-through panel would let the chart line read through the
    // price it is labelling.
    <div className="rounded-md border border-white/10 bg-aeras-hero-from px-2 py-1.5 text-xs shadow-sm">
      <div className="font-mono tabular-nums text-white">
        ${formatPrice(c.c)}
      </div>
      <div className="text-white/50">
        {new Date(c.t * 1000).toLocaleString()}
      </div>
    </div>
  );
}

function formatPrice(price: number): string {
  return price >= 1 ? price.toFixed(2) : price.toFixed(4);
}
