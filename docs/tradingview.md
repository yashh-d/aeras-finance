# TradingView Charting Library

The perps tab charts each venue's own data on TradingView's Charting Library
(Advanced Charts). This is the chart Lighter and Ondo run on their own screens,
and the one Ondo's history endpoint is formatted for. The library is licensed
by TradingView and is not on npm, so a checkout does not carry it and the
chart falls back to TradingView's open-source Lightweight Charts, under a
notice, until it is installed.

## Installing the library

1. Apply for access at https://www.tradingview.com/advanced-charts/. The
   licence is free for a product that shows the chart to its own users; the
   form asks for the product URL (`https://aeras.finance`).
2. TradingView grants access to the private GitHub repository
   `tradingview/charting_library`. Clone it, or download a release.
3. Copy the repository's `charting_library/` folder to
   `public/charting_library/` in this repo, so that
   `public/charting_library/charting_library.standalone.js` exists. The
   `datafeeds/` folder is not needed: both datafeeds here are JavaScript
   objects, not UDF endpoints.
4. Commit it. The repository is private and the licence permits the licensee
   to serve the files from its own product, and Vercel builds from the
   repository, so a gitignored copy would never reach production.

`lib/charts/tradingview.ts` loads `charting_library.standalone.js` from
`/charting_library/` and declares the parts of the widget and datafeed API the
app touches. Upgrade the library by replacing the folder; check the
[breaking changes](https://www.tradingview.com/charting-library-docs/latest/releases/)
against those declarations.

## The datafeeds

Each venue has a datafeed object implementing `onReady`, `resolveSymbol`,
`getBars`, `subscribeBars` and `unsubscribeBars`.

| | Lighter (`lib/lighter/tv-datafeed.ts`) | Ondo (`lib/ondo/tv-datafeed.ts`) |
|---|---|---|
| History | `/api/lighter/history`, an explicit window at a Lighter resolution over `/candles` or `/markPriceCandles` | `/api/ondo/history` with `from`/`to`, a pass-through of Ondo's UDF endpoint |
| Live bar | Polls the last three bars every ten seconds | Ondo's mark price WebSocket, through `lib/ondo/mark-socket.ts` |
| Resolutions | 1, 5, 15, 30, 60, 240, 720, 1D | 1, 5, 15, 30, 60, 240, 1D |
| Symbols | `SPY` for trades, `SPY:MARK` for the mark price | the base ticker |

The library keys a bar by its start time in milliseconds and rejects a tick
whose time runs backwards. `tvBarStart` in `lib/charts/tradingview.ts` is the
one place that arithmetic lives.

## What is not verified

The Ondo WebSocket frame reader (`lib/ondo/mark-stream.ts`) was written from
the integration guide's description, not from a captured frame. It walks each
message for the market and takes the first mark-price field on it. Capture a
frame and pin the shape and its test. The socket connects from the browser,
so Ondo's CORS allowlist applies to it.
