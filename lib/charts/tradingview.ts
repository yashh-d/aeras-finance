// TradingView's Charting Library (Advanced Charts): the surface this app uses.
//
// This is the chart Lighter and Ondo run on their own screens, and the one
// Ondo's history endpoint is shaped for ("TradingView UDF format, as required
// by the TradingView charting library"). It is licensed, not on npm: TradingView
// grants access to a private repository and the files are copied into
// public/charting_library/ (docs/tradingview.md). The library has no type
// package we can install alongside it, so the parts of its API the datafeeds
// and the widget host touch are declared here, narrowed to what is used.
//
// Field names follow the library's own, including its snake_case, because
// these objects are handed to the library verbatim.

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

// A bar as the library consumes it: `time` is unix milliseconds.
export interface TvBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TvDatafeedConfiguration {
  supported_resolutions: TvResolution[];
  supports_marks?: boolean;
  supports_timescale_marks?: boolean;
  supports_time?: boolean;
  exchanges?: { value: string; name: string; desc: string }[];
  symbols_types?: { name: string; value: string }[];
}

export interface TvSymbolInfo {
  name: string;
  ticker: string;
  description: string;
  type: string;
  session: string;
  timezone: string;
  exchange: string;
  listed_exchange: string;
  format: "price" | "volume";
  pricescale: number;
  minmov: number;
  has_intraday: boolean;
  has_daily: boolean;
  has_weekly_and_monthly: boolean;
  supported_resolutions: TvResolution[];
  intraday_multipliers?: string[];
  volume_precision: number;
  data_status: "streaming" | "endofday" | "delayed_streaming";
  visible_plots_set?: "ohlcv" | "ohlc" | "c";
}

export interface TvPeriodParams {
  // Unix seconds.
  from: number;
  to: number;
  countBack: number;
  firstDataRequest: boolean;
}

export interface TvHistoryMetadata {
  noData?: boolean;
  nextTime?: number;
}

export interface TvDatafeed {
  onReady(callback: (configuration: TvDatafeedConfiguration) => void): void;
  searchSymbols(
    userInput: string,
    exchange: string,
    symbolType: string,
    onResult: (items: unknown[]) => void,
  ): void;
  resolveSymbol(
    symbolName: string,
    onResolve: (symbolInfo: TvSymbolInfo) => void,
    onError: (reason: string) => void,
  ): void;
  getBars(
    symbolInfo: TvSymbolInfo,
    resolution: TvResolution,
    periodParams: TvPeriodParams,
    onResult: (bars: TvBar[], meta: TvHistoryMetadata) => void,
    onError: (reason: string) => void,
  ): void;
  subscribeBars(
    symbolInfo: TvSymbolInfo,
    resolution: TvResolution,
    onTick: (bar: TvBar) => void,
    listenerGuid: string,
    onResetCacheNeeded: () => void,
  ): void;
  unsubscribeBars(listenerGuid: string): void;
}

export interface TvWidgetOptions {
  container: HTMLElement;
  library_path: string;
  datafeed: TvDatafeed;
  symbol: string;
  interval: TvResolution;
  locale: string;
  theme: "dark" | "light";
  autosize: boolean;
  timezone: string;
  disabled_features: string[];
  enabled_features: string[];
  overrides: Record<string, string | number | boolean>;
  loading_screen: { backgroundColor: string; foregroundColor: string };
  custom_css_url?: string;
}

export interface TvWidget {
  onChartReady(callback: () => void): void;
  setSymbol(symbol: string, interval: TvResolution, callback: () => void): void;
  remove(): void;
}

declare global {
  interface Window {
    TradingView?: { widget: new (options: TvWidgetOptions) => TvWidget };
  }
}

export const CHARTING_LIBRARY_PATH = "/charting_library/";

// The library's own supported set, in the order its interval picker lists.
export const TV_RESOLUTIONS: TvResolution[] = ["1", "5", "15", "30", "60", "240", "720", "1D"];

// A price scale from a tick size or a decimal count. The library wants an
// integer power of ten: 100 for cents, 100000 for a five-place token.
export function tvPriceScale(decimals: number): number {
  return 10 ** Math.max(0, Math.min(8, Math.round(decimals)));
}

let loading: Promise<void> | null = null;

// Loads the standalone bundle once. It resolves when window.TradingView is
// live and rejects when the files are not there, which is the state a fresh
// checkout is in until the library has been copied in.
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
    script.onerror = () => fail(`charting_library.standalone.js not found under ${CHARTING_LIBRARY_PATH}`);
    document.head.appendChild(script);
  });
  return loading;
}
