"use client";

// TradingView's advanced chart, embedded. This is the candle chart with the
// indicator and drawing toolbars; it draws the underlying on its home
// exchange from TradingView's own data, not the xStock on Solana, which is
// why the line chart beside it stays ours and the caption says which is
// which.
//
// The embed is TradingView's script tag with its configuration as the tag's
// text, which the script reads and replaces with an iframe. That is a DOM
// side effect, so it lives in an effect, and it is torn down on symbol change
// by emptying the container, because the script has no API for re-pointing
// the iframe. next.config.ts lists the two TradingView origins the embed
// needs under script-src and frame-src.
//
// The script rewrites its container's inline style to height 100%, whatever
// was there. Setting the height on that element therefore does nothing: it
// collapsed to 150px the first time. The height lives on a wrapper the
// script never touches, and the container fills it.

import { useEffect, useRef } from "react";

const EMBED_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

export function TradingViewChart({
  symbol,
  height = 520,
}: {
  // TradingView's "EXCHANGE:TICKER".
  symbol: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    el.appendChild(widget);

    const script = document.createElement("script");
    script.src = EMBED_SRC;
    script.async = true;
    script.type = "text/javascript";
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(8, 9, 10, 1)",
      gridColor: "rgba(255, 255, 255, 0.06)",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      withdateranges: true,
      details: false,
      hotlist: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);

    return () => {
      el.replaceChildren();
    };
  }, [symbol]);

  return (
    <div
      className="overflow-hidden rounded-xl border border-white/[0.07]"
      style={{ height, width: "100%" }}
    >
      <div
        ref={ref}
        className="tradingview-widget-container"
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
