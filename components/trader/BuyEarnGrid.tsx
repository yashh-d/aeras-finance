"use client";

// Trader mode, Buy + Earn. "Buy Tesla, earn up to Y%": one card per asset
// with a borrow market, headlined by the best net rate the borrowed USDC can
// make across the three tiers in lib/trader/tiers.ts (a stock portfolio,
// staking, liquidity pools), at the SAFE MAXIMUM borrow ratio
// (docs/trader-mode-plan.md, D11 and D12). The card is the asset, the rate
// and the exposures as marks, nothing else (D14). Opening it shows the
// three tiers priced and the existing Buy + Earn ticket on the chosen one,
// with that tier's venue alone, beside the position it opened.

import { useMemo, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import { EarnTicket } from "@/components/strategies/EarnTicket";
import { Note } from "@/components/strategies/shared";
import { formatUsdPrice } from "@/lib/format";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { AccountBalances } from "@/lib/solana/balances";
import { maxBorrowRatio } from "@/lib/strategies/math";
import {
  useStrategyRates,
  type StrategyRates,
  type StrategyRatesState,
  type UsdcEarnOption,
} from "@/lib/strategies/rates";
import {
  pickRun,
  useStrategyRuns,
  type StrategyRun,
  type StrategyRunsStore,
} from "@/lib/strategies/runs-client";
import { assetMark, destinationMarks, type Mark } from "@/lib/trader/exposures";
import {
  bestTier,
  EARN_TIERS,
  tierState,
  type EarnTier,
  type TierId,
  type TierState,
} from "@/lib/trader/tiers";
import { GLASS_SURFACE } from "@/lib/ui/surface";

import { ExposureStrip } from "./ExposureStrip";
import { PositionSummary } from "./PositionSummary";
import {
  BackLink,
  BigFigure,
  CARD_GRID,
  ChoicePills,
  DetailCard,
  DetailColumns,
  EmptyState,
  fmtPct,
  fmtSignedPct,
  GridCard,
  Pill,
  SearchBox,
  SmallFigure,
  TraderHeader,
} from "./shared";

type Sort = "best" | "borrow" | "name";

const SORTS: readonly { id: Sort; label: string }[] = [
  { id: "best", label: "Highest rate" },
  { id: "borrow", label: "Cheapest to borrow" },
  { id: "name", label: "A to Z" },
];

// What a tier's loan becomes, for the strips. A live tier shows its venue's
// marks; a planned one shows the mark of what it will hold.
function tierMarks(tier: EarnTier, state: TierState): Mark[] {
  if (state.kind === "ready") return destinationMarks(state.option.venue);
  return destinationMarks(tier.venues[0].venue);
}

export function BuyEarnGrid({
  walletAddress,
  balances,
  prices,
  onRefresh,
}: {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  const rates = useStrategyRates();
  const store = useStrategyRuns(walletAddress);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("best");

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = rates.rows.filter(
      (r) =>
        q === "" ||
        r.xstock.symbol.toLowerCase().includes(q) ||
        r.xstock.name.toLowerCase().includes(q),
    );
    const best = (r: StrategyRates) => bestTier(r, rates.earnOptions)?.net ?? -Infinity;
    return [...rows].sort((a, b) => {
      if (sort === "name") return a.xstock.name.localeCompare(b.xstock.name);
      if (sort === "borrow") return (a.borrowApr ?? Infinity) - (b.borrowApr ?? Infinity);
      return best(b) - best(a);
    });
  }, [rates.rows, rates.earnOptions, query, sort]);

  const opened = open ? rates.rows.find((r) => r.xstock.mint === open) : null;

  if (opened) {
    return (
      <BuyEarnDetail
        row={opened}
        rates={rates}
        store={store}
        walletAddress={walletAddress}
        balances={balances}
        prices={prices}
        onRefresh={onRefresh}
        onBack={() => setOpen(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <TraderHeader
        eyebrow="Buy + Earn"
        title="Buy a stock. Earn on the loan."
        aside={<SearchBox value={query} onChange={setQuery} placeholder="Search assets" />}
      >
        Buy a tokenized stock, borrow against it, and put the loan into a
        portfolio, staking or a liquidity pool. The figure is the best of the
        three on what you put in.
      </TraderHeader>

      <ChoicePills options={SORTS} value={sort} onChange={setSort} label="Sort" />

      {cards.length === 0 ? (
        <EmptyState>
          {rates.loading
            ? "Loading markets…"
            : query
              ? "No asset matches that search."
              : "No asset has a borrow market."}
        </EmptyState>
      ) : (
        <div className={CARD_GRID}>
          {cards.map((row) => (
            <AssetCard
              key={row.xstock.mint}
              row={row}
              rates={rates}
              price={prices?.[row.xstock.mint]?.usdPrice ?? null}
              change={prices?.[row.xstock.mint]?.priceChange24h ?? null}
              saved={pickRun(store.runs, "earn", row.xstock.mint)}
              onOpen={() => setOpen(row.xstock.mint)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-white/40">
        xStocks are tokenized representations issued by Backed Finance. Holders
        do not have direct shareholder rights. A loan against them can be
        liquidated if the price falls past the threshold the ticket shows.
      </p>
    </div>
  );
}

function AssetCard({
  row,
  rates,
  price,
  change,
  saved,
  onOpen,
}: {
  row: StrategyRates;
  rates: StrategyRatesState;
  price: number | null;
  change: number | null;
  saved: StrategyRun | null;
  onOpen: () => void;
}) {
  const { xstock } = row;
  const best = bestTier(row, rates.earnOptions);
  const positive = change == null ? null : change >= 0;
  const to = best ? destinationMarks(best.option.venue) : [];
  return (
    <GridCard onClick={onOpen} muted={best != null && best.net <= 0}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AssetLogo xstock={xstock} size={40} />
          <div className="min-w-0">
            <div className="truncate text-base font-medium tracking-tight text-white">
              Buy {xstock.name}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-white/45">
              <span>{xstock.symbol}</span>
              {price != null && (
                <>
                  <span className="text-white/25">·</span>
                  <span className="font-mono tabular-nums text-white/70">
                    ${formatUsdPrice(price)}
                  </span>
                  {change != null && (
                    <span
                      className={`font-mono tabular-nums ${
                        positive ? "text-aeras-positive" : "text-aeras-negative"
                      }`}
                    >
                      {positive ? "+" : ""}
                      {change.toFixed(2)}%
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        {saved && (
          <Pill tone={saved.status === "running" ? "warn" : "positive"}>
            {saved.status === "running" ? "Resume" : "Open"}
          </Pill>
        )}
      </div>

      <div className="mt-auto flex items-end justify-between gap-4 pt-1">
        <BigFigure
          label="Earn up to"
          value={best ? fmtSignedPct(best.net) : rates.loading ? "…" : "—"}
          tone={best ? (best.net > 0 ? "positive" : "warn") : "muted"}
        />
        <ExposureStrip from={assetMark(xstock)} to={to} size={26} max={6} />
      </div>
    </GridCard>
  );
}

function BuyEarnDetail({
  row,
  rates,
  store,
  walletAddress,
  balances,
  prices,
  onRefresh,
  onBack,
}: {
  row: StrategyRates;
  rates: StrategyRatesState;
  store: StrategyRunsStore;
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
  onBack: () => void;
}) {
  const { xstock, route } = row;
  const saved = pickRun(store.runs, "earn", xstock.mint);
  const price = prices?.[xstock.mint]?.usdPrice ?? null;
  const best = bestTier(row, rates.earnOptions);
  // The tier the ticket is on. Starts on the best one and follows it until
  // the user picks another.
  const [chosen, setChosen] = useState<TierId | null>(null);
  const tierId: TierId = chosen ?? best?.tier.id ?? "portfolio";
  const tier = EARN_TIERS.find((t) => t.id === tierId)!;
  const state = tierState(tier, row, rates.earnOptions);

  // The venue a saved run used, so its close path resolves to the venue
  // that holds the money even when that venue is not the chosen tier's.
  const savedVenue = saved?.data.kind === "earn" ? saved.data.earnVenue : null;
  const savedOption = savedVenue
    ? (rates.earnOptions.find((o) => o.venue === savedVenue) ?? null)
    : null;
  const earn: UsdcEarnOption | null = state.kind === "ready" ? state.option : savedOption;
  const earnOptions: UsdcEarnOption[] =
    earn && savedOption && savedOption.venue !== earn.venue ? [earn, savedOption] : earn ? [earn] : [];

  // Bumped after the ticket reports a settled run, so the position column
  // re-reads the venue.
  const [tick, setTick] = useState(0);
  const settled = async () => {
    await onRefresh();
    setTick((n) => n + 1);
  };

  return (
    <div className="space-y-6">
      <BackLink label="All assets" onClick={onBack} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AssetLogo xstock={xstock} size={44} />
          <div>
            <div className="text-xl font-light tracking-tight text-white">Buy {xstock.name}</div>
            <div className="text-xs text-white/50">
              {xstock.symbol}
              {price != null && (
                <span className="ml-2 font-mono tabular-nums text-white/70">
                  ${formatUsdPrice(price)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <SmallFigure label="Borrow rate" value={fmtPct(row.borrowApr)} />
          <SmallFigure label="Borrows" value={`${Math.round(maxBorrowRatio(route) * 100)}% of value`} />
          <BigFigure
            label="Earn up to"
            value={best ? fmtSignedPct(best.net) : "—"}
            tone={best ? (best.net > 0 ? "positive" : "warn") : "muted"}
            align="right"
          />
        </div>
      </div>

      <TierPicker row={row} rates={rates} selected={tierId} onSelect={setChosen} />
      <p className="text-xs text-white/45">
        <span className="text-aeras-warning/90">Risk.</span> {tier.risk}
      </p>

      <DetailColumns
        left={
          <DetailCard title={tier.name}>
            {earn ? (
              <EarnTicket
                key={`${xstock.mint}-${tierId}`}
                row={row}
                earn={earn}
                earnOptions={earnOptions}
                walletAddress={walletAddress}
                balances={balances}
                prices={prices}
                store={store}
                saved={saved}
                onRefresh={settled}
                initialRatio={maxBorrowRatio(route)}
              />
            ) : state.kind === "planned" ? (
              <Note>{state.label} is not built yet. The other tiers run today.</Note>
            ) : (
              <Note tone="warn">
                {state.kind === "unavailable" ? state.reason : "This tier cannot run right now."}
                {" "}Pick another tier.
              </Note>
            )}
          </DetailCard>
        }
        right={
          <PositionSummary
            row={row}
            walletAddress={walletAddress}
            prices={prices}
            saved={saved}
            earnOptions={rates.earnOptions}
            refreshKey={tick}
          />
        }
      />
    </div>
  );
}

// The three tiers as a row of choices: rank, name, what the loan becomes as
// marks, and the net for this asset. The mechanism and the risk are one line
// each on the chosen tier, under the row.
function TierPicker({
  row,
  rates,
  selected,
  onSelect,
}: {
  row: StrategyRates;
  rates: StrategyRatesState;
  selected: TierId;
  onSelect: (id: TierId) => void;
}) {
  return (
    <div role="group" aria-label="Where the loan goes" className="grid gap-3 md:grid-cols-3">
      {EARN_TIERS.map((t) => {
        const state = tierState(t, row, rates.earnOptions);
        const ready = state.kind === "ready";
        const active = selected === t.id;
        const figure =
          state.kind === "ready"
            ? state.net == null
              ? { text: "—", cls: "text-white/40" }
              : { text: fmtSignedPct(state.net), cls: state.net > 0 ? "text-aeras-positive" : "text-aeras-warning" }
            : state.kind === "unavailable"
              ? { text: "off", cls: "text-white/35" }
              : { text: "soon", cls: "text-white/35" };
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(t.id)}
            title={state.kind === "unavailable" ? state.reason : state.kind === "planned" ? "Not yet available" : undefined}
            className={`${GLASS_SURFACE} flex flex-col gap-3 p-4 text-left transition-colors ${
              active ? "border-white/40 bg-white/[0.10]" : "hover:border-white/20 hover:bg-white/[0.08]"
            } ${ready ? "" : "opacity-60"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
                  Tier {t.rank}
                </div>
                <div className="mt-0.5 text-sm font-medium tracking-tight text-white">{t.name}</div>
              </div>
              <div className={`font-mono text-xl font-light tabular-nums ${figure.cls}`}>
                {figure.text}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <ExposureStrip from={assetMark(row.xstock)} to={tierMarks(t, state)} size={24} max={6} />
              <span className="truncate text-[11px] text-white/45">
                {state.kind === "ready" ? state.option.label : t.holds}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
