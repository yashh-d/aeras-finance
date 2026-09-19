"use client";

// Buy + Earn. Buy the asset, post it, borrow USDC at the chosen ratio, put
// the USDC in the best USDC vault. Three signatures on Jupiter, four on
// Kamino, run as steps so a failure mid-way leaves the user looking at what
// landed rather than at a spinner that stopped.

import { useRef, useState } from "react";

import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { AccountBalances } from "@/lib/solana/balances";
import { healthAt, borrowLiquidationDrop } from "@/lib/borrow/route";
import {
  buyWithUsdc,
  depositAndBorrow,
  depositUsdcToEarn,
  type BuyResult,
} from "@/lib/strategies/execute";
import { defaultBorrowRatio, earnNetApy } from "@/lib/strategies/math";
import type { StrategyRates, UsdcEarnOption } from "@/lib/strategies/rates";
import { useStrategyRun, type StepDef } from "@/lib/strategies/run";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";

import {
  floorCents,
  fmtHealth,
  fmtPct,
  fmtSignedPct,
  fmtUsd,
  Note,
  PreviewBlock,
  PreviewRow,
  PRIMARY_BUTTON,
  RatioSlider,
  StepList,
  UsdcAmount,
} from "./shared";

const MIN_BUY_USD = 5;
const MIN_BORROW_USD = 1;

