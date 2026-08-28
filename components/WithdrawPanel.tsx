"use client";

// Withdraw surface. The first off-ramp path is "send USDC on Solana to a
// centralized exchange deposit address (Coinbase, Kraken, Binance, etc.), then
// withdraw to your bank in the CEX UI." Aeras itself never touches fiat in v1.
// A Bridge-issued stablecoin card sits below as a teaser for the next step.

import { useMemo, useState } from "react";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
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
import type { AccountBalances } from "@/lib/solana/balances";
import { buildSendTransaction } from "@/lib/solana/send";
import { GLASS_SURFACE } from "@/lib/ui/surface";

interface Props {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string };

export function WithdrawPanel({
  walletAddress,
  balances,
  prices,
  onRefresh,
}: Props) {
  return (
    <div className="space-y-6">
      <PageHeader />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <WithdrawCard
            walletAddress={walletAddress}
            balances={balances}
            prices={prices}
            onRefresh={onRefresh}
          />
        </div>
        <div className="lg:col-span-2">
          <InstructionsCard />
        </div>
      </div>
      <CardComingSoon />
    </div>
  );
}

function PageHeader() {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        Withdraw
      </div>
      <h2 className="font-light text-2xl tracking-tight text-white">
        Off-ramp USDC to your bank
      </h2>
      <p className="text-sm text-white/50">
        Send USDC from this wallet to a centralized exchange deposit address,
        then withdraw to your bank in that exchange. Aeras does not touch fiat
        in v1.
      </p>
    </div>
  );
}

// ── Withdraw card ──────────────────────────────────────────────────────────

