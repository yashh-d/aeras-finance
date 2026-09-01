"use client";

// Taking assets back out of Ondo.
//
// The sibling of OndoMarginCard, and the answer to a real gap: this app could
// put collateral into Ondo and had no way to get it out, which made a deposit a
// one-way door.
//
// This is a transfer form, and it is kept at the size of one. An earlier
// version explained the collateral haircut, the difference between what Ondo
// credits and what you own, the two reconstructions behind the balance, and the
// conditions under which a withdrawal fee might apply, all above the amount
// field. Every sentence was true and the form was unusable. What survives is
// the part a user has to act on: how much can leave, why the rest cannot, and
// where it lands.
//
// One fact still has to survive every abbreviation: **a withdrawal lands on
// Ethereum, not on Solana.** Ondo returns the asset that was deposited, on the
// chain it was deposited on, and everything it credits is Ethereum-only.
// Someone who reads "withdraw" as "back in my Solana wallet" has been misled by
// this card, so the destination is named in the button and the receipt, and the
// receipt points at the Move to Solana card that finishes the trip.
//
// Registration is shown as a step rather than folded into the withdraw button.
// It is a signature that authorises a payout destination, it happens once, and
// it deserves to be a thing the user did on purpose. There is no second confirm
// step beyond it: the destination is never caller-supplied (the challenge route
// registers only the session's own wallet), so a confirmation screen would be
// asking the user to approve the only address the app can possibly use.

import { useState } from "react";

import type { UseOndoWithdraw } from "@/lib/ondo/use-ondo-withdraw";
import { defaultHolding } from "@/lib/ondo/use-ondo-withdraw";
import type { OndoHolding } from "@/lib/ondo/withdraw";

import { INSET_PANEL } from "@/lib/ui/surface";

const PANEL = INSET_PANEL;

export function OndoWithdrawCard({ withdraw }: { withdraw: UseOndoWithdraw }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [picking, setPicking] = useState(false);

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
  const amountUi =
    amount || trim(fixed(holding.withdrawableQuantity, holding.decimals));
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
          It lands on Ethereum. Use Move to Solana below to bring it to your
          Solana wallet.
        </p>
        <button
          type="button"
          onClick={() => {
            setAmount("");
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

      {!view.ownAddressRegistered ? (
        <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/40 p-3">
          <p className="text-[11px] leading-relaxed text-white/60">
            Ondo only sends to an address you have registered. One signature, no
            gas. Aeras registers your own wallet and nothing else.
          </p>
          <p className="mt-1.5 font-mono text-[10px] text-white/30">
            {view.ownAddress}
          </p>
          {view.cooldownPeriodSecs > 0 && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-aeras-warning">
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
                setAmount(
                  trim(fixed(holding.withdrawableQuantity, holding.decimals)),
                )
              }
              className="ml-2 shrink-0 text-[10px] uppercase tracking-[0.12em] text-white/35 transition-colors hover:text-white/70"
            >
              Max
            </button>
            <span className="ml-2 shrink-0 text-[11px] text-white/35">
              {holding.symbol}
            </span>
          </div>

          {/* One line where three stat rows used to be. The only number a
              withdrawal needs is how much can leave; the balance behind it
              matters only when the two differ, which the reasons below cover. */}
          <div className="mt-1.5 flex justify-between gap-3 text-[11px] text-white/35">
            <span>
              {trim(fixed(holding.withdrawableQuantity, 8))} {holding.symbol}{" "}
              available
            </span>
            {holding.marketValueUsd !== null && (
              <span className="font-mono tabular-nums">
                {usd(holding.marketValueUsd)}
              </span>
            )}
          </div>

          {/* Ondo returns one account-level fee and does not say which assets it
              applies to. Their docs say token withdrawals are free and USDC
              withdrawals may carry one, so it is stated only where it is
              expected to bite. On a token it would be a guess dressed as a
              quote. */}
          {view.withdrawalFeeUsd > 0 && holding.symbol === "USDC" && (
            <div className="mt-1 text-[11px] text-white/35">
              {usd(view.withdrawalFeeUsd)} withdrawal fee.
            </div>
          )}

          {holding.limitedBy === "margin" && (
            <p className="mt-2 text-[11px] leading-relaxed text-aeras-warning">
              Open positions are using this collateral as margin, so only part of
              it can leave. Close a position to release the rest.
            </p>
          )}

          {holding.limitedBy === "debt" && (
            <p className="mt-2 text-[11px] leading-relaxed text-aeras-warning">
              The account carries USDC debt, which reduces withdrawable margin
              dollar for dollar. Repaying it releases the rest.
            </p>
          )}

          {/* Kept, shortened, and only on the branch that means what it says.
              A documented haircut makes the arithmetic sound, so a gap there is
              collateral that moved without a ledger record. The undocumented
              branch used to print a paragraph about implied haircuts; that was
              a measurement of our own assumption, not something the user can
              act on, so it is gone. */}
          {holding.reconciliationWarning && holding.marginQuantityTrusted && (
            <p className="mt-2 text-[11px] leading-relaxed text-aeras-warning">
              Ondo&apos;s records and your deposit history disagree on this
              balance, so the smaller is shown. Auto-exchange selling collateral
              is the usual cause.
            </p>
          )}

          {view.limitRemainingUsd !== null && view.limitRemainingUsd < 1_000 && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              {usd(view.limitRemainingUsd)} left under the rolling withdrawal
              limit.
            </p>
          )}

          {overBalance && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-300">
              That is more than the{" "}
              {trim(fixed(holding.withdrawableQuantity, 8))} {holding.symbol}{" "}
              available to withdraw.
            </p>
          )}

          {status.kind === "error" && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-300">
              {status.message}
            </p>
          )}

          <button
            type="button"
            onClick={() => void withdraw.withdraw(holding.symbol, amountUi)}
            disabled={
              !amountUi ||
              requested <= 0 ||
              overBalance ||
              status.kind === "working"
            }
            className="mt-3 w-full rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:text-white/30"
          >
            {status.kind === "working"
              ? "Submitting…"
              : `Withdraw ${trim(amountUi) || "0"} ${holding.symbol} to Ethereum`}
          </button>

          <p className="mt-2 text-[11px] leading-relaxed text-white/30">
            Then use Move to Solana below to bring it to your Solana wallet.
          </p>
        </>
      )}
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
