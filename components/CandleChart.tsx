"use client";

// The candlestick chart both perps venues draw.
//
// Extracted from components/LighterChart.tsx rather than copied, so the two
// venues cannot drift apart: a candle body, a volume bar or a tooltip changed
// here changes on both. Each venue keeps its own data layer and feeds this the
// same bar shape.
//
// Drawn as candlesticks rather than the area line the rest of Aeras uses,
// because these are the surfaces showing a venue's own order-book history and
// the open-to-close body is the thing a trader reads first. Recharts has no
// candlestick series, so the body and wick are a custom shape over a range bar:
// the bar is given [low, high] as its value, which makes recharts scale and
// position it across the full wick, and the shape interpolates within that box
// to find where open and close sit. Doing it this way means the y-axis is still
// recharts', so the volume series underneath shares the same x positions for
// free.

import { useMemo } from "react";

import {
  Bar,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatUsdPrice } from "@/lib/format";

const UP = "#119b62";
const DOWN = "#d93232";

// How much of the plot the volume histogram is allowed to occupy. The volume
// axis is scaled to this fraction so the bars sit under the price action
// instead of competing with it.
const VOLUME_SHARE = 0.22;

// One bar, in the vocabulary this chart draws. Both venues' candle types are
// structurally assignable to it, so neither needs a mapping step.
export interface ChartCandle {
  // Unix MILLISECONDS. Ondo's upstream sends seconds and converts at its route;
  // getting this wrong draws a chart in 1970.
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  // False when no trade printed in the bar. A venue may still emit a flat bar so
  // the series has no gaps, which is why volume rather than price tells them
  // apart, and why the volume bar is omitted rather than drawn at zero height.
  traded: boolean;
}

export interface ChartMarker {
  price: number;
  label: string;
}

// Percentage move across the series, close to close. Null rather than zero when
// there is nothing to measure, so the header omits the figure instead of
// asserting a flat market.
export function seriesChange(candles: readonly ChartCandle[]): number | null {
  if (candles.length < 2) return null;
  const first = candles[0].o;
  const last = candles[candles.length - 1].c;
  if (!first) return null;
  return ((last - first) / first) * 100;
}

