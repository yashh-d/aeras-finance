"use client";

// The news rail. Three tabs over one list: the selected asset's coverage,
// the market-wide feeds, and the Federal Reserve's own releases (FOMC
// statements, minutes, speeches). Each row is the publisher, how old the story is, and
// the headline, which opens the article in a new tab; there is no summary,
// because ten summaries in a rail this width is a wall and the headline is
// what a reader scans.
//
// One hook, keyed by the tab, so only the list on screen polls. Ten rows to
// start and forty at most, which is what the route returns.

import { Globe } from "lucide-react";
import { useEffect, useReducer, useState, type ReactNode } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import type { XStock } from "@/lib/jupiter/xstocks";
import { FED_NEWS_KEY, MARKET_NEWS_KEY } from "@/lib/news/client";
import { relativeTime } from "@/lib/news/format";
import { useNews } from "@/lib/news/use-news";

const INITIAL_ROWS = 10;
// Relative times are re-rendered on this cadence so "3m ago" does not sit at
// three minutes for the five between refreshes.
const CLOCK_TICK_MS = 60_000;

type Tab = "asset" | "market" | "fed";

export function TerminalNews({ asset }: { asset: XStock | null }) {
  const [chosen, setChosen] = useState<Tab>("asset");
  // A bare market has no company to read about, so its rail opens on the
  // market tab and offers no company tab.
  const tab: Tab = asset ? chosen : chosen === "asset" ? "market" : chosen;
  const setTab = setChosen;
  const [expanded, setExpanded] = useState(false);
  const key =
    tab === "asset" && asset ? asset.mint : tab === "market" ? MARKET_NEWS_KEY : FED_NEWS_KEY;
  const { data, loading, error } = useNews(key);

  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const items = data?.items ?? [];
  const shown = expanded ? items : items.slice(0, INITIAL_ROWS);

  function choose(next: Tab) {
    setTab(next);
    setExpanded(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          News
        </div>
        <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
          {asset && (
            <TabButton
              label={asset.name}
              icon={<AssetLogo xstock={asset} size={14} />}
              active={tab === "asset"}
              onClick={() => choose("asset")}
            />
          )}
          <TabButton
            label="Market"
            icon={<Globe className="size-3.5 text-white/60" aria-hidden="true" />}
            active={tab === "market"}
            onClick={() => choose("market")}
          />
          <TabButton
            label="Fed"
            icon={<span aria-hidden="true">🇺🇸</span>}
            active={tab === "fed"}
            onClick={() => choose("fed")}
          />
        </div>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-white/40">Loading headlines</p>
      ) : error && items.length === 0 ? (
        <p className="py-6 text-center text-sm text-aeras-warning">
          Headlines are unavailable right now.
        </p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/40">
          {tab === "asset" && asset ? `No recent headlines for ${asset.name}.` : "No recent items."}
        </p>
      ) : (
        <div className="divide-y divide-white/[0.07]">
          {shown.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="-mx-2 block rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-white/45">
                <span className="truncate font-medium text-white/60">
                  {item.source}
                </span>
                {item.publishedAt != null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0 tabular-nums">
                      {relativeTime(item.publishedAt)}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-0.5 text-[13px] leading-snug text-white">
                {item.title}
              </div>
            </a>
          ))}
        </div>
      )}

      {items.length > INITIAL_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full pt-1 text-center text-[11px] font-medium text-white/50 transition-colors hover:text-white"
        >
          {expanded ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}

      {data && (
        <p className="text-[10px] text-white/30">
          Updated {relativeTime(data.fetchedAt)}
          {data.stale ? ". Some feeds did not answer; older items shown." : ""}
        </p>
      )}
    </div>
  );
}

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  // A mark before the label: the company's, a globe for the market, the flag
  // for the Fed, so the tabs read as what they are before the word is read.
  icon?: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex max-w-[10rem] items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
        active ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
      }`}
    >
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="truncate">{label}</span>
    </button>
  );
}
