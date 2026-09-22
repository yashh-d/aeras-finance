"use client";

// "Your position", the right column of a Trader detail view for a strategy.
// Reads the saved run for this strategy on this asset (the record the ticket
// writes after every step) and the live borrow position at the venue, and
// says what the user holds, owes, earns and how far the price can fall.
//
// Display only. Nothing here sizes a transaction: the Close action stays on
// the ticket, which re-reads the chain before every leg.

import { useEffect, useState } from "react";

import { healthAt, borrowLiquidationDrop } from "@/lib/borrow/route";
import { fromAtomicBN } from "@/lib/jupiter/borrow";
import {
  readJupiterPosition,
  readKaminoPosition,
} from "@/lib/strategies/execute";
import { earnNetApy } from "@/lib/strategies/math";
import type { StrategyRates, UsdcEarnOption } from "@/lib/strategies/rates";
import { STRATEGY_NAME, type StrategyRun } from "@/lib/strategies/runs-client";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { assetMark, destinationMarks, USDC_MARK, type Mark } from "@/lib/trader/exposures";
import { INSET_PANEL } from "@/lib/ui/surface";

import { AssetLogo } from "@/components/AssetLogo";

import { DetailCard, fmtPct, fmtSignedPct, fmtUsd } from "./shared";

interface LivePosition {
  collateralUi: number;
  debtUsd: number;
}

// The venue's own record of what is posted and owed against this asset.
// Polled slowly: it moves only when the user signs something, and the ticket
// refreshes the page after it does.
function useLivePosition(row: StrategyRates, walletAddress: string, tick: unknown) {
  const [live, setLive] = useState<LivePosition | null | undefined>(undefined);
  const { route } = row;
  const mint = row.xstock.mint;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (route.vault) {
          const vault = route.vault;
          const p = await readJupiterPosition(walletAddress, vault);
          if (cancelled) return;
          if (!p) {
            setLive(null);
            return;
          }
          setLive({
            collateralUi: fromAtomicBN(p.collateralAtomic, vault.collateralDecimals),
            debtUsd: fromAtomicBN(p.debtAtomic, vault.borrowDecimals),
          });
        } else {
          const p = await readKaminoPosition(walletAddress);
          if (cancelled) return;
          if (!p) {
            setLive(null);
            return;
          }
          // Kamino's obligation reader reports one collateral. The amount is
          // taken only when it is this asset; the debt is the obligation's.
          setLive({
            collateralUi: p.collateral.collateralMint === mint ? p.collateralUi : 0,
            debtUsd: p.debtUsdc,
          });
        }
      } catch {
        if (!cancelled) setLive(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `tick` is the caller's refresh signal.
  }, [walletAddress, route.vault, mint, tick]);
  return live;
}

