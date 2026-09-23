"use client";

// Swap, as the same white card the send and receive widgets use.
//
// The shape mirrors SendWidget on purpose: pick what you are swapping from,
// then act. It is the surface lib/trustware/swap-tokens.ts and swap-quote.ts
// were written for: the From list is what the wallet holds in the registry's
// terms (lib/swap/holdings.ts), To is the rest of the registry, the quote is
// quoteSwap, and the button runs executeSwap. The number it leads with is the
// guaranteed minimum, not the estimate.
//
// Gas is the gate in front of the signature, same as everywhere else since
// 2026-09-22: a Solana source runs behind useGasGate, an EVM source behind
// useEvmGasGate. Both render their own sheet above this card.

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowDown, ChevronDown, ChevronLeft, ChevronRight, XIcon } from "lucide-react";

import { estimateSolanaFeeCost } from "@/lib/borrow/setup-cost";
import { FIXED_GAS_POLICY, planEvmGas } from "@/lib/gas/evm";
import { useEvmGasGate } from "@/lib/gas/use-evm-gas-gate";
import { useGasGate } from "@/lib/gas/use-gas-gate";
import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import { getConnection } from "@/lib/solana/balances";
import { executeSwap } from "@/lib/swap/execute";
import type { SwapHolding } from "@/lib/swap/holdings";
import { atomicToUi, uiToAtomic } from "@/lib/trustware/amounts";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import type { EvmSigner, SolanaSigner } from "@/lib/trustware/execute";
import { quoteSwap, type SwapQuote } from "@/lib/trustware/swap-quote";
import {
  SWAP_TOKENS,
  isSamePair,
  swapTokenById,
  type SwapToken,
} from "@/lib/trustware/swap-tokens";
import { WALLET_CHAINS } from "@/lib/ui/chains";

// Every non-idle state carries the inputs it was priced for, so a quote for
// an amount the user has since changed reads as absent rather than being
// cleared by hand the moment an input moves.
type QuoteState =
  | { kind: "idle" }
  | { kind: "quoting"; key: string }
  | { kind: "ready"; key: string; quote: SwapQuote }
  | { kind: "error"; key: string; message: string };

type RunState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "done"; message: string; txHash: string }
  | { kind: "error"; message: string };

// What Max leaves behind on a native token, so the wallet can still pay for
// the swap it is about to sign and the next thing after it. Solana's is the
// send composer's figure; the EVM chains use the gas floors the venues keep.
const SOL_RESERVE_ATOMIC = 10_000_000n; // 0.01 SOL
const ETHEREUM_RESERVE_WEI = 2_000_000_000_000_000n; // 0.002 ETH
const BNB_RESERVE_WEI = 2_000_000_000_000_000n; // 0.002 BNB
// Ethereum gas for an approval and a bridge call, the Ondo unwind's measured
// figure, at the shared planner's 1.5x floor.
const ETHEREUM_SWAP_GAS_UNITS = 900_000n;
const QUOTE_DEBOUNCE_MS = 400;

function reserveFor(token: SwapToken): bigint {
  if (!token.native) return 0n;
  if (token.kind === "solana") return SOL_RESERVE_ATOMIC;
  if (token.chain === "1") return ETHEREUM_RESERVE_WEI;
  if (token.chain === "56") return BNB_RESERVE_WEI;
  return FIXED_GAS_POLICY[Number(token.chain)]?.floorWei ?? 0n;
}

function fmt(atomic: string, decimals: number, places: number): string {
  const n = Number(atomicToUi(atomic, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: places });
}

function chainLogo(token: SwapToken): string | undefined {
  return WALLET_CHAINS.find((c) =>
    token.kind === "solana" ? c.id === "solana" : c.evmChainId === Number(token.chain),
  )?.logo;
}

