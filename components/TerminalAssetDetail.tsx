"use client";

// The selected asset in full: the price header with the exchange's session
// figures beside the on-chain 24h move, and a tab strip over the chart, the
// company's financials, its headlines, profile, dividends, insider trades and
// filings. Company sections exist only for equities; a fund gets its quote
// and summary, and a bullion token has no listing and gets the chart and the
// news.
//
// Two prices sit in this header on purpose. The big figure is the market the
// ticket beside it trades: the xStock on Solana, or the Lighter perp when the
// ticket is in perps mode. The session figures are the underlying on its
// exchange, which is what a reader comparing to a broker sees. They differ
// by a few basis points, and the labels say which is which.

import { useState } from "react";

import { LendingBadge } from "@/components/AssetLogo";
import { TerminalAssetPicker } from "@/components/TerminalAssetPicker";
import { hasLendingMarket } from "@/lib/borrow/availability";
import type { TicketMode } from "@/components/TerminalTicket";
import type { TerminalSelection } from "@/lib/terminal/selection";
import { AboutTab, DividendsTab, FilingsTab, InsiderTab } from "@/components/CompanyInfoTabs";
import { CompanyFinancials } from "@/components/CompanyFinancials";
import { PerpChart } from "@/components/HomeCharts";
import { LighterChart } from "@/components/LighterChart";
import { PriceChart, type PriceChartMarker } from "@/components/PriceChart";
import { TradingViewChart } from "@/components/TradingViewChart";
import { useCompanySection } from "@/lib/company/client";
import { compactCount, compactUsd, signedPct, signedUsd } from "@/lib/company/format";
import { nasdaqListing, tradingViewSymbol } from "@/lib/company/listing";
import type {
  CompanyDividends,
  CompanyFiling,
  CompanyFinancials as Financials,
  CompanyProfile,
  CompanyQuote,
  CompanySummary,
  InsiderTrade,
} from "@/lib/company/types";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { XStock } from "@/lib/jupiter/xstocks";
import { PERPS_CANDLE_RANGES } from "@/lib/lighter/candles";
import type { LighterMarket } from "@/lib/lighter/types";
import { relativeTime } from "@/lib/news/format";
import { useNews } from "@/lib/news/use-news";
import { changeColor, formatChange, formatQuotePrice } from "@/lib/terminal/display";

type Tab = "chart" | "financials" | "news" | "about" | "dividends" | "insider" | "filings";

const TAB_LABEL: Record<Tab, string> = {
  chart: "Chart",
  financials: "Financials",
  news: "News",
  about: "About",
  dividends: "Dividends",
  insider: "Insider",
  filings: "Filings",
};

const COMPANY_TABS: Tab[] = ["chart", "financials", "news", "about", "dividends", "insider", "filings"];
const OTHER_TABS: Tab[] = ["chart", "news"];

type ChartKind = "line" | "candles";

