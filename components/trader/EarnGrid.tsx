"use client";

// Trader mode, Earn. One card per venue in lib/trader/earn-venues.ts with its
// live rate, its size and the user's position; opening a card shows the
// venue's own deposit and withdraw surface, which is the same component the
// Investor Earn tab draws, so the two modes cannot disagree about a venue.

import { useMemo, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import { ShMonadCard } from "@/components/ShMonadCard";
import type { EarnPositionsView } from "@/lib/positions/use-earn-positions";
import type { AccountBalances } from "@/lib/solana/balances";
import { EARN_VENUES, type EarnVenueCard, type EarnVenueId } from "@/lib/trader/earn-venues";
import { useEarnVenueQuotes, type EarnVenueQuote } from "@/lib/trader/use-earn-venues";
import { WALLET_CHAINS } from "@/lib/ui/chains";

import {
  BackLink,
  BigFigure,
  CARD_GRID,
  EmptyState,
  fmtPct,
  fmtUsd,
  GridCard,
  Pill,
  SearchBox,
  SmallFigure,
  TraderHeader,
} from "./shared";

export function EarnGrid({
  walletAddress,
  balances,
  earn,
  onSettled,
}: {
  walletAddress: string | undefined;
  balances: AccountBalances | null;
  // The page's earn read, so the card's position is the number the wallet
  // card and the sidebar total already show.
  earn: EarnPositionsView;
  onSettled: () => Promise<void> | void;
}) {
  const { quotes, loading } = useEarnVenueQuotes();
  const [open, setOpen] = useState<EarnVenueId | null>(null);
  const [query, setQuery] = useState("");

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return EARN_VENUES;
    return EARN_VENUES.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.operator.toLowerCase().includes(q) ||
        v.hold.toLowerCase().includes(q) ||
        v.search.some((s) => s.includes(q)),
    );
  }, [query]);

  const opened = open ? EARN_VENUES.find((v) => v.id === open) : null;

  if (opened) {
    return (
      <div className="space-y-6">
        <BackLink label="All venues" onClick={() => setOpen(null)} />
        <VenueDetail
          venue={opened}
          walletAddress={walletAddress}
          balances={balances}
          onSettled={onSettled}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TraderHeader
        eyebrow="Earn"
        title="Put your USDC to work"
        aside={<SearchBox value={query} onChange={setQuery} placeholder="Search venues" />}
      >
        Pick a venue. It funds from your Solana USDC in one press and shows what
        you hold as it earns. Withdraw whenever you want; each card says how.
      </TraderHeader>

      {cards.length === 0 ? (
        <EmptyState>No venue matches that search.</EmptyState>
      ) : (
        <div className={CARD_GRID}>
          {cards.map((v) => (
            <VenueCard
              key={v.id}
              venue={v}
              quote={quotes[v.id]}
              loading={loading}
              positionUsd={earn.rows.find((r) => r.key === v.positionKey)?.usd ?? null}
              positionDetail={earn.rows.find((r) => r.key === v.positionKey)?.detail ?? null}
              onOpen={() => setOpen(v.id)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-white/40">
        Rates are read live from each venue and move with it. A position&apos;s
        value follows the asset it is held in, which for staking is not the
        dollar.
      </p>
    </div>
  );
}

function VenueCard({
  venue,
  quote,
  loading,
  positionUsd,
  positionDetail,
  onOpen,
}: {
  venue: EarnVenueCard;
  quote: EarnVenueQuote | undefined;
  loading: boolean;
  positionUsd: number | null;
  positionDetail: string | null;
  onOpen: () => void;
}) {
  const chain = WALLET_CHAINS.find((c) => c.id === venue.chain);
  const apy = quote?.apy ?? null;
  return (
    <GridCard onClick={onOpen} muted={!loading && apy == null}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AssetLogo xstock={{ symbol: venue.hold, name: venue.name, logo: venue.logo }} size={36} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium tracking-tight text-white">
              {venue.name}
            </div>
            <div className="text-[11px] text-white/45">by {venue.operator}</div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Pill>{venue.kind}</Pill>
          {chain && <Pill logo={chain.logo}>{chain.label}</Pill>}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-white/50">
          {venue.put} in <span className="text-white/25">·</span> {venue.hold} out
        </div>
        <p className="text-xs leading-relaxed text-white/55">{venue.summary}</p>
      </div>

      <div className="mt-auto flex items-end justify-between gap-4 border-t border-white/[0.06] pt-4">
        <BigFigure
          label="APY"
          value={apy == null ? (loading ? "…" : "—") : fmtPct(apy)}
          tone={apy == null ? "muted" : "positive"}
          sub={quote?.basis ?? undefined}
        />
        <SmallFigure
          label="Staked"
          value={
            quote?.tvlUsd != null
              ? compactUsd(quote.tvlUsd)
              : (quote?.tvlNative ?? (loading ? "…" : "—"))
          }
        />
      </div>

      {positionUsd != null && positionUsd > 0 ? (
        <div className="flex items-baseline justify-between gap-3 rounded-lg border border-aeras-positive/25 bg-aeras-positive/10 px-3 py-2 text-xs">
          <span className="text-white/60">You hold</span>
          <span className="font-mono tabular-nums text-white">
            {fmtUsd(positionUsd)}
            {positionDetail && (
              <span className="ml-2 text-[11px] text-white/50">{positionDetail}</span>
            )}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 text-[11px] text-white/40">
          <span>Exit: {venue.exit}</span>
          <span className="text-white/60">Open</span>
        </div>
      )}
    </GridCard>
  );
}

function VenueDetail({
  venue,
  walletAddress,
  balances,
  onSettled,
}: {
  venue: EarnVenueCard;
  walletAddress: string | undefined;
  balances: AccountBalances | null;
  onSettled: () => Promise<void> | void;
}) {
  if (venue.id === "shmonad") {
    // The whole card, header and forms and disclosure, as the Investor Earn
    // tab draws it. It carries its own position block, its own stake and
    // withdraw modes and the way home, so the detail is the card.
    return (
      <ShMonadCard
        walletAddress={walletAddress}
        solanaUsdcAtomic={balances?.usdcAtomic ?? "0"}
        onRefresh={onSettled}
      />
    );
  }
  return <EmptyState>This venue has no surface yet.</EmptyState>;
}

function compactUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return fmtUsd(n, 0);
}
