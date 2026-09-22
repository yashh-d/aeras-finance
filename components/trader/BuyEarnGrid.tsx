"use client";

// Trader mode, Buy + Earn. "Buy Tesla, earn up to Y%": one card per asset
// with a borrow market, headlined by the best net rate the borrowed USDC can
// make across the three tiers in lib/trader/tiers.ts (a stock portfolio,
// staking, liquidity pools), at the SAFE MAXIMUM borrow ratio
// (docs/trader-mode-plan.md, D11 and D12). Opening a card shows the three
// tiers, priced, and the existing Buy + Earn ticket on the chosen one beside
// the position it opened. The five-venue picker Investor mode's ticket
// carries is not here: the vault destinations are plays.

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
import {
  bestTier,
  EARN_TIERS,
  tierState,
  type EarnTier,
  type TierId,
  type TierState,
} from "@/lib/trader/tiers";
import { GLASS_SURFACE } from "@/lib/ui/surface";

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
        Buy a tokenized stock and borrow as much USDC against it as the venue
        safely allows. The loan goes into one of three tiers: a stock
        portfolio, staking, or a liquidity pool. Each card&apos;s figure is the
        best tier&apos;s net rate on what you put in; open it to pick the tier.
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
        liquidated if the price falls past the venue&apos;s threshold, and
        every tier carries its own risk on top, stated on the tier.
      </p>
    </div>
  );
}

// The figure a tier shows on a card or in the picker: its net rate, or why
// there is none.
function tierFigure(s: TierState): { text: string; tone: "positive" | "warn" | "muted"; title?: string } {
  if (s.kind === "ready") {
    if (s.net == null) return { text: "—", tone: "muted" };
    return { text: fmtSignedPct(s.net), tone: s.net > 0 ? "positive" : "warn" };
  }
  if (s.kind === "unavailable") return { text: "off", tone: "muted", title: s.reason };
  return { text: "soon", tone: "muted", title: `${s.label}: not yet available` };
}

const TONE_TEXT = {
  positive: "text-aeras-positive",
  warn: "text-aeras-warning",
  muted: "text-white/35",
} as const;

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
  const { xstock, route } = row;
  const best = bestTier(row, rates.earnOptions);
  const ratio = maxBorrowRatio(route);
  const positive = change == null ? null : change >= 0;
  const states = EARN_TIERS.map((t) => [t, tierState(t, row, rates.earnOptions)] as const);
  return (
    <GridCard onClick={onOpen} muted={best != null && best.net <= 0}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AssetLogo xstock={xstock} size={36} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium tracking-tight text-white">
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
        {/* No venue pill: Trader mode names no lending venue (D13). The
            route still decides the rates and the signatures. */}
        {saved && (
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <Pill tone={saved.status === "running" ? "warn" : "positive"}>
              {saved.status === "running" ? "Resume" : "Open"}
            </Pill>
          </div>
        )}
      </div>

      <div className="flex items-end justify-between gap-4">
        <BigFigure
          label="Earn up to"
          value={best ? fmtSignedPct(best.net) : rates.loading ? "…" : "—"}
          tone={best ? (best.net > 0 ? "positive" : "warn") : "muted"}
          sub={
            best
              ? `in ${best.tier.name.toLowerCase()}, ${best.option.label}`
              : rates.loading
                ? "reading rates"
                : "no tier can run right now"
          }
        />
        <SmallFigure label="Borrows at max" value={`${Math.round(ratio * 100)}% of value`} />
      </div>

      {/* The three tiers, ranked, with what each would net. Planned slots
          say so rather than showing a number nothing backs. */}
      <div className="mt-auto space-y-1 border-t border-white/[0.06] pt-3">
        {states.map(([t, s]) => {
          const f = tierFigure(s);
          return (
            <div key={t.id} className="flex items-baseline justify-between gap-3 text-xs" title={f.title}>
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-white/30">{t.rank}</span>
                <span className="text-white/65">{t.name}</span>
              </span>
              <span className={`font-mono tabular-nums ${TONE_TEXT[f.tone]}`}>{f.text}</span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px] text-white/40">
        <span>
          Borrow up to {Math.round(route.collateralFactor * 100)}%
          {row.borrowApr != null && ` at ${fmtPct(row.borrowApr)}`}
        </span>
        <span className="text-white/60">{saved ? "Manage" : "Open"}</span>
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
  // Passing it keeps the ticket's own lookup honest: with the option absent
  // the close would fall back to the tier's venue and withdraw from the
  // wrong place.
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
          <AssetLogo xstock={xstock} size={40} />
          <div>
            <div className="text-lg font-light tracking-tight text-white">Buy {xstock.name}</div>
            <div className="text-xs text-white/50">{xstock.symbol}</div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <SmallFigure label="Price" value={price == null ? "—" : `$${formatUsdPrice(price)}`} />
          <SmallFigure label="Borrow rate" value={fmtPct(row.borrowApr)} />
          <SmallFigure label="Borrows at max" value={`${Math.round(maxBorrowRatio(route) * 100)}%`} />
          <BigFigure
            label="Earn up to"
            value={best ? fmtSignedPct(best.net) : "—"}
            tone={best ? (best.net > 0 ? "positive" : "warn") : "muted"}
            align="right"
          />
        </div>
      </div>

      <TierPicker row={row} rates={rates} selected={tierId} onSelect={setChosen} />

      <DetailColumns
        left={
          <DetailCard title={`Buy + Earn · ${tier.name}`}>
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
              <Note>
                {state.label} is not built yet. This tier will take the borrowed
                USDC once it is; the other two run today.
              </Note>
            ) : (
              <Note tone="warn">
                {state.kind === "unavailable" ? state.reason : "This tier cannot run right now."}
                {" "}Pick another tier above.
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

// The three tiers as a row of choices, each priced for this asset.
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
      {EARN_TIERS.map((t) => (
        <TierChoice
          key={t.id}
          tier={t}
          state={tierState(t, row, rates.earnOptions)}
          active={selected === t.id}
          onClick={() => onSelect(t.id)}
        />
      ))}
    </div>
  );
}

function TierChoice({
  tier,
  state,
  active,
  onClick,
}: {
  tier: EarnTier;
  state: TierState;
  active: boolean;
  onClick: () => void;
}) {
  const f = tierFigure(state);
  const ready = state.kind === "ready";
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${GLASS_SURFACE} flex flex-col gap-3 p-4 text-left transition-colors ${
        active ? "border-white/40 bg-white/[0.10]" : "hover:border-white/20 hover:bg-white/[0.08]"
      } ${ready ? "" : "opacity-70"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Tier {tier.rank}
          </div>
          <div className="mt-0.5 text-sm font-medium tracking-tight text-white">{tier.name}</div>
          <div className="text-[11px] text-white/50">
            {state.kind === "ready" ? state.option.label : tier.holds}
          </div>
        </div>
        <div className="text-right">
          <div className={`font-mono text-xl font-light tabular-nums ${TONE_TEXT[f.tone]}`}>
            {f.text}
          </div>
          {state.kind === "ready" && (
            <div className="text-[10px] text-white/40">pays {fmtPct(state.option.apy)}</div>
          )}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-white/55">{tier.summary}</p>
      <p className="text-[11px] leading-relaxed text-white/45">
        <span className="text-aeras-warning/90">Risk.</span> {tier.risk}
      </p>
      {state.kind !== "ready" && (
        <p className="text-[11px] text-white/45">
          {state.kind === "unavailable" ? state.reason : "Not yet available."}
        </p>
      )}
    </button>
  );
}
