"use client";

import { useMemo, useState } from "react";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";
import {
  SOLSCAN_TX_BASE,
  SOL_MINT,
  USDC_DECIMALS,
  USDC_MINT,
} from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import type { AccountBalances } from "@/lib/solana/balances";
import { buildSendTransaction, type SendAsset } from "@/lib/solana/send";

type AssetOption = {
  key: string;
  label: string;
  asset: SendAsset;
  balance: number;
  decimals: number;
};

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string };

export function SendForm({
  walletAddress,
  balances,
  prices,
  onClose,
  onSent,
}: {
  walletAddress: string;
  balances: AccountBalances;
  prices: JupiterPriceMap | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const options = useAssetOptions(balances);
  const [optionKey, setOptionKey] = useState<string>(options[0]?.key ?? "");
  const [recipient, setRecipient] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { wallets } = useWallets();

  const option = options.find((o) => o.key === optionKey) ?? options[0];
  const amount = Number(amountInput);
  const validAmount =
    Number.isFinite(amount) && amount > 0 && option && amount <= option.balance;
  const recipientPubkey = useMemo(() => {
    try {
      if (!recipient) return null;
      const pk = new PublicKey(recipient);
      return pk;
    } catch {
      return null;
    }
  }, [recipient]);
  const validRecipient =
    recipientPubkey != null && recipientPubkey.toBase58() !== walletAddress;

  const solPrice = prices?.[SOL_MINT]?.usdPrice;

  if (!options.length) {
    return (
      <div className="rounded-lg border border-aeras-border bg-white p-4 text-sm text-aeras-500">
        Nothing to send yet — wallet is empty.
        <button
          type="button"
          onClick={onClose}
          className="ml-2 text-aeras-900 underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>
    );
  }

  async function handleSend() {
    if (!option || !validAmount || !validRecipient || !recipientPubkey) return;

    setStatus({ kind: "sending" });
    try {
      const wallet = wallets[0];
      if (!wallet) throw new Error("No Solana wallet available to sign.");

      const built = await buildSendTransaction({
        sender: walletAddress,
        recipient: recipientPubkey.toBase58(),
        asset: option.asset,
        uiAmount: amount,
      });

      const { signature } = await signAndSendTransaction({
        transaction: built.transaction,
        wallet,
      });

      const sigB58 = bs58.encode(signature);
      setStatus({ kind: "done", signature: sigB58 });
      onSent();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-3 pt-2">
      {status.kind === "done" ? (
        <SentCard signature={status.signature} onClose={onClose} />
      ) : (
        <>
          <div>
            <label
              htmlFor="send-asset"
              className="text-xs font-medium uppercase tracking-wide text-aeras-300"
            >
              Token
            </label>
            <select
              id="send-asset"
              value={optionKey}
              onChange={(e) => {
                setOptionKey(e.target.value);
                setAmountInput("");
              }}
              className="mt-1 block w-full rounded-lg border border-aeras-border bg-white px-3 py-2 text-sm text-aeras-900 focus:border-aeras-blue focus:outline-none"
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label} · {formatBalance(o.balance, o.decimals)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="send-recipient"
              className="text-xs font-medium uppercase tracking-wide text-aeras-300"
            >
              To
            </label>
            <input
              id="send-recipient"
              type="text"
              placeholder="Solana address"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              className="mt-1 block w-full rounded-lg border border-aeras-border bg-white px-3 py-2 font-mono text-xs text-aeras-900 focus:border-aeras-blue focus:outline-none"
            />
            {recipient && !recipientPubkey && (
              <p className="mt-1 text-xs text-aeras-negative">Invalid Solana address.</p>
            )}
            {recipientPubkey && recipientPubkey.toBase58() === walletAddress && (
              <p className="mt-1 text-xs text-aeras-negative">
                That's this wallet's own address.
              </p>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label
                htmlFor="send-amount"
                className="text-xs font-medium uppercase tracking-wide text-aeras-300"
              >
                Amount
              </label>
              <button
                type="button"
                onClick={() =>
                  option && setAmountInput(maxAmountStr(option))
                }
                className="text-xs text-aeras-500 underline-offset-2 hover:underline"
              >
                Max
              </button>
            </div>
            <div className="relative">
              <input
                id="send-amount"
                type="number"
                inputMode="decimal"
                step="any"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="block w-full rounded-lg border border-aeras-border bg-white px-3 py-2 pr-16 text-sm text-aeras-900 focus:border-aeras-blue focus:outline-none"
              />
              {option && (
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-aeras-300">
                  {option.label.split(" ")[0]}
                </span>
              )}
            </div>
            {amountInput && !validAmount && (
              <p className="mt-1 text-xs text-aeras-negative">
                Amount must be greater than 0 and not exceed balance.
              </p>
            )}
          </div>

          <GasEstimate balanceSol={balances.sol} solPrice={solPrice} />

          {status.kind === "error" && (
            <p className="rounded-lg bg-aeras-surface px-3 py-2 text-sm text-aeras-negative">
              {status.message}
            </p>
          )}

          <button
            type="button"
            onClick={handleSend}
            disabled={
              !validAmount ||
              !validRecipient ||
              status.kind === "sending" ||
              balances.sol < 0.001
            }
            className="w-full rounded-lg bg-aeras-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status.kind === "sending" ? "Signing and sending..." : "Confirm send"}
          </button>
        </>
      )}
    </div>
  );
}

function useAssetOptions(balances: AccountBalances): AssetOption[] {
  return useMemo(() => {
    const opts: AssetOption[] = [];
    if (balances.sol > 0) {
      opts.push({
        key: "sol",
        label: "SOL · Solana",
        asset: { kind: "sol" },
        balance: balances.sol,
        decimals: 9,
      });
    }
    if (balances.usdc > 0) {
      opts.push({
        key: USDC_MINT,
        label: "USDC",
        asset: { kind: "spl", mint: USDC_MINT, decimals: USDC_DECIMALS },
        balance: balances.usdc,
        decimals: USDC_DECIMALS,
      });
    }
    for (const x of XSTOCKS) {
      const bal = balances.xstocks[x.mint] ?? 0;
      if (bal > 0) {
        opts.push({
          key: x.mint,
          label: `${x.symbol} · ${x.name}`,
          asset: { kind: "spl", mint: x.mint, decimals: x.decimals },
          balance: bal,
          decimals: x.decimals,
        });
      }
    }
    return opts;
  }, [balances]);
}

function GasEstimate({
  balanceSol,
  solPrice,
}: {
  balanceSol: number;
  solPrice: number | undefined;
}) {
  const gasSol = 0.000005;
  const gasUsd = solPrice ? gasSol * solPrice : null;
  const noSol = balanceSol < 0.001;
  return (
    <div className="rounded-lg bg-aeras-surface px-3 py-2 text-xs">
      <div className="flex justify-between">
        <span className="text-aeras-300">Gas (paid in SOL)</span>
        <span className="tabular-nums text-aeras-500">
          ~{gasSol.toFixed(6)} SOL
          {gasUsd != null && (
            <span className="text-aeras-300"> · ${gasUsd.toFixed(4)}</span>
          )}
        </span>
      </div>
      {noSol && (
        <p className="mt-1 text-aeras-negative">
          Need at least 0.001 SOL in this wallet to send. Send some SOL here
          first.
        </p>
      )}
    </div>
  );
}

function SentCard({
  signature,
  onClose,
}: {
  signature: string;
  onClose: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-aeras-border bg-aeras-surface p-3 text-sm">
        <div className="font-medium text-aeras-positive">Sent</div>
        <a
          href={`${SOLSCAN_TX_BASE}${signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block break-all font-mono text-xs text-aeras-positive underline decoration-aeras-border"
        >
          {signature}
        </a>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-lg border border-aeras-border px-4 py-2 text-sm font-medium text-aeras-500 transition-colors hover:bg-aeras-surface"
      >
        Done
      </button>
    </div>
  );
}

function maxAmountStr(option: AssetOption): string {
  // For SOL, leave a little for gas. For SPL tokens, full balance is fine.
  if (option.asset.kind === "sol") {
    const usable = Math.max(0, option.balance - 0.001);
    return usable.toFixed(option.decimals);
  }
  return option.balance.toString();
}

function formatBalance(value: number, decimals: number): string {
  const places = Math.min(decimals, 6);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: places,
  });
}
