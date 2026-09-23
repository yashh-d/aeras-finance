"use client";

// Transfer from a wallet the user already has: connect Phantom, MetaMask or
// the rest, pick something it holds that this app can use, and sign one
// transfer into the embedded wallet on the same chain. The external wallet
// signs nothing else and is never the account the app operates on; CLAUDE.md
// and lib/privy/solana.ts explain why that rule holds (silent multi-step
// flows, one identity across both chains, a destination the server pins).
//
// What is offered is what the app can use, not everything the wallet holds:
// SOL, USDC and the catalog on Solana; USDC and the gas token on the EVM
// chains the app lists. The balances come from the same readers the panel
// uses for the embedded wallet, pointed at the external address.

import { useCallback, useEffect, useMemo, useState } from "react";
import bs58 from "bs58";
import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import {
  useConnectWallet,
  usePrivy,
  useWallets,
  type ConnectedWallet,
  type WalletWithMetadata,
} from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useWallets as useSolanaWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { USDC_MINT } from "@/lib/jupiter/constants";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import { fetchAllBalances } from "@/lib/solana/balances";
import { buildSendTransaction, type SendAsset } from "@/lib/solana/send";
import { selectNativeHoldings } from "@/lib/trustware/native";
import { selectStableHoldings } from "@/lib/trustware/stables";
import type { TrustwareBalancesResponse } from "@/lib/trustware/types";
import { WALLET_CHAINS } from "@/lib/ui/chains";

// One thing an external wallet holds that can be moved in.
interface Row {
  key: string;
  symbol: string;
  chainLabel: string;
  logo?: string;
  decimals: number;
  balanceUi: number;
  send:
    | { kind: "solana"; asset: SendAsset }
    | { kind: "evm"; chainId: number; contract: string | null };
}

