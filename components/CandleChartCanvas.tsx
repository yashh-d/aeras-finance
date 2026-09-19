"use client";

// The TradingView chart both perps venues draw into.
//
// Lightweight Charts is the library TradingView publishes under Apache 2.0,
// not the licensed Advanced Charts that Lighter's own site embeds. It draws
// candles, volume, a crosshair and the scales, and it has no indicator or
// drawing toolbar; adding those means a TradingView library licence and a
// datafeed adapter over the same candle endpoints. The attribution logo the
// library draws by default is left on, which is what its licence asks.
//
// This holds the chart and nothing else: no fetch, no header, no range
// control. Each venue owns its feed (Lighter and Ondo serve different
// endpoints, resolutions and units) and hands finished bars in, the same split
// PerpsTerminal makes between chrome and content. The chart object is created
// once and fed by effects rather than rebuilt per render: it owns a canvas and
// a ResizeObserver, and remaking it on every poll would flicker. `autoSize`
// fills whatever contains it, so the terminal sizes the column and the chart
// follows.

import { useEffect, useRef } from "react";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";

import { applyTick, type ChartBar } from "@/lib/charts/bars";

const UP = "#119b62";
const DOWN = "#d93232";
const UP_VOLUME = "rgba(17, 155, 98, 0.35)";
const DOWN_VOLUME = "rgba(217, 50, 50, 0.35)";
const BACKGROUND = "#111415";

interface Handles {
  chart: IChartApi;
  price: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
}

export function CandleChartCanvas({
  bars,
  priceDecimals,
  fitKey,
  tick,
}: {
  bars: ChartBar[];
  // The market's own tick precision, so the price scale does not round a
  // sub-cent market to two places or pad a stock to five.
  priceDecimals: number;
  // Identity of the series on screen. The view is fitted to the data when
  // this changes and left alone otherwise, so a poll that refreshes the same
  // series keeps the user's zoom while a new market or range refits.
  fitKey: string | null;
  // A live price to fold into the last bar, from a venue's stream. Applied
  // with series.update rather than a full setData, which is the primitive
  // the library has for exactly this.
  tick?: number | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handles = useRef<Handles | null>(null);
  const fitted = useRef<string | null>(null);
  // The bar the stream is building on. Reset whenever a fresh series lands,
  // so a tick extends the newest bar and not one a poll has since replaced.
  const live = useRef<ChartBar | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: BACKGROUND },
        textColor: "rgba(255, 255, 255, 0.4)",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "rgba(255, 255, 255, 0.2)", labelBackgroundColor: "#2a2f31" },
        horzLine: { color: "rgba(255, 255, 255, 0.2)", labelBackgroundColor: "#2a2f31" },
      },
    });

    const price = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
    });

    // Volume on its own scale, squeezed into the bottom fifth so the bars sit
    // under the price action instead of competing with it.
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    handles.current = { chart, price, volume };
    return () => {
      chart.remove();
      handles.current = null;
      fitted.current = null;
      live.current = null;
    };
  }, []);

  useEffect(() => {
    const precision = Math.max(0, Math.min(8, priceDecimals));
    handles.current?.price.applyOptions({
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });
  }, [priceDecimals]);

  useEffect(() => {
    const h = handles.current;
    if (!h) return;

    h.price.setData(
      bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    );
    h.volume.setData(
      bars.map(({ time, open, close, volume }) => ({
        time,
        value: volume,
        color: close >= open ? UP_VOLUME : DOWN_VOLUME,
      })),
    );
    live.current = bars[bars.length - 1] ?? null;

    if (fitKey && fitted.current !== fitKey) {
      h.chart.timeScale().fitContent();
      fitted.current = fitKey;
    }
  }, [bars, fitKey]);

  useEffect(() => {
    const h = handles.current;
    const bar = live.current;
    if (!h || !bar || tick == null || !Number.isFinite(tick)) return;
    const next = applyTick(bar, tick);
    live.current = next;
    h.price.update({
      time: next.time,
      open: next.open,
      high: next.high,
      low: next.low,
      close: next.close,
    });
  }, [tick]);

  return <div ref={host} className="h-full w-full" />;
}
