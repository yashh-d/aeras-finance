"use client";

// Step two of the send widget: pick a token, size the amount, name a recipient.
//
// Light, because it lives inside SendWidget's white card. It replaces the dark
// SendForm that used to open in a side sheet, and carries that form's logic
// forward unchanged: the same buildSendTransaction, the same Privy signer, the
// same "leave 0.001 SOL for gas" rule on Max.
//
// Two things it adds. The token switcher is a list rather than a <select>,
// because a native option cannot carry a logo, and a popover inside a dialog
// fights the dialog for focus and stacking. Swapping the card's body for a list
// is the same move the chain picker already makes, one level in. And the amount
// can be denominated in USD, which is how people size a transfer, converted at
// the same Jupiter price the rest of the app quotes.

import { useMemo, useState } from "react";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import {
  requireEmbeddedSolanaWallet,
  useEmbeddedSolanaWallet,
} from "@/lib/privy/solana";
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
import { describeSendError } from "@/lib/solana/send-errors";
import { AssetLogo } from "@/components/AssetLogo";
import type { WalletChain } from "@/lib/ui/chains";

// Left in the wallet so the next transaction can pay its own signature fee.
// Same figure the old SendForm used.
const SOL_GAS_RESERVE = 0.001;

interface TokenOption {
  key: string;
  symbol: string;
  name: string;
  logo: string | undefined;
  asset: SendAsset;
  balance: number;
  decimals: number;
  // Undefined when the price feed has no quote. USD denomination is withdrawn
  // for that token rather than shown against a made-up rate.
  usdPrice: number | undefined;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string };

type Denomination = "token" | "usd";

