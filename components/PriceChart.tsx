"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchChartViaProxy, type OhlcCandle } from "@/lib/jupiter/charts";
import type { XStock } from "@/lib/jupiter/xstocks";

const RANGES = ["1D", "1W", "1M", "3M"] as const;
type Range = (typeof RANGES)[number];

export function PriceChart({ ticker }: { ticker: XStock }) {
  const [range, setRange] = useState<Range>("1D");
  const [candles, setCandles] = useState<OhlcCandle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchChartViaProxy(ticker.mint, range)
      .then((data) => {
        if (!cancelled) {
          setCandles(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ticker.mint, range]);

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
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
            {ticker.symbol} price
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-2xl font-light tracking-tight text-aeras-900 tabular-nums">
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
        <div className="flex gap-0.5 rounded-lg border border-aeras-border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                r === range
                  ? "bg-aeras-900 text-white"
                  : "text-aeras-300 hover:text-aeras-900"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="h-32 w-full">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <span className="text-xs font-medium text-aeras-500">
              {/rate limit/i.test(error)
                ? "Price history rate-limited"
                : "Price history unavailable"}
            </span>
            <span className="mt-1 text-[11px] text-aeras-300">
              Live oracle price is still available.
            </span>
          </div>
        ) : loading || !candles || candles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-aeras-300">
            {loading ? "Loading…" : "No data"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={candles} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis dataKey="c" domain={["dataMin", "dataMax"]} hide />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="c"
                stroke={stroke}
                strokeWidth={1.25}
                fill={`url(#${fillId})`}
                isAnimationActive={false}
              />
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
    <div className="rounded-md border border-aeras-border bg-white px-2 py-1.5 text-xs shadow-sm">
      <div className="font-mono tabular-nums text-aeras-900">
        ${formatPrice(c.c)}
      </div>
      <div className="text-aeras-300">
        {new Date(c.t * 1000).toLocaleString()}
      </div>
    </div>
  );
}

function formatPrice(price: number): string {
  return price >= 1 ? price.toFixed(2) : price.toFixed(4);
}