type Source =
  | { kind: "solana"; wallet: ConnectedStandardSolanaWallet; label: string }
  | { kind: "evm"; wallet: ConnectedWallet; label: string };

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function ExternalTransfer({
  solanaAddress,
  evmAddress,
  onBack,
  onTransferred,
}: {
  // The embedded wallets, which every transfer lands in.
  solanaAddress: string;
  evmAddress: string | undefined;
  onBack: () => void;
  onTransferred: () => Promise<void> | void;
}) {
  const { user } = usePrivy();
  const { connectWallet } = useConnectWallet();
  const { wallets: evmWallets } = useWallets();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // External wallets only. Privy's own carry walletClientType "privy" on the
  // EVM side; the Solana subpath's objects carry none, so those are told
  // apart by address against the embedded one.
  const embeddedSolana = useMemo(
    () =>
      user?.linkedAccounts.find(
        (a): a is WalletWithMetadata =>
          a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "solana",
      )?.address,
    [user],
  );
  const sources = useMemo<Source[]>(() => {
    const out: Source[] = [];
    for (const w of solanaWallets) {
      if (w.address === embeddedSolana) continue;
      out.push({ kind: "solana", wallet: w, label: `${w.standardWallet?.name ?? "Solana wallet"} · ${short(w.address)}` });
    }
    for (const w of evmWallets) {
      if (w.walletClientType === "privy") continue;
      out.push({ kind: "evm", wallet: w, label: `${w.meta?.name ?? w.walletClientType} · ${short(w.address)}` });
    }
    return out;
  }, [solanaWallets, evmWallets, embeddedSolana]);

  const [picked, setPicked] = useState<Source | null>(null);
  // A wallet that just connected is the source without another tap.
  const source = picked ?? (sources.length === 1 ? sources[0] : null);
  // Rows are stored with the address they were read for, so "loading" is
  // derived (the source moved on) rather than set by hand when it changes.
  const [loaded, setLoaded] = useState<{ address: string; rows: Row[] } | { address: string; error: string } | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const readRows = useCallback(async (s: Source): Promise<Row[]> => {
    {
      const out: Row[] = [];
      if (s.kind === "solana") {
        const b = await fetchAllBalances(s.wallet.address);
        if (b.sol > 0) out.push({ key: "sol", symbol: "SOL", chainLabel: "Solana", logo: "/logos/solana.png", decimals: 9, balanceUi: b.sol, send: { kind: "solana", asset: { kind: "sol" } } });
        if (b.usdc > 0) out.push({ key: "usdc", symbol: "USDC", chainLabel: "Solana", logo: "/logos/usdc.png", decimals: 6, balanceUi: b.usdc, send: { kind: "solana", asset: { kind: "spl", mint: USDC_MINT, decimals: 6 } } });
        for (const x of XSTOCKS) {
          const ui = b.xstocks[x.mint] ?? 0;
          if (ui > 0) out.push({ key: x.mint, symbol: x.symbol, chainLabel: "Solana", logo: x.logo, decimals: x.decimals, balanceUi: ui, send: { kind: "solana", asset: { kind: "spl", mint: x.mint, decimals: x.decimals } } });
        }
      } else {
        const res = await fetch(`/api/trustware/balances?evm=${s.wallet.address}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not read that wallet's balances.");
        const body = (await res.json()) as TrustwareBalancesResponse;
        for (const st of selectStableHoldings(body)) {
          const ui = Number(st.balanceAtomic) / 10 ** st.decimals;
          if (ui > 0) out.push({ key: `${st.chain}:usdc`, symbol: "USDC", chainLabel: st.chainLabel, logo: "/logos/usdc.png", decimals: st.decimals, balanceUi: ui, send: { kind: "evm", chainId: Number(st.chain), contract: st.contract } });
        }
        for (const n of selectNativeHoldings(body)) {
          const ui = Number(n.balanceAtomic) / 10 ** n.decimals;
          if (ui > 0) out.push({ key: `${n.chain}:native`, symbol: n.symbol, chainLabel: n.chainLabel, logo: WALLET_CHAINS.find((c) => c.evmChainId === Number(n.chain))?.logo, decimals: n.decimals, balanceUi: ui, send: { kind: "evm", chainId: Number(n.chain), contract: null } });
        }
      }
      return out;
    }
  }, []);

  // Read the source's balances once per source. State is only touched after
  // the read resolves.
  const sourceAddress = source?.wallet.address;
  useEffect(() => {
    if (!source || !sourceAddress) return;
    if (loaded?.address === sourceAddress) return;
    let cancelled = false;
    readRows(source)
      .then((rows) => {
        if (!cancelled) setLoaded({ address: sourceAddress, rows });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoaded({ address: sourceAddress, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [source, sourceAddress, loaded?.address, readRows]);
  const rows = loaded && loaded.address === sourceAddress && "rows" in loaded ? loaded.rows : [];
  const readError = loaded && loaded.address === sourceAddress && "error" in loaded ? loaded.error : null;
  const reading = Boolean(source) && loaded?.address !== sourceAddress;

  const amountNum = Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0 && row != null && amountNum <= row.balanceUi;

  async function send() {
    if (!source || !row || !validAmount) return;
    setStatus({ kind: "sending" });
    try {
      let sig: string;
      if (source.kind === "solana" && row.send.kind === "solana") {
        const built = await buildSendTransaction({
          sender: source.wallet.address,
          recipient: solanaAddress,
          asset: row.send.asset,
          uiAmount: amountNum,
        });
        const { signature } = await signAndSendTransaction({ transaction: built.transaction, wallet: source.wallet });
        sig = bs58.encode(signature);
      } else if (source.kind === "evm" && row.send.kind === "evm") {
        if (!evmAddress) throw new Error("No embedded EVM wallet to receive into.");
        await source.wallet.switchChain(row.send.chainId);
        const provider = await source.wallet.getEthereumProvider();
        const value = parseUnits(amount as `${number}`, row.decimals);
        const tx = row.send.contract
          ? { from: source.wallet.address, to: row.send.contract, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [evmAddress as `0x${string}`, value] }) }
          : { from: source.wallet.address, to: evmAddress, value: `0x${value.toString(16)}` };
        sig = (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
      } else {
        throw new Error("That asset cannot be sent from this wallet.");
      }
      setStatus({ kind: "done", message: `${amount} ${row.symbol} sent to your Aeras wallet. ${sig.slice(0, 10)}…` });
      await onTransferred();
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const busy = status.kind === "sending" || reading;

  // Step 1: pick or connect a wallet.
  if (!source) {
    return (
      <div className="pt-2">
        <Back label="Add funds" onClick={onBack} />
        <p className="mb-3 text-[13px] text-slate-400">
          Connect a wallet you already use and move funds from it into your Aeras wallet. It signs one transfer and nothing else.
        </p>
        <div className="space-y-2">
          {sources.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setPicked(s)}
              className={ROW}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-slate-800">{s.label}</span>
                <span className="block text-[11px] text-slate-400">{s.kind === "solana" ? "Solana" : "Ethereum and other EVM chains"}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" />
            </button>
          ))}
          <button type="button" onClick={() => connectWallet()} className={PRIMARY}>
            {sources.length ? "Connect another wallet" : "Connect a wallet"}
          </button>
        </div>
      </div>
    );
  }

  // Step 2: pick what to move.
  if (!row) {
    return (
      <div className="pt-2">
        <Back label="Wallets" onClick={() => setPicked(null)} />
        <div className="mb-3 rounded-2xl bg-slate-50 px-4 py-3 text-[13px] text-slate-600">{source.label}</div>
        {reading && <p className="text-[13px] text-slate-400">Reading balances…</p>}
        {readError && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-[11px] text-red-600">{readError}</p>}
        {!reading && !readError && rows.length === 0 && (
          <p className="rounded-2xl bg-slate-50 px-5 py-4 text-center text-sm text-slate-500">Nothing here this app can use.</p>
        )}
        <div className="space-y-2">
          {rows.map((r) => (
            <button key={r.key} type="button" onClick={() => setRow(r)} className={ROW}>
              {r.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.logo} alt="" className="size-7 shrink-0 rounded-full object-contain" />
              ) : (
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] text-slate-500">{r.symbol.slice(0, 2)}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-slate-800">{r.symbol}</span>
                <span className="block text-[11px] text-slate-400">{r.chainLabel}</span>
              </span>
              <span className="font-mono text-[13px] tabular-nums text-slate-700">{r.balanceUi.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 3: amount and send.
  return (
    <div className="pt-2">
      <Back label="Assets" onClick={() => { setRow(null); setAmount(""); setStatus({ kind: "idle" }); }} />
      <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
        {row.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.logo} alt="" className="size-7 shrink-0 rounded-full object-contain" />
        )}
        <span className="min-w-0">
          <span className="block text-[15px] font-medium text-slate-800">{row.symbol} on {row.chainLabel}</span>
          <span className="block truncate text-[11px] text-slate-400">to your Aeras wallet · {short(row.send.kind === "solana" ? solanaAddress : evmAddress ?? "")}</span>
        </span>
      </div>
      <div className="mt-4">
        <label htmlFor="ext-amount" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-slate-400">Amount</label>
        <div className="relative">
          <input
            id="ext-amount"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="0"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
            className="block w-full rounded-2xl border border-slate-200 py-3 pl-4 pr-16 font-mono text-lg tabular-nums text-slate-900 placeholder:text-slate-300 focus:border-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setAmount(String(row.balanceUi))}
            className="absolute inset-y-0 right-3 my-auto h-7 rounded-lg bg-slate-100 px-2.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
          >
            Max
          </button>
        </div>
        <div className="mt-1.5 flex justify-between text-[11px]">
          <span className="font-mono tabular-nums text-slate-400">{row.balanceUi.toLocaleString(undefined, { maximumFractionDigits: 6 })} {row.symbol} available</span>
          {amount && !validAmount && <span className="text-red-500">More than the wallet holds.</span>}
        </div>
      </div>
      {status.kind === "error" && <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-[11px] text-red-600">{status.message}</p>}
      {status.kind === "done" && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-[11px] text-emerald-700">{status.message}</p>}
      <button type="button" disabled={!validAmount || busy} onClick={send} className={PRIMARY}>
        {status.kind === "sending" ? "Confirm in your wallet…" : "Transfer"}
      </button>
    </div>
  );
}

function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-800">
      <ChevronLeft className="size-4" />
      {label}
    </button>
  );
}

const ROW = "flex w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50";
const PRIMARY = "mt-5 w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400";
