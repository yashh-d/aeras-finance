"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { ActivityPanel } from "@/components/ActivityPanel";
import { AssetGrid } from "@/components/AssetGrid";
import { BorrowPanel } from "@/components/BorrowPanel";
import { EarnPanel } from "@/components/EarnPanel";
import { PositionsPanel } from "@/components/PositionsPanel";
import { PriceChart } from "@/components/PriceChart";
import { SwapForm } from "@/components/SwapForm";
import { WalletPanel } from "@/components/WalletPanel";
import { WaitlistPending, type UserView } from "@/components/WaitlistPending";
import { WithdrawPanel } from "@/components/WithdrawPanel";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  vaultByCollateralMint,
  XSTOCK_BORROW_VAULTS,
} from "@/lib/jupiter/borrow";
import { fetchSparklines, type SparklinesResponse } from "@/lib/jupiter/charts";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { useJupiterPrices } from "@/lib/jupiter/use-prices";
import { XSTOCKS, type XStock } from "@/lib/jupiter/xstocks";
import {
  totalAccountUsd,
  useBalances,
  type AccountBalances,
} from "@/lib/solana/balances";

type Gate =
  | { state: "checking" }
  | { state: "approved" }
  | { state: "blocked"; user: UserView }
  | { state: "error"; message: string };