export function TerminalAssetDetail({
  xstock,
  prices,
  showingPerp,
  perpMarket,
  perpMarkets,
  catalogLoading,
  catalogError,
  nextEarningsAt,
  onPick,
  onPickerOpen,
  marker,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  showingPerp: boolean;
  perpMarket: LighterMarket | null;
  // The whole tradeable catalog, for the picker's Perps group.
  perpMarkets: readonly LighterMarket[];
  catalogLoading: boolean;
  catalogError: string | null;
  nextEarningsAt: number | null;
  // The picker in the header. See TerminalAssetPicker.
  onPick: (selection: TerminalSelection, mode: TicketMode) => void;
  onPickerOpen?: (open: boolean) => void;
  // A horizontal line on the line chart: the ticket's limit price while the
  // limit form is open. Only the line chart draws it; TradingView's embed
  // and the perp candles have no hook for it.
  marker?: PriceChartMarker;
}) {
  const [tab, setTab] = useState<Tab>("chart");
  const [chartKind, setChartKind] = useState<ChartKind>("line");

  const listing = nasdaqListing(xstock);
  const company = listing?.assetClass === "stocks";
  const tabs = company ? COMPANY_TABS : OTHER_TABS;
  const activeTab: Tab = tabs.includes(tab) ? tab : "chart";
  const ticker = listing?.ticker ?? null;

  const quote = useCompanySection<CompanyQuote>(ticker, "quote", 30_000);
  const summary = useCompanySection<CompanySummary>(ticker, "summary", 10 * 60_000);
  const financials = useCompanySection<Financials>(
    company && activeTab === "financials" ? ticker : null,
    "financials",
    30 * 60_000,
  );
  const profile = useCompanySection<CompanyProfile>(
    company && activeTab === "about" ? ticker : null,
    "profile",
    60 * 60_000,
  );
  const dividends = useCompanySection<CompanyDividends>(
    company && activeTab === "dividends" ? ticker : null,
    "dividends",
    60 * 60_000,
  );
  const insiders = useCompanySection<InsiderTrade[]>(
    company && activeTab === "insider" ? ticker : null,
    "insiders",
    10 * 60_000,
  );
  const filings = useCompanySection<CompanyFiling[]>(
    company && activeTab === "filings" ? ticker : null,
    "filings",
    10 * 60_000,
  );
  const news = useNews(activeTab === "news" ? xstock.mint : null);

  const entry = prices?.[xstock.mint];
  const price = showingPerp && perpMarket ? Number(perpMarket.markPrice) || null : (entry?.usdPrice ?? null);
  const change = showingPerp && perpMarket ? perpMarket.dailyPriceChange : (entry?.priceChange24h ?? null);
  const q = quote.data?.data ?? null;
  const s = summary.data?.data ?? null;
  const tvSymbol = tradingViewSymbol(xstock);

  return (
    <div className="space-y-4">
      {/* The picker, then what the asset can do beside its name: the perp's
          maximum leverage when Lighter lists it, and the lending badge the
          asset lists carry when a venue takes it as collateral. Same marks as
          the rows on Home and Markets, so the header says the same things. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <TerminalAssetPicker
            value={{ kind: "asset", xstock }}
            mode={showingPerp ? "perps" : "spot"}
            prices={prices}
            perpMarkets={perpMarkets}
            onSelect={onPick}
            onOpenChange={onPickerOpen}
            variant="detail"
          />
          {perpMarket && (
            <span
              title={`Up to ${perpMarket.maxLeverage}x on the ${perpMarket.symbol} perp on Lighter`}
              className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white/70"
            >
              {perpMarket.maxLeverage}x
            </span>
          )}
          {hasLendingMarket(xstock.mint) && <LendingBadge size={14} />}
        </div>

        {/* The price at the top right, where a quote screen keeps it, with the
            session figures on their own row beneath the name. */}
        <div className="text-right">
          <div className="font-mono text-[2rem] font-light tabular-nums leading-none text-white">
            {formatQuotePrice(price)}
          </div>
          <div className={`mt-1.5 font-mono text-sm tabular-nums ${changeColor(change)}`}>
            {formatChange(change)} <span className="text-white/40">24h</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {q && (
          <Stat
            label={q.marketStatus === "Open" ? "Session" : "Last session"}
            value={`${signedUsd(q.change)} ${signedPct(q.changePct)}`}
            tone={q.changePct}
          />
        )}
        {q?.extended && (
          <Stat
            label={q.marketStatus === "Pre Market" ? "Pre-market" : "After hours"}
            value={`${signedUsd(q.extended.change)} ${signedPct(q.extended.changePct)}`}
            tone={q.extended.changePct}
          />
        )}
        {s?.marketCapUsd != null && <Stat label="Mkt cap" value={compactUsd(s.marketCapUsd)} />}
        {q?.volume != null && <Stat label="Volume" value={compactCount(q.volume)} />}
        {company && (
          <Stat
            label="Next earnings"
            value={
              nextEarningsAt == null
                ? "—"
                : new Date(nextEarningsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
            }
          />
        )}
      </div>

      <div className="flex gap-4 overflow-x-auto border-b border-white/10">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={activeTab === t}
            className={`-mb-px shrink-0 border-b-2 pb-2 text-sm transition-colors ${
              activeTab === t
                ? "border-white text-white"
                : "border-transparent text-white/50 hover:text-white/80"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {activeTab === "chart" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            {/* Only the candles need a caption: TradingView charts the
                underlying on its exchange, which is not the xStock, and the
                reader should know which market the candles are. */}
            <p className="text-[11px] text-white/40">
              {chartKind === "candles" && !showingPerp
                ? tvSymbol
                  ? `TradingView chart of ${tvSymbol}, the underlying on its exchange.`
                  : "No candle source for this asset."
                : ""}
            </p>
            <div className="inline-flex shrink-0 rounded-lg border border-white/10 p-0.5 text-xs">
              {(["line", "candles"] as ChartKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setChartKind(k)}
                  aria-pressed={chartKind === k}
                  className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${
                    chartKind === k ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          {chartKind === "line" ? (
            showingPerp && perpMarket ? (
              <PerpChart
                key={perpMarket.symbol}
                symbol={perpMarket.symbol}
                market={perpMarket}
                catalogLoading={catalogLoading}
                catalogError={catalogError}
                heightClass="h-72"
                showHeading={false}
              />
            ) : (
              <PriceChart
                ticker={xstock}
                heightClass="h-72"
                showHeading={false}
                variant="detailed"
                marker={marker}
              />
            )
          ) : showingPerp && perpMarket ? (
            <LighterChart
              key={perpMarket.symbol}
              marketId={perpMarket.marketId}
              symbol={perpMarket.symbol}
              markPrice={Number(perpMarket.markPrice)}
              ranges={PERPS_CANDLE_RANGES}
            />
          ) : tvSymbol ? (
            <TradingViewChart key={tvSymbol} symbol={tvSymbol} />
          ) : (
            <p className="py-8 text-center text-sm text-white/40">No candle chart for {xstock.symbol}.</p>
          )}
        </div>
      )}

      {activeTab === "financials" && (
        <Section state={financials} what="financials">
          {(f) => <CompanyFinancials financials={f} price={q?.last ?? price} />}
        </Section>
      )}

      {activeTab === "news" &&
        (news.loading ? (
          <p className="py-6 text-center text-sm text-white/40">Loading headlines</p>
        ) : news.error && !news.data ? (
          <p className="py-6 text-center text-sm text-aeras-warning">Headlines are unavailable right now.</p>
        ) : (
          <div className="divide-y divide-white/[0.07]">
            {(news.data?.items ?? []).slice(0, 20).map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="-mx-2 block rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-1.5 text-[11px] text-white/45">
                  <span className="truncate font-medium text-white/60">{item.source}</span>
                  {item.publishedAt != null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0 tabular-nums">{relativeTime(item.publishedAt)}</span>
                    </>
                  )}
                </div>
                <div className="mt-0.5 text-[13px] leading-snug text-white">{item.title}</div>
              </a>
            ))}
          </div>
        ))}

      {activeTab === "about" && (
        <Section state={profile} what="the profile">
          {(p) => <AboutTab profile={p} />}
        </Section>
      )}
      {activeTab === "dividends" && (
        <Section state={dividends} what="dividends">
          {(d) => <DividendsTab dividends={d} />}
        </Section>
      )}
      {activeTab === "insider" && (
        <Section state={insiders} what="insider trades">
          {(t) => <InsiderTab trades={t} />}
        </Section>
      )}
      {activeTab === "filings" && (
        <Section state={filings} what="filings">
          {(f) => <FilingsTab filings={f} />}
        </Section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  const color = tone == null ? "text-white" : tone >= 0 ? "text-aeras-positive" : "text-aeras-negative";
  return (
    <div className="shrink-0">
      <div className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
        {label}
      </div>
      <div className={`mt-1 whitespace-nowrap font-mono text-[13px] tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

// One section's loading, error and loaded states, so each tab is a one-liner.
function Section<T>({
  state,
  what,
  children,
}: {
  state: { data: { data: T; fetchedAt: number; stale: boolean } | null; loading: boolean; error: string | null };
  what: string;
  children: (data: T) => React.ReactNode;
}) {
  if (state.loading) return <p className="py-6 text-center text-sm text-white/40">Loading {what}</p>;
  if (!state.data) {
    return (
      <p className="py-6 text-center text-sm text-aeras-warning">
        Nasdaq did not answer for {what} right now.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {children(state.data.data)}
      <p className="text-[10px] text-white/30">
        Nasdaq, updated {relativeTime(state.data.fetchedAt)}
        {state.data.stale ? ". Older copy; the source did not answer." : ""}
      </p>
    </div>
  );
}
