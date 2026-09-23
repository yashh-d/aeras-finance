"use client";

// The gas sheet for an EVM chain. Same three choices as the Solana one
// (components/GasSheet.tsx): cancel, use a little of the Solana USDC, or send
// the chain's native token to the wallet by hand.
//
// It is Solana USDC and not "part of what you are moving" because a position
// on an EVM chain cannot pay for its own exit: with no gas the wallet cannot
// sign the sale that would buy some. The sentence under the heading says so.

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { BORROW_PILL_CLASS } from "@/components/BorrowMarketDetail";
import { formatNative, type EvmGasShortfall } from "@/lib/gas/evm";
import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import { atomicToUi } from "@/lib/trustware/amounts";

type Phase =
  | { kind: "idle" }
  | { kind: "funding"; message: string }
  | { kind: "checking" }
  | { kind: "error"; message: string };

export function EvmGasSheet({
  shortfall,
  onUse,
  onCheckAgain,
  onCancel,
}: {
  shortfall: EvmGasShortfall;
  // Buy the gas from Solana USDC. Reports progress; resolves once the chain
  // shows the balance. The caller re-plans and resumes.
  onUse: (report: (message: string) => void) => Promise<void>;
  // The user sent gas by hand; re-read the balance and resume if it covers.
  onCheckAgain: () => Promise<void>;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [showAddress, setShowAddress] = useState(false);
  const [copied, setCopied] = useState(false);
  const busy = phase.kind === "funding" || phase.kind === "checking";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!hydrated) return null;

  const topup = shortfall.topup;
  const canUse = topup.usdcAtomic != null;
  const useLabel =
    topup.usdcAtomic != null
      ? `Use $${atomicToUi(topup.usdcAtomic.toString(), USDC_DECIMALS)} of your Solana USDC`
      : null;
  const blockedReason = topup.usdcAtomic == null ? topup.reason : null;

  async function use() {
    setPhase({ kind: "funding", message: "Starting." });
    try {
      await onUse((message) => setPhase({ kind: "funding", message }));
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function checkAgain() {
    setPhase({ kind: "checking" });
    try {
      await onCheckAgain();
      setPhase({ kind: "idle" });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 supports-backdrop-filter:backdrop-blur-xs"
        onClick={() => !busy && onCancel()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Network fee"
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#111415] p-6 text-white shadow-2xl"
      >
        <h2 className="font-light text-lg tracking-tight">
          Not enough {shortfall.nativeSymbol} on {shortfall.chainLabel} for the network fee
        </h2>
        <p className="mt-1.5 text-sm text-white/50">
          This needs about {formatNative(shortfall.requiredWei, shortfall.nativeSymbol)}. The
          wallet holds {formatNative(shortfall.balanceWei, shortfall.nativeSymbol)}.
          {canUse
            ? ` The ${shortfall.nativeSymbol} is bought with USDC from your Solana wallet, because a wallet with no gas cannot sell anything it holds on ${shortfall.chainLabel}.`
            : ""}
        </p>
        {blockedReason && (
          <p className="mt-2 text-xs text-white/60">{blockedReason}</p>
        )}

        {showAddress && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs">
            <div className="text-white/50">
              Send {shortfall.nativeSymbol} on {shortfall.chainLabel} to
            </div>
            <div className="mt-1 break-all font-mono text-white">{shortfall.evmAddress}</div>
            <button
              type="button"
              className="mt-2 text-white/60 hover:text-white"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shortfall.evmAddress);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  // Clipboard blocked; the address is on screen to select.
                }
              }}
            >
              {copied ? "Copied" : "Copy address"}
            </button>
          </div>
        )}

        {phase.kind === "error" && (
          <p className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
            {phase.message}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {useLabel && (
            <button type="button" onClick={use} disabled={busy} className={BORROW_PILL_CLASS}>
              {phase.kind === "funding" ? phase.message : useLabel}
            </button>
          )}
          {showAddress ? (
            <button
              type="button"
              onClick={checkAgain}
              disabled={busy}
              className={useLabel ? SECONDARY : BORROW_PILL_CLASS}
            >
              {phase.kind === "checking" ? "Checking…" : "I have sent it, check again"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddress(true)}
              disabled={busy}
              className={useLabel ? SECONDARY : BORROW_PILL_CLASS}
            >
              Add {shortfall.nativeSymbol}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="aeras-press w-full rounded-full px-4 py-2 text-sm font-medium text-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const SECONDARY =
  "aeras-press w-full rounded-full border border-white/10 px-4 py-2.5 text-sm font-medium text-white/60 hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
