"use client";

// Move USDC from Base back to the Solana wallet. Opened from the wallet panel's
// Fund menu, and only offered once there is a Base balance to move.
//
// One direction only, unlike MonadFundForm. Monad is a venue the app funds, so
// that form has to send money out as well as bring it back; Base is a place the
// user's USDC already happens to be, and the app's whole interest is getting it
// onto Solana where everything else works. Funding Base is left to Privy's
// widget in the same menu.

import { useState } from "react";
import { formatUnits, parseUnits } from "viem";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import {
  BASE_USDC,
  LOSSY_RETURN_BELOW_ATOMIC,
  maxReturnableBaseUsdcAtomic,
  needsBaseGas,
  RETURN_COST_USDC,
  sendBaseUsdcToSolana,
} from "@/lib/trustware/base";

type FormState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function BaseReturnForm({
  solanaAddress,
  baseUsdcAtomic,
  baseEthWei,
  onMoved,
}: {
  solanaAddress: string;
  // Base USDC available to move, 6-decimal atomic.
  baseUsdcAtomic: string;
  // Base ETH, 18-decimal atomic. Gas for the approval and the route.
  baseEthWei: string;
  // Called after funds arrive, so the panel refreshes both chains.
  onMoved: () => Promise<void> | void;
}) {
  const evm = useEmbeddedEvmWallet();
  const [input, setInput] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });

  const maxAtomic = BigInt(maxReturnableBaseUsdcAtomic(baseUsdcAtomic));
  const max = Number(formatUnits(maxAtomic, BASE_USDC.decimals));
  const noGas = needsBaseGas(baseEthWei);

  let amountAtomic = 0n;
  try {
    amountAtomic = input
      ? parseUnits(input as `${number}`, BASE_USDC.decimals)
      : 0n;
  } catch {
    // A half-typed number is not an error worth showing. Submit stays disabled
    // because the amount is still zero.
  }

  const busy = state.kind === "busy";
  const overBalance = amountAtomic > maxAtomic;
  const lossy = amountAtomic > 0n && amountAtomic < LOSSY_RETURN_BELOW_ATOMIC;
  const canSubmit =
    !busy && !noGas && amountAtomic > 0n && !overBalance && !!evm.address;

  async function handleSubmit() {
    if (!evm.address) return;
    setState({ kind: "busy", message: "Preparing…" });
    try {
      await sendBaseUsdcToSolana({
        amountAtomic,
        baseUsdcAtomic,
        ethBalanceWei: baseEthWei,
        evm: {
          address: evm.address,
          switchChain: evm.switchChain,
          getProvider: evm.getProvider,
        },
        solanaAddress,
        onProgress: (p) => setState({ kind: "busy", message: p.message }),
      });
      setState({ kind: "done", message: "USDC arrived on Solana." });
      setInput("");
      await onMoved();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="base-return-amount"
            className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50"
          >
            Amount
          </label>
          <button
            type="button"
            disabled={busy || max <= 0}
            onClick={() => setInput(String(max))}
            className="text-xs text-white/60 underline-offset-2 hover:text-white hover:underline disabled:opacity-40"
          >
            Max {max.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </button>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <input
            id="base-return-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            className="w-full bg-transparent font-mono text-lg text-white outline-none placeholder:text-white/25"
          />
          <span className="shrink-0 text-sm text-white/50">USDC</span>
        </div>
      </div>

      {/* Gas is the one thing that stops this before it starts, so it is stated
          up front rather than raised as a failure after the amount is entered. */}
      {noGas && (
        <p className="text-[11px] text-aeras-warning">
          This wallet has no ETH on Base to pay gas. Send a small amount of Base
          ETH to the same address first, then come back.
        </p>
      )}
      {overBalance && (
        <p className="text-[11px] text-aeras-warning">
          That is more than the wallet holds on Base.
        </p>
      )}
      {/* The bridge costs about the same whatever the size, so a small transfer
          loses a large share of itself. Said before the move, not after: it is
          a warning, not a block, because sometimes moving $5 is still worth it. */}
      {!overBalance && amountAtomic > 0n && lossy && (
        <p className="text-[11px] text-aeras-warning">
          The bridge costs about ${RETURN_COST_USDC.toFixed(2)} whatever the
          amount, so this transfer loses roughly{" "}
          {((RETURN_COST_USDC / Number(input || "0")) * 100).toFixed(1)}% of
          itself. Moving more at once costs the same.
        </p>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? state.message : "Move to Solana"}
      </button>

      {state.kind === "done" && (
        <p className="text-[11px] text-aeras-positive">{state.message}</p>
      )}
      {state.kind === "error" && (
        <p className="text-[11px] text-aeras-negative">{state.message}</p>
      )}
      <p className="text-[11px] text-white/45">
        Bridges through Trustware and lands as USDC in your Solana wallet. It
        takes a few minutes, and the cost comes out of the amount delivered.
      </p>
    </div>
  );
}
