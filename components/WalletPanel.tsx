"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  useCreateWallet,
  useFundWallet as useFundEvmWallet,
} from "@privy-io/react-auth";
import { useFundWallet } from "@privy-io/react-auth/solana";
import { mainnet } from "viem/chains";
import { SOL_MINT } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { AssetLogo } from "@/components/AssetLogo";
import type { AccountBalances } from "@/lib/solana/balances";
import {
  groupHoldings,
  totalPortfolioUsd,
  type HoldingGroup,
} from "@/lib/solana/holdings";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import { nativeUiAmount } from "@/lib/trustware/native";
import { SendForm } from "./SendForm";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Privy's EVM funding config requires an amount whenever an asset is named, so
// USDC needs a starting figure. It is a prefill the user edits in the funding
// UI, not a fixed charge.
const USDC_FUNDING_PREFILL = "25";

export function WalletPanel({
  walletAddress,
  balances,
  balancesError,
  balancesRefreshing,
  prices,
  scan,
  onSent,
  onRefresh,
}: {
  walletAddress: string;
  balances: AccountBalances | null;
  balancesError: string | null;
  balancesRefreshing: boolean;
  prices: JupiterPriceMap | null;
  // Cross-chain holdings and native balances, scanned once by the page so both
  // the header total and these rows read from the same snapshot.
  scan: WalletScan;
  onSent: () => void;
  onRefresh: () => Promise<void> | void;
}) {
  // Expanded by default so holdings are visible as soon as they load. This panel
  // remounts on section navigation; deriving the initial state from `balances`
  // left it collapsed (hiding every row) whenever it mounted after balances had
  // already loaded. Users can still collapse it manually.
  const [open, setOpen] = useState(true);
  // Which equity group is showing its breakdown. One at a time.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const { fundWallet } = useFundWallet({
    onUserExited: () => {
      onSent();
    },
  });
  const { fundWallet: fundEvmWallet } = useFundEvmWallet();
  const { createWallet: createEvmWallet } = useCreateWallet();
  const [creatingEvm, setCreatingEvm] = useState(false);
  const { address: evmAddress } = useEmbeddedEvmWallet();

  const totalUsd = totalPortfolioUsd(
    balances,
    prices,
    scan.held,
    scan.native,
    scan.nativePrices,
  );
  // One row per equity, not per mint. TSLAx and TSLAon are the same Tesla
  // position, so they collapse into a single line that opens to show the parts.
  const groups = groupHoldings(balances, prices, scan.held);
  const hasIndirectHolding = groups.some((g) =>
    g.parts.some((p) => !p.direct),
  );

  async function handleFund(asset: "native-currency" | "USDC") {
    setFundError(null);
    try {
      await fundWallet({
        address: walletAddress,
        options: { asset },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFundError(msg);
      console.error("[fundWallet]", err);
    }
  }

  // Funding the EVM wallet is a separate hook from the Solana one: the root
  // export funds EVM wallets, the /solana subpath funds Solana wallets. The
  // chain has to be named explicitly, and Privy's EVM config requires an amount
  // whenever an asset is specified, so USDC carries a prefill the user can edit
  // in the funding UI while ETH uses the open-ended native flow.
  async function handleFundEvm(asset: "native-currency" | "USDC") {
    setFundError(null);
    try {
      // Privy provisions embedded wallets at login, and only for users who do
      // not already have one. An account created before this app asked for an
      // EVM wallet therefore has only the Solana one, and no amount of
      // reloading changes that. Create it on demand instead.
      let address = evmAddress;
      if (!address) {
        setCreatingEvm(true);
        const created = await createEvmWallet();
        address = created?.address;
      }
      if (!address) {
        throw new Error(
          "Could not create an Ethereum wallet for this account.",
        );
      }
      await fundEvmWallet({
        address,
        options:
          asset === "USDC"
            ? { chain: mainnet, asset: "USDC", amount: USDC_FUNDING_PREFILL }
            : { chain: mainnet },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFundError(msg);
      console.error("[fundWallet evm]", err);
    } finally {
      setCreatingEvm(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex w-full items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Balances
          {totalUsd != null && (
            <span className="ml-2 font-mono text-white/60 normal-case tracking-normal">
              · ${totalUsd.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-3 text-xs text-white/50">
          <button
            type="button"
            onClick={() => onRefresh()}
            disabled={balancesRefreshing}
            className="underline-offset-2 hover:text-white hover:underline disabled:opacity-50"
          >
            {balancesRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="hover:text-white"
          >
            {open ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {balancesError && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
          Balance fetch interrupted. {balancesError}
        </p>
      )}

      {open && balances && (
        <>
          <div>
            <BalanceRow
              label="SOL"
              sublabel="Solana"
              amount={balances.sol}
              decimals={6}
              usd={
                prices?.[SOL_MINT]?.usdPrice
                  ? balances.sol * prices[SOL_MINT].usdPrice
                  : null
              }
              icon={
                <AssetLogo
                  xstock={{ symbol: "SOL", name: "Solana", logo: "/logos/solana.jpg" }}
                  size={30}
                />
              }
            />
            <BalanceRow
              label="USDC"
              sublabel="US Dollar"
              amount={balances.usdc}
              decimals={2}
              usd={balances.usdc}
              icon={
                <AssetLogo
                  xstock={{ symbol: "USDC", name: "USD Coin", logo: "/logos/usdc.png" }}
                  size={30}
                />
              }
            />
            {groups.map((group) => (
              <HoldingRow
                key={group.key}
                group={group}
                expanded={expandedKey === group.key}
                onToggle={() =>
                  setExpandedKey(expandedKey === group.key ? null : group.key)
                }
              />
            ))}
            {scan.native.map((n) => {
              const amount = nativeUiAmount(n);
              const price = scan.nativePrices[n.priceId];
              return (
                <BalanceRow
                  key={`${n.chain}:${n.symbol}`}
                  label={n.symbol}
                  sublabel={n.chainLabel}
                  amount={amount}
                  decimals={6}
                  usd={price ? amount * price : null}
                  icon={
                    <AssetLogo
                      xstock={{ symbol: n.symbol, name: n.chainLabel }}
                      size={30}
                    />
                  }
                  badge={
                    <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
                      Gas
                    </span>
                  }
                />
              );
            })}
            {balances.usdc === 0 &&
              balances.sol === 0 &&
              scan.native.length === 0 &&
              groups.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-white/50">
                  No balances yet. Fund USDC or SOL to start.
                </div>
              )}
          </div>

          {hasIndirectHolding && (
            <p className="px-3.5 text-[11px] text-white/50">
              Ondo tokens are a different mint from the xStocks this app trades.
              Deposit one as collateral in Borrow and it converts first.
            </p>
          )}

          <div className="space-y-2">
            <FundRow label="Solana">
              <ActionButton onClick={() => handleFund("USDC")}>
                Fund USDC
              </ActionButton>
              <ActionButton onClick={() => handleFund("native-currency")}>
                Fund SOL
              </ActionButton>
            </FundRow>
            <FundRow label="Ethereum">
              <ActionButton onClick={() => handleFundEvm("USDC")}>
                {creatingEvm ? "Setting up…" : "Fund USDC"}
              </ActionButton>
              <ActionButton onClick={() => handleFundEvm("native-currency")}>
                {creatingEvm ? "Setting up…" : "Fund ETH"}
              </ActionButton>
            </FundRow>
            <div className="grid grid-cols-2 gap-2">
              <ActionButton onClick={() => setReceiving(true)}>
                Receive
              </ActionButton>
              <ActionButton onClick={() => setSending(true)}>Send</ActionButton>
            </div>
          </div>
          {fundError && (
            <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
              Funding unavailable. {fundError}
            </p>
          )}

          <Sheet open={receiving} onOpenChange={setReceiving}>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader className="border-b border-white/10">
                <SheetTitle>Receive tokens</SheetTitle>
                <SheetDescription>
                  Two wallets, one account. Send each asset to the address for
                  the chain it lives on.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3 overflow-y-auto px-4 py-4">
                <ReceiveAddress
                  label="Solana"
                  address={walletAddress}
                  accepts="SOL, USDC, xStocks, and Ondo's Solana tokens."
                />
                <EvmReceiveAddress />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={sending} onOpenChange={setSending}>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader className="border-b border-white/10">
                <SheetTitle>Send tokens</SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  From {walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}
                </SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-4 pb-4">
                <SendForm
                  walletAddress={walletAddress}
                  balances={balances}
                  prices={prices}
                  onClose={() => setSending(false)}
                  onSent={() => {
                    onSent();
                  }}
                />
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}

// A funding pair labelled with the chain it funds. Naming the chain matters:
// USDC on Solana and USDC on Ethereum are different balances in different
// wallets, and an unlabelled pair of buttons would not say which one you get.
function FundRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
        {label}
      </span>
      <div className="grid flex-1 grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function ActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15"
    >
      {children}
    </button>
  );
}

function BalanceRow({
  label,
  sublabel,
  amount,
  decimals,
  usd,
  icon,
  badge,
}: {
  label: string;
  sublabel: string;
  amount: number;
  decimals: number;
  usd: number | null;
  icon?: ReactNode;
  // Optional tag beside the symbol, used to mark a holding the app cannot
  // trade or deposit as it stands.
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2.5">
        {icon}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium tracking-tight text-white">
              {label}
            </span>
            {badge}
          </div>
          <div className="text-xs text-white/50">{sublabel}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm tabular-nums text-white">
          {amount.toLocaleString(undefined, {
            maximumFractionDigits: decimals,
          })}
        </div>
        {usd != null && (
          <div className="font-mono text-xs text-white/50">
            ${usd.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  );
}

// One receiving address, with what it accepts and a way to copy it.
function ReceiveAddress({
  label,
  address,
  accepts,
  warning,
}: {
  label: string;
  address: string;
  accepts: string;
  warning?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked. The address is on screen either way.
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          {label}
        </div>
        <button
          type="button"
          onClick={copy}
          className="text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="mt-1.5 break-all font-mono text-xs text-white">
        {address}
      </div>
      <p className="mt-1.5 text-[11px] text-white/50">{accepts}</p>
      {warning && (
        <p className="mt-1 text-[11px] text-aeras-warning">{warning}</p>
      )}
    </div>
  );
}

// The EVM half of receiving.
//
// Privy provisions an embedded EVM wallet alongside the Solana one, and it is
// the same 0x address on every EVM chain. Nothing surfaced it before, so the
// cross-chain deposit path the borrow flow already supports had no way to be
// funded.
//
// Only Ethereum and BNB Chain are named, because those are the chains the app
// can actually spend from: they are declared in Privy's supportedChains and
// carry registered equivalents. Assets sent on any other EVM chain arrive at
// this same address and then cannot be moved from here, so the warning says so
// rather than leaving it to be discovered.
function EvmReceiveAddress() {
  const { address, ready } = useEmbeddedEvmWallet();
  const { createWallet } = useCreateWallet();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready || !address) {
    // Reloading would not help: an account created before this app asked for an
    // EVM wallet simply does not have one, and Privy only provisions at login.
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Ethereum and BNB Chain
        </div>
        <p className="mt-1.5 text-[11px] text-white/50">
          This account has no Ethereum wallet yet. Creating one takes a moment
          and needs no signature.
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
          className="mt-2 w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:border-white/25 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create Ethereum wallet"}
        </button>
        {error && (
          <p className="mt-1.5 text-[11px] text-aeras-negative">{error}</p>
        )}
      </div>
    );
  }

  return (
    <ReceiveAddress
      label="Ethereum and BNB Chain"
      address={address}
      accepts="Tokenized stocks on either chain. Deposit one as collateral in Borrow and it converts to the Solana version first."
      warning="Only these two chains. Assets sent on another EVM chain reach this address but cannot be used or moved."
    />
  );
}

// One equity. A position held through a single mint renders as a plain row; one
// held through several shows the combined value and opens to the breakdown.
function HoldingRow({
  group,
  expanded,
  onToggle,
}: {
  group: HoldingGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const single = group.parts.length === 1;
  const icon = (
    <AssetLogo
      xstock={{ symbol: group.symbol, name: group.name, logo: group.logo }}
      size={30}
    />
  );

  if (single) {
    const part = group.parts[0];
    return (
      <BalanceRow
        label={part.symbol}
        sublabel={part.direct ? part.name : `${part.name} · Ondo`}
        amount={part.amount}
        decimals={6}
        usd={part.usd}
        icon={icon}
        badge={
          part.direct ? undefined : (
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
              {part.convertible ? "Converts on deposit" : "Not supported"}
            </span>
          )
        }
      />
    );
  }

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-white/5"
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <div>
            <div className="text-sm font-medium tracking-tight text-white">
              {group.symbol}
            </div>
            <div className="text-xs text-white/50">
              {group.name} · {group.parts.length} tokens
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-mono text-sm tabular-nums text-white">
              {group.usd != null ? `$${group.usd.toFixed(2)}` : "—"}
            </div>
            <div className="font-mono text-xs text-white/50">
              {group.amount.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}
            </div>
          </div>
          <ChevronDown
            className={`size-4 shrink-0 text-white/40 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>
      {expanded && (
        <div className="border-t border-white/5 bg-black/20 px-3.5 py-1">
          {group.parts.map((part) => (
            <div
              key={part.mint}
              className="flex items-center justify-between py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white">
                  {part.symbol}
                </span>
                <span className="text-[10px] text-white/40">
                  {part.chainLabel}
                </span>
                {!part.direct && (
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
                    {part.convertible ? "Converts on deposit" : "Not supported"}
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="font-mono text-xs tabular-nums text-white">
                  {part.usd != null ? `$${part.usd.toFixed(2)}` : "—"}
                </div>
                <div className="font-mono text-[11px] text-white/50">
                  {part.amount.toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

