"use client";

// The self-funding path inside a hedge ticket.
//
// This renders exactly where the old dead end sat: the user opened the hedge
// form, the ticket needs margin they do not have on Lighter, and the panel used
// to say "add margin above first" and stop. For the assets that can borrow
// against themselves, that instruction was busywork: the holding itself can pay
// for the hedge. This offers that as one button.
//
// It is deliberately a section inside the ticket rather than a second ticket.
// The user has already chosen the holding and seen the short; the only new
// decision here is "fund it from the holding instead of from cash", and the
// numbers that decision needs are the borrow, what survives the road, and the
// two liquidation directions. Everything else would be restating the form above
// it.
//
// The flow it triggers is not atomic, and the states in between are more
// exposed than either endpoint, so the progress line and the outcome messages
// come verbatim from the orchestrator, which is the one place that knows what
// has actually happened. This component adds no interpretation of its own: a
// surface that softened "your debt is open and your hedge is not" would be
// lying in precisely the situation where accuracy matters most.

import type { HedgeRoute } from "@/lib/lighter/hedge";
import type { LighterMarket } from "@/lib/lighter/types";
import { useOneClickHedge } from "@/lib/lighter/use-one-click-hedge";

const LABEL =
  "text-[11px] font-medium uppercase tracking-wider text-white/35";

