"use client";

// The "Portfolios" group on Markets, holding the one portfolio the app offers.
//
// Its own group rather than a row in the catalog, because a Mag7X position
// is not a token in the wallet: it is a smart account on Base that Glider
// keeps aligned with Bitwise's weights. The row reads like a Markets row
// (mark, name, a figure, a sparkline, a chevron) so the eye does not have to
// change gear, and the expansion is the detail beside the ticket, as every
// catalog row's is.

import { ChevronDown } from "lucide-react";

import { AssetLogo } from "@/components/AssetLogo";
import { GLIDER_STRATEGY_NAME } from "@/lib/glider/constants";
import { useGliderHistory, useGliderPortfolio, useGliderStrategy } from "@/lib/glider/use-glider";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import type { AccountBalances } from "@/lib/solana/balances";
import { VENUE_LOGOS } from "@/lib/tokens/logos";
import { GLASS_SURFACE } from "@/lib/ui/surface";

import { GliderMag7xDetail } from "./GliderMag7xDetail";
import { GliderTicket } from "./GliderTicket";

const MARK = { symbol: "MAG7X", name: GLIDER_STRATEGY_NAME, logo: VENUE_LOGOS.glider };

// Search terms that should surface this group. The row has no ticker, so
// the words a user would type for it are listed here.
const SEARCH_TERMS = ["mag7", "mag 7", "magnificent", "bitwise", "glider", "portfolio", "spacex", "base"];

export function gliderMatchesQuery(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return SEARCH_TERMS.some((t) => t.includes(q) || q.includes(t));
}

function LineSparkline({ values, positive }: { values: number[]; positive: boolean | null }) {
  const W = 60;
  const H = 18;
  if (values.length < 2) return <div className="h-[18px] w-[60px]" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`)
    .join(" ");
  const stroke = positive == null ? "stroke-aeras-100" : positive ? "stroke-aeras-positive" : "stroke-aeras-negative";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible" aria-hidden="true">
      <polyline points={points} fill="none" strokeWidth={1.5} className={stroke} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function GliderMag7xCard({
  prices,
  balances,
  walletAddress,
  expanded,
  onToggle,
  onRefresh,
}: {
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  walletAddress: string | null;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => Promise<void> | void;
}) {
  const { strategy, error: strategyError } = useGliderStrategy();
  const history = useGliderHistory(expanded);
  const evm = useEmbeddedEvmWallet();
  const portfolioState = useGliderPortfolio(!!walletAddress && !!evm.address);
  const portfolio = portfolioState.portfolio;

  const boost = strategy?.boost ?? null;
  const live = strategy?.live ?? null;
  const liveAll = live?.windows.find((w) => w.window === "all")?.percentChange ?? null;
  const sparkValues = (live?.points ?? []).slice(-90).map((p) => p.percentChange);

  return (
    <div className={`${GLASS_SURFACE} p-5 lg:p-6`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-medium tracking-tight text-white">Portfolios</h3>
          <span className="text-[11px] tabular-nums text-white/40">1</span>
        </div>
        {strategyError && !strategy && (
          <span className="text-[11px] text-aeras-warning">Glider offline</span>
        )}
      </div>

      <div className="mt-4 divide-y divide-white/10">
        <div className="flex items-center gap-3 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
          <div className="min-w-0 flex-1">Portfolio</div>
          <div className="w-24 text-right">Position</div>
          <div className="w-24 text-right">Boost</div>
          <div className="hidden w-16 text-center sm:block">Since listing</div>
          <div className="w-5" />
        </div>
        <div>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={`group flex w-full items-center gap-3 py-3 text-left text-sm transition-colors ${
              expanded ? "bg-white/[0.03]" : "hover:bg-white/5"
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <AssetLogo xstock={MARK} size={32} />
              <div className="min-w-0">
                <div className="truncate font-medium tracking-tight text-white">{strategy?.name ?? GLIDER_STRATEGY_NAME}</div>
                <div className="mt-0.5 text-[11px] text-white/45">
                  Mag7 + SpaceX, equal weight · Bitwise on Glider · Base
                </div>
              </div>
            </div>
            <div className="w-24 text-right">
              {portfolio && portfolio.totalValueUsd > 0 ? (
                <>
                  <div className="font-mono tabular-nums text-white">${portfolio.totalValueUsd.toFixed(2)}</div>
                  <div className="font-mono text-[11px] text-white/45">
                    {(() => {
                      const all = portfolio.performance?.windows.find((w) => w.window === "all")?.percentChange;
                      return all == null ? "held" : `${all >= 0 ? "+" : ""}${all.toFixed(2)}%`;
                    })()}
                  </div>
                </>
              ) : (
                <span className="font-mono text-[11px] text-white/35">—</span>
              )}
            </div>
            <div className="w-24 text-right">
              <div className={`font-mono tabular-nums ${boost ? "text-aeras-positive" : "text-white/50"}`}>
                {boost ? `${(boost.apr * 100).toFixed(1)}% APR` : "—"}
              </div>
              <div className="font-mono text-[11px] text-white/45">{boost ? "boost, in USD" : "no campaign"}</div>
            </div>
            <div className="hidden w-16 items-center justify-center sm:flex">
              <LineSparkline values={sparkValues} positive={liveAll == null ? null : liveAll >= 0} />
            </div>
            <div className="w-5">
              <ChevronDown
                className={`size-4 text-white/40 transition-transform group-hover:text-white/70 ${expanded ? "rotate-180" : ""}`}
              />
            </div>
          </button>

          {expanded && (
            <div className="border-t border-white/10 px-1 py-5">
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  {strategy ? (
                    <GliderMag7xDetail
                      strategy={strategy}
                      history={history.history}
                      historyError={history.error}
                      prices={prices}
                    />
                  ) : (
                    <div className="text-xs text-white/50">{strategyError ?? "Reading the strategy from Glider…"}</div>
                  )}
                </div>
                <div>
                  <GliderTicket
                    strategy={strategy}
                    portfolioState={portfolioState}
                    walletAddress={walletAddress}
                    balances={balances}
                    onRefresh={onRefresh}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