export default function AppPage() {
  const router = useRouter();
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();

  // Approval gate. On login we sync the verified Privy identity into the users
  // table and read back the access status. Approved enters the app; everyone
  // else sees the waitlist/blocked screen in place.
  const [gate, setGate] = useState<Gate>({ state: "checking" });

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      router.replace("/");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!cancelled)
            setGate({ state: "error", message: "Could not read your session." });
          return;
        }
        const res = await fetch("/api/auth/sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as {
          user?: UserView;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.user) {
          setGate({
            state: "error",
            message: data.error ?? `Sign-in failed (HTTP ${res.status}).`,
          });
          return;
        }
        if (data.user.status === "approved") {
          setGate({ state: "approved" });
        } else {
          setGate({ state: "blocked", user: data.user });
        }
      } catch (err) {
        if (!cancelled)
          setGate({
            state: "error",
            message: err instanceof Error ? err.message : "Sign-in failed.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, getAccessToken, router]);

  const embeddedSolanaWallet = user?.linkedAccounts.find(
    (account): account is WalletWithMetadata =>
      account.type === "wallet" &&
      account.walletClientType === "privy" &&
      account.chainType === "solana",
  );

  if (!ready || !authenticated || gate.state === "checking") {
    return (
      <div className="flex flex-1 items-center justify-center bg-aeras-canvas px-6 py-12">
        <main className="w-full max-w-md rounded-2xl border border-aeras-border bg-white p-8">
          <p className="text-sm text-aeras-300">Loading...</p>
        </main>
      </div>
    );
  }

  if (gate.state === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-aeras-canvas px-6 py-12">
        <main className="w-full max-w-md rounded-2xl border border-aeras-border bg-white p-8">
          <h1 className="font-light text-xl tracking-tight text-aeras-900">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-aeras-300">{gate.message}</p>
          <button
            type="button"
            onClick={logout}
            className="mt-6 text-xs text-aeras-300 underline-offset-2 hover:text-aeras-900 hover:underline"
          >
            Sign out
          </button>
        </main>
      </div>
    );
  }

  if (gate.state === "blocked") {
    return <WaitlistPending user={gate.user} onLogout={logout} />;
  }

  return (
    <SignedIn
      userEmail={user?.email?.address}
      walletAddress={embeddedSolanaWallet?.address}
      onLogout={logout}
    />
  );
}

function CopyAddressButton({
  address,
  dark,
}: {
  address: string;
  dark?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts; ignore silently.
    }
  }

  const cls = dark
    ? "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/50 underline-offset-2 hover:bg-white/10 hover:text-white"
    : "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-aeras-300 underline-offset-2 hover:bg-aeras-surface hover:text-aeras-900";

  return (
    <button type="button" onClick={handleCopy} className={cls}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function SignedIn({
  userEmail,
  walletAddress,
  onLogout,
}: {
  userEmail: string | undefined;
  walletAddress: string | undefined;
  onLogout: () => void;
}) {
  const [ticker, setTicker] = useState<XStock>(XSTOCKS[0]);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("portfolio");
  const { prices, error: pricesError } = useJupiterPrices();
  const {
    balances,
    error: balancesError,
    refreshing: balancesRefreshing,
    refresh: refreshBalances,
  } = useBalances(walletAddress);

  const tickerPrice = prices?.[ticker.mint]?.usdPrice;
  const totalUsd = totalAccountUsd(balances, prices);

  function handleAssetSelect(x: XStock) {
    setTicker(x);
    setTradeOpen(true);
  }

  return (
    <div className="flex min-h-screen flex-col bg-aeras-canvas lg:flex-row">
      {/* Sidebar (full-height dark gradient on desktop, top hero on mobile) */}
      <aside className="bg-gradient-to-br from-aeras-hero-from to-aeras-hero-to text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-72 lg:flex-col lg:p-7 xl:w-80">
        <div className="flex items-center justify-between p-6 lg:p-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/aeras-logo-white.png"
            alt="Aeras"
            className="h-24 w-auto -ml-3"
          />
          <button
            type="button"
            onClick={onLogout}
            className="text-xs text-white/60 underline-offset-2 hover:text-white hover:underline lg:hidden"
          >
            Sign out
          </button>
        </div>

        <div className="px-6 pb-6 lg:px-0 lg:pb-0 lg:mt-10">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Total balance
          </div>
          <div className="mt-1 font-mono text-[2.5rem] font-light leading-none tracking-tight tabular-nums">
            {totalUsd == null ? "—" : `$${totalUsd.toFixed(2)}`}
          </div>
          <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/50">
            <span className="inline-block size-1.5 rounded-full bg-aeras-positive" />
            Solana Mainnet · Live · 10s
          </div>
        </div>

        <nav className="hidden lg:mt-10 lg:flex lg:flex-col lg:gap-0.5">
          <SidebarNavItem
            label="Portfolio"
            active={activeSection === "portfolio"}
            onClick={() => setActiveSection("portfolio")}
          />
          <SidebarNavItem
            label="Markets"
            active={activeSection === "markets"}
            onClick={() => setActiveSection("markets")}
          />
          <SidebarNavItem
            label="Borrow"
            active={activeSection === "borrow"}
            onClick={() => setActiveSection("borrow")}
          />
          <SidebarNavItem
            label="Earn"
            active={activeSection === "earn"}
            onClick={() => setActiveSection("earn")}
          />
          <SidebarNavItem label="Hedge" />
          <SidebarNavItem
            label="Withdraw"
            active={activeSection === "withdraw"}
            onClick={() => setActiveSection("withdraw")}
          />
          <SidebarNavItem
            label="Positions"
            active={activeSection === "positions"}
            onClick={() => setActiveSection("positions")}
          />
          <SidebarNavItem
            label="Activity"
            active={activeSection === "activity"}
            onClick={() => setActiveSection("activity")}
          />
        </nav>

        <div className="hidden lg:mt-auto lg:flex lg:flex-col lg:gap-2 lg:border-t lg:border-white/10 lg:pt-5">
          <div className="text-xs text-white/60 truncate">
            {userEmail ?? "Not linked"}
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="font-mono text-white/70">
              {walletAddress
                ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
                : "Provisioning…"}
            </span>
            {walletAddress && (
              <CopyAddressButton address={walletAddress} dark />
            )}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="mt-2 self-start text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 px-6 py-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl space-y-6">
          {activeSection === "earn" ? (
            <EarnPanel prices={prices} />
          ) : activeSection === "positions" ? (
            walletAddress ? (
              <PositionsPanel
                walletAddress={walletAddress}
                balances={balances}
                prices={prices}
              />
            ) : (
              <p className="text-sm text-aeras-300">
                Waiting for embedded Solana wallet to provision...
              </p>
            )
          ) : activeSection === "withdraw" ? (
            walletAddress ? (
              <WithdrawPanel
                walletAddress={walletAddress}
                balances={balances}
                prices={prices}
                onRefresh={refreshBalances}
              />
            ) : (
              <p className="text-sm text-aeras-300">
                Waiting for embedded Solana wallet to provision...
              </p>
            )
          ) : activeSection === "borrow" ? (
            walletAddress ? (
              <BorrowSection
                walletAddress={walletAddress}
                balances={balances}
                prices={prices}
                onRefresh={refreshBalances}
              />
            ) : (
              <p className="text-sm text-aeras-300">
                Waiting for embedded Solana wallet to provision...
              </p>
            )
          ) : activeSection === "markets" ? (
            <MarketsSection
              prices={prices}
              pricesError={pricesError}
              balances={balances}
              selectedMint={ticker.mint}
              onSelect={handleAssetSelect}
            />
          ) : activeSection === "activity" ? (
            walletAddress ? (
              <ActivityPanel walletAddress={walletAddress} />
            ) : (
              <p className="text-sm text-aeras-300">
                Waiting for embedded Solana wallet to provision...
              </p>
            )
          ) : walletAddress ? (
            <>
              {/* Top row on desktop: Wallet | Assets (3/4 cols) */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <WalletPanel
                    walletAddress={walletAddress}
                    balances={balances}
                    balancesError={balancesError}
                    balancesRefreshing={balancesRefreshing}
                    prices={prices}
                    onSent={refreshBalances}
                    onRefresh={refreshBalances}
                  />
                </Card>

                <Card className="lg:col-span-2">
                  <AssetGrid
                    prices={prices}
                    pricesError={pricesError}
                    selectedMint={ticker.mint}
                    onSelect={handleAssetSelect}
                  />
                </Card>
              </div>

              {/* Chart + Borrow side by side on desktop */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                <Card className="lg:col-span-3">
                  <PriceChart ticker={ticker} />
                </Card>

                <Card className="lg:col-span-2">
                  <BorrowPanel
                    walletAddress={walletAddress}
                    balances={balances}
                    prices={prices}
                    onRefresh={refreshBalances}
                  />
                </Card>
              </div>

            </>
          ) : (
            <p className="text-sm text-aeras-300">
              Waiting for embedded Solana wallet to provision...
            </p>
          )}
        </div>
      </main>

      {walletAddress && (
        <Sheet open={tradeOpen} onOpenChange={setTradeOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader className="border-b border-aeras-border">
              <SheetTitle>
                Trade {ticker.symbol}{" "}
                <span className="font-normal text-aeras-300">
                  · {ticker.name}
                </span>
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {tickerPrice != null
                  ? `$${tickerPrice.toFixed(2)} · Jupiter Ultra route`
                  : "Loading price..."}
              </SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto px-4 pb-4">
              {tradeOpen && (
                <SwapForm
                  ticker={ticker}
                  walletAddress={walletAddress}
                  prices={prices}
                  balances={balances}
                  onBalanceChange={refreshBalances}
                />
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-aeras-border bg-white p-5 lg:p-6 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function MarketsSection({
  prices,
  pricesError,
  balances,
  selectedMint,
  onSelect,
}: {
  prices: JupiterPriceMap | null;
  pricesError: string | null;
  balances: AccountBalances | null;
  selectedMint: string;
  onSelect: (xstock: XStock) => void;
}) {
  const [sparks, setSparks] = useState<SparklinesResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await fetchSparklines();
        if (!cancelled) setSparks(next);
      } catch {
        // Sparklines are nice-to-have; skip silently on failure.
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          Markets
        </div>
        <h2 className="font-light text-2xl tracking-tight text-aeras-900">
          Tokenized stocks
        </h2>
        <p className="text-sm text-aeras-300">
          Buy and sell xStocks issued by Backed Finance. Orders route through
          Jupiter Ultra for best execution. xStocks are tokenized
          representations; holders do not have direct shareholder rights.
        </p>
      </div>

      <div className="rounded-2xl border border-aeras-border bg-white p-5 lg:p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
              Catalog
            </div>
            <div className="mt-1 text-sm font-medium tracking-tight text-aeras-900">
              {XSTOCKS.length} assets
            </div>
          </div>
          {pricesError ? (
            <span className="inline-flex items-center gap-1 text-xs text-aeras-warning">
              <span className="inline-block size-1.5 rounded-full bg-aeras-warning" />
              Price feed offline
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-aeras-300">
              <span className="inline-block size-1.5 rounded-full bg-aeras-positive" />
              Live · 10s
            </span>
          )}
        </div>

        <div className="mt-5 divide-y divide-aeras-border">
          <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
            <div className="col-span-4">Asset</div>
            <div className="col-span-2 text-right">Price</div>
            <div className="col-span-1 text-right">24h</div>
            <div className="col-span-2 text-center">7d</div>
            <div className="col-span-2 text-right">Holdings</div>
            <div className="col-span-1 text-right" />
          </div>
          {XSTOCKS.map((x) => (
            <MarketsRow
              key={x.mint}
              xstock={x}
              entry={prices?.[x.mint]}
              sparkline={sparks?.[x.mint]}
              held={balances?.xstocks[x.mint] ?? 0}
              selected={selectedMint === x.mint}
              borrowable={vaultByCollateralMint(x.mint) != null}
              onSelect={() => onSelect(x)}
            />
          ))}
        </div>
      </div>

      <p className="text-[11px] text-aeras-300">
        xStocks are subject to KYC and geographic restrictions at the issuer
        level. {XSTOCK_BORROW_VAULTS.length} of {XSTOCKS.length} are borrowable
        on Jupiter Lend today; the rest can be held and sold but not used as
        collateral yet.
      </p>
    </div>
  );
}

function MarketsRow({
  xstock,
  entry,
  sparkline,
  held,
  selected,
  borrowable,
  onSelect,
}: {
  xstock: XStock;
  entry: JupiterPriceMap[string] | undefined;
  sparkline: number[] | undefined;
  held: number;
  selected: boolean;
  borrowable: boolean;
  onSelect: () => void;
}) {
  const price = entry?.usdPrice;
  const change = entry?.priceChange24h;
  const positive = change == null ? null : change >= 0;
  const changeColor =
    positive == null
      ? "text-aeras-300"
      : positive
        ? "text-aeras-positive"
        : "text-aeras-negative";
  const sparkStroke =
    positive == null
      ? "stroke-aeras-100"
      : positive
        ? "stroke-aeras-positive"
        : "stroke-aeras-negative";
  const heldUsd = price != null ? held * price : null;
  return (
    <div
      className={`grid grid-cols-12 items-center gap-2 py-3 text-sm ${
        selected ? "bg-aeras-blue-wash/40" : ""
      }`}
    >
      <div className="col-span-4">
        <div className="flex items-center gap-2">
          <span className="font-medium tracking-tight text-aeras-900">
            {xstock.symbol}
          </span>
          {borrowable && (
            <span className="rounded-md bg-aeras-blue-wash px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-aeras-blue">
              Collateral
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-aeras-300">{xstock.name}</div>
      </div>
      <div className="col-span-2 text-right font-mono tabular-nums text-aeras-900">
        {price == null ? "—" : `$${formatPrice(price)}`}
      </div>
      <div
        className={`col-span-1 text-right font-mono tabular-nums text-xs ${changeColor}`}
      >
        {change == null
          ? "—"
          : `${positive ? "+" : ""}${change.toFixed(2)}%`}
      </div>
      <div className="col-span-2 flex justify-center">
        <RowSparkline values={sparkline} strokeClassName={sparkStroke} />
      </div>
      <div className="col-span-2 text-right">
        {held > 0 ? (
          <>
            <div className="font-mono tabular-nums text-aeras-900">
              {held.toFixed(4)}
            </div>
            {heldUsd != null && (
              <div className="font-mono text-[11px] text-aeras-300">
                ${heldUsd.toFixed(2)}
              </div>
            )}
          </>
        ) : (
          <span className="font-mono text-[11px] text-aeras-300">—</span>
        )}
      </div>
      <div className="col-span-1 text-right">
        <button
          type="button"
          onClick={onSelect}
          className="rounded-lg bg-aeras-blue px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-aeras-blue-medium"
        >
          Trade
        </button>
      </div>
    </div>
  );
}

function RowSparkline({
  values,
  strokeClassName,
}: {
  values: number[] | undefined;
  strokeClassName: string;
}) {
  const W = 96;
  const H = 24;
  if (!values || values.length < 2) {
    return <div style={{ width: W, height: H }} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = W / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = H - ((v - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="overflow-visible"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClassName}
      />
    </svg>
  );
}

function formatPrice(price: number): string {
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

function BorrowSection({
  walletAddress,
  balances,
  prices,
  onRefresh,
}: {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          Borrow
        </div>
        <h2 className="font-light text-2xl tracking-tight text-aeras-900">
          Borrow USDC against your xStocks
        </h2>
        <p className="text-sm text-aeras-300">
          Pledge tokenized stocks as collateral, draw USDC at a variable rate,
          repay any time. Positions route to Jupiter Lend on Solana.
        </p>
      </div>

      <VaultCatalog balances={balances} prices={prices} />

      <div className="rounded-2xl border border-aeras-border bg-white p-5 lg:p-6">
        <BorrowPanel
          walletAddress={walletAddress}
          balances={balances}
          prices={prices}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}

function VaultCatalog({
  balances,
  prices,
}: {
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
}) {
  return (
    <div className="rounded-2xl border border-aeras-border bg-white p-5 lg:p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
            Markets
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-aeras-900">
            Available vaults
          </div>
        </div>
        <span className="text-xs text-aeras-300">
          via <span className="text-aeras-blue">Jupiter Lend</span>
        </span>
      </div>

      <div className="mt-5 divide-y divide-aeras-border">
        <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          <div className="col-span-4">Collateral → Borrow</div>
          <div className="col-span-2 text-right">CF</div>
          <div className="col-span-2 text-right">LT</div>
          <div className="col-span-4 text-right">Your collateral</div>
        </div>
        {XSTOCK_BORROW_VAULTS.map((v) => {
          const held = balances?.xstocks[v.collateralMint] ?? 0;
          const price = prices?.[v.collateralMint]?.usdPrice;
          const usd = price != null ? held * price : null;
          const eligible = held > 0;
          return (
            <div
              key={v.vaultId}
              className="grid grid-cols-12 items-center gap-2 py-2.5 text-sm"
            >
              <div className="col-span-4">
                <div className="font-medium tracking-tight text-aeras-900">
                  {v.collateralSymbol} → {v.borrowSymbol}
                </div>
                <div className="font-mono text-[11px] text-aeras-300">
                  #{v.vaultId}
                </div>
              </div>
              <div className="col-span-2 text-right font-mono tabular-nums text-xs text-aeras-500">
                {(v.collateralFactor / 10).toFixed(0)}%
              </div>
              <div className="col-span-2 text-right font-mono tabular-nums text-xs text-aeras-500">
                {(v.liquidationThreshold / 10).toFixed(0)}%
              </div>
              <div className="col-span-4 text-right">
                {eligible ? (
                  <>
                    <div className="font-mono tabular-nums text-sm text-aeras-900">
                      {held.toFixed(4)} {v.collateralSymbol}
                    </div>
                    {usd != null && (
                      <div className="font-mono text-[11px] text-aeras-300">
                        ${usd.toFixed(2)}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="rounded-md bg-aeras-blue-wash px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aeras-blue">
                    Buy {v.collateralSymbol} to use
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Section =
  | "portfolio"
  | "markets"
  | "earn"
  | "borrow"
  | "withdraw"
  | "positions"
  | "activity";

function SidebarNavItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const interactive = onClick != null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`group flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active
          ? "bg-white/10 text-white"
          : interactive
            ? "text-white/55 hover:bg-white/5 hover:text-white"
            : "cursor-not-allowed text-white/30"
      }`}
    >
      <span className="flex items-center gap-2">
        {label}
        {!interactive && (
          <span className="text-[9px] uppercase tracking-wider text-white/30">
            Soon
          </span>
        )}
      </span>
      {active && (
        <span className="inline-block size-1.5 rounded-full bg-aeras-blue" />
      )}
    </button>
  );
}
