"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AmountField } from "@/components/AmountField";
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
import {
  atomicToUiString,
  type AccountBalances,
} from "@/lib/solana/balances";

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
  modeToggle,
  autoFocus = false,
}: {
  ticker: XStock;
  walletAddress: string;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  onBalanceChange: () => void;
  // Market/limit switch, rendered beside buy/sell rather than in a row of its
  // own. Owned by AssetTradePanel, which is what the switch actually controls.
  modeToggle?: ReactNode;
  autoFocus?: boolean;
}) {
  const [direction, setDirection] = useState<Direction>("buy");
  const [quoteAsset, setQuoteAsset] = useState<QuoteAsset>("USDC");
  // Starts empty, showing a placeholder zero under a blinking caret. A seeded
  // default saves nobody a keystroke: it has to be cleared before any other
  // figure can be typed, and it puts a number on screen the user did not
  // choose.
  const [amountInput, setAmountInput] = useState("");
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
  // The exact balance as a lossless string. Max fills THIS: the display
  // rounding (toFixed) rounds UP for high-decimal mints, so filling it made
  // Max request more than the wallet holds and fail its own check with
  // "Need 0.1188, have 0.1188". SOL has no stored atomic figure, so its float
  // is rendered at full precision instead.
  const inputBalanceExact = !balances
    ? null
    : isBuy
      ? quoteAsset === "USDC"
        ? atomicToUiString(balances.usdcAtomic, USDC_DECIMALS)
        : String(balances.sol)
      : atomicToUiString(
          balances.xstocksAtomic[ticker.mint] ?? "0",
          ticker.decimals,
        );
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
    // Clear whenever the input asset changes: an amount typed in USDC means
    // nothing once the field is denominated in SOL or in the stock itself, and
    // a quote fetched for the old pair is no longer the one on offer.
    setAmountInput("");
    setStatus({ kind: "idle" });
  }, [direction, quoteAsset, ticker.mint]);

  const inputAmount = Number(amountInput);
  const belowMin = !Number.isFinite(inputAmount) || inputAmount < minInputAmount;
  // Compared in atomic units (toAtomic truncates, matching what the quote
  // will actually request), so an exact-balance Max always passes.
  const insufficient =
    inputBalanceExact != null &&
    Number.isFinite(inputAmount) &&
    BigInt(toAtomic(inputAmount, inputDecimals)) >
      BigInt(toAtomic(Number(inputBalanceExact), inputDecimals));

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

  // Nothing under the amount unless the amount is actually a problem. The
  // minimum used to be stated at rest, where it told a user something they had
  // not done wrong yet; it now appears only once a figure is typed under it.
  const typedAmount = amountInput !== "" && inputAmount > 0;
  const amountNote = insufficient
    ? `Not enough ${inputSymbol}. You have ${inputBalance?.toFixed(inputAmountFmtDigits)}.`
    : typedAmount && belowMin
      ? `Minimum ~${minInputAmount.toFixed(inputAmountFmtDigits)} ${inputSymbol}.`
      : null;

  // Which of USDC or SOL the trade is denominated in. On a buy this is the
  // unit of the figure being typed, so it renders as that unit; on a sell the
  // figure is in the xStock and this is the payout, which sits lower down.
  const quoteToggle = (
    <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
      {(["USDC", "SOL"] as QuoteAsset[]).map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => setQuoteAsset(a)}
          className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
            quoteAsset === a
              ? "bg-white/10 text-white"
              : "text-white/50 hover:text-white"
          }`}
        >
          {a}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* No asset identity here. Both places this form renders (the Home detail
          and the Markets row expansion) already name the asset directly above
          it, so repeating it was the same line twice on one screen.

          Direction and mode sit on the amount's own row rather than in a strip
          above it, so the ticket opens on the figure instead of on two rows of
          controls. They wrap underneath when the panel is too narrow. */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <AmountField
            id="amount"
            ariaLabel={`Amount to ${direction} in ${inputSymbol}`}
            autoFocus={autoFocus}
            value={amountInput}
            onChange={(v) => {
              setAmountInput(v);
              reset();
            }}
            unit={
              isBuy ? (
                quoteToggle
              ) : (
                <span className="text-sm text-white/40">{inputSymbol}</span>
              )
            }
          />
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
              {(["buy", "sell"] as Direction[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    direction === d
                      ? "bg-aeras-blue text-white"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {d === "buy" ? "Buy" : "Sell"}
                </button>
              ))}
            </div>
            {modeToggle}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/40">
          <span>
            {inputBalance == null
              ? "..."
              : `${inputBalance.toFixed(inputAmountFmtDigits)} ${inputSymbol} available`}
            {inputBalanceExact != null && Number(inputBalanceExact) > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAmountInput(inputBalanceExact);
                  reset();
                }}
                className="ml-1.5 text-white/60 underline-offset-2 hover:text-white hover:underline"
              >
                Max
              </button>
            )}
          </span>
          {!isBuy && (
            <span className="flex items-center gap-1.5">
              Receive in
              {quoteToggle}
            </span>
          )}
        </div>

        {amountNote && (
          <p className="mt-2 text-xs text-aeras-negative">{amountNote}</p>
        )}
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
        <p className="rounded-lg bg-white/5 px-3 py-2 text-sm text-aeras-negative">
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
            className="flex-1 rounded-lg border border-white/10 px-4 py-3 text-sm font-medium text-white/60 transition-colors hover:bg-white/5"
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
        <p className="text-center text-sm text-white/50">
          Signing and submitting...
        </p>
      )}

      {status.kind === "done" && (
        <button
          type="button"
          onClick={reset}
          className="w-full rounded-lg border border-white/10 px-4 py-3 text-sm font-medium text-white/60 transition-colors hover:bg-white/5"
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
    <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <div>
        <div className="flex justify-between">
          <span className="text-white/50">You pay</span>
          <span className="text-white tabular-nums">
            {inAmount.toFixed(inputSymbol === "USDC" ? 2 : 6)} {inputSymbol} ·{" "}
            <span className="text-white/50">${quote.inUsdValue.toFixed(2)}</span>
          </span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-white/50">You receive</span>
          <span className="font-medium text-white tabular-nums">
            {outAmount.toFixed(outputSymbol === "USDC" ? 2 : 6)} {outputSymbol} ·{" "}
            <span className="text-white/50">
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
          <span className="text-white/50">
            Network costs{quote.gasless ? " (Jupiter pays)" : ""}
          </span>
          <span className="tabular-nums text-white">
            {totalSol.toFixed(6)} SOL
            {totalUsd != null && (
              <span className="text-white/50"> · ${totalUsd.toFixed(2)}</span>
            )}
          </span>
        </div>
        <div className="mt-1 space-y-0.5 pl-2 text-xs text-white/50">
          <FeeLine label="Priority" lamports={priority} />
          <FeeLine label="Signature" lamports={signature} />
          <FeeLine label="Rent" lamports={rent} />
        </div>
      </div>

      <Divider />

      <Row label="Route">
        <span className="text-white/60">
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
      <span className="text-white/50">{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-white/10" />;
}

function SuccessCard({ signature }: { signature: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <div className="font-medium text-aeras-positive">Filled</div>
      <a
        href={`${SOLSCAN_TX_BASE}${signature}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block break-all font-mono text-xs text-aeras-positive underline decoration-white/10"
      >
        {signature}
      </a>
    </div>
  );
}
