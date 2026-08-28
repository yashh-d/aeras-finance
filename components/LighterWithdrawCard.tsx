"use client";

// Getting margin off Lighter and back to the Solana wallet, from the margin
// stat's Withdraw button.
//
// Two stages with a resting stop in between, and the card says so up front
// rather than letting the user discover Ethereum in the middle: Lighter can
// only pay its own L1 address, so the money exits to Ethereum first (no fee,
// dynamic delay), rests at the user's own address, and a second explicit
// button brings it home to Solana through Trustware. The stop is safe; nothing
// about it needs to be hidden, and hiding it would mean signing an Ethereum
// transaction the user never asked to see.

import { useState } from "react";

import { useLighterWithdraw } from "@/lib/lighter/use-lighter-withdraw";

const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.14em] text-white/35";

export function LighterWithdrawCard({
  accountIndex,
  availableUsd,
  solanaUsdcAtomic,
  onClose,
  onSettled,
}: {
  accountIndex: number | undefined;
  // Margin not backing a position: the most Lighter will release.
  availableUsd: number;
  // Solana wallet USDC in base units, funding a gas top-up when needed.
  solanaUsdcAtomic: string;
  onClose: () => void;
  onSettled: () => void;
}) {
  const [amount, setAmount] = useState("");
  const w = useLighterWithdraw({ accountIndex, onSettled });

  const entered = Number(amount);
  const canSubmit =
    w.ready &&
    w.state.kind !== "withdrawing" &&
    w.state.kind !== "bridging" &&
    entered > 0 &&
    entered <= availableUsd;

  const minutes =
    w.delaySeconds != null ? Math.ceil(w.delaySeconds / 60) : null;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-white">Withdraw margin</h3>
          <p className="mt-1 text-sm leading-relaxed text-white/45">
            Lighter pays withdrawals to your Ethereum address
            {minutes != null ? ` after about ${minutes} minutes` : ""}, with no
            fee. A second step then brings the USDC back to your Solana wallet.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-white/35 transition-colors hover:text-white/70"
        >
          Close
        </button>
      </div>

      {(w.state.kind === "idle" || w.state.kind === "error") && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[180px] flex-1 items-center rounded-lg border border-white/10 bg-black/40 px-3 py-2 focus-within:border-white/25">
              <input
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^\d.]/g, ""))
                }
                inputMode="decimal"
                placeholder="0.00"
                className="w-full bg-transparent font-mono text-sm tabular-nums text-white placeholder:text-white/25 focus:outline-none"
              />
              <span className="pl-2 text-xs text-white/35">USDC</span>
            </div>
            <button
              type="button"
              onClick={() => setAmount(availableUsd.toFixed(2))}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60 transition-colors hover:border-white/20 hover:text-white"
            >
              Max
            </button>
            <button
              type="button"
              onClick={() => void w.withdraw(entered, availableUsd)}
              disabled={!canSubmit}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              Withdraw
            </button>
          </div>
          <p className="mt-2 text-[11px] text-white/35">
            ${availableUsd.toFixed(2)} of margin is not backing a position and
            can be withdrawn.
          </p>
          {w.state.kind === "error" && (
            <p className="mt-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {w.state.message}
            </p>
          )}
        </>
      )}

      {(w.state.kind === "withdrawing" ||
        w.state.kind === "bridging" ||
        w.state.kind === "topping-up") && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/70" />
          <span className="text-sm text-white/70">
            {w.state.kind === "withdrawing"
              ? w.state.progress.message
              : w.state.message}
          </span>
        </div>
      )}

      {w.state.kind === "submitted" && (
        <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-sm text-emerald-300">
          Lighter accepted the ${w.state.amountUsd.toFixed(2)} withdrawal. It
          arrives at your Ethereum address in about{" "}
          {w.state.delaySeconds != null
            ? `${Math.ceil(w.state.delaySeconds / 60)} minutes`
            : "the posted delay"}
          . The step below activates once it lands; you can close this and come
          back.
        </div>
      )}

      {w.state.kind === "bridged" && (
        <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-sm text-emerald-300">
          {w.state.deliveredUsd != null
            ? `$${w.state.deliveredUsd.toFixed(2)} USDC arrived in your Solana wallet.`
            : "The USDC is on its way to your Solana wallet."}
        </div>
      )}

      {/* The resting stop. Shown whenever Ethereum holds withdrawn USDC,
          including from a withdrawal made days ago in another session. */}
      {w.ethereumUsdc != null &&
        w.ethereumUsdc > 0 &&
        w.state.kind !== "bridging" &&
        w.state.kind !== "bridged" && (
          <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
            <div className={LABEL}>On Ethereum, ready to come home</div>
            <p className="text-sm text-white/70">
              <span className="font-mono tabular-nums text-white">
                ${w.ethereumUsdc.toFixed(2)}
              </span>{" "}
              USDC is at your Ethereum address.
              {w.ethGasOk === false &&
                " Bridging it needs a little ETH for gas first; it is safe where it is until then."}
            </p>
            {w.ethGasOk === false && (
              <button
                type="button"
                onClick={() => void w.topUpGas(BigInt(solanaUsdcAtomic || "0"))}
                className="w-full rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20"
              >
                Buy ETH for gas with Solana USDC
              </button>
            )}
            <button
              type="button"
              onClick={() => void w.bridgeHome()}
              disabled={w.ethGasOk === false}
              className="w-full rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-white/30"
            >
              Bring ${w.ethereumUsdc.toFixed(2)} to Solana
            </button>
          </div>
        )}
    </div>
  );
}