export function PositionSummary({
  row,
  walletAddress,
  prices,
  saved,
  earnOptions,
  refreshKey,
}: {
  row: StrategyRates;
  walletAddress: string;
  prices: JupiterPriceMap | null;
  saved: StrategyRun | null;
  earnOptions: UsdcEarnOption[];
  // Change it to re-read the venue.
  refreshKey?: unknown;
}) {
  const live = useLivePosition(row, walletAddress, refreshKey);
  const { xstock, route } = row;
  const price = prices?.[xstock.mint]?.usdPrice ?? null;

  const collateralUi = live?.collateralUi ?? 0;
  const debtUsd = live?.debtUsd ?? 0;
  const collateralUsd = price != null ? collateralUi * price : null;
  const ratio =
    collateralUsd != null && collateralUsd > 0 ? debtUsd / collateralUsd : null;
  const health = ratio != null ? healthAt(route, ratio) : null;
  const drop = ratio != null ? borrowLiquidationDrop(route, ratio) : null;

  const earnData = saved?.data.kind === "earn" ? saved.data : null;
  const option = earnData
    ? (earnOptions.find((o) => o.venue === earnData.earnVenue) ?? null)
    : null;
  const net =
    earnData && option && row.borrowApr != null && ratio != null
      ? earnNetApy({
          borrowRatio: ratio,
          earnApy: option.apy,
          borrowApr: row.borrowApr,
          collateralSupplyApy: row.collateralSupplyApy,
        })
      : null;

  const healthTone =
    health == null || !Number.isFinite(health)
      ? "text-white"
      : health < 1.1
        ? "text-aeras-negative"
        : health < 1.5
          ? "text-aeras-warning"
          : "text-white";

  const nothing = live === null && !saved;

  return (
    <DetailCard title="Your position">
      {live === undefined && !saved ? (
        <p className="text-sm text-white/45">Reading the position…</p>
      ) : nothing ? (
        <div className="space-y-2">
          <p className="text-sm text-white/60">No position on {xstock.symbol} yet.</p>
          <p className="text-xs text-white/40">
            Enter an amount on the left. The preview prices the whole run before
            anything signs.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {saved && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/70">
                {STRATEGY_NAME[saved.strategy]}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
                  saved.status === "running"
                    ? "bg-aeras-warning/20 text-aeras-warning"
                    : "bg-aeras-positive/15 text-aeras-positive"
                }`}
              >
                {saved.status === "running" ? "Part way through" : "Open"}
              </span>
              <span className="text-[11px] text-white/40">
                since {new Date(saved.openedAt).toLocaleDateString()}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Figure
              label={`${xstock.symbol} posted`}
              value={collateralUi > 0 ? collateralUi.toFixed(4) : "—"}
              sub={collateralUsd != null && collateralUsd > 0 ? fmtUsd(collateralUsd) : undefined}
              marks={[assetMark(xstock)]}
            />
            <Figure
              label="Owed"
              value={debtUsd > 0 ? fmtUsd(debtUsd) : "—"}
              sub={row.borrowApr != null ? `${fmtPct(row.borrowApr)} a year` : undefined}
              marks={[USDC_MARK]}
            />
            <Figure
              label="Health"
              value={health == null ? "—" : Number.isFinite(health) ? health.toFixed(2) : "∞"}
              className={healthTone}
            />
            <Figure
              label="Liquidation if price drops"
              value={drop == null ? "—" : `−${(drop * 100).toFixed(0)}%`}
              sub={
                price != null && drop != null
                  ? `below ${fmtUsd(price * (1 - drop))}`
                  : undefined
              }
            />
          </div>

          {earnData && (
            <div className={`${INSET_PANEL} space-y-2 px-3 py-3 text-xs`}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
                  The loan is earning
                </div>
                <MarkStack marks={destinationMarks(earnData.earnVenue)} />
              </div>
              <Row label="In" value={option?.label ?? earnData.earnLabel} />
              <Row label="Deposited" value={fmtUsd(earnData.borrowedUsd)} />
              <Row label="Rate there" value={option ? fmtPct(option.apy) : "—"} />
              <Row
                label="Net on what you put in"
                value={net == null ? "—" : fmtSignedPct(net)}
                tone={net == null ? "muted" : net > 0 ? "positive" : "warn"}
              />
              <Row label="Put in" value={fmtUsd(earnData.amountUsd)} muted />
            </div>
          )}

          {saved?.data.kind === "leverage" && (
            <div className={`${INSET_PANEL} space-y-2 px-3 py-3 text-xs`}>
              <Row label="Put in" value={fmtUsd(saved.data.equityUsd)} />
              <Row label="Leverage" value={`${saved.data.leverage.toFixed(1)}×`} />
              <Row label="Borrowed" value={fmtUsd(saved.data.borrowUsd)} />
            </div>
          )}

          {saved?.data.kind === "ladder" && (
            <div className={`${INSET_PANEL} space-y-2 px-3 py-3 text-xs`}>
              <Row label="Put in" value={fmtUsd(saved.data.equityUsd)} />
              <Row label="Rounds" value={String(saved.data.rounds.length)} />
              <Row
                label="Borrowed in total"
                value={fmtUsd(saved.data.rounds.reduce((s, r) => s + r.borrowedUsd, 0))}
              />
            </div>
          )}

          <p className="text-[11px] text-white/40">
            Closing is on the left. It reads the venue again before every leg.
          </p>
        </div>
      )}
    </DetailCard>
  );
}

function Figure({
  label,
  value,
  sub,
  className,
  marks,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
  // What the figure is denominated in, as marks in the corner.
  marks?: Mark[];
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] text-white/50">{label}</div>
        {marks && marks.length > 0 && <MarkStack marks={marks} size={18} />}
      </div>
      <div className={`mt-0.5 font-mono text-sm tabular-nums ${className ?? "text-white"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-white/40">{sub}</div>}
    </div>
  );
}

// A few marks overlapping, for a corner.
function MarkStack({ marks, size = 20, max = 4 }: { marks: Mark[]; size?: number; max?: number }) {
  const shown = marks.slice(0, max);
  const rest = marks.length - shown.length;
  return (
    <div className="flex shrink-0 items-center">
      {shown.map((m, i) => (
        <span
          key={m.key}
          title={m.name}
          className="rounded-full ring-2 ring-[#0d0f11]"
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.3) }}
        >
          <AssetLogo xstock={m} size={size} />
        </span>
      ))}
      {rest > 0 && <span className="ml-1 font-mono text-[10px] text-white/40">+{rest}</span>}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: "positive" | "warn" | "muted";
  muted?: boolean;
}) {
  const cls =
    tone === "positive"
      ? "text-aeras-positive"
      : tone === "warn"
        ? "text-aeras-warning"
        : tone === "muted" || muted
          ? "text-white/60"
          : "text-white";
  return (
    <div className="flex justify-between gap-3">
      <span className="text-white/50">{label}</span>
      <span className={`font-mono tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}
