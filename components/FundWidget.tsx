"use client";

// Add funds, as the same white card the send and receive widgets use.
//
// Three ways in, each one a row, and every one lands on Solana: that is
// where the app starts, so it is the default here rather than a chain the
// user picks. Card hands off to Privy's funding flow with the method
// pre-chosen; address opens the Receive card; "Transfer from wallet" is ours,
// connecting an external wallet for one transfer into the embedded one
// (components/ExternalTransfer.tsx). No exchange row and no cross-chain
// stock row, on request; the stock deposit sheet is still reachable from a
// held equivalent in the wallet rows.

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, CreditCard, Wallet, XIcon } from "lucide-react";

import { ExternalTransfer } from "./ExternalTransfer";

export function FundWidget({
  open,
  onOpenChange,
  solanaAddress,
  evmAddress,
  onCard,
  onReceive,
  onTransferred,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  solanaAddress: string;
  evmAddress: string | undefined;
  onCard: () => void;
  onReceive: () => void;
  onTransferred: () => Promise<void> | void;
}) {
  const [transferring, setTransferring] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setTransferring(false);
    onOpenChange(next);
  }
  // Rows that hand off elsewhere close this card first, so two dialogs never
  // stack.
  const handoff = (fn: () => void) => () => {
    handleOpenChange(false);
    fn();
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[28px] bg-white p-6 text-slate-900 shadow-[0_24px_64px_rgba(0,0,0,0.45)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Close className="absolute right-5 top-5 z-10 grid size-8 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          {transferring ? (
            <>
              <Dialog.Title className="sr-only">Transfer from wallet</Dialog.Title>
              <ExternalTransfer
                solanaAddress={solanaAddress}
                evmAddress={evmAddress}
                onBack={() => setTransferring(false)}
                onTransferred={onTransferred}
              />
            </>
          ) : (
            <>
              <Dialog.Title className="mb-1 mt-8 text-center text-xl font-medium tracking-tight text-slate-700">
                Add funds
              </Dialog.Title>
              <Dialog.Description className="mb-6 text-center text-[13px] text-slate-400">
                Move money into your Aeras wallet.
              </Dialog.Description>
              <div className="space-y-3">
                <Row icon={<Wallet className="size-5" />} title="Transfer from wallet" sub="Phantom, MetaMask, Solflare and others" onClick={() => setTransferring(true)} />
                <Row icon={<CreditCard className="size-5" />} title="Buy with card" sub="Debit or credit card, through MoonPay or Coinbase" onClick={handoff(onCard)} />
                <Row logos={["/logos/monad.png", "/logos/eth.png", "/logos/base.svg"]} title="Receive to address" sub="Monad, Ethereum, Base and others" onClick={handoff(onReceive)} />
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ logos, icon, title, sub, onClick }: { logos?: string[]; icon?: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 px-5 py-3.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      {logos ? (
        // The chains as a small fan of marks inside the same 36px tile the
        // other rows use, so the three rows line up.
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100">
          <span className="flex items-center">
            {logos.map((l, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={l}
                src={l}
                alt=""
                className="size-4 rounded-full bg-white object-contain ring-1 ring-white"
                style={{ marginLeft: i === 0 ? 0 : -5, zIndex: logos.length - i }}
              />
            ))}
          </span>
        </span>
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-[13px] font-medium text-white">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-slate-800">{title}</span>
        <span className="block truncate text-[11px] text-slate-400">{sub}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-400" />
    </button>
  );
}
