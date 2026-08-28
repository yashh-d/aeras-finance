"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AmountField } from "@/components/AmountField";
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
  modeToggle,
  autoFocus = false,
}: {
  ticker: XStock;
  walletAddress: string;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  auth: TriggerAuth;
  onBalanceChange: () => void;
  onOrderPlaced: () => void;
  // Market/limit switch, rendered beside buy/sell rather than in a row of its
  // own. Owned by AssetTradePanel, which is what the switch actually controls.
  modeToggle?: ReactNode;
  autoFocus?: boolean;
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
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
          <div className="font-medium text-aeras-positive">Limit order placed</div>
          <div className="mt-1 break-all font-mono text-xs text-white/50">
            {status.orderId}
          </div>
          {status.signature && (
            <a
              href={`${SOLSCAN_TX_BASE}${status.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block break-all font-mono text-xs text-aeras-positive underline decoration-white/10"
            >
              {status.signature}
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={() => setStatus({ kind: "idle" })}
          className="w-full rounded-lg border border-white/10 px-4 py-3 text-sm font-medium text-white/60 transition-colors hover:bg-white/5"
        >
          New limit order
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* No asset identity here, and no "Limit buy" heading: the market/limit
          switch beside buy/sell already says which one this is, and both places
          this form renders name the asset directly above it. Direction and mode
          share the amount's row, as they do on the market ticket. */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <AmountField
            id="limit-amount"
            ariaLabel={`Amount to ${direction} in ${inputSymbol}`}
            autoFocus={autoFocus}
            value={amountInput}
            onChange={setAmountInput}
            unit={<span className="text-sm text-white/40">{inputSymbol}</span>}
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
        <div className="mt-2 text-xs text-white/40">
          {inputBalance == null
            ? "..."
            : `${inputBalance.toFixed(amountDigits)} ${inputSymbol} available`}
          {inputBalance != null && inputBalance > 0 && (
            <button
              type="button"
              onClick={() => setAmountInput(inputBalance.toFixed(amountDigits))}
              className="ml-1.5 text-white/60 underline-offset-2 hover:text-white hover:underline"
            >
              Max
            </button>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs text-white/40">
          Trigger price · market{" "}
          {marketPrice != null ? `$${marketPrice.toFixed(2)}` : "—"}
        </div>
        <AmountField
          id="limit-price"
          ariaLabel="Trigger price in USD"
          prefix="$"
          value={priceInput}
          onChange={setPriceInput}
          unit={
            <span className="text-sm text-white/40">
              {triggerCondition === "below" ? "or below" : "or above"}
            </span>
          }
        />
      </div>

      <div className="space-y-1 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-white/50">Order value</span>
          <span className="tabular-nums text-white">
            {orderUsd > 0 ? `$${orderUsd.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">
            Est. {isBuy ? `${ticker.symbol} received` : "USDC received"}
          </span>
          <span className="tabular-nums text-white">
            {estimate != null
              ? `${estimate.toFixed(isBuy ? 4 : 2)} ${isBuy ? ticker.symbol : "USDC"}`
              : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">Expires</span>
          <span className="tabular-nums text-white">7 days</span>
        </div>
        {/* Kept, because it is the one thing about a trigger order a user can
            get wrong: the estimate above is not a fill price. */}
        <p className="pt-1 text-xs text-white/40">
          The estimate is not guaranteed. The swap runs at market once the
          trigger is hit.
        </p>
      </div>

      {insufficient ? (
        <p className="text-xs text-aeras-negative">
          Not enough {inputSymbol}. You have{" "}
          {inputBalance?.toFixed(amountDigits)}.
        </p>
      ) : belowMin && amountValid ? (
        <p className="text-xs text-aeras-negative">
          Minimum order size is ${TRIGGER_MIN_USD}.
        </p>
      ) : null}

      {status.kind === "error" && (
        <p className="rounded-lg bg-white/5 px-3 py-2 text-sm text-aeras-negative">
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
