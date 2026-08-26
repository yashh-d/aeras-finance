"use client";

// Move USDC between the Solana wallet and the Monad wallet. Opened by the
// wallet panel's Monad Fund button. "To Monad" runs lib/morpho/fund.ts's
// fundMonadUsdc (Trustware conversion plus the one-time MON gas top-up when
// the wallet has none); "To Solana" runs sendMonadUsdcToSolana, the reverse
// leg signed by the embedded EVM wallet. No vault is involved either way.

import { useState } from "react";
import { formatUnits, parseUnits } from "viem";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import {
  fundMonadUsdc,
  maxFundableDepositAtomic,
  needsMonadGas,
  sendMonadUsdcToSolana,
  type SolanaSigner,
} from "@/lib/morpho/fund";
import type { MorphoTxProgress } from "@/lib/morpho/deposit";

const USDC_DECIMALS = 6;

type Direction = "toMonad" | "toSolana";

type FormState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function MonadFundForm({
  solanaAddress,
  solanaUsdcAtomic,
  monadUsdcAtomic,
  monBalanceAtomic,
  solanaSigner,
  onFunded,
}: {
  solanaAddress: string;
  // Solana USDC available to move, 6-decimal atomic.
  solanaUsdcAtomic: string;
  // Current Monad balances: the reverse leg's ceiling and the gas checks.
  monadUsdcAtomic: string;
  monBalanceAtomic: string;
  solanaSigner: SolanaSigner | undefined;
  // Called after funds arrive, so the panel refreshes both chains' balances.
  onFunded: () => Promise<void> | void;
}) {
  const evm = useEmbeddedEvmWallet();
  const [direction, setDirection] = useState<Direction>("toMonad");
  const [input, setInput] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });

  const toMonad = direction === "toMonad";
  // To Monad: the Solana balance discounted by the funding margin, less the
  // gas top-up when one is needed. To Solana: the full Monad USDC balance,
  // since fees come out of the delivered side and gas is paid in MON.
  const maxAtomic = toMonad
    ? maxFundableDepositAtomic("0", solanaUsdcAtomic, monBalanceAtomic)
    : monadUsdcAtomic;
  const maxUi = Number(formatUnits(BigInt(maxAtomic), USDC_DECIMALS));

  const amountAtomic = (() => {
    try {
      return input ? parseUnits(input, USDC_DECIMALS) : 0n;
    } catch {
      return 0n;
    }
  })();
  const overLimit = amountAtomic > BigInt(maxAtomic);
  const busy = state.kind === "busy";
  const ready = toMonad
    ? Boolean(evm.address && solanaSigner)
    : Boolean(evm.ready && !needsMonadGas(monBalanceAtomic));
  const disabled = busy || amountAtomic <= 0n || overLimit || !ready;

  function switchDirection(next: Direction) {
    setDirection(next);
    setInput("");
    setState({ kind: "idle" });
  }

  const onProgress = (p: MorphoTxProgress) =>
    setState({ kind: "busy", message: p.message });

  async function handleSubmit() {
    if (!evm.address) return;
    setState({ kind: "busy", message: "Preparing…" });
    try {
      if (toMonad) {
        if (!solanaSigner) return;
        await fundMonadUsdc({
          amountAtomic,
          monadUsdcAtomic,
          solanaUsdcAtomic,
          monBalanceAtomic,
          evmAddress: evm.address,
          solana: solanaSigner,
          onProgress,
        });
        setState({ kind: "done", message: "USDC arrived on Monad." });
      } else {
        await sendMonadUsdcToSolana({
          amountAtomic,
          monadUsdcAtomic,
          monBalanceAtomic,
          evm: { address: evm.address, switchChain: evm.switchChain, getProvider: evm.getProvider },
          solanaAddress,
          onProgress,
        });
        setState({ kind: "done", message: "USDC arrived on Solana." });
      }
      setInput("");
      await onFunded();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(
          [
            ["toMonad", "Solana → Monad"],
            ["toSolana", "Monad → Solana"],
          ] as const
        ).map(([dir, label]) => (
          <button
            key={dir}
            type="button"
            onClick={() => switchDirection(dir)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              direction === dir
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            {toMonad ? "Move USDC to Monad" : "Move USDC to Solana"}
          </label>
          <span className="font-mono text-[11px] text-white/50">
            {maxUi.toLocaleString(undefined, { maximumFractionDigits: 2 })} on{" "}
            {toMonad ? "Solana" : "Monad"}
            <button
              type="button"
              onClick={() => {
                setInput(formatUnits(BigInt(maxAtomic), USDC_DECIMALS));
                if (state.kind !== "idle") setState({ kind: "idle" });
              }}
              className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
            >
              Max
            </button>
          </span>
        </div>
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (state.kind !== "idle") setState({ kind: "idle" });
            }}
            className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
            USDC
          </span>
        </div>
      </div>

      <p className="text-[11px] text-white/60">
        {toMonad ? (
          <>
            Converts through Trustware and lands in your Monad wallet.{" "}
            {needsMonadGas(monBalanceAtomic) &&
              "A one-time 0.50 USDC buys MON to pay Monad gas. "}
          </>
        ) : (
          <>
            Delivers to your Solana wallet. Fees come out of the delivered
            amount; gas is paid in MON.{" "}
          </>
        )}
        Bridging takes a few minutes.
      </p>

      {!ready && (
        <p className="text-[11px] text-aeras-warning">
          {!toMonad && evm.ready && needsMonadGas(monBalanceAtomic)
            ? "Your Monad wallet has no MON for gas. Fund it from Solana first; gas arrives automatically."
            : "Both wallets are required. They are provisioned on login; try reconnecting if this persists."}
        </p>
      )}
      {overLimit && (
        <p className="text-[11px] text-aeras-negative">
          Amount is above what {toMonad ? "your Solana USDC can fund" : "the Monad wallet holds"}.
        </p>
      )}
      {state.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {state.message}
        </p>
      )}
      {state.kind === "done" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-positive">
          {state.message}
        </p>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={handleSubmit}
        className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy
          ? state.message
          : toMonad
            ? "Fund Monad wallet"
            : "Send to Solana"}
      </button>
    </div>
  );
}
