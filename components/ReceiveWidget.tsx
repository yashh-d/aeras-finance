"use client";

// Receive, as the same white card the send widget uses.
//
// The shape mirrors SendWidget on purpose: pick a network, then act. What
// differs is that every network is live here. Receiving needs no signature and
// no send path, so an EVM chain is as usable as Solana, and the rows are all
// enabled where the send picker greys four of them out.
//
// The address is drawn as a QR before it is drawn as text, because the reason
// someone opens this panel is to point another wallet at it, and that other
// wallet is usually on a phone.

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { QRCodeSVG } from "qrcode.react";
import { Check, ChevronLeft, ChevronRight, Copy, XIcon } from "lucide-react";
import { useCreateWallet } from "@privy-io/react-auth";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import {
  EVM_RECEIVE_WARNING,
  WALLET_CHAINS,
  type WalletChain,
} from "@/lib/ui/chains";

export function ReceiveWidget({
  open,
  onOpenChange,
  solanaAddress,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  solanaAddress: string | undefined;
}) {
  const { address: evmAddress } = useEmbeddedEvmWallet();
  const [chain, setChain] = useState<WalletChain | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) setChain(null);
    onOpenChange(next);
  }

  const address = chain
    ? chain.wallet === "solana"
      ? solanaAddress
      : evmAddress
    : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[28px] bg-white p-6 text-slate-900 shadow-[0_24px_64px_rgba(0,0,0,0.45)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Close className="absolute right-5 top-5 z-10 grid size-8 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          {chain ? (
            <>
              <Dialog.Title className="sr-only">
                Receive on {chain.label}
              </Dialog.Title>
              <AddressPanel
                chain={chain}
                address={address}
                onBack={() => setChain(null)}
              />
            </>
          ) : (
            <>
              <Dialog.Title className="mb-1 mt-8 text-center text-xl font-medium tracking-tight text-slate-700">
                Receive to your Aeras Finance wallet
              </Dialog.Title>
              <Dialog.Description className="mb-6 text-center text-[13px] text-slate-400">
                Pick the network the assets are coming from.
              </Dialog.Description>

              <div className="space-y-3">
                {WALLET_CHAINS.map((c) => (
                  <ChainRow
                    key={c.id}
                    chain={c}
                    address={
                      c.wallet === "solana" ? solanaAddress : evmAddress
                    }
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
  return (
    // Every chain is selectable, including one with no wallet yet: the panel
    // behind it offers to create the missing wallet, which is more use than a
    // dead row.
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 px-5 py-3.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
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
      <ChevronRight className="size-4 shrink-0 text-slate-400" />
    </button>
  );
}

function AddressPanel({
  chain,
  address,
  onBack,
}: {
  chain: WalletChain;
  address: string | undefined;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked. The address is on screen either way.
    }
  }

  return (
    <div className="pt-2">
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
        <span className="text-[15px] font-medium text-slate-800">
          {chain.label}
        </span>
      </div>

      {address ? (
        <>
          {/* Level M, which is what a wallet address wants: the string is
              short enough that the extra correction costs no modules a phone
              camera would notice, and the quiet zone matters more than the
              level for scanning off a screen. */}
          <div className="mt-5 flex justify-center">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <QRCodeSVG
                value={address}
                size={168}
                level="M"
                marginSize={0}
                bgColor="#ffffff"
                fgColor="#0f172a"
                title={`${chain.label} address`}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={copy}
            className="mt-4 flex w-full items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-slate-700">
              {address}
            </span>
            <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-500">
              {copied ? (
                <>
                  <Check className="size-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  Copy
                </>
              )}
            </span>
          </button>

          {chain.wallet === "evm" && (
            <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-[11px] leading-relaxed text-amber-700">
              {EVM_RECEIVE_WARNING}
            </p>
          )}
        </>
      ) : (
        <MissingWallet chain={chain} />
      )}
    </div>
  );
}

// Reloading would not help: an account created before this app asked for an
// EVM wallet simply does not have one, and Privy only provisions at login.
// Carried over from the panel this widget replaces.
function MissingWallet({ chain }: { chain: WalletChain }) {
  const { createWallet } = useCreateWallet();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (chain.wallet === "solana") {
    return (
      <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-4 text-center text-sm text-slate-500">
        Your Solana wallet is still being provisioned.
      </p>
    );
  }

  return (
    <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-4 text-center">
      <p className="text-[13px] text-slate-500">
        This account has no Ethereum wallet yet. Creating one takes a moment and
        needs no signature.
      </p>
      <button
        type="button"
        disabled={creating}
        onClick={async () => {
          setError(null);
          setCreating(true);
          try {
            await createWallet();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setCreating(false);
          }
        }}
        className="mt-3 w-full rounded-2xl bg-slate-900 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
      >
        {creating ? "Creating…" : "Create Ethereum wallet"}
      </button>
      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
