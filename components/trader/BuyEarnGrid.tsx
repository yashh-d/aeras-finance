"use client";

// Trader mode, Buy + Earn. One card per asset with a borrow market, headlined
// by the net rate on the money put in: the Buy + Earn figure the Strategies
// page and the asset strips show, from the same hook, at the same default
// ratio. Opening a card mounts the existing Buy + Earn ticket beside the
// position it opened. See docs/trader-mode-plan.md, D4 and D5.

import { useMemo, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import { EarnTicket } from "@/components/strategies/EarnTicket";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { AccountBalances } from "@/lib/solana/balances";
import { defaultBorrowRatio, earnNetApy } from "@/lib/strategies/math";
import { useStrategyRates, type StrategyRates, type StrategyRatesState } from "@/lib/strategies/rates";
import {
  pickRun,
  useStrategyRuns,
  type StrategyRun,
  type StrategyRunsStore,
} from "@/lib/strategies/runs-client";
import { formatUsdPrice } from "@/lib/format";

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

type Sort = "net" | "borrow" | "name";

const SORTS: readonly { id: Sort; label: string }[] = [
  { id: "net", label: "Best net rate" },
  { id: "borrow", label: "Cheapest to borrow" },
  { id: "name", label: "A to Z" },
];

// The card's headline: net APY on equity at the route's default ratio.
export function buyEarnNet(row: StrategyRates, earnApy: number | null): number | null {
  if (earnApy == null || row.borrowApr == null) return null;
  return earnNetApy({
    borrowRatio: defaultBorrowRatio(row.route),
    earnApy,
    borrowApr: row.borrowApr,
    collateralSupplyApy: row.collateralSupplyApy,
  });
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
  const [sort, setSort] = useState<Sort>("net");

  const earnApy = rates.defaultEarn?.apy ?? null;

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = rates.rows.filter(
      (r) =>
        q === "" ||
        r.xstock.symbol.toLowerCase().includes(q) ||
        r.xstock.name.toLowerCase().includes(q) ||
        r.route.venueLabel.toLowerCase().includes(q),
    );
    const net = (r: StrategyRates) => buyEarnNet(r, earnApy);
    return [...rows].sort((a, b) => {
      if (sort === "name") return a.xstock.name.localeCompare(b.xstock.name);
      if (sort === "borrow") return (a.borrowApr ?? Infinity) - (b.borrowApr ?? Infinity);
      return (net(b) ?? -Infinity) - (net(a) ?? -Infinity);
    });
  }, [rates.rows, query, sort, earnApy]);

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
        title="Buy a stock. Let the loan earn."
        aside={<SearchBox value={query} onChange={setQuery} placeholder="Search assets" />}
      >
        Buy a tokenized stock, borrow USDC against it, and put the loan where it
        earns more than it costs. The stock stays yours; the spread is the
        yield.
        {rates.defaultEarn && (
          <>
            {" "}
            Borrowed USDC earns {fmtPct(rates.defaultEarn.apy)} in{" "}
            {rates.defaultEarn.label} right now.
          </>
        )}
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
              earnApy={earnApy}
              earnLabel={rates.defaultEarn?.label ?? null}
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
        liquidated if the price falls past the venue&apos;s threshold.
      </p>
    </div>
  );
}

function AssetCard({
  row,
  earnApy,
  earnLabel,
  price,
  change,
  saved,
  onOpen,
}: {
  row: StrategyRates;
  earnApy: number | null;
  earnLabel: string | null;
  price: number | null;
  change: number | null;
  saved: StrategyRun | null;
  onOpen: () => void;
}) {
  const { xstock, route } = row;
  const net = buyEarnNet(row, earnApy);
  const ratio = defaultBorrowRatio(route);
  const positive = change == null ? null : change >= 0;
  return (
    <GridCard onClick={onOpen} muted={net != null && net <= 0}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AssetLogo xstock={xstock} size={36} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium tracking-tight text-white">
              {xstock.name}
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
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {saved ? (
            <Pill tone={saved.status === "running" ? "warn" : "positive"}>
              {saved.status === "running" ? "Resume" : "Open"}
            </Pill>
          ) : (
            <Pill>{route.venueLabel}</Pill>
          )}
        </div>
      </div>

      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-white/50">
        {xstock.symbol} <span className="text-white/25">→</span> USDC{" "}
        <span className="text-white/25">→</span> {earnLabel ?? "USDC vault"}
      </div>

      <div className="mt-auto flex items-end justify-between gap-4 border-t border-white/[0.06] pt-4">
        <BigFigure
          label="Net on what you put in"
          value={net == null ? "—" : fmtSignedPct(net)}
          tone={net == null ? "muted" : net > 0 ? "positive" : "warn"}
          sub={
            row.borrowApr != null && earnApy != null
              ? `borrow ${fmtPct(row.borrowApr)}, earn ${fmtPct(earnApy)}`
              : "reading rates"
          }
        />
        <SmallFigure label="Borrows" value={`${Math.round(ratio * 100)}% of value`} />
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px] text-white/40">
        <span>
          Borrow up to {Math.round(route.collateralFactor * 100)}% on {route.venueLabel}
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
            <div className="text-lg font-light tracking-tight text-white">{xstock.name}</div>
            <div className="flex items-center gap-2 text-xs text-white/50">
              <span>{xstock.symbol}</span>
              <Pill>{route.venueLabel}</Pill>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <SmallFigure label="Price" value={price == null ? "—" : `$${formatUsdPrice(price)}`} />
          <SmallFigure label="Borrow rate" value={fmtPct(row.borrowApr)} />
          <SmallFigure
            label="Max borrow"
            value={`${Math.round(route.collateralFactor * 100)}%`}
          />
        </div>
      </div>

      <DetailColumns
        left={
          <DetailCard title="Buy + Earn">
            <EarnTicket
              key={xstock.mint}
              row={row}
              earn={rates.defaultEarn}
              earnOptions={rates.earnOptions}
              walletAddress={walletAddress}
              balances={balances}
              prices={prices}
              store={store}
              saved={saved}
              onRefresh={settled}
            />
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
