"use client";

import { useCallback, useEffect, useState } from "react";
import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import {
  cancelOrderInit,
  confirmCancelOrder,
  listOrders,
  type TriggerOrder,
} from "@/lib/jupiter/trigger";
import { fromAtomic } from "@/lib/jupiter/ultra";
import type { TriggerAuth } from "@/lib/jupiter/use-trigger-auth";
import type { XStock } from "@/lib/jupiter/xstocks";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";

export function OpenLimitOrders({
  ticker,
  auth,
  refreshKey,
  onChanged,
  showWhenEmpty,
}: {
  ticker: XStock;
  auth: TriggerAuth;
  // Bump to force a refetch (e.g. after a new order is placed).
  refreshKey: number;
  onChanged: () => void;
  // Whether to keep the heading and its sign-in prompt on screen when there is
  // nothing to list. False on the market ticket, where a heading over a line
  // asking the user to sign in is two rows about orders they have not placed.
  showWhenEmpty: boolean;
}) {
  const { ensureToken, peekToken, reset: resetAuth } = auth;
  const signTxBase64 = useSignSolanaTxBase64();

  const [orders, setOrders] = useState<TriggerOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(
    async (forceAuth: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const token = peekToken() ?? (forceAuth ? await ensureToken() : null);
        if (!token) {
          setLoading(false);
          return;
        }
        const res = await listOrders({ state: "active", mint: ticker.mint }, token);
        setOrders(res.orders);
      } catch (err) {
        resetAuth();
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [ensureToken, peekToken, resetAuth, ticker.mint],
  );

  // Auto-load only when already authenticated, so expanding a row never forces a
  // signature prompt on its own.
  useEffect(() => {
    if (peekToken()) {
      load(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, ticker.mint]);

  async function handleCancel(orderId: string) {
    setCancelling(orderId);
    setError(null);
    try {
      const token = await ensureToken();
      const init = await cancelOrderInit(orderId, token);
      const signed = await signTxBase64(init.transaction);
      await confirmCancelOrder(
        orderId,
        { signedTransaction: signed, cancelRequestId: init.requestId },
        token,
      );
      await load(false);
      onChanged();
    } catch (err) {
      resetAuth();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(null);
    }
  }

  // Nothing loaded and nothing to say: take up no room at all.
  if (!showWhenEmpty && !error && (orders == null || orders.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Open limit orders
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="text-xs text-white/60 underline-offset-2 hover:text-white hover:underline disabled:opacity-50"
        >
          {loading ? "Loading…" : orders == null ? "Show" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-xs text-aeras-negative">{error}</p>}

      {orders == null ? (
        !error && (
          <p className="text-xs text-white/50">
            Sign in to view your open limit orders for {ticker.symbol}.
          </p>
        )
      ) : orders.length === 0 ? (
        <p className="text-xs text-white/50">No open limit orders.</p>
      ) : (
        <div className="divide-y divide-white/10 rounded-lg border border-white/10">
          {orders.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              ticker={ticker}
              cancelling={cancelling === o.id}
              onCancel={() => handleCancel(o.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderRow({
  order,
  ticker,
  cancelling,
  onCancel,
}: {
  order: TriggerOrder;
  ticker: XStock;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const isBuy = order.inputMint === USDC_MINT;
  const inputDecimals = isBuy ? USDC_DECIMALS : ticker.decimals;
  const amount = fromAtomic(order.remainingInputAmount, inputDecimals);
  const amountSymbol = isBuy ? "USDC" : ticker.symbol;

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
      <div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-medium uppercase tracking-wider ${
              isBuy ? "text-aeras-positive" : "text-aeras-negative"
            }`}
          >
            {isBuy ? "Buy" : "Sell"}
          </span>
          <span className="font-mono tabular-nums text-white">
            {amount.toFixed(isBuy ? 2 : 4)} {amountSymbol}
          </span>
        </div>
        <div className="text-[11px] text-white/50">
          {order.triggerCondition === "below" ? "≤" : "≥"} $
          {order.triggerPriceUsd.toFixed(2)} · {order.orderState}
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-white/60 transition-colors hover:bg-white/5 disabled:opacity-50"
      >
        {cancelling ? "Cancelling…" : "Cancel"}
      </button>
    </div>
  );
}
