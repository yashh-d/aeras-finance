"use client";

// The chain picker that opens before a send.
//
// Deliberately light, against an app that is dark everywhere else. It is
// modelled on Privy's own "Add funds" modal, which the wallet panel already
// opens through useFundWallet: a white card, a centred title, and one bordered
// row per choice. Funding and sending are the two ends of the same job, so they
// are the two places that read as a system dialog rather than as app chrome.
//
// Colours here are explicit rather than shadcn tokens. The app never sets the
// `dark` class, so every token whose dark value lives in the `.dark` block of
// globals.css resolves to its LIGHT value. That has already produced white text
// on a white sheet twice (see components/ui/sheet.tsx and TriggerForm.tsx), and
// a surface that is deliberately white is exactly where the next one would hide.

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, XIcon } from "lucide-react";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { WALLET_CHAINS, type WalletChain } from "@/lib/ui/chains";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { AccountBalances } from "@/lib/solana/balances";
import { SendComposer } from "@/components/SendComposer";

export function SendWidget({
  open,
  onOpenChange,
  solanaAddress,
  balances,
  prices,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  solanaAddress: string | undefined;
  balances: AccountBalances;
  prices: JupiterPriceMap | null;
  onSent: () => void;
}) {
  // Read here rather than threaded in as a prop: the address a chain sends
  // from is this component's subject, so it resolves its own.
  const { address: evmAddress } = useEmbeddedEvmWallet();

  // null is the chain step. Cleared on close so the widget always reopens on
  // the network list rather than back inside a half-filled form.
  const [chain, setChain] = useState<WalletChain | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) setChain(null);
    onOpenChange(next);
  }

  const composing = chain != null && solanaAddress != null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[28px] bg-white p-6 text-slate-900 shadow-[0_24px_64px_rgba(0,0,0,0.45)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Close className="absolute right-5 top-5 z-10 grid size-8 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          {composing ? (
            <>
              {/* Kept for the dialog's accessible name. The composer draws its
                  own header, so a second centred title would just repeat it. */}
              <Dialog.Title className="sr-only">
                Send on {chain.label}
              </Dialog.Title>
              <SendComposer
                chain={chain}
                address={solanaAddress}
                balances={balances}
                prices={prices}
                onBack={() => setChain(null)}
                onSent={onSent}
                onClose={() => handleOpenChange(false)}
              />
            </>
          ) : (
            <>
              <Dialog.Title className="mb-1 mt-8 text-center text-xl font-medium tracking-tight text-slate-700">
                Send from your Aeras Finance wallet
              </Dialog.Title>
              <Dialog.Description className="mb-6 text-center text-[13px] text-slate-400">
                Pick the network. Each one signs from the address shown.
              </Dialog.Description>

              <div className="space-y-3">
                {WALLET_CHAINS.map((c) => (
                  <ChainRow
                    key={c.id}
                    chain={c}
                    address={c.wallet === "solana" ? solanaAddress : evmAddress}
                    onSelect={() => setChain(c)}
                  />
                ))}
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChainRow({
  chain,
  address,
  onSelect,
}: {
  chain: WalletChain;
  address: string | undefined;
  onSelect: () => void;
}) {
  // A chain with no provisioned address cannot be sent from either, so it is
  // held in the same disabled state rather than offered and failing later.
  const ready = chain.sendEnabled && address != null;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!ready}
      className={`flex w-full items-center gap-4 rounded-2xl border px-5 py-3.5 text-left transition-colors ${
        ready
          ? "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
          : "cursor-not-allowed border-slate-200 opacity-55"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={chain.logo}
        alt=""
        className="size-7 shrink-0 rounded-full object-contain"
      />

      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-slate-800">
          {chain.label}
        </span>
        <span className="block truncate font-mono text-[11px] text-slate-400">
          {address
            ? `${address.slice(0, 6)}…${address.slice(-4)}`
            : "No wallet yet"}
        </span>
      </span>

      {ready ? (
        <ChevronRight className="size-4 shrink-0 text-slate-400" />
      ) : (
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Soon
        </span>
      )}
    </button>
  );
}
