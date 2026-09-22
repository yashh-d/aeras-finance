"use client";

// Buy + Earn, in one click. Buy the asset, post it, borrow USDC at the chosen
// ratio, put the USDC to work. The base case sends it to the Hyperithm USDC
// Apex vault on Monad through the same Trustware funding the Earn tab uses
// (Solana USDC to Monad USDC, a MON gas top-up if the wallet has none, then
// the ERC-4626 deposit). Jupiter Lend Earn and Kamino's USDC vault are the
// alternatives that stay on Solana. Every signature is silent
// (showWalletUIs is off in lib/privy/provider.tsx), so the one press runs the
// whole chain; the steps are shown as they land so a failure mid-way leaves
// the user looking at what happened rather than at a spinner that stopped.
//
// The run is saved after every step. A saved run that is still going comes
// back as a resume prompt; a finished one comes back with its close path:
// take the USDC out of the vault, repay, withdraw the asset.

import { useCallback, useEffect, useRef, useState } from "react";

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { AccountBalances } from "@/lib/solana/balances";
import { healthAt, borrowLiquidationDrop } from "@/lib/borrow/route";
import {
  buyWithUsdc,
  depositAndBorrow,
  depositUsdcToEarn,
  readAtaBalanceAtomic,
  readJupiterPosition,
  readKaminoPosition,
  repayAndWithdraw,
  tokenProgramFor,
  withdrawUsdcFromEarn,
  type BuyResult,
  type MonadSigners,
} from "@/lib/strategies/execute";
import { defaultBorrowRatio, earnNetApy } from "@/lib/strategies/math";
import type { StrategyRates, UsdcEarnOption } from "@/lib/strategies/rates";
import { useStrategyRun, type StepDef } from "@/lib/strategies/run";
import {
  newRunId,
  type EarnRunData,
  type StrategyRun,
  type StrategyRunsStore,
} from "@/lib/strategies/runs-client";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64, useSignSolanaTxBase64 } from "@/lib/privy/sign";

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
  SECONDARY_BUTTON,
  StepList,
  UsdcAmount,
} from "./shared";

const MIN_BUY_USD = 5;
const MIN_BORROW_USD = 1;
// Interest on the loan, covered by withdrawing a little more than was
// borrowed. The venue returns any excess.
const CLOSE_REPAY_PAD = 1.01;

