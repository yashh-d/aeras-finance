"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AssetLogo } from "@/components/AssetLogo";
import { chartKeyOf, type ChartSubject } from "@/lib/jupiter/chart-assets";
import {
  CHART_RANGES,
  fetchChartViaProxy,
  type ChartRange,
  type OhlcCandle,
} from "@/lib/jupiter/charts";
import type { XStock } from "@/lib/jupiter/xstocks";
import { formatUsdPrice } from "@/lib/format";

// Two shapes of the same chart. Compact is the dashboard card: four ranges in
// the header, no axes, the plot flush to the card. Detailed is the Home chart
// column: axes and a hairline grid, and all eight ranges on their own row
// between the header and the plot, spread across the width, because eight
// labels beside a price do not fit in a two-fifths column.
export type PriceChartVariant = "compact" | "detailed";

const COMPACT_RANGES: readonly ChartRange[] = ["1D", "1W", "1M", "3M"];
const DETAILED_RANGES: readonly ChartRange[] = CHART_RANGES;

// Module-scoped cache of the last good candles per (key, range). Survives
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

// The Coingecko-backed chart. Fetches its own series; the drawing is
// PriceSeriesView below, which the Home charts also feed from Lighter candles
// so a perp and a stock read as the same kind of chart.
export function PriceChart({
  ticker,
  marker,
  heightClass,
  showHeading,
  showLogo,
  title,
  actions,
  variant,
  showRanges,
}: {
  // A catalog asset or a chart-only one. See lib/jupiter/chart-assets.ts.
  ticker: ChartSubject;
  marker?: PriceChartMarker;
  heightClass?: string;
  showHeading?: boolean;
  showLogo?: boolean;
  title?: ReactNode;
  actions?: ReactNode;
  variant?: PriceChartVariant;
  showRanges?: boolean;
}) {
  const [range, setRange] = useState<ChartRange>("1D");
  const series = useCoingeckoSeries(chartKeyOf(ticker), range);

  return (
    <PriceSeriesView
      identity={ticker}
      candles={series.candles}
      loading={series.loading}
      error={series.error}
      onRetry={series.retry}
      range={range}
      onRange={setRange}
      marker={marker}
      heightClass={heightClass}
      showHeading={showHeading}
      showLogo={showLogo}
      title={title}
      actions={actions}
      variant={variant}
      showRanges={showRanges}
    />
  );
}

function useCoingeckoSeries(
  key: string,
  range: ChartRange,
): {
  candles: OhlcCandle[] | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [candles, setCandles] = useState<OhlcCandle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped to force a refetch (auto-retry / manual retry) without changing the
  // key or range.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${key}:${range}`;
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

    fetchChartViaProxy(key, range)
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
  }, [key, range, reloadTick]);

  // Self-heal: while a chart is stuck with nothing to show, keep retrying so it
  // recovers on its own once Coingecko's rate limit clears.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setReloadTick((n) => n + 1), AUTO_RETRY_MS);
    return () => clearTimeout(id);
  }, [error]);

  return {
    candles,
    loading,
    error,
    retry: () => setReloadTick((n) => n + 1),
  };
}

export type PriceSeriesIdentity = Pick<XStock, "symbol" | "name" | "logo">;

