"use client";

// TradingView's Charting Library, hosting a venue's datafeed.
//
// This is the chart both perps venues run on their own screens: the licensed
// Advanced Charts widget with a datafeed behind it, so the candles, the
// indicators, the drawing tools and the interval picker are all TradingView's
// and the data is the venue's. The library is not on npm; its files live at
// public/charting_library/ once obtained from TradingView (docs/tradingview.md),
// and lib/charts/tradingview.ts loads the standalone bundle from there.
//
// The widget is created once per symbol and datafeed and removed on the way
// out. A symbol change tears the widget down and builds a new one rather
// than calling setSymbol, because the datafeed is per market too and the
// pair change together.
//
// Until the library files are in place the loader rejects, and the chart
// renders `fallback` under a notice saying so, rather than a blank panel. The
// fallback is the venue's own bars on TradingView's open-source Lightweight
// Charts, so the tab still charts the venue while the licence is pending.

import { useEffect, useRef, useState } from "react";

import {
  CHARTING_LIBRARY_PATH,
  loadChartingLibrary,
  type TvDatafeed,
  type TvResolution,
  type TvWidget,
} from "@/lib/charts/tradingview";

const BACKGROUND = "#111415";
const UP = "#119b62";
const DOWN = "#d93232";

type LibraryState = "loading" | "ready" | "missing";

export function TradingViewChart({
  datafeed,
  symbol,
  interval = "15",
  fallback,
  footer,
}: {
  datafeed: TvDatafeed;
  symbol: string;
  interval?: TvResolution;
  // Rendered while the library files are absent, under a notice.
  fallback: React.ReactNode;
  // Footer text on the left; the right side names TradingView.
  footer: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [library, setLibrary] = useState<LibraryState>("loading");

  useEffect(() => {
    let cancelled = false;
    loadChartingLibrary()
      .then(() => {
        if (!cancelled) setLibrary("ready");
      })
      .catch(() => {
        if (!cancelled) setLibrary("missing");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const container = host.current;
    const TradingView = typeof window === "undefined" ? undefined : window.TradingView;
    if (library !== "ready" || !container || !TradingView) return;

    let widget: TvWidget | null = new TradingView.widget({
      container,
      library_path: CHARTING_LIBRARY_PATH,
      datafeed,
      symbol,
      interval,
      locale: "en",
      theme: "dark",
      autosize: true,
      timezone: "Etc/UTC",
      disabled_features: [
        // One market per chart; the venue's picker chooses it.
        "header_symbol_search",
        "symbol_search_hot_key",
        "header_compare",
        "header_saveload",
        "use_localstorage_for_settings",
        "popup_hints",
      ],
      enabled_features: ["hide_left_toolbar_by_default"],
      overrides: {
        "paneProperties.background": BACKGROUND,
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": "rgba(255, 255, 255, 0.04)",
        "paneProperties.horzGridProperties.color": "rgba(255, 255, 255, 0.04)",
        "scalesProperties.textColor": "rgba(255, 255, 255, 0.5)",
        "mainSeriesProperties.candleStyle.upColor": UP,
        "mainSeriesProperties.candleStyle.downColor": DOWN,
        "mainSeriesProperties.candleStyle.borderUpColor": UP,
        "mainSeriesProperties.candleStyle.borderDownColor": DOWN,
        "mainSeriesProperties.candleStyle.wickUpColor": UP,
        "mainSeriesProperties.candleStyle.wickDownColor": DOWN,
      },
      loading_screen: { backgroundColor: BACKGROUND, foregroundColor: "rgba(255, 255, 255, 0.3)" },
    });

    return () => {
      try {
        widget?.remove();
      } catch {
        // The library throws if the iframe is already gone, which it is when
        // the panel unmounts before the widget finished loading.
      }
      widget = null;
    };
  }, [library, datafeed, symbol, interval]);

  if (library === "missing") {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="shrink-0 rounded-lg border border-[#c47b00]/40 bg-[#c47b00]/10 px-3 py-2 text-[11px] text-[#e0a53d]">
          TradingView Charting Library not found under {CHARTING_LIBRARY_PATH}. The chart below
          is the venue&apos;s data on TradingView&apos;s open-source renderer until the library is
          installed. See docs/tradingview.md.
        </div>
        <div className="min-h-0 flex-1">{fallback}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#111415]">
      <div ref={host} className="min-h-0 w-full flex-1" />
      <div className="flex shrink-0 items-center justify-between border-t border-white/[0.05] px-4 py-1.5 text-[10px] uppercase tracking-[0.12em] text-white/30">
        <span>{footer}</span>
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white/60"
        >
          Charts by TradingView
        </a>
      </div>
    </div>
  );
}
