"use client";

// The Mag7X ticket: create the account, fund it, watch the position, leave.
//
// One press does the whole entry. For a first deposit that is an EVM
// signature (enrollment), a Solana signature (the USDC to Base) and a wait
// while Glider buys the holdings; for a later deposit the first is skipped.
// The exit is one EVM signature (the sale), a Solana signature if the wallet
// needs Base gas, and the Base signature that sends the USDC home. Every
// leg re-reads the chain, so a failed run is pressed again, not untangled.
//
// Not shown here: what the portfolio is. That is the detail beside this
// ticket. The one thing repeated is the eligibility line, because it gates
// the button.

import { useEffect, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import {
  fmtUsd,
  Note,
  PreviewBlock,
  PreviewRow,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  UsdcAmount,
} from "@/components/strategies/shared";
import { requestGliderRebalance, waitForGliderOperation } from "@/lib/glider/client";
import {
  GLIDER_STRATEGY_NAME,
  MAG7X_MIN_DEPOSIT_USD,
} from "@/lib/glider/constants";
import { ensureMag7xPortfolio } from "@/lib/glider/enroll";
import { exitMag7xToSolana } from "@/lib/glider/exit";
import { executeMag7xDeposit, planMag7xDeposit, type Mag7xDepositPlan } from "@/lib/glider/fund";
import type { GliderStrategyView } from "@/lib/glider/types";
import type { GliderPortfolioState } from "@/lib/glider/use-glider";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import type { AccountBalances } from "@/lib/solana/balances";
import { VENUE_LOGOS } from "@/lib/tokens/logos";
import { BASE_EXPLORER_ADDRESS_BASE } from "@/lib/base/constants";

type Flow =
  | { kind: "idle" }
  | { kind: "busy"; message: string; log: string[] }
  | { kind: "done"; message: string; log: string[] }
  | { kind: "error"; message: string; log: string[] };

function pct(decimal: number | null | undefined, digits = 1): string {
  if (decimal == null || !Number.isFinite(decimal)) return "—";
  return `${(decimal * 100).toFixed(digits)}%`;
}

function signedPct(percent: number | null | undefined): string {
  if (percent == null || !Number.isFinite(percent)) return "—";
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function readable(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function GliderTicket({
  strategy,
  portfolioState,
  walletAddress,
  balances,
  onRefresh,
}: {
  strategy: GliderStrategyView | null;
  portfolioState: GliderPortfolioState;
  walletAddress: string | null;
  balances: AccountBalances | null;
  onRefresh: () => Promise<void> | void;
}) {
  const evm = useEmbeddedEvmWallet();
  const solanaSignAndSend = useSendSolanaTxBase64();
  const [amountInput, setAmountInput] = useState("");
  const [attested, setAttested] = useState(false);
  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const [plan, setPlan] = useState<Mag7xDepositPlan | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  const { portfolio, known, keyConfigured } = portfolioState;
  const busy = flow.kind === "busy";
  const amountUsd = Number(amountInput);
  const amountValid =
    Number.isFinite(amountUsd) &&
    amountUsd >= MAG7X_MIN_DEPOSIT_USD &&
    balances != null &&
    amountUsd <= balances.usdc;
  const amountAtomic = amountValid ? BigInt(Math.round(amountUsd * 1_000_000)) : 0n;

  // Price the deposit as the amount is typed, once there is an account to
  // price it against. Without one the quote would need a destination that
  // does not exist yet, so the preview shows the amount and the floor only.
  useEffect(() => {
    if (!amountValid || !portfolio || !walletAddress || !balances) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      const next = await planMag7xDeposit({
        amountAtomic,
        solanaAddress: walletAddress,
        solanaUsdcAtomic: balances.usdcAtomic,
        portfolio: { portfolioId: portfolio.portfolioId, smartAccount: portfolio.smartAccount },
      });
      if (!cancelled) setPlan(next);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // amountAtomic is derived from amountInput; portfolio identity is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountInput, amountValid, portfolio?.portfolioId, portfolio?.smartAccount, walletAddress, balances?.usdcAtomic]);

  function progress(message: string) {
    setFlow((prev) => {
      const log = prev.kind === "idle" ? [] : prev.log;
      return { kind: "busy", message, log: [...log, message] };
    });
  }

  const evmSigner =
    evm.address
      ? { address: evm.address, switchChain: evm.switchChain, getProvider: evm.getProvider }
      : null;
  const solanaSigner = walletAddress
    ? { address: walletAddress, signAndSendBase64: solanaSignAndSend }
    : null;

  async function handleDeposit() {
    if (!evmSigner || !solanaSigner || !balances || !amountValid) return;
    setFlow({ kind: "busy", message: "Starting", log: [] });
    try {
      const account =
        portfolio ??
        (await ensureMag7xPortfolio({ evm: evmSigner, attested, onProgress: progress }));
      const priced = await planMag7xDeposit({
        amountAtomic,
        solanaAddress: solanaSigner.address,
        solanaUsdcAtomic: balances.usdcAtomic,
        portfolio: { portfolioId: account.portfolioId, smartAccount: account.smartAccount },
      });
      if (priced.kind === "blocked") throw new Error(priced.reason);
      const result = await executeMag7xDeposit({
        plan: priced,
        solana: solanaSigner,
        onProgress: (p) => progress(p.message),
      });
      setFlow((prev) => ({
        kind: "done",
        message: result.rebalancePending
          ? "Deposit landed on Base. Glider is buying the holdings; the position updates as they land."
          : `Deposited ${fmtUsd(priced.amountUsd)} into ${GLIDER_STRATEGY_NAME}.`,
        log: prev.kind === "idle" ? [] : prev.log,
      }));
      setAmountInput("");
      await Promise.all([portfolioState.refresh(), onRefresh()]);
    } catch (err) {
      setFlow((prev) => ({ kind: "error", message: readable(err), log: prev.kind === "idle" ? [] : prev.log }));
    }
  }

  async function handleRebalance() {
    setFlow({ kind: "busy", message: "Asking Glider to buy the holdings", log: [] });
    try {
      const r = await requestGliderRebalance();
      if (!r.operationId) {
        setFlow({
          kind: "done",
          message: `Glider ran a rebalance recently; the next manual one is allowed in ${r.retryAfterSeconds ?? 60}s. The scheduler will buy the holdings on its own before then or after.`,
          log: [],
        });
        return;
      }
      const { operation, timedOut } = await waitForGliderOperation(r.operationId, {
        onTick: (op) => progress(`Glider is buying the holdings (${op.state.replace("_", " ")})`),
      });
      if (operation?.state === "failed" || operation?.state === "cancelled") {
        throw new Error(`Glider's rebalance ${operation.state}${operation.error ? `: ${operation.error}` : ""}.`);
      }
      setFlow((prev) => ({
        kind: "done",
        message: timedOut ? "Still running on Glider's side; the position updates when it lands." : "Holdings bought.",
        log: prev.kind === "idle" ? [] : prev.log,
      }));
      await portfolioState.refresh();
    } catch (err) {
      setFlow((prev) => ({ kind: "error", message: readable(err), log: prev.kind === "idle" ? [] : prev.log }));
    }
  }

  async function handleExit() {
    if (!evmSigner || !solanaSigner || !portfolio) return;
    setConfirmExit(false);
    setFlow({ kind: "busy", message: "Starting the exit", log: [] });
    try {
      const hasHoldings = portfolio.totalValueUsd - portfolio.idleUsdc > 1;
      const r = await exitMag7xToSolana({
        evm: evmSigner,
        solana: solanaSigner,
        hasHoldings,
        onProgress: (p) => progress(p.message),
      });
      const delivered = r.deliveredAtomic ? Number(r.deliveredAtomic) / 1e6 : Number(r.returnedAtomic) / 1e6;
      setFlow((prev) => ({
        kind: "done",
        message: `${fmtUsd(delivered)} USDC is back in your Solana wallet.`,
        log: prev.kind === "idle" ? [] : prev.log,
      }));
      await Promise.all([portfolioState.refresh(), onRefresh()]);
    } catch (err) {
      setFlow((prev) => ({ kind: "error", message: readable(err), log: prev.kind === "idle" ? [] : prev.log }));
    }
  }

  // ── Gates ─────────────────────────────────────────────────────────────────

  if (!walletAddress) {
    return <Note>Sign in to open a Mag7X position.</Note>;
  }
  if (!known && portfolioState.loading) {
    return <div className="text-xs text-white/50">Checking for a Mag7X account…</div>;
  }
  if (known && !keyConfigured) {
    return (
      <Note>
        Deposits into {GLIDER_STRATEGY_NAME} open once Glider is configured on this server.
        The figures beside this are live; the account creation is not yet.
      </Note>
    );
  }
  if (portfolioState.error && !portfolio) {
    return <Note tone="warn">{portfolioState.error}</Note>;
  }

  const boost = strategy?.boost ?? null;
  const all = portfolio?.performance?.windows.find((w) => w.window === "all")?.percentChange ?? null;
  const heldCount = portfolio ? portfolio.assets.filter((a) => a.holding && a.balance > 0).length : 0;
  const canDeposit =
    !busy && amountValid && !!evmSigner && !!solanaSigner && (portfolio != null || attested) &&
    (plan == null || plan.kind === "ready");

  return (
    <div className="space-y-4">
      {portfolio && (
        <PreviewBlock>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AssetLogo xstock={{ symbol: "MAG7X", name: GLIDER_STRATEGY_NAME, logo: VENUE_LOGOS.glider }} size={22} />
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">Your position</div>
            </div>
            <a
              href={`${BASE_EXPLORER_ADDRESS_BASE}${portfolio.smartAccount}`}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-white/40 underline decoration-white/20 hover:text-white"
            >
              account on Base
            </a>
          </div>
          <div className="font-mono text-2xl tabular-nums text-white">{fmtUsd(portfolio.totalValueUsd)}</div>
          <PreviewRow label="Return since deposit" value={signedPct(all)} warn={all != null && all < 0} />
          <PreviewRow label="Holdings" value={heldCount > 0 ? `${heldCount} of ${strategy?.holdings.length ?? 8}` : "none yet"} muted={heldCount === 0} />
          {portfolio.idleUsdc > 0.5 && (
            <PreviewRow label="USDC waiting to be invested" value={fmtUsd(portfolio.idleUsdc)} warn />
          )}
          {portfolio.inTransitUsd > 0 && (
            <PreviewRow label="In transit" value={fmtUsd(portfolio.inTransitUsd)} muted />
          )}
          <PreviewRow
            label="Next rebalance"
            value={portfolio.schedule.nextDueAt ? new Date(portfolio.schedule.nextDueAt).toLocaleString() : portfolio.schedule.status ?? "—"}
            muted
          />
          {boost && <PreviewRow label="Boost" value={`${pct(boost.apr)} APR, paid in dollars`} />}
          {portfolio.idleUsdc > 1 && !busy && (
            <button type="button" onClick={handleRebalance} className={SECONDARY_BUTTON}>
              Buy holdings now
            </button>
          )}
        </PreviewBlock>
      )}

      <UsdcAmount value={amountInput} onChange={setAmountInput} balanceUsdc={balances?.usdc ?? null} />

      <PreviewBlock>
        <PreviewRow label="Buys" value={amountValid ? `${fmtUsd(amountUsd)} across ${strategy?.holdings.length ?? 8} holdings at equal weight` : "—"} />
        <PreviewRow
          label="Arrives on Base"
          value={plan?.kind === "ready" ? `about ${fmtUsd(plan.deliveredUsd)}` : amountValid ? (portfolio ? "pricing…" : "priced after the account exists") : "—"}
          muted={plan?.kind !== "ready"}
        />
        {plan?.kind === "ready" && (
          <PreviewRow label="Route cost" value={`${fmtUsd(plan.amountUsd - plan.deliveredUsd)} (${(plan.lossBps / 100).toFixed(2)}%)`} muted />
        )}
        <PreviewRow label="Strategy fee" value={strategy ? pct(strategy.fee, 2) : "—"} muted />
        <PreviewRow label="Boost" value={boost ? `${pct(boost.apr)} APR while the campaign runs` : "none live"} muted={!boost} />
        <PreviewRow label="Signatures" value={portfolio ? "1 on Solana" : "1 on Ethereum, 1 on Solana"} muted />
      </PreviewBlock>

      {plan?.kind === "blocked" && amountValid && <Note tone="warn">{plan.reason}</Note>}
      {plan?.kind === "ready" && plan.warning && <Note tone="warn">{plan.warning}</Note>}

      {!portfolio && (
        <label className="flex items-start gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            disabled={busy}
            className="mt-0.5"
          />
          <span>
            I am not a US person and not in a restricted jurisdiction. Coinbase tokenized stocks are
            offered under Regulation S and are not available to US persons.
          </span>
        </label>
      )}

      {!evm.address && <Note>Waiting for the embedded Ethereum wallet to provision.</Note>}

      <button type="button" onClick={handleDeposit} disabled={!canDeposit} className={PRIMARY_BUTTON}>
        {busy
          ? flow.message
          : amountInput === ""
            ? "Enter an amount"
            : !amountValid
              ? amountUsd < MAG7X_MIN_DEPOSIT_USD
                ? `Minimum ${fmtUsd(MAG7X_MIN_DEPOSIT_USD)}`
                : "Not enough USDC"
              : !portfolio && !attested
                ? "Confirm eligibility above"
                : portfolio
                  ? `Deposit ${fmtUsd(amountUsd)}`
                  : `Create account and deposit ${fmtUsd(amountUsd)}`}
      </button>

      {portfolio && portfolio.totalValueUsd > 0 && !busy && (
        confirmExit ? (
          <div className="space-y-2">
            <Note tone="warn">
              This sells every holding to USDC on Base, buys a little ETH for gas if the wallet has none,
              and moves the USDC to your Solana wallet. Three signatures, a few minutes, about 1% in
              swap and bridge costs.
            </Note>
            <div className="flex gap-2">
              <button type="button" onClick={handleExit} className={PRIMARY_BUTTON}>
                Sell everything and move to Solana
              </button>
              <button type="button" onClick={() => setConfirmExit(false)} className={SECONDARY_BUTTON}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmExit(true)} className={SECONDARY_BUTTON}>
            Exit to Solana
          </button>
        )
      )}

      {flow.kind !== "idle" && flow.log.length > 0 && (
        <ol className="space-y-1 text-[11px] text-white/50">
          {flow.log.map((line, i) => (
            <li key={i} className={i === flow.log.length - 1 && busy ? "text-white" : undefined}>
              {line}
            </li>
          ))}
        </ol>
      )}
      {flow.kind === "done" && <Note>{flow.message}</Note>}
      {flow.kind === "error" && (
        <Note tone="warn">
          {flow.message} Pressing again resumes from where it stopped; nothing is lost.
        </Note>
      )}
    </div>
  );
}