export function SwapSheet({
  open,
  onOpenChange,
  holdings,
  solanaAddress,
  evmAddress,
  solana,
  evm,
  solanaUsdcAtomic,
  solPriceUsd,
  onSettled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holdings: SwapHolding[];
  solanaAddress: string;
  evmAddress: string | undefined;
  solana: SolanaSigner;
  evm: EvmSigner | null;
  solanaUsdcAtomic: string;
  solPriceUsd: number | null;
  onSettled: () => Promise<void> | void;
}) {
  const signTxBase64 = useSignSolanaTxBase64();
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [input, setInput] = useState("");
  const [quoteState, setQuoteState] = useState<QuoteState>({ kind: "idle" });
  const [run, setRun] = useState<RunState>({ kind: "idle" });

  function handleOpenChange(next: boolean) {
    if (!next) {
      setFromId(null);
      setToId(null);
      setPicking(null);
      setInput("");
      setRun({ kind: "idle" });
    }
    onOpenChange(next);
  }

  // Sell defaults to Solana USDC when held, else the first balance, so the
  // sheet opens on a pair rather than two empty pills.
  const from =
    (fromId ? holdings.find((h) => h.token.id === fromId) : undefined) ??
    holdings.find((h) => h.token.id === `${TRUSTWARE_SOLANA_CHAIN}:USDC`) ??
    holdings[0] ??
    null;
  // To defaults to the other side of the app's most common move.
  const to = useMemo<SwapToken | null>(() => {
    const chosen = toId ? swapTokenById(toId) : undefined;
    if (chosen && from && !isSamePair(from.token, chosen)) return chosen;
    if (!from) return null;
    const fallback =
      from.token.id === `${TRUSTWARE_SOLANA_CHAIN}:USDC`
        ? swapTokenById("143:USDC")
        : swapTokenById(`${TRUSTWARE_SOLANA_CHAIN}:USDC`);
    return fallback && !isSamePair(from.token, fallback) ? fallback : null;
  }, [toId, from]);

  const destinations = useMemo(
    () => SWAP_TOKENS.filter((t) => !from || !isSamePair(from.token, t)),
    [from],
  );

  const maxAtomic = from
    ? (() => {
        const b = BigInt(from.balanceAtomic);
        const r = reserveFor(from.token);
        return b > r ? b - r : 0n;
      })()
    : 0n;
  let amountAtomic = 0n;
  try {
    amountAtomic = from && input ? BigInt(uiToAtomic(input, from.token.decimals)) : 0n;
  } catch {
    amountAtomic = 0n;
  }
  const overMax = amountAtomic > maxAtomic;
  const busy = run.kind === "busy";

  // Gas gates for the source side.
  const gasSolana = useGasGate({
    walletAddress: solanaAddress,
    walletUsdc: Number(solanaUsdcAtomic || "0") / 10 ** USDC_DECIMALS,
    solPriceUsd,
    signTxBase64,
  });
  const gasEvm = useEvmGasGate({ evm, solana });

  // Price as the amount settles. The quote is what the button executes, so
  // it is keyed to the pair and amount it was priced for; `current` below is
  // empty the moment any of those change.
  const quoteKey = from && to ? `${from.token.id}|${to.id}|${amountAtomic}` : "";
  useEffect(() => {
    if (!from || !to || amountAtomic <= 0n || overMax) return;
    const fromAddress = from.token.kind === "solana" ? solanaAddress : evmAddress;
    const toAddress = to.kind === "solana" ? solanaAddress : evmAddress;
    if (!fromAddress || !toAddress) return;
    const key = quoteKey;
    let cancelled = false;
    const id = setTimeout(async () => {
      setQuoteState({ kind: "quoting", key });
      try {
        const quote = await quoteSwap({
          from: from.token,
          to,
          amountUi: atomicToUi(amountAtomic.toString(), from.token.decimals),
          fromAddress,
          toAddress,
        });
        if (!cancelled) setQuoteState({ kind: "ready", key, quote });
      } catch (err) {
        if (!cancelled) {
          setQuoteState({ kind: "error", key, message: err instanceof Error ? err.message : String(err) });
        }
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // quoteKey covers from, to and amountAtomic; the addresses are the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, overMax, solanaAddress, evmAddress]);
  const current: QuoteState =
    quoteState.kind !== "idle" && quoteState.key === quoteKey ? quoteState : { kind: "idle" };

  async function handleSwap() {
    if (current.kind !== "ready" || !from) return;
    const quote = current.quote;
    setRun({ kind: "busy", message: "Checking gas…" });
    const blocked =
      from.token.kind === "solana"
        ? await gasSolana.guard({
            estimate: () =>
              estimateSolanaFeeCost({
                connection: getConnection(),
                walletAddress: solanaAddress,
                venueLabel: "This swap",
              }),
            resume: () => handleSwap(),
          })
        : evm
          ? await gasEvm.guard({
              plan: () =>
                planEvmGas({
                  chainId: Number(from.token.chain),
                  evm,
                  solanaUsdcAtomic,
                  solanaAddress,
                  gasUnits: ETHEREUM_SWAP_GAS_UNITS,
                  positionValueUsd: quote.fromAmountUsd ?? 0,
                }),
              resume: () => handleSwap(),
            })
          : false;
    if (blocked) {
      setRun({ kind: "idle" });
      return;
    }
    try {
      const r = await executeSwap({
        quote,
        solana,
        evm,
        onProgress: (p) => setRun({ kind: "busy", message: p.message }),
      });
      setRun({
        kind: "done",
        message: r.deliveredAtomic
          ? `${fmt(r.deliveredAtomic, quote.to.decimals, 6)} ${quote.to.symbol} arrived on ${quote.to.chainLabel}.`
          : `${quote.to.symbol} is in your ${quote.to.chainLabel} wallet.`,
        txHash: r.sourceTxHash,
      });
      setInput("");
      await onSettled();
    } catch (err) {
      setRun({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const ready = current.kind === "ready" ? current.quote : null;
  const crossChain = ready && ready.from.chain !== ready.to.chain;
  const canSwap = Boolean(ready) && !busy && !overMax && amountAtomic > 0n;

  // Sell and Buy trade places when the Buy side is something the wallet
  // holds; otherwise the arrow is inert, since a From has to be a balance.
  const toHeld = to ? holdings.find((h) => h.token.id === to.id) : undefined;
  function flip() {
    if (!from || !to || !toHeld || busy) return;
    setFromId(to.id);
    setToId(from.token.id);
    setInput("");
    if (run.kind !== "idle") setRun({ kind: "idle" });
  }

  const cta = busy
    ? run.message
    : !from
      ? "Select a token"
      : !to
        ? "Select a token"
        : amountAtomic <= 0n
          ? "Enter an amount"
          : overMax
            ? "Not enough balance"
            : current.kind === "quoting"
              ? "Pricing…"
              : ready
                ? "Swap"
                : "Swap";

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[28px] bg-white p-6 text-slate-900 shadow-[0_24px_64px_rgba(0,0,0,0.45)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Close className="absolute right-5 top-5 z-10 grid size-8 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          {picking ? (
            <>
              <Dialog.Title className="sr-only">
                {picking === "from" ? "Sell" : "Buy"}
              </Dialog.Title>
              <div className="pt-2">
                <BackButton label="Back" onClick={() => setPicking(null)} />
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {picking === "from" ? "Sell" : "Buy"}
                </p>
                <div className="space-y-2">
                  {(picking === "from" ? holdings.map((h) => h.token) : destinations).map((t) => {
                    const held = holdings.find((h) => h.token.id === t.id);
                    return (
                      <TokenRow
                        key={t.id}
                        token={t}
                        trailing={
                          held ? (
                            <span className="block font-mono text-[13px] tabular-nums text-slate-700">
                              {fmt(held.balanceAtomic, held.token.decimals, 4)}
                            </span>
                          ) : undefined
                        }
                        onSelect={() => {
                          if (picking === "from") {
                            setFromId(t.id);
                            setInput("");
                          } else {
                            setToId(t.id);
                          }
                          setPicking(null);
                          if (run.kind !== "idle") setRun({ kind: "idle" });
                        }}
                      />
                    );
                  })}
                  {picking === "from" && holdings.length === 0 && (
                    <p className="rounded-2xl bg-slate-50 px-5 py-4 text-center text-sm text-slate-500">
                      Nothing to swap yet. Fund the wallet first.
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : run.kind === "done" ? (
            <>
              <Dialog.Title className="sr-only">Swapped</Dialog.Title>
              <div className="pt-6">
                <div className="rounded-2xl bg-emerald-50 px-4 py-4 text-center">
                  <div className="text-sm font-medium text-emerald-700">Swapped</div>
                  <p className="mt-1 text-[13px] text-emerald-700">{run.message}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-emerald-600">{run.txHash}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenChange(false)}
                  className="mt-4 w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <Dialog.Title className="mb-4 mt-1 text-[15px] font-medium text-slate-700">
                Swap
              </Dialog.Title>

              {/* Sell */}
              <div className="rounded-3xl bg-slate-50 px-5 pb-4 pt-4">
                <div className="text-[13px] text-slate-400">Sell</div>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    id="swap-amount"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    placeholder="0"
                    value={input}
                    disabled={busy || !from}
                    onChange={(e) => {
                      setInput(e.target.value);
                      if (run.kind !== "idle") setRun({ kind: "idle" });
                    }}
                    className="min-w-0 flex-1 bg-transparent font-mono text-[34px] leading-none tabular-nums text-slate-900 outline-none placeholder:text-slate-300 disabled:opacity-60"
                  />
                  <TokenPill token={from?.token ?? null} onClick={() => setPicking("from")} disabled={busy} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[13px]">
                  <span className="font-mono tabular-nums text-slate-400">
                    {ready && ready.fromAmountUsd != null ? `$${ready.fromAmountUsd.toFixed(2)}` : "$0"}
                  </span>
                  {from && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setInput(atomicToUi(maxAtomic.toString(), from.token.decimals))}
                      className={`font-mono tabular-nums transition-colors hover:text-slate-700 ${overMax ? "text-red-500" : "text-slate-400"}`}
                    >
                      {fmt(from.balanceAtomic, from.token.decimals, 4)} {from.token.symbol}
                    </button>
                  )}
                </div>
              </div>

              {/* The arrow between the two. */}
              <div className="relative z-10 -my-3 flex justify-center">
                <button
                  type="button"
                  onClick={flip}
                  disabled={!toHeld || busy}
                  aria-label="Swap direction"
                  className="grid size-11 place-items-center rounded-2xl border-4 border-white bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-default disabled:hover:bg-slate-100"
                >
                  <ArrowDown className="size-5" />
                </button>
              </div>

              {/* Buy */}
              <div className="rounded-3xl bg-slate-50 px-5 pb-4 pt-4">
                <div className="text-[13px] text-slate-400">Buy</div>
                <div className="mt-1 flex items-center gap-3">
                  <div
                    className={`min-w-0 flex-1 truncate font-mono text-[34px] leading-none tabular-nums ${ready ? "text-slate-900" : "text-slate-300"}`}
                  >
                    {ready ? fmt(ready.toAmountAtomic, ready.to.decimals, 6) : "0"}
                  </div>
                  <TokenPill token={to} onClick={() => setPicking("to")} disabled={busy} accent={!to} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[13px]">
                  <span className="font-mono tabular-nums text-slate-400">
                    {ready && ready.toAmountUsd != null ? `$${ready.toAmountUsd.toFixed(2)}` : "$0"}
                  </span>
                  {toHeld && (
                    <span className="font-mono tabular-nums text-slate-400">
                      {fmt(toHeld.balanceAtomic, toHeld.token.decimals, 4)} {toHeld.token.symbol}
                    </span>
                  )}
                </div>
              </div>

              {ready && (
                <div className="mt-3 space-y-1.5 px-1 text-[12px]">
                  <Line
                    label="You receive at least"
                    value={`${fmt(ready.toAmountMinAtomic, ready.to.decimals, 6)} ${ready.to.symbol}`}
                    strong
                  />
                  <Line
                    label="Rate"
                    value={`1 ${ready.from.symbol} = ${ready.rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${ready.to.symbol}`}
                  />
                  {ready.totalFeesUsd != null && (
                    <Line label="Fees" value={`$${ready.totalFeesUsd.toFixed(2)}`} />
                  )}
                  {ready.priceImpactFraction != null && (
                    <Line
                      label="Value lost"
                      value={`${(ready.priceImpactFraction * 100).toFixed(2)}%`}
                      warn={ready.priceImpactFraction > 0.02}
                    />
                  )}
                  <Line
                    label="Via"
                    value={ready.engine === "jupiter" ? "Jupiter" : crossChain ? "Bridge, a few minutes" : "Trustware"}
                  />
                </div>
              )}
              {ready && ready.priceImpactFraction != null && ready.priceImpactFraction > 0.05 && (
                <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-[11px] text-amber-700">
                  Over 5% of the value is lost on this route. A larger amount, or a different pair, usually does better.
                </p>
              )}
              {current.kind === "error" && (
                <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-[11px] text-red-600">
                  {current.message}
                </p>
              )}
              {run.kind === "error" && (
                <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-[11px] text-red-600">
                  {run.message}
                </p>
              )}

              <button
                type="button"
                disabled={!canSwap}
                onClick={handleSwap}
                className="mt-4 w-full rounded-2xl bg-slate-900 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {cta}
              </button>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
      {gasSolana.element}
      {gasEvm.element}
    </Dialog.Root>
  );
}

// ── pieces, in the send widget's vocabulary ─────────────────────────────────

function TokenMark({ token }: { token: SwapToken | null }) {
  const chain = token ? chainLogo(token) : undefined;
  return (
    <span className="relative size-7 shrink-0">
      {token?.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={token.logo} alt="" className="size-7 rounded-full object-contain" />
      ) : (
        <span className="grid size-7 place-items-center rounded-full bg-slate-100 text-[11px] font-medium text-slate-500">
          {token?.symbol.slice(0, 2) ?? "?"}
        </span>
      )}
      {chain && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={chain}
          alt=""
          className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border border-white bg-white object-contain"
        />
      )}
    </span>
  );
}

function TokenRow({
  token,
  trailing,
  onSelect,
}: {
  token: SwapToken;
  trailing?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <TokenMark token={token} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-slate-800">{token.symbol}</span>
        <span className="block truncate text-[11px] text-slate-400">
          {token.name} · {token.chainLabel}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {trailing ?? <ChevronRight className="size-4 text-slate-400" />}
      </span>
    </button>
  );
}

// The token pill on the right of each panel: mark, symbol, chevron. Accented
// when nothing is picked yet, the way the reference draws "Select token".
function TokenPill({
  token,
  onClick,
  disabled,
  accent,
}: {
  token: SwapToken | null;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-[15px] font-medium transition-colors disabled:opacity-60 ${
        accent
          ? "bg-slate-900 text-white hover:bg-slate-800"
          : "border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {token ? <TokenMark token={token} /> : <span className="w-1" />}
      <span>{token ? token.symbol : "Select token"}</span>
      <ChevronDown className="size-4 opacity-70" />
    </button>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-800"
    >
      <ChevronLeft className="size-4" />
      {label}
    </button>
  );
}

function Line({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400">{label}</span>
      <span className={`shrink-0 font-mono tabular-nums ${warn ? "text-amber-700" : strong ? "text-slate-900" : "text-slate-600"}`}>
        {value}
      </span>
    </div>
  );
}
