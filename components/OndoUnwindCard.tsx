"use client";

// What you hold on Ethereum after withdrawing from Ondo, and the way home.
//
// This card exists because of a gap that made a working withdrawal look like a
// loss: the tokens land in the embedded Ethereum wallet, and the shared wallet
// scan filters cross-chain holdings through a registry keyed to Jupiter Lend
// borrow vaults, so anything without one (SPCX, CRCL, GLD, SLV, SNDK) is
// dropped before it reaches a screen. Confirmed on chain, invisible in the app.
//
// So the first job here is simply to show the balance, read straight off the
// token contract. The second is to convert it back into the canonical Solana
// xStock, which the Portfolio already displays, prices and charts.
//
// The one thing the copy must not soften: **this leg costs gas and the user
// pays it.** The deposit avoided gas by routing at Ondo's deposit address, and
// Ondo paid for the withdrawal itself. Neither is true here.

import { useState } from "react";

import type { UseOndoUnwind } from "@/lib/ondo/use-ondo-unwind";

import { INSET_PANEL } from "@/lib/ui/surface";

const PANEL = INSET_PANEL;

export function OndoUnwindCard({ unwind }: { unwind: UseOndoUnwind }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  const { holdings, status } = unwind;
  const holding = holdings.find((h) => h.symbol === selected) ?? holdings[0] ?? null;

  if (unwind.loading && holdings.length === 0) {
    return (
      <div className={`${PANEL} p-4`}>
        <h3 className="text-sm font-medium text-white">On Ethereum</h3>
        <p className="mt-1 text-sm text-white/45">Reading your Ethereum wallet.</p>
      </div>
    );
  }

  // Nothing withdrawn, or nothing left. Rendered as a plain absence rather than
  // an error: most of the time this is simply the normal state.
  if (!holding) {
    return null;
  }

  const amountUi = amount || trim(fixed(holding.balanceTokens, 8));
  const gasEth = Number(unwind.gasWei) / 1e18;

  if (status.kind === "sent") {
    return (
      <div className={`${PANEL} p-4`}>
        <h3 className="text-sm font-medium text-white">On its way to Solana</h3>
        <div className="mt-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-sm text-emerald-300">
          Bridging. It usually takes a few minutes, and it will appear in your
          balances as {holding.xstockSymbol} once it lands.
          <div className="mt-1.5 font-mono text-[11px] text-emerald-300/70">
            {status.sourceTxHash.slice(0, 18)}…
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setAmount("");
            unwind.reset();
          }}
          className="mt-2 text-[11px] text-emerald-300/70 underline-offset-2 hover:underline"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-white">On Ethereum</h3>
          <p className="mt-0.5 text-[11px] text-white/35">
            Withdrawn from Ondo. Not shown in your balances above.
          </p>
        </div>
        {holdings.length > 1 && (
          <button
            type="button"
            onClick={() =>
              setSelected(
                holdings[(holdings.findIndex((h) => h.symbol === holding.symbol) + 1) %
                  holdings.length].symbol,
              )
            }
            className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white"
          >
            {holding.symbol}
          </button>
        )}
      </div>

      <div className="mt-3 space-y-1 rounded-lg border border-white/[0.07] bg-black/40 p-3 text-[11px]">
        <Line
          label={holding.symbol}
          value={`${trim(fixed(holding.balanceTokens, 8))}${
            holding.valueUsd === null ? "" : `  (${usd(holding.valueUsd)})`
          }`}
        />
        <Line label="Gas available" value={`${gasEth.toFixed(6)} ETH`} />
      </div>

      {!holding.xstockSymbol ? (
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">
          Aeras has no Solana equivalent registered for {holding.symbol}, so it
          cannot be brought back automatically. It is safe in your Ethereum
          wallet and can be moved from there.
        </p>
      ) : status.kind === "ready" ? (
        <Plan unwind={unwind} />
      ) : (
        <>
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">
            Converting to {holding.xstockSymbol} brings it to your Solana wallet,
            where it shows up in your balances. This leg is signed by your wallet
            and costs Ethereum gas, unlike the withdrawal, which Ondo paid for.
          </p>

          <div className="mt-3 flex items-center rounded-lg border border-white/10 bg-black/40 px-3 py-2 focus-within:border-white/25">
            <input
              value={amountUi}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="w-full bg-transparent font-mono text-sm tabular-nums text-white outline-none"
            />
            <button
              type="button"
              onClick={() => setAmount(trim(fixed(holding.balanceTokens, 8)))}
              className="ml-2 shrink-0 text-[10px] uppercase tracking-[0.12em] text-white/35 transition-colors hover:text-white/70"
            >
              Max
            </button>
            <span className="ml-2 shrink-0 text-[11px] text-white/35">
              {holding.symbol}
            </span>
          </div>

          {status.kind === "confirm" && (
            <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5">
              <p className="text-[11px] leading-relaxed text-amber-300">
                {status.reason}
              </p>
              <button
                type="button"
                onClick={() =>
                  void unwind.price(holding.symbol, amountUi, status.lossBps)
                }
                className="mt-2 text-[11px] text-amber-300 underline underline-offset-2"
              >
                Continue anyway
              </button>
            </div>
          )}

          {status.kind === "error" && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-300">
              {status.message}
            </p>
          )}

          {status.kind === "working" && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/60">
              {status.message}
            </p>
          )}

          <button
            type="button"
            onClick={() => void unwind.price(holding.symbol, amountUi)}
            disabled={
              status.kind === "pricing" ||
              status.kind === "working" ||
              !amountUi ||
              Number(amountUi) <= 0
            }
            className="mt-3 w-full rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:text-white/30"
          >
            {status.kind === "pricing"
              ? "Pricing…"
              : `Bring ${trim(amountUi) || "0"} ${holding.symbol} to Solana`}
          </button>
        </>
      )}
    </div>
  );
}

// What the route delivers, before anything is signed. Same shape as the margin
// card's plan block: the cost is the thing worth seeing first, and showing it
// after the signature would be showing it too late.
function Plan({ unwind }: { unwind: UseOndoUnwind }) {
  const status = unwind.status;
  if (status.kind !== "ready") return null;
  const plan = status.plan;

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/[0.07] bg-black/40 p-3">
      <div className="space-y-1 text-[11px]">
        <Line
          label={`${plan.target.xstockSymbol} delivered`}
          value={`${trim(plan.deliveredTokens)}${
            plan.deliveredValueUsd === null ? "" : `  (${usd(plan.deliveredValueUsd)})`
          }`}
        />
        {plan.bridgeFeesUsd !== null && (
          <Line label="Bridge fee" value={usd(plan.bridgeFeesUsd)} />
        )}
        {plan.lossBps !== null && (
          <Line label="Conversion cost" value={`${(plan.lossBps / 100).toFixed(2)}%`} />
        )}
        <Line
          label="Gas (estimated)"
          value={`${(Number(plan.gasNeededWei) / 1e18).toFixed(6)} ETH`}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-white/45">
        Two signatures: an approval, then the transfer. Both on Ethereum.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={unwind.reset}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void unwind.confirm()}
          className="rounded-lg bg-emerald-500/90 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          Confirm
        </button>
      </div>
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

// Floored, never rounded up: a "max" that rounds up asks for more than the
// balance and reverts at the token contract.
function fixed(value: number, decimals: number): string {
  const places = Math.min(decimals, 8);
  const factor = 10 ** places;
  return (Math.floor(value * factor) / factor).toFixed(places);
}

function trim(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
