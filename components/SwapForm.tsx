"use client";

import { useEffect, useState } from "react";
import {
  LAMPORTS_PER_SOL,
  SOLSCAN_TX_BASE,
  SOL_DECIMALS,
  SOL_MINT,
  ULTRA_MIN_USD,
  USDC_DECIMALS,
  USDC_MINT,
} from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import {
  executeUltraOrder,
  fetchUltraOrderViaProxy,
  fromAtomic,
  toAtomic,
  type UltraOrderResponse,
} from "@/lib/jupiter/ultra";
import type { XStock } from "@/lib/jupiter/xstocks";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import type { AccountBalances } from "@/lib/solana/balances";

type QuoteAsset = "USDC" | "SOL";
type Direction = "buy" | "sell";

type Status =
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "quoted"; quote: UltraOrderResponse }
  | { kind: "buying" }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string };

export function SwapForm({
  ticker,
  walletAddress,
  prices,
  balances,
  onBalanceChange,
}: {
  ticker: XStock;
  walletAddress: string;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  onBalanceChange: () => void;
}) {
  const [direction, setDirection] = useState<Direction>("buy");
  const [quoteAsset, setQuoteAsset] = useState<QuoteAsset>("USDC");
  const [amountInput, setAmountInput] = useState("5");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const signTxBase64 = useSignSolanaTxBase64();

  const solPrice = prices?.[SOL_MINT]?.usdPrice;
  const marketPrice = prices?.[ticker.mint]?.usdPrice;
  const isBuy = direction === "buy";

  // Resolve which side is the input vs output of the swap.
  const quoteMint = quoteAsset === "USDC" ? USDC_MINT : SOL_MINT;
  const quoteDecimals = quoteAsset === "USDC" ? USDC_DECIMALS : SOL_DECIMALS;
  const quotePriceUsd = quoteAsset === "USDC" ? 1 : solPrice;

  const inputSymbol = isBuy ? quoteAsset : ticker.symbol;
  const inputMint = isBuy ? quoteMint : ticker.mint;
  const inputDecimals = isBuy ? quoteDecimals : ticker.decimals;
  const inputBalance = isBuy
    ? quoteAsset === "USDC"
      ? balances?.usdc ?? null
      : balances?.sol ?? null
    : balances?.xstocks[ticker.mint] ?? null;
  const inputPriceUsd = isBuy ? quotePriceUsd : marketPrice;

  const outputSymbol = isBuy ? ticker.symbol : quoteAsset;
  const outputDecimals = isBuy ? ticker.decimals : quoteDecimals;

  // Minimum input expressed in input units, derived from Jupiter's $5 floor.
  const minInputAmount = inputPriceUsd
    ? ULTRA_MIN_USD / inputPriceUsd
    : isBuy && quoteAsset === "USDC"
      ? ULTRA_MIN_USD
      : 0.05;

  useEffect(() => {
    setStatus({ kind: "idle" });
  }, [ticker.mint, direction]);

  useEffect(() => {
    // Reset the input to ~the minimum whenever the input asset changes.
    const defaultAmount = inputPriceUsd
      ? (ULTRA_MIN_USD / inputPriceUsd) * 1.02
      : isBuy && quoteAsset === "USDC"
        ? ULTRA_MIN_USD
        : 0.06;
    const decimals = inputSymbol === "USDC" ? 2 : 4;
    setAmountInput(defaultAmount.toFixed(decimals));
    setStatus({ kind: "idle" });
    // Re-init only when the input asset identity changes, not on price ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, quoteAsset, ticker.mint]);

  const inputAmount = Number(amountInput);
  const belowMin = !Number.isFinite(inputAmount) || inputAmount < minInputAmount;
  const insufficient =
    inputBalance != null &&
    Number.isFinite(inputAmount) &&
    inputBalance < inputAmount;

  async function fetchQuote(): Promise<UltraOrderResponse> {
    const quote = await fetchUltraOrderViaProxy({
      inputMint,
      outputMint: isBuy ? ticker.mint : quoteMint,
      amount: toAtomic(inputAmount, inputDecimals),
      taker: walletAddress,
    });
    if (quote.error || quote.errorMessage) {
      throw new Error(quote.errorMessage ?? quote.error ?? "Quote failed");
    }
    if (!quote.transaction || !quote.requestId) {
      throw new Error("Quote missing transaction or requestId");
    }
    return quote;
  }

  async function handlePreview() {
    setStatus({ kind: "quoting" });
    try {
      // Refresh balances first so the insufficient-balance check uses fresh data.
      onBalanceChange();
      const quote = await fetchQuote();
      setStatus({ kind: "quoted", quote });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleBuy() {
    setStatus({ kind: "buying" });
    try {
      const fresh = await fetchQuote();
      const signed = await signTxBase64(fresh.transaction!);
      const result = await executeUltraOrder({
        signedTransaction: signed,
        requestId: fresh.requestId,
      });
      if (result.status !== "Success" || !result.signature) {
        throw new Error(result.error ?? "Swap failed");
      }
      setStatus({ kind: "done", signature: result.signature });
      onBalanceChange();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function reset() {
    setStatus({ kind: "idle" });
  }

  const inputAmountFmtDigits = inputSymbol === "USDC" ? 2 : inputSymbol === "SOL" ? 4 : 4;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-aeras-300">
            {isBuy ? "Buying" : "Selling"}
          </div>
          <div className="mt-1 text-base font-medium text-aeras-900">
            {ticker.symbol}{" "}
            <span className="text-aeras-300">· {ticker.name}</span>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-aeras-border p-0.5 text-xs">
          {(["buy", "sell"] as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                direction === d
                  ? "bg-aeras-900 text-white"
                  : "text-aeras-500 hover:text-aeras-900"
              }`}
            >
              {d === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label
            htmlFor="amount"
            className="text-xs font-medium uppercase tracking-wide text-aeras-300"
          >
            {isBuy ? "Pay with" : "Receive in"}
          </label>
          <span className="text-xs text-aeras-300">
            {isBuy ? "Balance: " : "Sending: "}
            {inputBalance == null
              ? "..."
              : `${inputBalance.toFixed(inputAmountFmtDigits)} ${inputSymbol}`}
            {inputBalance != null && inputBalance > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAmountInput(inputBalance.toFixed(inputAmountFmtDigits));
                  reset();
                }}
                className="ml-1 text-aeras-500 underline-offset-2 hover:underline"
              >
                Max
              </button>
            )}
          </span>
        </div>
        <div className="mb-2 inline-flex rounded-lg border border-aeras-border p-0.5 text-xs">
          {(["USDC", "SOL"] as QuoteAsset[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setQuoteAsset(a)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                quoteAsset === a
                  ? "bg-aeras-900 text-white"
                  : "text-aeras-500 hover:text-aeras-900"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="relative">
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            min={isBuy ? minInputAmount : 0}
            step={inputSymbol === "USDC" ? "0.01" : "0.001"}
            value={amountInput}
            onChange={(e) => {
              setAmountInput(e.target.value);
              reset();
            }}
            className="block w-full rounded-lg border border-aeras-border bg-white px-3 py-2 pr-16 text-sm text-aeras-900 focus:border-aeras-blue focus:outline-none"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-aeras-300">
            {inputSymbol}
          </span>
        </div>
        <p className="mt-1 text-xs text-aeras-300">
          {insufficient
            ? `Insufficient ${inputSymbol}. Need ${inputAmount}, have ${inputBalance?.toFixed(inputAmountFmtDigits)}.`
            : `Minimum ~${minInputAmount.toFixed(inputAmountFmtDigits)} ${inputSymbol} ($${ULTRA_MIN_USD} Jupiter Ultra gasless threshold).`}
        </p>
      </div>

      {status.kind === "quoted" && (
        <QuoteCard
          quote={status.quote}
          inputSymbol={inputSymbol}
          inputDecimals={inputDecimals}
          outputSymbol={outputSymbol}
          outputDecimals={outputDecimals}
          marketPrice={isBuy ? marketPrice : undefined}
          solPrice={solPrice}
        />
      )}
      {status.kind === "done" && <SuccessCard signature={status.signature} />}
      {status.kind === "error" && (
        <p className="rounded-lg bg-aeras-surface px-3 py-2 text-sm text-aeras-negative">
          {status.message}
        </p>
      )}

      {(status.kind === "idle" ||
        status.kind === "quoting" ||
        status.kind === "error") && (
        <button
          type="button"
          onClick={handlePreview}
          disabled={
            belowMin || insufficient || status.kind === "quoting"
          }
          className="w-full rounded-lg bg-aeras-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status.kind === "quoting" ? "Fetching quote..." : "Preview"}
        </button>
      )}

      {status.kind === "quoted" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex-1 rounded-lg border border-aeras-border px-4 py-3 text-sm font-medium text-aeras-500 transition-colors hover:bg-aeras-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleBuy}
            className="flex-1 rounded-lg bg-aeras-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium"
          >
            {isBuy ? "Confirm buy" : "Confirm sell"}
          </button>
        </div>
      )}

      {status.kind === "buying" && (
        <p className="text-center text-sm text-aeras-300">
          Signing and submitting...
        </p>
      )}

      {status.kind === "done" && (
        <button
          type="button"
          onClick={reset}
          className="w-full rounded-lg border border-aeras-border px-4 py-3 text-sm font-medium text-aeras-500 transition-colors hover:bg-aeras-surface"
        >
          New order
        </button>
      )}
    </div>
  );
}

function QuoteCard({
  quote,
  inputSymbol,
  inputDecimals,
  outputSymbol,
  outputDecimals,
  marketPrice,
  solPrice,
}: {
  quote: UltraOrderResponse;
  inputSymbol: string;
  inputDecimals: number;
  outputSymbol: string;
  outputDecimals: number;
  marketPrice: number | undefined;
  solPrice: number | undefined;
}) {
  const outAmount = fromAtomic(quote.outAmount, outputDecimals);
  const inAmount = fromAtomic(quote.inAmount, inputDecimals);
  const slippagePct = quote.slippageBps / 100;

  // Effective $/xStock price: USD value of the leg / amount of xStock in that leg.
  // Buys put xStock on the output side; sells put it on the input side.
  const isBuy = inputSymbol === "USDC" || inputSymbol === "SOL";
  const effectivePrice = isBuy
    ? outAmount > 0
      ? quote.inUsdValue / outAmount
      : 0
    : inAmount > 0
      ? quote.outUsdValue / inAmount
      : 0;

  const priceDelta =
    marketPrice && marketPrice > 0
      ? ((effectivePrice - marketPrice) / marketPrice) * 100
      : null;
  const deltaIsPremium = priceDelta != null && priceDelta >= 0;

  const priority = quote.prioritizationFeeLamports ?? 0;
  const signature = quote.signatureFeeLamports ?? 0;
  const rent = quote.rentFeeLamports ?? 0;
  const totalLamports = priority + signature + rent;
  const totalSol = totalLamports / LAMPORTS_PER_SOL;
  const totalUsd = solPrice ? totalSol * solPrice : null;

  return (
    <div className="space-y-3 rounded-lg border border-aeras-border bg-aeras-surface p-3 text-sm">
      <div>
        <div className="flex justify-between">
          <span className="text-aeras-300">You pay</span>
          <span className="text-aeras-900 tabular-nums">
            {inAmount.toFixed(inputSymbol === "USDC" ? 2 : 6)} {inputSymbol} ·{" "}
            <span className="text-aeras-300">${quote.inUsdValue.toFixed(2)}</span>
          </span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-aeras-300">You receive</span>
          <span className="font-medium text-aeras-900 tabular-nums">
            {outAmount.toFixed(outputSymbol === "USDC" ? 2 : 6)} {outputSymbol} ·{" "}
            <span className="text-aeras-300">
              ${quote.outUsdValue.toFixed(2)}
            </span>
          </span>
        </div>
      </div>

      <Divider />

      <Row label="Effective price">
        <span className="tabular-nums">
          ${effectivePrice.toFixed(2)} / {isBuy ? outputSymbol : inputSymbol}
        </span>
      </Row>
      <Row label="Market (Jupiter)">
        <span className="tabular-nums">
          {marketPrice != null ? `$${marketPrice.toFixed(2)}` : "—"}
          {priceDelta != null && (
            <span
              className={`ml-2 ${
                deltaIsPremium ? "text-aeras-negative" : "text-aeras-positive"
              }`}
            >
              {deltaIsPremium ? "+" : ""}
              {priceDelta.toFixed(2)}%
            </span>
          )}
        </span>
      </Row>
      <Row label="Price impact">
        <span className="tabular-nums">
          {(quote.priceImpactPct * 100).toFixed(2)}%
        </span>
      </Row>
      <Row label="Max slippage">
        <span className="tabular-nums">{slippagePct.toFixed(2)}%</span>
      </Row>

      <Divider />

      <div>
        <div className="flex justify-between">
          <span className="text-aeras-300">
            Network costs{quote.gasless ? " (Jupiter pays)" : ""}
          </span>
          <span className="tabular-nums text-aeras-900">
            {totalSol.toFixed(6)} SOL
            {totalUsd != null && (
              <span className="text-aeras-300"> · ${totalUsd.toFixed(2)}</span>
            )}
          </span>
        </div>
        <div className="mt-1 space-y-0.5 pl-2 text-xs text-aeras-300">
          <FeeLine label="Priority" lamports={priority} />
          <FeeLine label="Signature" lamports={signature} />
          <FeeLine label="Rent" lamports={rent} />
        </div>
      </div>

      <Divider />

      <Row label="Route">
        <span className="text-aeras-500">
          {quote.router}
          {quote.swapType ? ` · ${quote.swapType}` : ""}
        </span>
      </Row>
    </div>
  );
}

function FeeLine({ label, lamports }: { label: string; lamports: number }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">
        {(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-aeras-300">{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-aeras-border" />;
}

function SuccessCard({ signature }: { signature: string }) {
  return (
    <div className="rounded-lg border border-aeras-border bg-aeras-surface p-3 text-sm">
      <div className="font-medium text-aeras-positive">Filled</div>
      <a
        href={`${SOLSCAN_TX_BASE}${signature}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block break-all font-mono text-xs text-aeras-positive underline decoration-aeras-border"
      >
        {signature}
      </a>
    </div>
  );
}