function WithdrawCard({
  walletAddress,
  balances,
  prices,
  onRefresh,
}: Props) {
  const usdcBalance = balances?.usdc ?? 0;
  const solBalance = balances?.sol ?? 0;
  const solPrice = prices?.[SOL_MINT]?.usdPrice;

  const [exchange, setExchange] = useState<ExchangeKey>("coinbase");
  const [recipient, setRecipient] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [confirmedNetwork, setConfirmedNetwork] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { wallet: embeddedWallet } = useEmbeddedSolanaWallet();

  const amount = Number(amountInput);
  const validAmount =
    Number.isFinite(amount) && amount > 0 && amount <= usdcBalance;

  const recipientPubkey = useMemo(() => {
    try {
      if (!recipient) return null;
      return new PublicKey(recipient);
    } catch {
      return null;
    }
  }, [recipient]);

  const validRecipient =
    recipientPubkey != null && recipientPubkey.toBase58() !== walletAddress;

  const hasSolForGas = solBalance >= 0.001;

  const exchangeMeta = EXCHANGES[exchange];

  const canSubmit =
    validAmount &&
    validRecipient &&
    confirmedNetwork &&
    hasSolForGas &&
    status.kind !== "sending";

  async function handleSend() {
    if (!recipientPubkey || !validAmount) return;
    setStatus({ kind: "sending" });
    try {
      const wallet = requireEmbeddedSolanaWallet(embeddedWallet);

      const built = await buildSendTransaction({
        sender: walletAddress,
        recipient: recipientPubkey.toBase58(),
        asset: { kind: "spl", mint: USDC_MINT, decimals: USDC_DECIMALS },
        uiAmount: amount,
      });

      const { signature } = await signAndSendTransaction({
        transaction: built.transaction,
        wallet,
      });

      const sigB58 = bs58.encode(signature);
      setStatus({ kind: "done", signature: sigB58 });
      await onRefresh();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (status.kind === "done") {
    return (
      <div className={`space-y-4 ${GLASS_SURFACE} p-5 lg:p-6`}>
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Sent
          </div>
          <div className="text-sm font-medium tracking-tight text-white">
            USDC transfer broadcast to Solana
          </div>
        </div>
        <p className="text-xs text-white/50">
          Funds typically land in {exchangeMeta.label} within 1-2 minutes.
          {" "}Once {exchangeMeta.label} credits your balance, complete the bank
          withdrawal from inside their app.
        </p>
        <a
          href={`${SOLSCAN_TX_BASE}${status.signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-aeras-positive underline decoration-white/10"
        >
          {status.signature}
        </a>
        <button
          type="button"
          onClick={() => {
            setStatus({ kind: "idle" });
            setAmountInput("");
            setRecipient("");
            setConfirmedNetwork(false);
          }}
          className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
        >
          Send another withdrawal
        </button>
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${GLASS_SURFACE} p-5 lg:p-6`}>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Send USDC
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-white">
            To a centralized exchange
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-white/50">
            Available
          </div>
          <div className="font-mono text-sm tabular-nums text-white">
            {usdcBalance.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            USDC
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-white/50">
          Destination exchange
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(EXCHANGES) as ExchangeKey[]).map((key) => {
            const meta = EXCHANGES[key];
            const active = exchange === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setExchange(key)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-aeras-blue bg-aeras-blue/15 text-aeras-blue"
                    : "border-white/10 bg-white/5 text-white/60 hover:border-white/25 hover:bg-white/5"
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label
            htmlFor="withdraw-recipient"
            className="text-xs font-medium uppercase tracking-wide text-white/50"
          >
            {exchangeMeta.label} USDC deposit address
          </label>
          <span className="text-[10px] uppercase tracking-wider text-white/50">
            Solana network
          </span>
        </div>
        <input
          id="withdraw-recipient"
          type="text"
          placeholder="Paste Solana address from your exchange"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none"
        />
        {recipient && !recipientPubkey && (
          <p className="mt-1 text-xs text-aeras-negative">
            Invalid Solana address. Make sure you copied the USDC (Solana)
            deposit address, not an ERC-20 or other network address.
          </p>
        )}
        {recipientPubkey &&
          recipientPubkey.toBase58() === walletAddress && (
            <p className="mt-1 text-xs text-aeras-negative">
              That is this wallet&apos;s own address.
            </p>
          )}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label
            htmlFor="withdraw-amount"
            className="text-xs font-medium uppercase tracking-wide text-white/50"
          >
            Amount (USDC)
          </label>
          <button
            type="button"
            onClick={() => setAmountInput(usdcBalance.toFixed(USDC_DECIMALS))}
            className="text-xs text-white/60 underline-offset-2 hover:underline"
          >
            Max
          </button>
        </div>
        <div className="relative">
          <input
            id="withdraw-amount"
            type="number"
            inputMode="decimal"
            step="any"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 pr-16 text-sm text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-white/50">
            USDC
          </span>
        </div>
        {amountInput && !validAmount && (
          <p className="mt-1 text-xs text-aeras-negative">
            Amount must be greater than 0 and not exceed your USDC balance.
          </p>
        )}
        {exchangeMeta.minDeposit && validAmount && amount < exchangeMeta.minDeposit && (
          <p className="mt-1 text-xs text-aeras-warning">
            {exchangeMeta.label} typically requires a minimum deposit of{" "}
            {exchangeMeta.minDeposit} USDC. Smaller amounts may not credit.
          </p>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/60">
        <input
          type="checkbox"
          checked={confirmedNetwork}
          onChange={(e) => setConfirmedNetwork(e.target.checked)}
          className="mt-0.5 accent-aeras-blue"
        />
        <span>
          I confirmed this address is a <strong>USDC on Solana</strong>{" "}
          deposit address in {exchangeMeta.label}. Sending to the wrong network
          (Ethereum, Polygon, Base, etc.) will lose the funds permanently.
        </span>
      </label>

      <GasEstimate balanceSol={solBalance} solPrice={solPrice} />

      {status.kind === "error" && (
        <p className="rounded-lg bg-white/5 px-3 py-2 text-sm text-aeras-negative">
          {status.message}
        </p>
      )}

      <button
        type="button"
        onClick={handleSend}
        disabled={!canSubmit}
        className="w-full rounded-xl bg-aeras-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status.kind === "sending"
          ? "Signing and sending..."
          : `Withdraw to ${exchangeMeta.label}`}
      </button>
    </div>
  );
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
    <div className="rounded-lg bg-white/5 px-3 py-2 text-xs">
      <div className="flex justify-between">
        <span className="text-white/50">Network fee (paid in SOL)</span>
        <span className="tabular-nums text-white/60">
          ~{gasSol.toFixed(6)} SOL
          {gasUsd != null && (
            <span className="text-white/50"> · ${gasUsd.toFixed(4)}</span>
          )}
        </span>
      </div>
      {noSol && (
        <p className="mt-1 text-aeras-negative">
          Need at least 0.001 SOL in this wallet to send. Fund SOL from the
          wallet panel first.
        </p>
      )}
    </div>
  );
}

// ── Instructions card ──────────────────────────────────────────────────────

function InstructionsCard() {
  return (
    <div className={`space-y-4 ${GLASS_SURFACE} p-5 lg:p-6`}>
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          How it works
        </div>
        <div className="mt-1 text-sm font-medium tracking-tight text-white">
          USDC to bank account
        </div>
      </div>
      <ol className="space-y-3 text-xs text-white/60">
        <Step n={1} title="Open your exchange">
          Log in to Coinbase, Kraken, Binance, or another USDC-supporting
          exchange. Your bank must already be linked there.
        </Step>
        <Step n={2} title="Find the USDC deposit address">
          Go to Deposit, choose <strong>USDC</strong>, and select the{" "}
          <strong>Solana</strong> network. Copy the deposit address. Do not use
          Ethereum or any other network.
        </Step>
        <Step n={3} title="Send from Aeras">
          Paste the address above, enter the amount, confirm the network, and
          submit. The transfer typically arrives in under a minute.
        </Step>
        <Step n={4} title="Convert USDC to fiat">
          In the exchange, sell USDC for your local currency (USD, EUR, GBP,
          etc.). This is usually a one-click "Convert" or market sell.
        </Step>
        <Step n={5} title="Withdraw to your bank">
          Initiate a bank withdrawal from the exchange. ACH and SEPA typically
          settle in 1-3 business days. Wire transfers settle same day for a
          fee.
        </Step>
      </ol>
      <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/50">
        Aeras never holds fiat. The exchange is responsible for KYC and the
        bank transfer. Tax reporting on disposals is your responsibility.
      </p>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-5 flex-none items-center justify-center rounded-full bg-aeras-blue/20 font-mono text-[10px] tabular-nums text-aeras-blue-medium">
        {n}
      </span>
      <div>
        <div className="text-xs font-medium text-white">{title}</div>
        <div className="mt-0.5 leading-relaxed">{children}</div>
      </div>
    </li>
  );
}

// ── Card teaser ────────────────────────────────────────────────────────────

function CardComingSoon() {
  return (
    <div className={`overflow-hidden ${GLASS_SURFACE} p-6 text-white lg:p-8`}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/80">
            Coming soon
          </div>
          <h3 className="text-xl font-light tracking-tight">
            Bridge-issued stablecoin card
          </h3>
          <p className="max-w-lg text-sm text-white/60">
            Spend USDC directly from this wallet anywhere Visa is accepted, no
            exchange round-trip and no bank withdrawal. Issued through Bridge.
          </p>
        </div>
        <div className="hidden h-32 w-52 flex-none rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-white/0 p-4 lg:block">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">
            Aeras
          </div>
          <div className="mt-6 font-mono text-xs tabular-nums text-white/70">
            •••• •••• •••• ••••
          </div>
          <div className="mt-3 text-[10px] uppercase tracking-wider text-white/40">
            Powered by Bridge
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Exchange metadata ──────────────────────────────────────────────────────

type ExchangeKey = "coinbase" | "kraken" | "binance" | "other";

const EXCHANGES: Record<
  ExchangeKey,
  { label: string; minDeposit: number | null }
> = {
  coinbase: { label: "Coinbase", minDeposit: null },
  kraken: { label: "Kraken", minDeposit: 1 },
  binance: { label: "Binance", minDeposit: 10 },
  other: { label: "Other", minDeposit: null },
};
