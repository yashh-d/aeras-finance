"use client";

// Taking assets back out of Ondo.
//
// The sibling of OndoMarginCard, and the answer to a real gap: this app could
// put collateral into Ondo and had no way to get it out, which made a deposit a
// one-way door.
//
// The card is built around one fact that has to survive every abbreviation of
// the copy: **a withdrawal lands on Ethereum, not on Solana.** Ondo returns the
// asset that was deposited, on the chain it was deposited on, and everything it
// credits is Ethereum-only. Someone who reads "withdraw" as "back in my Solana
// wallet" has been misled by this card, not by Ondo, so the destination is
// named in the button, in the confirmation, and in the receipt.
//
// Registration is shown as a step rather than folded into the withdraw button.
// It is a signature that authorises a payout destination, it happens once, and
// it deserves to be a thing the user did on purpose.

import { useState } from "react";

import type { UseOndoWithdraw } from "@/lib/ondo/use-ondo-withdraw";
import { defaultHolding } from "@/lib/ondo/use-ondo-withdraw";
import type { OndoHolding } from "@/lib/ondo/withdraw";

const PANEL = "rounded-xl border border-white/[0.07] bg-[#111415]";

export function OndoWithdrawCard({ withdraw }: { withdraw: UseOndoWithdraw }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const { view, status } = withdraw;
  const holding =
    view?.holdings.find((h) => h.symbol === selected) ?? defaultHolding(view);

  if (withdraw.loading && !view) {
    return (
      <div className={`${PANEL} p-4`}>
        <h3 className="text-sm font-medium text-white">Withdraw</h3>
        <p className="mt-1 text-sm text-white/45">Reading your Ondo balances.</p>
      </div>
    );
  }

  if (!view || !holding) {
    return (
      <div className={`${PANEL} p-4`}>
        <h3 className="text-sm font-medium text-white">Nothing to withdraw</h3>
        <p className="mt-1 text-sm text-white/45">
          {withdraw.error
            ? withdraw.error
            : "This Ondo account holds no collateral. Anything you deposit shows up here."}
        </p>
      </div>
    );
  }

  // Pre-filled with the whole withdrawable balance, for the same reason the
  // margin card pre-fills: someone withdrawing is usually withdrawing all of it.
  const amountUi = amount || trim(fixed(holding.withdrawableQuantity, holding.decimals));
  const requested = Number(amountUi);
  const overBalance = requested > holding.withdrawableQuantity * 1.000001;

  if (status.kind === "sent") {
    const { receipt } = status;
    return (
      <div className={`${PANEL} p-4`}>
        <h3 className="text-sm font-medium text-white">Withdrawal submitted</h3>
        <div className="mt-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-sm text-emerald-300">
          {trim(receipt.amount)} {receipt.symbol} to your Ethereum wallet. Ondo
          broadcasts the transfer and pays the gas.
          <div className="mt-1.5 font-mono text-[11px] text-emerald-300/70">
            {receipt.hash
              ? `${receipt.hash.slice(0, 18)}…`
              : `${receipt.withdrawal_status} · ${receipt.withdrawal_id}`}
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">
          This lands on Ethereum, not on Solana. Bringing it back to your Solana
          wallet is a separate bridge and is not built into Aeras yet.
        </p>
        <button
          type="button"
          onClick={() => {
            setAmount("");
            setConfirming(false);
            withdraw.reset();
          }}
          className="mt-2 text-[11px] text-emerald-300/70 underline-offset-2 hover:underline"
        >
          Withdraw more
        </button>
      </div>
    );
  }

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-white">Withdraw</h3>
          <p className="mt-0.5 text-[11px] text-white/35">
            To your Ethereum wallet. Ondo pays the gas.
          </p>
        </div>
        {view.holdings.length > 1 && (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white"
          >
            {holding.symbol}
          </button>
        )}
      </div>

      {picking && (
        <div className="mt-3 divide-y divide-white/[0.06] rounded-lg border border-white/[0.07]">
          {view.holdings.map((h) => (
            <button
              key={h.symbol}
              type="button"
              onClick={() => {
                setSelected(h.symbol);
                setAmount("");
                setPicking(false);
                setConfirming(false);
                withdraw.reset();
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
            >
              <div className="min-w-0">
                <div className="text-xs text-white/80">
                  {h.symbol} <span className="text-white/35">{h.label}</span>
                </div>
                <div className="text-[11px] text-white/30">
                  {h.withdrawableQuantity > 0
                    ? `${trim(fixed(h.withdrawableQuantity, 8))} withdrawable`
                    : "locked by margin"}
                </div>
              </div>
              <div className="shrink-0 font-mono text-xs tabular-nums text-white/70">
                {h.marketValueUsd === null ? "—" : usd(h.marketValueUsd)}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1 rounded-lg border border-white/[0.07] bg-black/40 p-3 text-[11px]">
        <Line
          label="Balance"
          value={`${trim(fixed(holding.quantity, 8))} ${holding.symbol}`}
        />
        <Line
          label="Withdrawable now"
          value={`${trim(fixed(holding.withdrawableQuantity, 8))} ${holding.symbol}`}
        />
        {holding.marketValueUsd !== null && (
          <Line label="Market value" value={usd(holding.marketValueUsd)} />
        )}
      </div>

      {/* The haircut is the single most misread number on this integration, so
          it is contradicted explicitly here rather than left to be inferred.
          Ondo discounts collateral for margin credit, not for ownership. */}
      {holding.symbol !== "USDC" &&
        holding.limitedBy === "balance" &&
        holding.withdrawableQuantity >= holding.quantity * 0.999999 && (
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">
            The full balance is withdrawable. Ondo&apos;s haircut reduces what
            the collateral counts for as margin, not what you own.
          </p>
        )}

      {holding.limitedBy === "margin" && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">
          Open positions are using this collateral as margin, so only part of it
          can leave. Close a position to release the rest.
        </p>
      )}

      {holding.limitedBy === "debt" && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">
          The account carries USDC debt, which reduces withdrawable margin dollar
          for dollar. Repaying it or closing the position releases the rest.
        </p>
      )}

      {/* Two different messages, because the same disagreement means two
          different things. On an asset with a published haircut the arithmetic
          is sound, so a gap means collateral moved without a ledger record and
          auto-exchange is the candidate. On an asset with an inferred haircut
          the gap is most likely the inference being wrong, and the implied
          figure is the only real measurement of Ondo's haircut available, so it
          is worth showing rather than warning about. */}
      {holding.reconciliationWarning &&
        (holding.marginQuantityTrusted ? (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">
            Ondo&apos;s credited margin implies{" "}
            {trim(fixed(holding.marginQuantity ?? 0, 8))} {holding.symbol} while
            deposit history implies {trim(fixed(holding.ledgerQuantity, 8))}.
            Ondo exposes no per-asset balance, so both are reconstructions and
            the smaller is used. Auto-exchange selling collateral is the usual
            cause.
          </p>
        ) : holding.impliedHaircut !== null ? (
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">
            Ondo credits this at about{" "}
            {(holding.impliedHaircut * 100).toFixed(1)}% below mark, not the{" "}
            {(holding.assumedHaircut * 100).toFixed(0)}% Aeras assumes for an
            asset whose haircut Ondo has not published. That affects margin, not
            what you own, so the full balance above is still withdrawable.
          </p>
        ) : null)}

      {view.limitRemainingUsd !== null && view.limitRemainingUsd < 1_000 && (
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">
          {usd(view.limitRemainingUsd)} left under the rolling withdrawal limit.
          It is separate from margin.
        </p>
      )}

      {!view.ownAddressRegistered ? (
        <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/40 p-3">
          <p className="text-[11px] leading-relaxed text-white/60">
            Ondo will only send to an address you have registered. Registering
            takes one signature and no gas. Aeras registers your own embedded
            wallet and nothing else.
          </p>
          <p className="mt-1.5 font-mono text-[10px] text-white/30">
            {view.ownAddress}
          </p>
          {view.cooldownPeriodSecs > 0 && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-amber-400/80">
              Ondo holds a newly registered address for{" "}
              {formatDuration(view.cooldownPeriodSecs)} before it can receive.
            </p>
          )}
          {status.kind === "error" && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-300">
              {status.message}
            </p>
          )}
          <button
            type="button"
            onClick={() => void withdraw.register()}
            disabled={status.kind === "registering"}
            className="mt-3 w-full rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:text-white/30"
          >
            {status.kind === "registering"
              ? "Waiting for the signature…"
              : "Register this wallet"}
          </button>
        </div>
      ) : confirming ? (
        <div className="mt-3 space-y-3 rounded-lg border border-white/[0.07] bg-black/40 p-3">
          <div className="space-y-1 text-[11px]">
            <Line label="Amount" value={`${trim(amountUi)} ${holding.symbol}`} />
            {holding.markPriceUsd !== null && (
              <Line label="Value" value={usd(requested * holding.markPriceUsd)} />
            )}
            <Line label="Network" value="Ethereum" />
            {/* Ondo returns one account-level fee and does not say which assets
                it applies to. Their docs say token withdrawals are free and
                USDC withdrawals may carry one, so a token withdrawal shows the
                figure as conditional rather than as "None": on a small balance
                a surprise $1 is a real proportion of it. */}
            <Line
              label="Fee"
              value={
                view.withdrawalFeeUsd <= 0
                  ? "None"
                  : holding.symbol === "USDC"
                    ? usd(view.withdrawalFeeUsd)
                    : `${usd(view.withdrawalFeeUsd)} if charged`
              }
            />
          </div>
          {view.withdrawalFeeUsd > 0 && holding.symbol !== "USDC" && (
            <p className="text-[11px] leading-relaxed text-white/45">
              Ondo publishes one {usd(view.withdrawalFeeUsd)} withdrawal fee and
              says token withdrawals are free of it. Aeras has not watched a
              token withdrawal settle, so treat that as their claim rather than
              a measured fact.
            </p>
          )}
          <p className="font-mono text-[10px] leading-relaxed text-white/30">
            {view.ownAddress}
          </p>
          <p className="text-[11px] leading-relaxed text-white/45">
            This arrives on Ethereum. Getting it to Solana is a separate bridge
            that Aeras does not run yet.
          </p>
          {status.kind === "error" && (
            <p className="text-[11px] leading-relaxed text-red-300">
              {status.message}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                withdraw.reset();
              }}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void withdraw.withdraw(holding.symbol, amountUi)}
              disabled={status.kind === "working"}
              className="rounded-lg bg-emerald-500/90 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              {status.kind === "working" ? "Submitting…" : "Confirm withdrawal"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center rounded-lg border border-white/10 bg-black/40 px-3 py-2 focus-within:border-white/25">
            <input
              value={amountUi}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="w-full bg-transparent font-mono text-sm tabular-nums text-white outline-none"
            />
            <button
              type="button"
              onClick={() =>
                setAmount(trim(fixed(holding.withdrawableQuantity, holding.decimals)))
              }
              className="ml-2 shrink-0 text-[10px] uppercase tracking-[0.12em] text-white/35 transition-colors hover:text-white/70"
            >
              Max
            </button>
            <span className="ml-2 shrink-0 text-[11px] text-white/35">
              {holding.symbol}
            </span>
          </div>

          {overBalance && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-300">
              That is more than the {trim(fixed(holding.withdrawableQuantity, 8))}{" "}
              {holding.symbol} available to withdraw.
            </p>
          )}

          {status.kind === "error" && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-300">
              {status.message}
            </p>
          )}

          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!amountUi || requested <= 0 || overBalance}
            className="mt-3 w-full rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:text-white/30"
          >
            Withdraw {trim(amountUi) || "0"} {holding.symbol} to Ethereum
          </button>
        </>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-white/35">{label}</span>
      <span className="font-mono tabular-nums text-white/70">{value}</span>
    </div>
  );
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

// Fixed, then trimmed, never rounded up: a "max" that rounds up asks Ondo for
// more than the balance and comes back as insufficient funds.
function fixed(value: number, decimals: number): string {
  const places = Math.min(decimals, 8);
  const factor = 10 ** places;
  return (Math.floor(value * factor) / factor).toFixed(places);
}

function trim(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function formatDuration(seconds: number): string {
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)} days`;
  if (seconds >= 3_600) return `${Math.round(seconds / 3_600)} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

// Kept for callers that render a holding row outside this card.
export type { OndoHolding };
