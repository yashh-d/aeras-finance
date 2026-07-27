"use client";

import { useState, type ReactNode } from "react";
import { useFundWallet } from "@privy-io/react-auth/solana";
import { SOL_MINT } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS, type XStock } from "@/lib/jupiter/xstocks";
import { AssetLogo } from "@/components/AssetLogo";
import type { AccountBalances } from "@/lib/solana/balances";
import { totalAccountUsd } from "@/lib/solana/balances";
import { SendForm } from "./SendForm";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function WalletPanel({
  walletAddress,
  balances,
  balancesError,
  balancesRefreshing,
  prices,
  onSent,
  onRefresh,
}: {
  walletAddress: string;
  balances: AccountBalances | null;
  balancesError: string | null;
  balancesRefreshing: boolean;
  prices: JupiterPriceMap | null;
  onSent: () => void;
  onRefresh: () => Promise<void> | void;
}) {
  // Expanded by default so holdings are visible as soon as they load. This panel
  // remounts on section navigation; deriving the initial state from `balances`
  // left it collapsed (hiding every row) whenever it mounted after balances had
  // already loaded. Users can still collapse it manually.
  const [open, setOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const { fundWallet } = useFundWallet({
    onUserExited: () => {
      onSent();
    },
  });

  const totalUsd = totalAccountUsd(balances, prices);

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
            {XSTOCKS.filter(
              (x) => (balances.xstocks[x.mint] ?? 0) > 0,
            ).map((x) => (
              <XStockRow
                key={x.mint}
                xstock={x}
                amount={balances.xstocks[x.mint] ?? 0}
                price={prices?.[x.mint]?.usdPrice}
              />
            ))}
            {balances.usdc === 0 &&
              balances.sol === 0 &&
              Object.values(balances.xstocks).every((v) => v === 0) && (
                <div className="px-3 py-4 text-center text-xs text-white/50">
                  No balances yet. Fund USDC or SOL to start.
                </div>
              )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <ActionButton onClick={() => handleFund("USDC")}>Fund USDC</ActionButton>
            <ActionButton onClick={() => handleFund("native-currency")}>Fund SOL</ActionButton>
            <ActionButton onClick={() => setSending(true)}>Send</ActionButton>
          </div>
          {fundError && (
            <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
              Funding unavailable. {fundError}
            </p>
          )}

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
}: {
  label: string;
  sublabel: string;
  amount: number;
  decimals: number;
  usd: number | null;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2.5">
        {icon}
        <div>
          <div className="text-sm font-medium tracking-tight text-white">
            {label}
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

function XStockRow({
  xstock,
  amount,
  price,
}: {
  xstock: XStock;
  amount: number;
  price: number | undefined;
}) {
  return (
    <BalanceRow
      label={xstock.symbol}
      sublabel={xstock.name}
      amount={amount}
      decimals={6}
      usd={price != null ? amount * price : null}
      icon={<AssetLogo xstock={xstock} size={30} />}
    />
  );
}

