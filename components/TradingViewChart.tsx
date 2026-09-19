"use client";

// A TradingView advanced chart, filling whatever contains it.
//
// The perps tab draws this instead of the venue's own candles. Lighter serves
// candles at five resolutions and Ondo at one, and neither serves the drawing
// tools, indicators or the years of history a trader expects from a chart
// they sit on, so each venue got a different hand-rolled plot and both were
// thinner than the chart in the next tab over. TradingView's free widget
// carries all of it, so the venues share one chart and differ only in which
// symbol they resolve to (lib/tokens/tradingview-symbol.ts).
//
// It is the underlying that is charted, not the perp. Funding and basis put
// the venue's mark off spot, and the header rail above the chart states the
// mark; the footer here names the TradingView symbol so the two are never
// confused for one series.
//
// The widget is TradingView's embed script, which reads its configuration from
// its own text content and renders an iframe into the sibling it finds. It
// has no update path, so a change of symbol tears the container down and
// mounts a fresh one; the effect does exactly that and nothing else. The
// script is loaded from TradingView's own host, which is the only way the
// free widget is offered.

import { useEffect, useRef } from "react";

const EMBED_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

const FRAME =
  "flex h-full flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#111415]";

export function TradingViewChart({
  symbol,
  interval = "15",
}: {
  // A TradingView symbol ("NASDAQ:TSLA"), or null when the market has no
  // public underlying to chart.
  symbol: string | null;
  // TradingView's resolution strings: minutes as a number, then "D", "W".
  interval?: string;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container || symbol == null) return;

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src = EMBED_SRC;
    script.type = "text/javascript";
    script.async = true;
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "#111415",
      gridColor: "rgba(255, 255, 255, 0.04)",
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      withdateranges: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);

    return () => {
      container.replaceChildren();
    };
  }, [symbol, interval]);

  if (symbol == null) {
    return (
      <div className={FRAME}>
        <div className="flex flex-1 items-center justify-center text-xs text-white/35">
          No public price series for this market.
        </div>
      </div>
    );
  }

  return (
    <div className={FRAME}>
      <div
        ref={host}
        className="tradingview-widget-container min-h-0 w-full flex-1"
      />
      <div className="flex shrink-0 items-center justify-between border-t border-white/[0.05] px-4 py-1.5 text-[10px] uppercase tracking-[0.12em] text-white/30">
        <span className="font-mono normal-case tracking-normal">{symbol}</span>
        {/* TradingView's terms ask that the free widget stay attributed. */}
        <a
          href={`https://www.tradingview.com/symbols/${encodeURIComponent(symbol.replace(":", "-"))}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white/60"
        >
          Chart by TradingView
        </a>
      </div>
    </div>
  );
}