export function SendComposer({
  chain,
  address,
  balances,
  prices,
  onBack,
  onSent,
  onClose,
}: {
  chain: WalletChain;
  address: string;
  balances: AccountBalances;
  prices: JupiterPriceMap | null;
  onBack: () => void;
  onSent: () => void;
  onClose: () => void;
}) {
  const options = useTokenOptions(balances, prices);
  const [tokenKey, setTokenKey] = useState(options[0]?.key ?? "");
  const [pickingToken, setPickingToken] = useState(false);
  const [denom, setDenom] = useState<Denomination>("token");
  const [amountInput, setAmountInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { wallet: embeddedWallet } = useEmbeddedSolanaWallet();

  const token = options.find((o) => o.key === tokenKey) ?? options[0];
  // USD is only offered where there is a price, so a token with no quote falls
  // back to its own units rather than to a dead toggle.
  const usdReady = token?.usdPrice != null && token.usdPrice > 0;
  const activeDenom: Denomination = usdReady ? denom : "token";

  const typed = Number(amountInput);
  const typedValid = Number.isFinite(typed) && typed > 0;
  // The figure actually sent is always in token units. USD is a lens on the
  // input, never a second source of truth.
  const tokenAmount =
    !typedValid || !token
      ? 0
      : activeDenom === "usd" && token.usdPrice
        ? typed / token.usdPrice
        : typed;
  const usdAmount =
    token?.usdPrice != null ? tokenAmount * token.usdPrice : undefined;
  const validAmount = tokenAmount > 0 && token != null && tokenAmount <= token.balance;

  const recipientPubkey = useMemo(() => {
    try {
      if (!recipient) return null;
      return new PublicKey(recipient);
    } catch {
      return null;
    }
  }, [recipient]);
  const validRecipient =
    recipientPubkey != null && recipientPubkey.toBase58() !== address;

  const noSol = balances.sol < SOL_GAS_RESERVE;

  async function handleSend() {
    if (!token || !validAmount || !validRecipient || !recipientPubkey) return;
    setStatus({ kind: "sending" });
    try {
      const wallet = requireEmbeddedSolanaWallet(embeddedWallet);
      const built = await buildSendTransaction({
        sender: address,
        recipient: recipientPubkey.toBase58(),
        asset: token.asset,
        uiAmount: tokenAmount,
      });
      const { signature } = await signAndSendTransaction({
        transaction: built.transaction,
        wallet,
      });
      setStatus({ kind: "done", signature: bs58.encode(signature) });
      onSent();
    } catch (err) {
      setStatus({ kind: "error", message: describeSendError(err) });
    }
  }

  function applyMax() {
    if (!token) return;
    const max = maxTokenAmount(token);
    if (activeDenom === "usd" && token.usdPrice) {
      setAmountInput((max * token.usdPrice).toFixed(2));
    } else {
      setAmountInput(trimZeros(max.toFixed(Math.min(token.decimals, 6))));
    }
  }

  function switchDenom(next: Denomination) {
    if (next === activeDenom || !token?.usdPrice) return;
    // Carry the value across rather than clearing it, so a half-typed amount
    // survives the toggle.
    if (typedValid) {
      setAmountInput(
        next === "usd"
          ? (typed * token.usdPrice).toFixed(2)
          : trimZeros((typed / token.usdPrice).toFixed(Math.min(token.decimals, 6))),
      );
    }
    setDenom(next);
  }

  if (status.kind === "done") {
    return <SentPanel signature={status.signature} onClose={onClose} />;
  }

  if (!options.length) {
    return (
      <div className="pt-2">
        <StepHeader chain={chain} address={address} onBack={onBack} />
        <p className="mt-6 rounded-2xl bg-slate-50 px-5 py-4 text-center text-sm text-slate-500">
          Nothing to send yet. This wallet is empty.
        </p>
      </div>
    );
  }

  if (pickingToken) {
    return (
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setPickingToken(false)}
          className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-800"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        <div className="space-y-2">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                setTokenKey(o.key);
                setAmountInput("");
                setPickingToken(false);
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <AssetLogo
                xstock={{ symbol: o.symbol, name: o.name, logo: o.logo }}
                size={28}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-slate-800">
                  {o.symbol}
                </span>
                <span className="block truncate text-[11px] text-slate-400">
                  {o.name}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[13px] tabular-nums text-slate-700">
                  {formatAmount(o.balance, o.decimals)}
                </span>
                {o.usdPrice != null && (
                  <span className="block font-mono text-[11px] tabular-nums text-slate-400">
                    ${formatUsd(o.balance * o.usdPrice)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2">
      <StepHeader chain={chain} address={address} onBack={onBack} />

      {/* Token, with its balance. Tapping swaps the card body for the list. */}
      <button
        type="button"
        onClick={() => setPickingToken(true)}
        className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
      >
        {token && (
          <AssetLogo
            xstock={{ symbol: token.symbol, name: token.name, logo: token.logo }}
            size={28}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-slate-800">
            {token?.symbol}
          </span>
          <span className="block truncate text-[11px] text-slate-400">
            Balance {token ? formatAmount(token.balance, token.decimals) : "—"}
            {token?.usdPrice != null &&
              ` · $${formatUsd(token.balance * token.usdPrice)}`}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-slate-400" />
      </button>

      {/* Amount, denominated either way. */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label
            htmlFor="send-amount"
            className="text-[11px] font-medium uppercase tracking-wide text-slate-400"
          >
            Amount
          </label>
          {usdReady && (
            <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
              <DenomButton
                label="USD"
                active={activeDenom === "usd"}
                onClick={() => switchDenom("usd")}
              />
              <DenomButton
                label={token?.symbol ?? "Token"}
                active={activeDenom === "token"}
                onClick={() => switchDenom("token")}
              />
            </div>
          )}
        </div>

        <div className="relative">
          {activeDenom === "usd" && (
            <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-lg text-slate-400">
              $
            </span>
          )}
          <input
            id="send-amount"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="0"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className={`block w-full rounded-2xl border border-slate-200 py-3 pr-16 font-mono text-lg tabular-nums text-slate-900 placeholder:text-slate-300 focus:border-slate-400 focus:outline-none ${
              activeDenom === "usd" ? "pl-8" : "pl-4"
            }`}
          />
          <button
            type="button"
            onClick={applyMax}
            className="absolute inset-y-0 right-3 my-auto h-7 rounded-lg bg-slate-100 px-2.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
          >
            Max
          </button>
        </div>

        <div className="mt-1.5 flex items-start justify-between gap-2 text-[11px]">
          <span className="font-mono tabular-nums text-slate-400">
            {!typedValid || !token
              ? " "
              : activeDenom === "usd"
                ? `≈ ${formatAmount(tokenAmount, token.decimals)} ${token.symbol}`
                : usdAmount != null
                  ? `≈ $${formatUsd(usdAmount)}`
                  : " "}
          </span>
          {typedValid && token && tokenAmount > token.balance && (
            <span className="text-right text-red-500">
              More than your balance.
            </span>
          )}
        </div>
      </div>

      {/* Recipient. */}
      <div className="mt-3">
        <label
          htmlFor="send-recipient"
          className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-slate-400"
        >
          To
        </label>
        <input
          id="send-recipient"
          type="text"
          placeholder="Solana address"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          className="block w-full rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs text-slate-900 placeholder:text-slate-300 focus:border-slate-400 focus:outline-none"
        />
        {recipient && !recipientPubkey && (
          <p className="mt-1.5 text-[11px] text-red-500">
            Not a valid Solana address.
          </p>
        )}
        {recipientPubkey && recipientPubkey.toBase58() === address && (
          <p className="mt-1.5 text-[11px] text-red-500">
            That is this wallet&apos;s own address.
          </p>
        )}
      </div>

      {noSol && (
        <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-[11px] text-amber-700">
          Needs at least {SOL_GAS_RESERVE} SOL in this wallet to pay the network
          fee.
        </p>
      )}

      {status.kind === "error" && (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-[11px] text-red-600">
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
          noSol
        }
        className="mt-5 w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      >
        {status.kind === "sending" ? "Signing and sending…" : "Send"}
      </button>
    </div>
  );
}

function StepHeader({
  chain,
  address,
  onBack,
}: {
  chain: WalletChain;
  address: string;
  onBack: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ChevronLeft className="size-4" />
        Network
      </button>
      <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={chain.logo}
          alt=""
          className="size-7 shrink-0 rounded-full object-contain"
        />
        <span className="min-w-0">
          <span className="block text-[15px] font-medium text-slate-800">
            {chain.label}
          </span>
          <span className="block truncate font-mono text-[11px] text-slate-400">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        </span>
      </div>
    </>
  );
}

function DenomButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? "bg-white text-slate-800 shadow-sm"
          : "text-slate-400 hover:text-slate-600"
      }`}
    >
      {label}
    </button>
  );
}

function SentPanel({
  signature,
  onClose,
}: {
  signature: string;
  onClose: () => void;
}) {
  return (
    <div className="pt-6">
      <div className="rounded-2xl bg-emerald-50 px-4 py-4 text-center">
        <div className="text-sm font-medium text-emerald-700">Sent</div>
        <a
          href={`${SOLSCAN_TX_BASE}${signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block break-all font-mono text-[11px] text-emerald-600 underline underline-offset-2"
        >
          {signature}
        </a>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
      >
        Done
      </button>
    </div>
  );
}

// SOL, USDC, then anything in the curated list the wallet actually holds. Same
// order and same zero-balance filter the old SendForm used.
function useTokenOptions(
  balances: AccountBalances,
  prices: JupiterPriceMap | null,
): TokenOption[] {
  return useMemo(() => {
    const out: TokenOption[] = [];
    if (balances.sol > 0) {
      out.push({
        key: "sol",
        symbol: "SOL",
        name: "Solana",
        logo: "/logos/solana.png",
        asset: { kind: "sol" },
        balance: balances.sol,
        decimals: 9,
        usdPrice: prices?.[SOL_MINT]?.usdPrice,
      });
    }
    if (balances.usdc > 0) {
      out.push({
        key: USDC_MINT,
        symbol: "USDC",
        name: "USD Coin",
        logo: "/logos/usdc.png",
        asset: { kind: "spl", mint: USDC_MINT, decimals: USDC_DECIMALS },
        balance: balances.usdc,
        decimals: USDC_DECIMALS,
        usdPrice: prices?.[USDC_MINT]?.usdPrice ?? 1,
      });
    }
    for (const x of XSTOCKS) {
      const bal = balances.xstocks[x.mint] ?? 0;
      if (bal <= 0) continue;
      out.push({
        key: x.mint,
        symbol: x.symbol,
        name: x.name,
        logo: x.logo,
        asset: { kind: "spl", mint: x.mint, decimals: x.decimals },
        balance: bal,
        decimals: x.decimals,
        usdPrice: prices?.[x.mint]?.usdPrice,
      });
    }
    return out;
  }, [balances, prices]);
}

// SOL keeps a reserve back for the signature fee; an SPL transfer is paid in
// SOL, so its whole balance is sendable.
function maxTokenAmount(option: TokenOption): number {
  if (option.asset.kind === "sol") {
    return Math.max(0, option.balance - SOL_GAS_RESERVE);
  }
  return option.balance;
}

function formatAmount(value: number, decimals: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(decimals, 6),
  });
}

function formatUsd(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}