// The drawing, given a series. Owns nothing about where the candles came from.
export function PriceSeriesView({
  identity,
  candles,
  loading,
  error,
  onRetry,
  range,
  onRange,
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
  // Replaces the "<name> price" label above the price. The Home charts put
  // their asset picker here, so the control that chooses the series sits
  // exactly where the series is named.
  title,
  // Rendered at the right edge of the header. The Home charts put a remove
  // control here, at the edge rather than over the plot.
  actions,
  variant = "compact",
  // Drop the range switch and hold the chart at its current range. Set by a
  // chart that sits next to a bigger one of the same asset, where a second
  // set of range buttons is a control nobody needs twice.
  showRanges = true,
}: {
  identity: PriceSeriesIdentity;
  candles: OhlcCandle[] | null;
  loading: boolean;
  error: string | null;
  // Absent when the source has no manual retry, in which case the error state
  // shows no button.
  onRetry?: () => void;
  range: ChartRange;
  onRange: (range: ChartRange) => void;
  marker?: PriceChartMarker;
  heightClass?: string;
  showHeading?: boolean;
  showLogo?: boolean;
  title?: ReactNode;
  actions?: ReactNode;
  variant?: PriceChartVariant;
  showRanges?: boolean;
}) {
  const detailed = variant === "detailed";
  const ranges = detailed ? DETAILED_RANGES : COMPACT_RANGES;

  const first = candles?.[0]?.c;
  const last = candles?.[candles.length - 1]?.c;
  const change =
    first != null && last != null && first !== 0
      ? ((last - first) / first) * 100
      : null;
  const positive = change == null ? null : change >= 0;
  const stroke = positive == null ? "#6f7174" : positive ? "#119b62" : "#d93232";
  const fillId = `chartFill-${positive ? "up" : "down"}`;
  const formatX = candles ? xTickFormatter(candles) : undefined;

  const rangeSwitch = (
    <div
      className={
        detailed
          ? "flex items-center justify-between text-[11px] font-medium"
          : "flex items-center gap-3 text-xs font-medium"
      }
    >
      {showRanges && ranges.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onRange(r)}
          className={`tabular-nums transition-colors ${
            r === range ? "text-white" : "text-white/35 hover:text-white/70"
          }`}
        >
          {r}
        </button>
      ))}
      {!detailed && actions}
    </div>
  );

  // In the detailed variant the range switch has its own row, so the header
  // row holds only the heading and the actions. With neither it is an empty
  // element that still takes a gap from space-y-3, which is what a headingless
  // detailed chart (Home's asset view) would otherwise open with.
  const showHeaderRow =
    showHeading || (detailed ? actions != null : showRanges || actions != null);

  return (
    <div className="space-y-3">
      {showHeaderRow && (
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
            {showLogo && <AssetLogo xstock={identity} size={32} />}
            <div>
              {title ?? (
                <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
                  {identity.name} price
                </div>
              )}
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-mono text-2xl font-light tracking-tight text-white tabular-nums">
                  {last != null ? `$${formatPrice(last)}` : "—"}
                </span>
                {change != null && candles && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      positive ? "text-aeras-positive" : "text-aeras-negative"
                    }`}
                  >
                    {positive ? "+" : ""}
                    {change.toFixed(2)}% · {windowLabel(range, candles)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        {/* Plain text rather than a bordered pill group: at four options the
            container and the filled active state read as a control panel above
            the chart instead of a range switch. In the detailed variant the
            switch has its own row below this one and only the actions stay
            up here. */}
        {detailed ? (
          actions && (
            <div className="flex items-center text-xs font-medium">{actions}</div>
          )
        ) : (
          rangeSwitch
        )}
      </div>
      )}

      {/* Eight ranges spread across the width, above the plot they change. */}
      {detailed && showRanges && rangeSwitch}

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
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 text-[11px] font-medium text-white/70 underline-offset-2 hover:text-white hover:underline"
              >
                Retry now
              </button>
            )}
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
                left a visible gap. The detailed variant has a visible axis on
                the right, whose own width holds the line clear of the edge. */}
            <AreaChart
              data={candles}
              margin={{ top: 4, right: detailed ? 0 : 2, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              {detailed && (
                // Horizontal hairlines only. Vertical ones cut a line chart
                // into columns and add nothing the x-axis labels do not say.
                <CartesianGrid
                  vertical={false}
                  stroke="rgba(255,255,255,0.06)"
                />
              )}
              {/* The axis band has to hold the label's full line box, not just
                  its cap height: 10px type sits about 12px tall plus the tick
                  margin, and an 18px band clipped every label at the waist. */}
              <XAxis
                dataKey="t"
                hide={!detailed}
                tickFormatter={formatX}
                interval="preserveStartEnd"
                minTickGap={48}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                height={X_AXIS_HEIGHT}
                tick={AXIS_TICK}
              />
              <YAxis
                dataKey="c"
                orientation="right"
                hide={!detailed}
                // Fitted to the data, not rounded out to tidy tick values. An
                // "auto" domain drew a Tesla day that moved between $355 and
                // $368 on a $350 to $371 scale, which flattened the line to a
                // third of the plot. With the domain fixed, recharts picks its
                // ticks inside it instead of widening it to reach them, and
                // the slight padding keeps the extremes off the plot edges.
                domain={
                  marker
                    ? [
                        (dataMin: number) =>
                          Math.min(dataMin, marker.price) * 0.995,
                        (dataMax: number) =>
                          Math.max(dataMax, marker.price) * 1.005,
                      ]
                    : detailed
                      ? [
                          (dataMin: number) => dataMin * 0.998,
                          (dataMax: number) => dataMax * 1.002,
                        ]
                      : ["dataMin", "dataMax"]
                }
                tickFormatter={formatAxisPrice}
                tickCount={4}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                width={detailed ? Y_AXIS_WIDTH : 0}
                tick={AXIS_TICK}
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

// Axis labels: the same muted weight as every other caption on the card.
const AXIS_TICK = { fill: "rgba(255,255,255,0.35)", fontSize: 10 };
// Tick margin plus a full line of 10px type, with a little to spare.
const X_AXIS_HEIGHT = 26;
// Room for the widest label the formatter produces, a six-figure price with
// its comma ("100,000"), plus the tick margin. Was 56 with a dollar sign on
// every tick, which took a seventh of a two-fifths column away from the line.
const Y_AXIS_WIDTH = 50;

// How far back a range asks for, in seconds. Null for MAX, which asks for
// everything there is.
function rangeSpanSeconds(range: ChartRange, nowMs: number): number | null {
  const day = 86_400;
  switch (range) {
    case "1D":
      return day;
    case "1W":
      return 7 * day;
    case "1M":
      return 30 * day;
    case "3M":
      return 90 * day;
    case "6M":
      return 180 * day;
    case "YTD": {
      const jan1 = Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 1) / 1000;
      return Math.max(day, nowMs / 1000 - jan1);
    }
    case "1Y":
      return 365 * day;
    case "5Y":
      return 1825 * day;
    case "MAX":
      return null;
  }
}

// What the change figure is measured over. The range, unless the series
// starts materially later than the range asked for: an asset listed last
// summer, a keyless Coingecko tier that stops at a year, a venue serving its
// bar cap. Then it names where the data begins, since "+31% · 5Y" over
// fourteen months would be a lie.
function windowLabel(range: ChartRange, candles: OhlcCandle[]): string {
  const first = candles[0]?.t;
  const last = candles[candles.length - 1]?.t;
  if (first == null || last == null) return range;
  const span = rangeSpanSeconds(range, last * 1000);
  // Two days of slack: daily bars land on day boundaries, not on "now".
  if (span != null && last - first >= span - 2 * 86_400) return range;
  return `since ${new Date(first * 1000).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

// Chosen from the span the data actually covers rather than the range asked
// for, so a truncated series still labels itself at the right grain.
function xTickFormatter(candles: OhlcCandle[]): (t: number) => string {
  const first = candles[0]?.t ?? 0;
  const last = candles[candles.length - 1]?.t ?? 0;
  const spanDays = (last - first) / 86_400;
  if (spanDays <= 2) {
    return (t) =>
      new Date(t * 1000).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
  }
  // Daily bars are stamped at midnight UTC, so a local-time label west of
  // Greenwich puts Jan 1 in December. Dates are read in UTC for that reason;
  // intraday times above stay local, because those are the hours the viewer
  // actually lived through.
  if (spanDays <= 120) {
    return (t) =>
      new Date(t * 1000).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
  }
  if (spanDays <= 800) {
    return (t) =>
      new Date(t * 1000).toLocaleDateString(undefined, {
        month: "short",
        timeZone: "UTC",
      });
  }
  return (t) => String(new Date(t * 1000).getUTCFullYear());
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
  return formatUsdPrice(price);
}

// Axis ticks get fewer places than the headline and no currency sign: they sit
// in a 50px band and four of them have to tell apart, not quote a price, and
// the headline above the plot already says these are dollars.
function formatAxisPrice(price: number): string {
  if (price >= 1000) return Math.round(price).toLocaleString("en-US");
  if (price >= 100) return price.toFixed(1);
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}