export function OneClickHedge({
  xstockSymbol,
  mint,
  quantity,
  totalQuantity,
  tokenPriceUsd,
  market,
  hedgeRoute,
  depositAddress,
  onSettled,
  onBorrowed,
  offerBorrow,
}: {
  xstockSymbol: string;
  mint: string;
  quantity: string;
  totalQuantity: string;
  tokenPriceUsd: number;
  market: LighterMarket | null;
  hedgeRoute: HedgeRoute;
  depositAddress: string | undefined;
  onSettled: () => void;
  onBorrowed: () => void;
  // Whether the idle borrow offer should show at all. False when the ticket's
  // margin is already affordable, where offering a borrow is noise. Running
  // and finished runs, and the resume card, render regardless: they describe
  // money that has already moved, which no gate is allowed to hide.
  offerBorrow: boolean;
}) {
  const oneClick = useOneClickHedge({
    xstockSymbol,
    mint,
    quantity,
    totalQuantity,
    tokenPriceUsd,
    market,
    hedgeRoute,
    depositAddress,
    onSettled,
    onBorrowed,
  });

  const { plan, resumePlan, state } = oneClick;

  // Order matters and was once a live bug. A run in flight and a finished
  // outcome render from `state` alone, before ANY plan-derived guard: the run
  // itself zeroes the wallet quantity the plan is computed from, so by the
  // time there is something to show, `plan` is reliably null. The old order
  // checked plan first and blanked the progress box and the outcome exactly
  // when the user most needed them.
  if (state.kind === "running") {
    return (
      <div className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/70" />
          <span className={LABEL}>{stepLabel(state.progress.step)}</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/55">
          {state.progress.message}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/35">
          Keep this page open. This runs in several steps and the state between
          them matters.
        </p>
      </div>
    );
  }

  if (state.kind === "done") {
    const outcome = state.outcome;
    const tone =
      outcome.kind === "hedged"
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
        : outcome.kind === "blocked"
          ? "border-white/15 bg-white/[0.06] text-white/70"
          : "border-amber-400/25 bg-amber-400/10 text-amber-200";
    return (
      <div className={`rounded-lg border px-3 py-2.5 text-sm ${tone}`}>
        {outcome.kind === "hedged" ? (
          <>The borrow, the deposit and the short all went through.</>
        ) : outcome.kind === "blocked" ? (
          <>{outcome.message}</>
        ) : (
          // borrowed-not-funded, funded-not-credited, credited-not-hedged: the
          // orchestrator's message says what exists and what to do, verbatim.
          <>{outcome.message}</>
        )}
        <button
          type="button"
          onClick={oneClick.reset}
          className="mt-2 block text-[11px] underline decoration-white/30 underline-offset-2 hover:decoration-white/60"
        >
          Dismiss
        </button>
      </div>
    );
  }


  // The stranded state, and the card that gets a user out of it: an earlier run
  // borrowed (collateral is in the vault) and stalled before Lighter was
  // funded. The remaining legs are the fix, and a second borrow is precisely
  // the wrong move, so this card takes priority over the borrow offer.
  //
  // Gated on offerBorrow (margin does NOT already cover the ticket) for a
  // reason proven live: stranded runs can complete invisibly, and once their
  // deposits credit, the ticket's own Short button is the whole remaining job.
  // Showing "send more USDC" to a user whose margin already suffices invites
  // paying for the same hedge twice.
  if (state.kind === "idle" && resumePlan?.kind === "ok" && offerBorrow) {
    return (
      <div className="space-y-2.5 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3">
        <div>
          <div className={LABEL}>Finish the hedge</div>
          <p className="mt-1 text-[11px] leading-relaxed text-white/50">
            An earlier run borrowed against your {xstockSymbol} and stopped
            before the margin reached Lighter. This sends{" "}
            {usd(resumePlan.marginUsd)} from your wallet to Lighter and opens
            the {usd(resumePlan.shortNotionalUsd)} short. It does not borrow
            again, and it checks the wallet balance before sending anything.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void oneClick.resume()}
          disabled={!oneClick.resumeReady}
          className="w-full rounded-lg bg-amber-400/20 px-4 py-2.5 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-400/30 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-white/30"
        >
          Send {usd(resumePlan.marginUsd)} and short {usd(resumePlan.shortNotionalUsd)}
        </button>
      </div>
    );
  }

  // From here the state is idle. Nothing left in the wallet to borrow against
  // means the holding is already posted as collateral, and the ticket above
  // this section already handles funding margin and shorting. No plan means no
  // borrow market for this asset, or the plan refused; the caller shows its
  // own "add margin" notice.
  if (!offerBorrow) return null;
  if (Number(quantity) <= 0) return null;
  if (!plan) return null;

  if (plan.kind === "blocked") {
    return (
      <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
        <div className={LABEL}>Borrow to hedge</div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
          {plan.message}
        </p>
      </div>
    );
  }

  const risk = plan.risk;

  return (
    <div className="space-y-2.5 rounded-lg border border-white/[0.07] bg-white/[0.03] p-3">
      <div>
        <div className={LABEL}>Or let the holding pay for it</div>
        <p className="mt-1 text-[11px] leading-relaxed text-white/40">
          Borrow {usd(plan.borrowedUsd)} against your {xstockSymbol} on{" "}
          {venueLabel(plan)} at {percent(plan.borrowRatio)} of its value, post it
          as Lighter margin, and open the short, without adding cash.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Borrow" value={usd(plan.borrowedUsd)} />
        <Figure
          label="Margin after transit"
          value={usd(plan.marginUsd)}
          hint={
            plan.fundingLossUsd > 0.005
              ? `${usd(plan.fundingLossUsd)} to the bridge`
              : "no bridge cost"
          }
        />
        <Figure
          label="Short"
          value={usd(plan.shortNotionalUsd)}
          hint={`${plan.leverage.toFixed(2)}x`}
        />
        <Figure
          label="Offsets"
          value={percent(plan.coverage)}
          hint={plan.leverageCapped ? "capped by leverage" : undefined}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-white/40">
        Two ways this position can be liquidated, in opposite directions.
        {risk.borrowLiquidationDrop != null && (
          <>
            {" "}
            The borrow if {xstockSymbol.replace(/x$/, "")} falls about{" "}
            {percent(risk.borrowLiquidationDrop)}.
          </>
        )}
        {risk.shortLiquidationRise != null && (
          <>
            {" "}
            The short if it rises about {percent(risk.shortLiquidationRise)}.
          </>
        )}{" "}
        Neither leg can rescue the other, because the short&apos;s profit sits on
        Lighter and cannot repay the debt without a withdrawal.
      </p>

      <p className="text-[11px] leading-relaxed text-white/40">
        Your holding sits unhedged for about {plan.unhedgedMinutes} minutes
        between the borrow landing and the short filling. You will sign twice on
        Solana.
      </p>

      <button
        type="button"
        onClick={() => void oneClick.run()}
        disabled={!oneClick.ready}
        className="w-full rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-white/30"
      >
        Borrow {usd(plan.borrowedUsd)} and short {usd(plan.shortNotionalUsd)}
      </button>
    </div>
  );
}

function stepLabel(step: string): string {
  switch (step) {
    case "borrowing":
      return "Borrowing";
    case "funding":
      return "Sending margin";
    case "crediting":
      return "Waiting for Lighter";
    case "hedging":
      return "Opening the short";
    default:
      return "Working";
  }
}

function venueLabel(plan: { xstockSymbol: string }): string {
  // The executor only runs Jupiter vaults today, and the plan reaching this
  // component implies one exists (the hook returns null otherwise), so the
  // label is static rather than threaded through the plan.
  void plan;
  return "Jupiter Lend";
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className="mt-1 font-mono text-sm tabular-nums text-white">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-white/30">{hint}</div>}
    </div>
  );
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function percent(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(0)}%`;
}
