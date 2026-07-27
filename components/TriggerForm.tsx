"use client";

import { useEffect, useState } from "react";
import {
  SOLSCAN_TX_BASE,
  TRIGGER_DEFAULT_EXPIRY_MS,
  TRIGGER_DEFAULT_SLIPPAGE_BPS,
  TRIGGER_MIN_USD,
  USDC_DECIMALS,
  USDC_MINT,
} from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import {
  craftDeposit,
  createOrder,
  getVault,
  type TriggerCondition,
} from "@/lib/jupiter/trigger";
import { toAtomic } from "@/lib/jupiter/ultra";
import type { TriggerAuth } from "@/lib/jupiter/use-trigger-auth";
import type { XStock } from "@/lib/jupiter/xstocks";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import type { AccountBalances } from "@/lib/solana/balances";

type Direction = "buy" | "sell";

type Status =
  | { kind: "idle" }
  | { kind: "placing"; step: string }
  | { kind: "done"; orderId: string; signature?: string }
  | { kind: "error"; message: string };

export function TriggerForm({
  ticker,
  walletAddress,
  prices,
  balances,
  auth,
  onBalanceChange,
  onOrderPlaced,
}: {
  ticker: XStock;
  walletAddress: string;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  auth: TriggerAuth;
  onBalanceChange: () => void;
  onOrderPlaced: () => void;
}) {
  const [direction, setDirection] = useState<Direction>("buy");
  const [amountInput, setAmountInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const { ensureToken, reset: resetAuth } = auth;
  const signTxBase64 = useSignSolanaTxBase64();

  const marketPrice = prices?.[ticker.mint]?.usdPrice;
  const isBuy = direction === "buy";

  // Buy spends USDC for the xStock; sell sends the xStock for USDC.
  const inputSymbol = isBuy ? "USDC" : ticker.symbol;
  const inputMint = isBuy ? USDC_MINT : ticker.mint;
  const inputDecimals = isBuy ? USDC_DECIMALS : ticker.decimals;
  const outputMint = isBuy ? ticker.mint : USDC_MINT;
  const inputBalance = isBuy
    ? balances?.usdc ?? null
    : balances?.xstocks[ticker.mint] ?? null;

  // Buy-below the target, sell-above it: the standard limit-order semantics.
  const triggerCondition: TriggerCondition = isBuy ? "below" : "above";

  // Seed the trigger price near market the first time we have a quote.
  useEffect(() => {
    if (marketPrice != null && priceInput === "") {
      setPriceInput(marketPrice.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketPrice]);

  useEffect(() => {
    setStatus({ kind: "idle" });
  }, [ticker.mint, direction]);

  const amount = Number(amountInput);
  const triggerPrice = Number(priceInput);
  const amountValid = Number.isFinite(amount) && amount > 0;
  const priceValid = Number.isFinite(triggerPrice) && triggerPrice > 0;

  // Order USD value: for a buy it is the USDC spent; for a sell it is the xStock
  // amount valued at the trigger price.
  const orderUsd = !amountValid
    ? 0
    : isBuy
      ? amount
      : priceValid
        ? amount * triggerPrice
        : 0;
  const belowMin = orderUsd < TRIGGER_MIN_USD;
  const insufficient =
    inputBalance != null && amountValid && inputBalance < amount;

  // Estimated other side, for display only.
  const estimate =
    amountValid && priceValid
      ? isBuy
        ? amount / triggerPrice // xStock received
        : amount * triggerPrice // USDC received
      : null;

  const canSubmit =
    amountValid &&
    priceValid &&
    !belowMin &&
    !insufficient &&
    status.kind !== "placing";

  async function handlePlace() {
    try {
      onBalanceChange();
      setStatus({ kind: "placing", step: "Authenticating" });
      const token = await ensureToken();

      setStatus({ kind: "placing", step: "Preparing vault" });
      await getVault(token);

      const atomicAmount = toAtomic(amount, inputDecimals);

      setStatus({ kind: "placing", step: "Preparing deposit" });
      const deposit = await craftDeposit(
        { inputMint, outputMint, userAddress: walletAddress, amount: atomicAmount },
        token,
      );

      setStatus({ kind: "placing", step: "Awaiting signature" });
      const depositSignedTx = await signTxBase64(deposit.transaction);

      setStatus({ kind: "placing", step: "Submitting order" });
      const order = await createOrder(
        {
          depositRequestId: deposit.requestId,
          depositSignedTx,
          userPubkey: walletAddress,
          inputMint,
          inputAmount: atomicAmount,
          outputMint,
          triggerMint: ticker.mint,
          triggerCondition,
          triggerPriceUsd: triggerPrice,
          slippageBps: TRIGGER_DEFAULT_SLIPPAGE_BPS,
          expiresAt: Date.now() + TRIGGER_DEFAULT_EXPIRY_MS,
        },
        token,
      );

      setStatus({ kind: "done", orderId: order.id, signature: order.txSignature });
      setAmountInput("");
      onBalanceChange();
      onOrderPlaced();
    } catch (err) {
      // A stale JWT shows up as an auth error; drop it so the next try re-auths.
      resetAuth();
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const amountDigits = inputSymbol === "USDC" ? 2 : 4;

  if (status.kind === "done") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-aeras-border dark:border-white/10 bg-aeras-surface dark:bg-white/5 p-3 text-sm">
          <div className="font-medium text-aeras-positive">Limit order placed</div>
          <div className="mt-1 break-all font-mono text-xs text-aeras-300 dark:text-white/50">
            {status.orderId}
          </div>
          {status.signature && (
            <a
              href={`${SOLSCAN_TX_BASE}${status.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block break-all font-mono text-xs text-aeras-positive underline decoration-aeras-border dark:decoration-white/10"
            >
              {status.signature}
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={() => setStatus({ kind: "idle" })}
          className="w-full rounded-lg border border-aeras-border dark:border-white/10 px-4 py-3 text-sm font-medium text-aeras-500 dark:text-white/60 transition-colors hover:bg-aeras-surface dark:hover:bg-white/5"
        >
          New limit order
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-aeras-300 dark:text-white/50">
            Limit {isBuy ? "buy" : "sell"}
          </div>
          <div className="mt-1 text-base font-medium text-aeras-900 dark:text-white">
            {ticker.symbol}{" "}
            <span className="text-aeras-300 dark:text-white/50">· {ticker.name}</span>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-aeras-border dark:border-white/10 p-0.5 text-xs">
          {(["buy", "sell"] as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                direction === d
                  ? "bg-aeras-900 dark:bg-aeras-blue text-white"
                  : "text-aeras-500 dark:text-white/60 hover:text-aeras-900 dark:hover:text-white"
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
            htmlFor="limit-amount"
            className="text-xs font-medium uppercase tracking-wide text-aeras-300 dark:text-white/50"
          >
            {isBuy ? "Pay with" : "Sell amount"}
          </label>
          <span className="text-xs text-aeras-300 dark:text-white/50">
            Balance:{" "}
            {inputBalance == null
              ? "..."
              : `${inputBalance.toFixed(amountDigits)} ${inputSymbol}`}
            {inputBalance != null && inputBalance > 0 && (
              <button
                type="button"
                onClick={() => setAmountInput(inputBalance.toFixed(amountDigits))}
                className="ml-1 text-aeras-500 dark:text-white/60 underline-offset-2 hover:underline"
              >
                Max
              </button>
            )}
          </span>
        </div>
        <div className="relative">
          <input
            id="limit-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step={inputSymbol === "USDC" ? "0.01" : "0.0001"}
            value={amountInput}
            placeholder="0.00"
            onChange={(e) => setAmountInput(e.target.value)}
            className="block w-full rounded-lg border border-aeras-border dark:border-white/15 bg-white dark:bg-white/5 px-3 py-2 pr-16 text-sm text-aeras-900 dark:text-white placeholder:text-aeras-300 dark:placeholder:text-white/30 focus:border-aeras-blue focus:outline-none"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-aeras-300 dark:text-white/50">
            {inputSymbol}
          </span>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label
            htmlFor="limit-price"
            className="text-xs font-medium uppercase tracking-wide text-aeras-300 dark:text-white/50"
          >
            Trigger price (USD)
          </label>
          <span className="text-xs text-aeras-300 dark:text-white/50">
            Market: {marketPrice != null ? `$${marketPrice.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="relative">
          <input
            id="limit-price"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={priceInput}
            placeholder="0.00"
            onChange={(e) => setPriceInput(e.target.value)}
            className="block w-full rounded-lg border border-aeras-border dark:border-white/15 bg-white dark:bg-white/5 px-3 py-2 pr-10 text-sm text-aeras-900 dark:text-white placeholder:text-aeras-300 dark:placeholder:text-white/30 focus:border-aeras-blue focus:outline-none"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-aeras-300 dark:text-white/50">
            $
          </span>
        </div>
        <p className="mt-1 text-xs text-aeras-300 dark:text-white/50">
          Executes when {ticker.symbol} trades{" "}
          {triggerCondition === "below" ? "at or below" : "at or above"} this price.
          Output is not guaranteed; the swap runs at market when triggered.
        </p>
      </div>

      <div className="space-y-1 rounded-lg border border-aeras-border dark:border-white/10 bg-aeras-surface dark:bg-white/5 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-aeras-300 dark:text-white/50">Order value</span>
          <span className="tabular-nums text-aeras-900 dark:text-white">
            {orderUsd > 0 ? `$${orderUsd.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-aeras-300 dark:text-white/50">
            Est. {isBuy ? `${ticker.symbol} received` : "USDC received"}
          </span>
          <span className="tabular-nums text-aeras-900 dark:text-white">
            {estimate != null
              ? `${estimate.toFixed(isBuy ? 4 : 2)} ${isBuy ? ticker.symbol : "USDC"}`
              : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-aeras-300 dark:text-white/50">Expires</span>
          <span className="tabular-nums text-aeras-900 dark:text-white">7 days</span>
        </div>
      </div>

      {insufficient ? (
        <p className="text-xs text-aeras-negative">
          Insufficient {inputSymbol}. Need {amount}, have{" "}
          {inputBalance?.toFixed(amountDigits)}.
        </p>
      ) : belowMin && amountValid ? (
        <p className="text-xs text-aeras-300 dark:text-white/50">
          Minimum order size is ${TRIGGER_MIN_USD}.
        </p>
      ) : null}

      {status.kind === "error" && (
        <p className="rounded-lg bg-aeras-surface dark:bg-white/5 px-3 py-2 text-sm text-aeras-negative">
          {status.message}
        </p>
      )}

      <button
        type="button"
        onClick={handlePlace}
        disabled={!canSubmit}
        className="w-full rounded-lg bg-aeras-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status.kind === "placing" ? `${status.step}…` : "Place limit order"}
      </button>
    </div>
  );
}
