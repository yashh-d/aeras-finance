// TradingView's Charting Library (Advanced Charts): the surface this app uses.
//
// This is the chart Lighter and Ondo run on their own screens, and the one
// Ondo's history endpoint is shaped for ("TradingView UDF format, as required
// by the TradingView charting library"). It is licensed, not on npm: TradingView
// grants access to a private repository and the files are copied into
// public/charting_library/ (docs/tradingview.md). Its TypeScript definitions
// ship with it rather than on npm; they are vendored under ./vendor (version
// 32.2.0) and re-exported here under short names, so the datafeeds and the
// widget host are typed against the real API rather than a hand-written one.

import type {
  ChartingLibraryWidgetConstructor,
  ResolutionString,
} from "./vendor/charting_library";

export type TvResolution = "1" | "5" | "15" | "30" | "60" | "240" | "720" | "1D";

export const TV_RESOLUTION_MS: Record<TvResolution, number> = {
  "1": 60_000,
  "5": 5 * 60_000,
  "15": 15 * 60_000,
  "30": 30 * 60_000,
  "60": 60 * 60_000,
  "240": 4 * 60 * 60_000,
  "720": 12 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

export function isTvResolution(value: string): value is TvResolution {
  return value in TV_RESOLUTION_MS;
}

// The start of the bar that contains `nowMs` at a resolution, in ms UTC.
// The library keys a bar by this and rejects a tick whose time runs backwards,
// so a live price is folded into the bar that starts here.
export function tvBarStart(nowMs: number, resolution: TvResolution): number {
  const ms = TV_RESOLUTION_MS[resolution];
  return Math.floor(nowMs / ms) * ms;
}

// The library's own definitions, version 32.2.0, vendored under ./vendor from
// the files TradingView ships with the library. Nothing here is hand-written.
export type {
  Bar as TvBar,
  ChartingLibraryWidgetOptions as TvWidgetOptions,
  DatafeedConfiguration as TvDatafeedConfiguration,
  HistoryMetadata as TvHistoryMetadata,
  IBasicDataFeed as TvDatafeed,
  IChartingLibraryWidget as TvWidget,
  LibrarySymbolInfo as TvSymbolInfo,
  PeriodParams as TvPeriodParams,
  ResolutionString,
} from "./vendor/charting_library";

declare global {
  interface Window {
    // What charting_library.standalone.js installs.
    TradingView?: { widget: ChartingLibraryWidgetConstructor };
  }
}

// The library types a resolution as a nominal string. These are the ones
// both datafeeds serve, stamped once here so nothing else needs the cast.
export function asResolution(resolution: TvResolution): ResolutionString {
  return resolution as unknown as ResolutionString;
}

export const TV_RESOLUTION_STRINGS: ResolutionString[] = (
  Object.keys(TV_RESOLUTION_MS) as TvResolution[]
).map(asResolution);

// Where the library's static files are. Same-origin by default, at
// public/charting_library/. NEXT_PUBLIC_TRADINGVIEW_LIBRARY_PATH points it at
// another origin instead, per the library's cross-origin hosting guide: an
// absolute http(s) URL of the folder holding charting_library.standalone.js,
// with a trailing slash, on a server that allows this origin with CORS. The
// same value is both the script's src and the widget's library_path, which
// the guide requires to agree.
export const CHARTING_LIBRARY_PATH: string = (() => {
  const raw = process.env.NEXT_PUBLIC_TRADINGVIEW_LIBRARY_PATH?.trim();
  if (!raw) return "/charting_library/";
  if (!/^https?:\/\//.test(raw)) return "/charting_library/";
  return raw.endsWith("/") ? raw : `${raw}/`;
})();

// A price scale from a tick size or a decimal count. The library wants an
// integer power of ten: 100 for cents, 100000 for a five-place token.
export function tvPriceScale(decimals: number): number {
  return 10 ** Math.max(0, Math.min(8, Math.round(decimals)));
}

let loading: Promise<void> | null = null;

// Loads the standalone bundle once. It resolves when window.TradingView is
// live and rejects when the files are not there, which is the state a fresh
// checkout is in until the library has been copied in or pointed at. The
// script tag is what the library's guide prescribes for a remote origin, so
// the same loader serves both cases.
export function loadChartingLibrary(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.TradingView?.widget) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${CHARTING_LIBRARY_PATH}charting_library.standalone.js`;
    script.async = true;
    const fail = (why: string) => {
      loading = null;
      script.remove();
      reject(new Error(why));
    };
    script.onload = () => {
      if (window.TradingView?.widget) resolve();
      else fail("charting_library.standalone.js loaded but exposed no widget");
    };
    script.onerror = () =>
      fail(
        `charting_library.standalone.js not found under ${CHARTING_LIBRARY_PATH}` +
          (CHARTING_LIBRARY_PATH.startsWith("http")
            ? " (a remote host must also allow this origin with CORS)"
            : ""),
      );
    document.head.appendChild(script);
  });
  return loading;
}