export function CandleChart<R extends string>({
  symbol,
  subtitle,
  price,
  candles,
  ranges,
  range,
  onRangeChange,
  marker,
  fill,
  venueLabel,
  resolutionLabel,
  notice,
}: {
  symbol: string;
  // Optional second identity line, in the left group so the range strip keeps
  // the right. Ondo names its markets by ticker and by company; Lighter's symbol
  // is the whole name, so it passes nothing.
  subtitle?: string;
  // The venue's live mark. Shown while the first candle response is still in
  // flight so the header is never empty, and it is the fresher of the two.
  price?: number | null;
  candles: readonly ChartCandle[];
  // Omit to hide the range strip entirely.
  ranges?: readonly R[];
  range?: R;
  onRangeChange?: (range: R) => void;
  marker?: ChartMarker;
  // Take the height of whatever contains this rather than a fixed 224px. The
  // perps terminals size their own chart column, so the plot has to stretch into
  // it; the hedge tab passes nothing and gets the fixed height.
  fill?: boolean;
  // Footer. Absent means no footer strip.
  venueLabel?: string;
  resolutionLabel?: string;
  // Rendered in place of the plot: loading, error, or no market.
  notice?: string | null;
}) {
  const change = seriesChange(candles);
  const positive = change == null ? null : change >= 0;
  const last = candles[candles.length - 1]?.c ?? price ?? null;

  const priceDomain = useMemo<[number, number]>(() => {
    if (candles.length === 0) return [0, 1];
    let low = Infinity;
    let high = -Infinity;
    for (const candle of candles) {
      if (candle.l < low) low = candle.l;
      if (candle.h > high) high = candle.h;
    }
    if (marker) {
      low = Math.min(low, marker.price);
      high = Math.max(high, marker.price);
    }
    // Headroom below the price band for the volume histogram, plus a little
    // above so the top wick is not clipped by the plot edge.
    const span = high - low || high * 0.01 || 1;
    return [low - span * (VOLUME_SHARE + 0.05), high + span * 0.05];
  }, [candles, marker]);

  const volumeMax = useMemo(() => {
    let max = 0;
    for (const candle of candles) if (candle.v > max) max = candle.v;
    return max || 1;
  }, [candles]);

  return (
    <div
      className={`rounded-xl border border-white/[0.07] bg-[#111415] ${
        fill ? "flex h-full flex-col" : ""
      }`}
    >
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-3 px-4 pt-3.5">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-medium text-white/90">{symbol}</span>
          <span className="font-mono text-xl font-light tabular-nums text-white">
            {last != null ? formatPrice(last) : "—"}
          </span>
          {change != null && (
            <span
              className={`font-mono text-xs tabular-nums ${
                positive ? "text-[#119b62]" : "text-[#d93232]"
              }`}
            >
              {positive ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          )}
          {subtitle && (
            <span className="text-[11px] text-white/35">{subtitle}</span>
          )}
        </div>
        {ranges && ranges.length > 0 && (
          <div className="flex gap-0.5 rounded-lg border border-white/[0.07] p-0.5">
            {ranges.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRangeChange?.(r)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
                  r === range
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className={`w-full px-1 pb-2 pt-2 ${fill ? "min-h-0 flex-1" : "h-56"}`}
      >
        {notice != null ? (
          <Empty>{notice}</Empty>
        ) : candles.length === 0 ? (
          <Empty>Loading price history</Empty>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={candles as ChartCandle[]}
              margin={{ top: 4, right: 52, bottom: 0, left: 0 }}
            >
              <XAxis dataKey="t" hide />
              <YAxis yAxisId="price" domain={priceDomain} hide />
              <YAxis
                yAxisId="volume"
                domain={[0, volumeMax / VOLUME_SHARE]}
                hide
              />
              <Tooltip
                content={<CandleTooltip />}
                cursor={{ stroke: "rgba(255,255,255,0.14)", strokeWidth: 1 }}
              />
              <Bar
                yAxisId="volume"
                dataKey="v"
                shape={<VolumeBar />}
                isAnimationActive={false}
              />
              <Bar
                yAxisId="price"
                dataKey={candleRange}
                shape={<Candle />}
                isAnimationActive={false}
              />
              {marker && (
                <ReferenceLine
                  yAxisId="price"
                  y={marker.price}
                  stroke="#c47b00"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  label={{
                    value: `${marker.label} ${formatPrice(marker.price)}`,
                    position: "insideTopRight",
                    fill: "#e0a53d",
                    fontSize: 10,
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {venueLabel && candles.length > 0 && (
        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.05] px-4 py-1.5 text-[10px] uppercase tracking-[0.12em] text-white/30">
          <span>
            {candles.length} bars
            {resolutionLabel ? ` · ${resolutionLabel}` : ""}
          </span>
          <span>{venueLabel}</span>
        </div>
      )}
    </div>
  );
}

// Giving the bar a [low, high] pair is what makes recharts lay it out across the
// whole wick, which the shape then subdivides.
function candleRange(candle: ChartCandle): [number, number] {
  return [candle.l, candle.h];
}

interface ShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: ChartCandle;
}

function Candle({ x, y, width, height, payload }: ShapeProps) {
  if (
    x == null ||
    y == null ||
    width == null ||
    height == null ||
    payload == null
  ) {
    return null;
  }

  const { o, c, h, l } = payload;
  const rising = c >= o;
  const colour = rising ? UP : DOWN;

  // The box spans low to high. Anything between them can be placed by
  // interpolation, which is why no external scale function is needed here.
  const span = h - l;
  const priceToY = (price: number) =>
    span === 0 ? y : y + ((h - price) / span) * height;

  const bodyTop = priceToY(Math.max(o, c));
  const bodyBottom = priceToY(Math.min(o, c));
  const bodyWidth = Math.max(1, width * 0.62);
  const centre = x + width / 2;

  return (
    <g>
      <line
        x1={centre}
        x2={centre}
        y1={y}
        y2={y + height}
        stroke={colour}
        strokeWidth={1}
      />
      <rect
        x={centre - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        // A doji would otherwise be invisible, so it is drawn as a one-pixel bar.
        height={Math.max(1, bodyBottom - bodyTop)}
        fill={colour}
      />
    </g>
  );
}

function VolumeBar({ x, y, width, height, payload }: ShapeProps) {
  if (x == null || y == null || width == null || height == null || payload == null) {
    return null;
  }
  if (!payload.traded) return null;

  const colour = payload.c >= payload.o ? UP : DOWN;
  const barWidth = Math.max(1, width * 0.62);
  return (
    <rect
      x={x + width / 2 - barWidth / 2}
      y={y}
      width={barWidth}
      height={Math.max(0, height)}
      fill={colour}
      opacity={0.22}
    />
  );
}

function CandleTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartCandle }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const c = payload[payload.length - 1].payload;
  const rising = c.c >= c.o;

  return (
    <div className="rounded-md border border-white/10 bg-[#0a0c0d]/95 px-2.5 py-2 text-[11px] shadow-lg">
      <div className="mb-1 text-white/40">{new Date(c.t).toLocaleString()}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums">
        <Field label="O" value={formatPrice(c.o)} />
        <Field label="H" value={formatPrice(c.h)} />
        <Field label="L" value={formatPrice(c.l)} />
        <Field
          label="C"
          value={formatPrice(c.c)}
          className={rising ? "text-[#119b62]" : "text-[#d93232]"}
        />
      </div>
      <div className="mt-1 font-mono text-[10px] tabular-nums text-white/40">
        {c.traded ? `Vol ${formatVolume(c.v)}` : "No trades"}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  className = "text-white/80",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex gap-1.5">
      <span className="text-white/35">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-white/35">
      {children}
    </div>
  );
}

function formatPrice(price: number): string {
  // Five places under a dollar: perp ticks are finer than spot.
  return formatUsdPrice(price, 5);
}

function formatVolume(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(2);
}