export function EarnTicket({
  row,
  earn: defaultEarn,
  earnOptions,
  walletAddress,
  balances,
  prices,
  store,
  saved,
  onRefresh,
}: {
  row: StrategyRates;
  // The base case: the Hyperithm vault on Monad when its rate is known.
  earn: UsdcEarnOption | null;
  // Every earn venue, for the picker and so a saved run can name the one it
  // used even if it is no longer the default.
  earnOptions: UsdcEarnOption[];
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  store: StrategyRunsStore;
  // A run of this strategy on this asset, still going or finished.
  saved: StrategyRun | null;
  onRefresh: () => Promise<void> | void;
}) {
  const signTx = useSignSolanaTxBase64();
  const solanaSignAndSend = useSendSolanaTxBase64();
  const evm = useEmbeddedEvmWallet();
  const run = useStrategyRun();
  const savedData = saved?.data.kind === "earn" ? saved.data : null;
  const [amountInput, setAmountInput] = useState("");
  const [ratio, setRatio] = useState(() => defaultBorrowRatio(row.route));
  // Where the borrowed USDC goes. Starts on the base case and follows it
  // until the user picks another venue.
  const [venue, setVenue] = useState<UsdcEarnOption["venue"] | null>(null);
  const earn =
    (venue ? earnOptions.find((o) => o.venue === venue) : null) ?? defaultEarn;
  // The Monad legs need the embedded EVM wallet. Undefined until Privy has
  // provisioned it, which the ticket waits for before it will start.
  const monad: MonadSigners | undefined =
    evm.address
      ? {
          evm: { address: evm.address, switchChain: evm.switchChain, getProvider: evm.getProvider },
          solanaSignAndSend,
        }
      : undefined;
  // Which run the step list belongs to, and its data as it accumulates.
  const runId = useRef<string | null>(null);
  const data = useRef<EarnRunData | null>(null);
  const bought = useRef<BuyResult | null>(null);
  const [mode, setMode] = useState<"open" | "close">("open");

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
  const spread = earn && row.borrowApr != null ? earn.apy - row.borrowApr : null;
  const health = healthAt(route, ratio);
  const drop = borrowLiquidationDrop(route, ratio);

  // Persist the step list whenever it changes, alongside the data so far.
  const { save } = store;
  useEffect(() => {
    // Never while closing: a close that fails part way must leave the saved
    // record as it was (a finished open), not as an interrupted run whose
    // Resume would rebuild and re-send the OPEN steps. Close is retried by
    // pressing Close again; each of its legs re-reads the chain first.
    if (mode === "close") return;
    if (!runId.current || !data.current || run.steps.length === 0) return;
    save({
      id: runId.current,
      strategy: "earn",
      mint: xstock.mint,
      status: run.finished && mode === "open" ? "done" : "running",
      steps: run.steps.map(({ id, label, status, signatures }) => ({ id, label, status, signatures })),
      data: data.current,
      openedAt: saved?.id === runId.current ? saved.openedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // `saved` is the record this run came from; re-saving on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.steps, run.finished, mode, save, xstock.mint]);

  const optionFor = useCallback(
    (d: EarnRunData): UsdcEarnOption | null =>
      earnOptions.find((o) => o.venue === d.earnVenue) ?? earn,
    [earnOptions, earn],
  );
  // Both Monad venues need the embedded EVM wallet and the Trustware leg.
  const needsMonad = (o: UsdcEarnOption | null) =>
    o?.venue === "morpho" || o?.venue === "shmonad";

  // The three opening steps, from data that may be fresh or restored.
  function openSteps(d: EarnRunData, option: UsdcEarnOption): StepDef[] {
    const usdcAtomic = BigInt(Math.round(d.amountUsd * 1_000_000));
    const programId = tokenProgramFor(xstock);
    const px = price;
    return [
      {
        id: "buy",
        label: `Buy ${xstock.symbol} with ${fmtUsd(d.amountUsd)}`,
        run: async (report) => {
          const before = await readAtaBalanceAtomic({ mint: xstock.mint, owner: walletAddress, programId });
          d.bought = { beforeAtomic: before.toString() };
          // Reporting patches the step, which saves the run with the balance
          // just read. That is what lets a resume tell whether the order
          // below landed while the page was away.
          report("Placing the order");
          const r = await buyWithUsdc({ walletAddress, xstock, usdcAtomic, signTx });
          bought.current = r;
          d.bought = {
            beforeAtomic: before.toString(),
            boughtAtomic: r.boughtAtomic.toString(),
            boughtUi: r.boughtUi,
            signature: r.signature,
          };
          return { signatures: [r.signature] };
        },
        // An interrupted buy landed if the wallet holds more than it did.
        reconcile: async () => {
          if (!d.bought) return false;
          const now = await readAtaBalanceAtomic({ mint: xstock.mint, owner: walletAddress, programId });
          const gained = now - BigInt(d.bought.beforeAtomic);
          if (gained <= 0n) return false;
          const r: BuyResult = {
            signature: d.bought.signature ?? "",
            boughtAtomic: gained,
            boughtUi: Number(gained) / 10 ** xstock.decimals,
            outUsdValue: d.amountUsd,
          };
          bought.current = r;
          d.bought = { ...d.bought, boughtAtomic: gained.toString(), boughtUi: r.boughtUi };
          return true;
        },
      },
      {
        id: "collateral",
        label:
          route.venue === "jupiter"
            ? `Deposit ${xstock.symbol} and borrow USDC on ${route.venueLabel}`
            : `Deposit ${xstock.symbol} on Kamino, then borrow USDC`,
        run: async (report) => {
          const b = bought.current ?? restoredBuy(d);
          if (!b) throw new Error("The buy has not landed yet.");
          if (px == null) throw new Error("No price for the asset right now.");
          let borrow = floorCents(b.boughtUi * px * d.ratio);
          if (row.liquidityUsd != null) borrow = Math.min(borrow, floorCents(row.liquidityUsd));
          if (borrow < MIN_BORROW_USD) {
            throw new Error("The borrow would be under $1. Increase the amount or the ratio.");
          }
          d.borrowedUsd = borrow;
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
        // Landed if the asset has left the wallet and the venue shows debt.
        reconcile: async () => {
          const b = restoredBuy(d);
          if (!b) return false;
          const now = await readAtaBalanceAtomic({ mint: xstock.mint, owner: walletAddress, programId });
          if (now >= BigInt(d.bought!.beforeAtomic) + b.boughtAtomic) return false;
          if (route.vault) {
            const p = await readJupiterPosition(walletAddress, route.vault);
            if (!p || p.debtAtomic.isZero()) return false;
          } else {
            const p = await readKaminoPosition(walletAddress);
            if (!p || p.debtUsdc <= 0) return false;
          }
          d.borrowedUsd ??= floorCents(b.boughtUi * (px ?? 0) * d.ratio);
          return true;
        },
      },
      {
        id: "earn",
        label:
          option.venue === "morpho"
            ? `Move the borrowed USDC to Monad and deposit it into ${option.morphoVault?.name ?? option.label}`
            : option.venue === "shmonad"
              ? "Move the borrowed USDC to Monad as MON and stake it in shMON"
              : `Deposit the borrowed USDC into ${option.label}`,
        run: async (report) => {
          if (!d.borrowedUsd || d.borrowedUsd <= 0) throw new Error("Nothing was borrowed.");
          const r = await depositUsdcToEarn({
            option,
            walletAddress,
            amountUsdc: d.borrowedUsd,
            signTx,
            monad,
            onProgress: report,
          });
          // A Monad deposit ends in an EVM hash, which Solscan cannot show.
          return { signatures: needsMonad(option) ? [] : [r.signature] };
        },
        // Landed if the borrowed USDC is no longer sitting in the wallet.
        reconcile: async () => {
          if (!d.borrowedUsd) return false;
          const usdc =
            Number(
              await readAtaBalanceAtomic({
                mint: USDC_MINT,
                owner: walletAddress,
                programId: TOKEN_PROGRAM_ID,
              }),
            ) / 10 ** USDC_DECIMALS;
          return usdc < d.borrowedUsd * 0.5;
        },
      },
    ];
  }

  function restoredBuy(d: EarnRunData): BuyResult | null {
    if (!d.bought?.boughtAtomic || d.bought.boughtUi == null) return null;
    return {
      signature: d.bought.signature ?? "",
      boughtAtomic: BigInt(d.bought.boughtAtomic),
      boughtUi: d.bought.boughtUi,
      outUsdValue: d.amountUsd,
    };
  }

  const canStart =
    amountValid &&
    borrowUsd != null &&
    borrowUsd >= MIN_BORROW_USD &&
    !liquidityShort &&
    earn != null &&
    (!needsMonad(earn) || monad != null) &&
    price != null &&
    !run.running &&
    run.steps.length === 0 &&
    saved == null;

  async function handleStart() {
    if (!canStart || !earn) return;
    bought.current = null;
    runId.current = newRunId();
    data.current = {
      kind: "earn",
      amountUsd,
      ratio,
      earnVenue: earn.venue,
      earnLabel: earn.label,
    };
    const ok = await run.start(openSteps(data.current, earn));
    if (ok) await onRefresh();
  }

  async function handleResume() {
    if (!saved || !savedData) return;
    const option = optionFor(savedData);
    if (!option) return;
    runId.current = saved.id;
    data.current = { ...savedData };
    bought.current = restoredBuy(data.current);
    setRatio(savedData.ratio);
    const ok = await run.resume(openSteps(data.current, option), saved.steps);
    if (ok) await onRefresh();
  }

  // Close: pull enough USDC from the vault to clear the loan, repay it, take
  // the asset back. The asset stays in the wallet; nothing is sold.
  async function handleClose() {
    if (!saved || !savedData) return;
    const option = optionFor(savedData);
    if (!option) return;
    setMode("close");
    runId.current = saved.id;
    data.current = { ...savedData };
    const borrowed = savedData.borrowedUsd ?? 0;
    const steps: StepDef[] = [
      {
        id: "earn-withdraw",
        label:
          option.venue === "morpho"
            ? `Withdraw the USDC from ${option.morphoVault?.name ?? option.label} and bring it back to Solana`
            : option.venue === "shmonad"
              ? "Unstake from shMON instantly and bring the MON back to Solana as USDC"
              : `Withdraw the USDC from ${option.label}`,
        run: async (report) => {
          const held = balances?.usdc ?? 0;
          // Whatever the wallet does not already cover, up to the whole
          // position: a debt that has grown past the deposit takes the
          // yield too. The Monad leg home costs about 0.3%, so it asks for
          // a little more than the loan; shMON's instant exit adds up to
          // another 1%.
          const homePad =
            option.venue === "morpho" ? 1.01 : option.venue === "shmonad" ? 1.02 : 1;
          const need = Math.max(0, borrowed * CLOSE_REPAY_PAD * homePad - held);
          const r = await withdrawUsdcFromEarn({
            option,
            walletAddress,
            amountUsdc: Math.max(need, 0.01),
            signTx,
            monad,
            onProgress: report,
          });
          return { signatures: r.signature ? [r.signature] : [] };
        },
      },
      {
        id: "repay",
        label:
          route.venue === "jupiter"
            ? `Repay the loan and withdraw ${xstock.symbol} from ${route.venueLabel}`
            : `Repay on Kamino, then withdraw ${xstock.symbol}`,
        run: async (report) => {
          const r = await repayAndWithdraw({
            route,
            walletAddress,
            repay: { kind: "all" },
            withdraw: { kind: "all" },
            signTx,
            onProgress: report,
          });
          return { signatures: r.signatures };
        },
      },
    ];
    const ok = await run.start(steps);
    if (ok) {
      store.remove(saved.id);
      runId.current = null;
      data.current = null;
      await onRefresh();
    }
  }

  // ── Saved run views ────────────────────────────────────────────────────────

  if (saved && savedData && run.steps.length === 0) {
    const option = optionFor(savedData);
    if (saved.status === "running") {
      const doneCount = saved.steps.filter((s) => s.status === "done").length;
      return (
        <div className="space-y-4">
          <Note>
            A Buy + Earn on {xstock.symbol} for {fmtUsd(savedData.amountUsd)} is
            part way through: {doneCount} of {saved.steps.length} steps landed.
            Resume checks the chain for anything that landed while the page was
            away before it sends the next step.
          </Note>
          <PreviewBlock>
            {saved.steps.map((s) => (
              <PreviewRow key={s.id} label={s.label} value={s.status} muted={s.status !== "done"} />
            ))}
          </PreviewBlock>
          <div className="flex gap-2">
            <button type="button" onClick={handleResume} className={PRIMARY_BUTTON}>
              Resume
            </button>
            <button
              type="button"
              onClick={() => store.remove(saved.id)}
              className={SECONDARY_BUTTON}
              title="Forget this run. Positions already opened stay on the Borrow and Earn tabs."
            >
              Discard
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <PreviewBlock>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Open Buy + Earn on {xstock.symbol}
          </div>
          <PreviewRow label="Put in" value={fmtUsd(savedData.amountUsd)} />
          <PreviewRow label={`Holding ${xstock.symbol}`} value={savedData.bought?.boughtUi != null ? savedData.bought.boughtUi.toFixed(4) : "—"} />
          <PreviewRow label={`Borrowed on ${route.venueLabel}`} value={fmtUsd(savedData.borrowedUsd)} />
          <PreviewRow label="Earning in" value={option?.label ?? savedData.earnLabel} />
          <PreviewRow label="Opened" value={new Date(saved.openedAt).toLocaleDateString()} muted />
        </PreviewBlock>
        <Note>
          Closing withdraws enough USDC from the vault to clear the loan, repays
          it, and returns the {xstock.symbol} to the wallet. Nothing is sold.
          Interest and the vault&apos;s own yield are read live at that moment.
        </Note>
        <div className="flex gap-2">
          <button type="button" onClick={handleClose} className={PRIMARY_BUTTON}>
            Close and keep the {xstock.symbol}
          </button>
          <button
            type="button"
            onClick={() => store.remove(saved.id)}
            className={SECONDARY_BUTTON}
            title="Forget this run without touching the positions."
          >
            Forget
          </button>
        </div>
      </div>
    );
  }

  // ── Close in progress ──────────────────────────────────────────────────────

  if (mode === "close") {
    return (
      <div className="space-y-4">
        <StepList run={run} />
        {run.finished && (
          <Note>Closed. The {xstock.symbol} is back in the wallet.</Note>
        )}
      </div>
    );
  }

  // ── Open ticket ────────────────────────────────────────────────────────────

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

      {earnOptions.length > 1 && (
        <div>
          <div className="mb-2 text-xs text-white/50">Borrowed USDC earns in</div>
          <div className="flex flex-wrap gap-2">
            {earnOptions.map((o) => (
              <button
                key={o.venue}
                type="button"
                disabled={run.running}
                onClick={() => setVenue(o.venue)}
                className={`rounded-lg border px-3 py-1.5 text-left text-xs transition-colors ${
                  earn?.venue === o.venue
                    ? "border-white/20 bg-white/10 text-white"
                    : "border-white/10 text-white/60 hover:text-white"
                }`}
              >
                <span className="font-medium">{o.label}</span>
                <span className="ml-2 font-mono tabular-nums">{fmtPct(o.apy)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {needsMonad(earn) && !monad && (
        <Note>Waiting for the embedded Ethereum wallet to provision.</Note>
      )}

      {earn?.monDenominated && (
        <Note tone="warn">
          Earns in MON, not USDC. The loan is USDC. If MON falls, the staked
          value may not cover the loan, and closing pays the instant exit fee
          ({fmtPct(earn.exitFee)} now). The rate shown is the staking APY in
          MON terms.
        </Note>
      )}

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
          label="Steps"
          value={
            needsMonad(earn)
              ? `buy, borrow, fund Monad, deposit. All signed automatically`
              : `buy, borrow, deposit. All signed automatically`
          }
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
          Done. The loan is on the Borrow tab and the USDC is earning in{" "}
          {earn?.label ?? "the vault"}. Come back here to close it.
        </Note>
      ) : (
        <button type="button" onClick={handleStart} disabled={!canStart} className={PRIMARY_BUTTON}>
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
                  : `Buy + Earn ${net != null ? fmtSignedPct(net) : ""}`}
        </button>
      )}
    </div>
  );
}