export function EarnTicket({
  row,
  earn,
  walletAddress,
  balances,
  prices,
  onRefresh,
}: {
  row: StrategyRates;
  earn: UsdcEarnOption | null;
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  const signTx = useSignSolanaTxBase64();
  const run = useStrategyRun();
  const [amountInput, setAmountInput] = useState("");
  const [ratio, setRatio] = useState(() => defaultBorrowRatio(row.route));

  // What the earlier steps produced, read by the later ones. Refs rather than
  // state because the step closures are built once at start and must see the
  // values the previous step wrote, not the render they were created in.
  const bought = useRef<BuyResult | null>(null);
  const borrowed = useRef<number>(0);

  const { xstock, route } = row;
  const price = prices?.[xstock.mint]?.usdPrice ?? null;
  const amountUsd = Number(amountInput);
  const amountValid =
    Number.isFinite(amountUsd) &&
    amountUsd >= MIN_BUY_USD &&
    balances != null &&
    amountUsd <= balances.usdc;
  const borrowUsd = amountValid ? floorCents(amountUsd * ratio) : null;
  const liquidityShort =
    borrowUsd != null && row.liquidityUsd != null && borrowUsd > row.liquidityUsd;

  const net =
    earn && row.borrowApr != null
      ? earnNetApy({
          borrowRatio: ratio,
          earnApy: earn.apy,
          borrowApr: row.borrowApr,
          collateralSupplyApy: row.collateralSupplyApy,
        })
      : null;
  const spread =
    earn && row.borrowApr != null ? earn.apy - row.borrowApr : null;
  const health = healthAt(route, ratio);
  const drop = borrowLiquidationDrop(route, ratio);

  const canStart =
    amountValid &&
    borrowUsd != null &&
    borrowUsd >= MIN_BORROW_USD &&
    !liquidityShort &&
    earn != null &&
    price != null &&
    !run.running &&
    run.steps.length === 0;

  async function handleStart() {
    if (!canStart || !earn || price == null || borrowUsd == null) return;
    bought.current = null;
    borrowed.current = 0;
    const usdcAtomic = BigInt(Math.round(amountUsd * 1_000_000));

    const steps: StepDef[] = [
      {
        id: "buy",
        label: `Buy ${xstock.symbol} with ${fmtUsd(amountUsd)}`,
        run: async () => {
          const r = await buyWithUsdc({ walletAddress, xstock, usdcAtomic, signTx });
          bought.current = r;
          return { signatures: [r.signature] };
        },
      },
      {
        id: "collateral",
        label:
          route.venue === "jupiter"
            ? `Deposit ${xstock.symbol} and borrow USDC on ${route.venueLabel}`
            : `Deposit ${xstock.symbol} on Kamino, then borrow USDC`,
        run: async (report) => {
          const b = bought.current;
          if (!b) throw new Error("The buy has not landed yet.");
          // Sized off what the wallet actually gained, at the current price,
          // capped by what the venue can still lend.
          let borrow = floorCents(b.boughtUi * price! * ratio);
          if (row.liquidityUsd != null) borrow = Math.min(borrow, floorCents(row.liquidityUsd));
          if (borrow < MIN_BORROW_USD) {
            throw new Error("The borrow would be under $1. Increase the amount or the ratio.");
          }
          borrowed.current = borrow;
          const r = await depositAndBorrow({
            route,
            walletAddress,
            collateralAtomic: b.boughtAtomic,
            borrowUsdc: borrow,
            signTx,
            onProgress: report,
          });
          return { signatures: r.signatures };
        },
      },
      {
        id: "earn",
        label: `Deposit the borrowed USDC into ${earn.label}`,
        run: async () => {
          if (borrowed.current <= 0) throw new Error("Nothing was borrowed.");
          const r = await depositUsdcToEarn({
            option: earn,
            walletAddress,
            amountUsdc: borrowed.current,
            signTx,
          });
          return { signatures: [r.signature] };
        },
      },
    ];

    const ok = await run.start(steps);
    if (ok) await onRefresh();
  }

  return (
    <div className="space-y-4">
      <UsdcAmount
        value={amountInput}
        onChange={(v) => {
          setAmountInput(v);
          if (run.finished || run.failedAt != null) run.reset();
        }}
        balanceUsdc={balances?.usdc ?? null}
        autoFocus
      />

      <RatioSlider
        route={route}
        value={ratio}
        onChange={setRatio}
        disabled={run.running}
      />

      {spread != null && spread <= 0 && (
        <Note tone="warn">
          Borrowing costs more than the vault pays right now:{" "}
          {fmtPct(row.borrowApr)} to borrow, {fmtPct(earn?.apy)} to earn. The
          strategy loses money at these rates. It stays available in case
          you want the position anyway.
        </Note>
      )}

      <PreviewBlock>
        <PreviewRow label="Buys" value={amountValid ? `${fmtUsd(amountUsd)} of ${xstock.symbol}` : "—"} />
        <PreviewRow
          label={`Borrows on ${route.venueLabel}`}
          value={borrowUsd != null ? `${fmtUsd(borrowUsd)} USDC at ${fmtPct(row.borrowApr)}` : "—"}
          warn={liquidityShort}
        />
        <PreviewRow
          label={`Earns in ${earn?.label ?? "the best USDC vault"}`}
          value={earn ? fmtPct(earn.apy) : "—"}
        />
        {row.collateralSupplyApy > 0 && (
          <PreviewRow label={`${xstock.symbol} supply rate`} value={fmtPct(row.collateralSupplyApy)} />
        )}
        <PreviewRow
          label="Net on what you put in"
          value={net != null ? fmtSignedPct(net) : "—"}
          warn={net != null && net < 0}
        />
        <PreviewRow
          label="Per year at these rates"
          value={net != null && amountValid ? fmtUsd(amountUsd * net) : "—"}
          muted
        />
        <PreviewRow label="Health" value={fmtHealth(health)} />
        <PreviewRow
          label="Liquidation if the price drops"
          value={drop != null ? `−${(drop * 100).toFixed(0)}%` : "—"}
        />
        <PreviewRow
          label="Signatures"
          value={route.venue === "jupiter" ? "3" : "4"}
          muted
        />
      </PreviewBlock>

      {liquidityShort && (
        <Note tone="warn">
          {route.venueLabel} only has {fmtUsd(row.liquidityUsd)} left to lend.
          Lower the amount or the ratio.
        </Note>
      )}

      <StepList run={run} />

      {run.finished ? (
        <Note>
          Done. The position is on the Borrow tab and the USDC on the Earn tab.
        </Note>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          className={PRIMARY_BUTTON}
        >
          {run.running
            ? "Working…"
            : run.failedAt != null
              ? "Retry the failed step above"
              : amountInput === ""
                ? "Enter an amount"
                : !amountValid
                  ? amountUsd < MIN_BUY_USD
                    ? `Minimum ${fmtUsd(MIN_BUY_USD)}`
                    : "Not enough USDC"
                  : `Buy and earn ${net != null ? fmtSignedPct(net) : ""}`}
        </button>
      )}
    </div>
  );
}
