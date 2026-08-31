"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { ChevronDown, ChevronLeft, Search } from "lucide-react";
import { ActivityPanel } from "@/components/ActivityPanel";
import { AssetGrid } from "@/components/AssetGrid";
import { AssetLogo, LendingBadge } from "@/components/AssetLogo";
import { AssetTradePanel } from "@/components/AssetTradePanel";
import { BorrowPanel } from "@/components/BorrowPanel";
import { EarnPanel } from "@/components/EarnPanel";
import { HedgePanel } from "@/components/HedgePanel";
import { PerpsPanel } from "@/components/PerpsPanel";
import { PositionsPanel } from "@/components/PositionsPanel";
import { PriceChart } from "@/components/PriceChart";
import { WalletPanel } from "@/components/WalletPanel";
import { WaitlistPending, type UserView } from "@/components/WaitlistPending";
import { WithdrawPanel } from "@/components/WithdrawPanel";
import { hasLendingMarket } from "@/lib/borrow/availability";
import { fetchSparklines, type SparklinesResponse } from "@/lib/jupiter/charts";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { useJupiterPrices } from "@/lib/jupiter/use-prices";
import { useLighterBalance } from "@/lib/lighter/use-lighter-balance";
import { useMonadBalances } from "@/lib/morpho/use-monad-balances";
import { totalPortfolioUsd } from "@/lib/solana/holdings";
import { useWalletScan } from "@/lib/trustware/use-wallet-scan";
import { useTriggerAuth } from "@/lib/jupiter/use-trigger-auth";
import { GLASS_SURFACE } from "@/lib/ui/surface";
import {
  XSTOCK_CATEGORIES,
  XSTOCKS,
  type XStock,
  type XStockCategory,
} from "@/lib/jupiter/xstocks";
import {
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
  const { ready, authenticated, user, logout, getAccessToken, linkEmail } =
    usePrivy();

  // Email is the merge key for the users table (users_email_unique in
  // 0001_waitlist.sql), so a signed-in user without one cannot be resolved
  // against the waitlist or approved by an admin. Wallet login makes that
  // reachable: signing in with Phantom or MetaMask links no email at all.
  // Mirrors extractEmail in lib/privy/auth.ts, which accepts either source.
  const linkedEmail = user?.email?.address ?? user?.google?.email;

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
    // Hold the sync until an email exists rather than syncing without one and
    // patching it in later. syncFromPrivy matches on the Privy DID first, so a
    // row inserted with a null email would never adopt the waitlist row the
    // same person created through the form, and stamping the address on later
    // collides with that row on users_email_unique. That surfaces as a 500 on
    // every subsequent sign-in, with no way out from the UI. The render below
    // shows the prompt; linking re-runs this effect through `linkedEmail`.
    if (!linkedEmail) return;

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
  }, [ready, authenticated, linkedEmail, getAccessToken, router]);

  const embeddedSolanaWallet = user?.linkedAccounts.find(
    (account): account is WalletWithMetadata =>
      account.type === "wallet" &&
      account.walletClientType === "privy" &&
      account.chainType === "solana",
  );

  if (!ready || !authenticated) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12"
        style={{ backgroundColor: "#08090a" }}
      >
        <main className={`w-full max-w-md ${GLASS_SURFACE} p-8`}>
          <p className="text-sm text-white/50">Loading...</p>
        </main>
      </div>
    );
  }

  // Ahead of the gate states on purpose: without an email there is nothing to
  // sync yet, so `gate` is still "checking" and would otherwise render as an
  // indefinite loading screen.
  if (!linkedEmail) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6 py-12"
        style={{ backgroundColor: "#08090a" }}
      >
        <main className={`w-full max-w-md ${GLASS_SURFACE} p-8`}>
          <h1 className="font-light text-xl tracking-tight text-white">
            Add your email
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Your wallet is connected. Aeras uses your email to match you to your
            waitlist place and to reach you about your account.
          </p>
          <button
            type="button"
            onClick={linkEmail}
            className="mt-6 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            Add email
          </button>
          <button
            type="button"
            onClick={logout}
            className="mt-4 block text-xs text-white/50 underline-offset-2 hover:text-white hover:underline"
          >
            Sign out
          </button>
        </main>
      </div>
    );
  }

  if (gate.state === "checking") {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12"
        style={{ backgroundColor: "#08090a" }}
      >
        <main className={`w-full max-w-md ${GLASS_SURFACE} p-8`}>
          <p className="text-sm text-white/50">Loading...</p>
        </main>
      </div>
    );
  }

  if (gate.state === "error") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6 py-12"
        style={{ backgroundColor: "#08090a" }}
      >
        <main className={`w-full max-w-md ${GLASS_SURFACE} p-8`}>
          <h1 className="font-light text-xl tracking-tight text-white">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-white/50">{gate.message}</p>
          <button
            type="button"
            onClick={logout}
            className="mt-6 text-xs text-white/50 underline-offset-2 hover:text-white hover:underline"
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
      userEmail={linkedEmail}
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
    : "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/50 underline-offset-2 hover:bg-white/5 hover:text-white";

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
  // Which asset Home's grid has drilled into. Null shows the full grid.
  const [openAsset, setOpenAsset] = useState<XStock | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("portfolio");
  const { prices, error: pricesError } = useJupiterPrices();
  const {
    balances,
    error: balancesError,
    refreshing: balancesRefreshing,
    refresh: refreshBalances,
    refreshSettled: settleBalances,
  } = useBalances(walletAddress);

  // Scanned once here rather than inside the wallet card, so the header total
  // and the balance rows can never disagree about what the account holds.
  const walletScan = useWalletScan(walletAddress ?? undefined);
  // Monad balances live in the embedded EVM wallet, outside both the Solana
  // read and the Trustware scan, so the header total reads them separately.
  const monad = useMonadBalances(walletScan.evmAddress);
  // Lighter margin lives on its own L2, keyed by the embedded EVM wallet, so
  // it is a third separate read.
  const lighter = useLighterBalance(walletScan.evmAddress);
  // A deposit can spend a holding on another chain, so anything that refreshes
  // the Solana balances has to re-scan the others too. Without this the panel
  // kept showing an EVM balance the conversion had already consumed.
  const refreshScan = walletScan.refresh;
  const refreshMonad = monad.refresh;
  const refreshLighter = lighter.refresh;
  const refreshAll = useCallback(async () => {
    refreshScan();
    await Promise.all([refreshBalances(), refreshMonad(), refreshLighter()]);
  }, [refreshScan, refreshBalances, refreshMonad, refreshLighter]);
  const settleAll = useCallback(async () => {
    refreshScan();
    await Promise.all([settleBalances(), refreshMonad(), refreshLighter()]);
  }, [refreshScan, settleBalances, refreshMonad, refreshLighter]);
  const solanaTotalUsd = totalPortfolioUsd(
    balances,
    prices,
    walletScan.held,
    walletScan.native,
    walletScan.nativePrices,
    // Both were missing, and both are rendered as rows by the wallet panel
    // below. USDC withdrawn from Lighter lands on Ethereum and arrives in
    // `stables`, so without it a withdrawal read as money vanishing.
    walletScan.ondo,
    walletScan.stables,
  );
  // Monad USDC at par, MON at the native price feed's rate (0 while the price
  // is loading, so the total can only understate, never invent value).
  const monadUsd =
    (monad.balances?.usdcUi ?? 0) +
    (monad.balances?.monUi ?? 0) * (walletScan.nativePrices["monad"] ?? 0);
  // Lighter margin counts the same way: 0 while loading, so a slow read can
  // only understate the total.
  const offSolanaUsd = monadUsd + (lighter.usd ?? 0);
  const totalUsd =
    solanaTotalUsd != null
      ? solanaTotalUsd + offSolanaUsd
      : offSolanaUsd > 0
        ? offSolanaUsd
        : null;

  // Jupiter Trigger auth for the Home asset detail's limit tab. Cheap to hold:
  // it signs nothing until an order is actually placed.
  const auth = useTriggerAuth(walletAddress ?? null);

  function handleAssetSelect(x: XStock) {
    setTicker(x);
    setOpenAsset(x);
  }

  return (
    // The night canvas, on every section. It is set inline rather than as a
    // theme token: a token added to @theme needs a dev-server restart to
    // register, and a class that silently fails here drops the whole page onto
    // the white body background with white type on top of it.
    <div
      className="relative flex min-h-screen flex-col text-white lg:flex-row"
      style={{ backgroundColor: "#08090a" }}
    >
      {/* Two low-alpha pools in the brand blue. Without them the canvas reads as
          flat black and the glass surfaces have nothing to catch. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(58rem 38rem at 10% -12%, rgba(41,115,255,0.10), transparent 62%), radial-gradient(46rem 34rem at 94% 6%, rgba(87,146,255,0.055), transparent 60%)",
        }}
      />

      {/* Sidebar (full-height on desktop, top hero on mobile) */}
      <aside className="relative border-b border-white/[0.08] bg-white/[0.035] text-white backdrop-blur-2xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-72 lg:flex-col lg:border-b-0 lg:border-r lg:p-7 xl:w-80">
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
            Live · 10s
          </div>
        </div>

        <nav className="hidden lg:mt-10 lg:flex lg:flex-col lg:gap-0.5">
          <SidebarNavItem
            label="Home"
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
          <SidebarNavItem
            label="Hedge"
            active={activeSection === "hedge"}
            onClick={() => setActiveSection("hedge")}
          />
          <SidebarNavItem
            label="Perps"
            active={activeSection === "perps"}
            onClick={() => setActiveSection("perps")}
          />
          <SidebarNavItem
            label="Withdraw"
            active={activeSection === "withdraw"}
            onClick={() => setActiveSection("withdraw")}
          />
          <SidebarNavItem
            label="Portfolio"
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
            <span className="text-[10px] uppercase tracking-wider text-white/30">
              SOL
            </span>
          </div>
          {/* The embedded Ethereum wallet, shown rather than left to be
              discovered. It is a second wallet holding real assets: Ondo Perps
              withdrawals land in it, and Morpho earn funds through it. Until
              this line existed the only way to see the address was to open the
              Receive sheet, so a user looking at a withdrawal that had already
              settled had no address to check it against. */}
          {walletScan.evmAddress && (
            <div className="flex items-center gap-1 text-xs">
              <span className="font-mono text-white/70">
                {`${walletScan.evmAddress.slice(0, 6)}…${walletScan.evmAddress.slice(-4)}`}
              </span>
              <CopyAddressButton address={walletScan.evmAddress} dark />
              <span className="text-[10px] uppercase tracking-wider text-white/30">
                ETH
              </span>
            </div>
          )}
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
      <main className="relative flex-1 px-6 py-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl space-y-6">
          {activeSection === "earn" ? (
            <EarnPanel
              walletAddress={walletAddress}
              balances={balances}
              prices={prices}
              onRefresh={settleAll}
            />
          ) : activeSection === "positions" ? (
            walletAddress ? (
              <PositionsPanel
                walletAddress={walletAddress}
                balances={balances}
                prices={prices}
              />
            ) : (
              <p className="text-sm text-white/50">
                Waiting for embedded Solana wallet to provision...
              </p>
            )
          ) : activeSection === "withdraw" ? (
            walletAddress ? (
              <WithdrawPanel
                walletAddress={walletAddress}
                balances={balances}
                prices={prices}
                onRefresh={settleAll}
              />
            ) : (
              <p className="text-sm text-white/50">
                Waiting for embedded Solana wallet to provision...
              </p>
            )
          ) : activeSection === "hedge" ? (
            <HedgePanel balances={balances} prices={prices} scan={walletScan} />
          ) : activeSection === "perps" ? (
            // Balances and the cross-chain scan are for the margin card: a
            // position is opened against margin held on Ondo, but what funds
            // that margin is whatever the user holds anywhere.
            <PerpsPanel balances={balances} prices={prices} scan={walletScan} />
          ) : activeSection === "borrow" ? (
            walletAddress ? (
              <BorrowSection
                walletAddress={walletAddress}
                balances={balances}
                prices={prices}
                onRefresh={settleAll}
                onAddFunds={() => setActiveSection("markets")}
              />
            ) : (
              <p className="text-sm text-white/50">
                Waiting for embedded Solana wallet to provision...
              </p>
            )
          ) : activeSection === "markets" ? (
            <MarketsSection
              prices={prices}
              pricesError={pricesError}
              balances={balances}
              walletAddress={walletAddress ?? null}
              onRefresh={settleAll}
            />
          ) : activeSection === "activity" ? (
            walletAddress ? (
              <ActivityPanel walletAddress={walletAddress} />
            ) : (
              <p className="text-sm text-white/50">
                Waiting for embedded Solana wallet to provision...
              </p>
            )
          ) : walletAddress ? (
            <>
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
                  Home
                </div>
                <h2 className="font-light text-2xl tracking-tight text-white">
                  Your account
                </h2>
                <p className="text-sm text-white/45">
                  Fund your wallet, buy tokenized stocks, and track your balance.
                </p>
              </div>

              {/* Top row on desktop: Wallet | Assets (3/4 cols) */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <WalletPanel
                    walletAddress={walletAddress}
                    balances={balances}
                    balancesError={balancesError}
                    balancesRefreshing={balancesRefreshing}
                    prices={prices}
                    scan={walletScan}
                    onSent={settleAll}
                    onRefresh={refreshAll}
                  />
                </Card>

                <Card className="lg:col-span-2">
                  {openAsset ? (
                    <HomeAssetDetail
                      xstock={openAsset}
                      prices={prices}
                      balances={balances}
                      walletAddress={walletAddress}
                      auth={auth}
                      onRefresh={settleAll}
                      onBack={() => setOpenAsset(null)}
                    />
                  ) : (
                    <AssetGrid
                      prices={prices}
                      pricesError={pricesError}
                      selectedMint={ticker.mint}
                      onSelect={handleAssetSelect}
                      onSeeAll={() => setActiveSection("markets")}
                    />
                  )}
                </Card>
              </div>

              {/* Chart + Borrow side by side on desktop */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                <Card className="lg:col-span-2">
                  <PriceChart ticker={ticker} />
                </Card>

                <Card className="lg:col-span-3">
                  <BorrowPanel
                    walletAddress={walletAddress}
                    balances={balances}
                    prices={prices}
                    onRefresh={settleAll}
                    onAddFunds={() => setActiveSection("markets")}
                    unboxed
                  />
                </Card>
              </div>

            </>
          ) : (
            <p className="text-sm text-white/50">
              Waiting for embedded Solana wallet to provision...
            </p>
          )}
        </div>
      </main>

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
      className={`${GLASS_SURFACE} p-5 text-white lg:p-6 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function MarketsSection({
  prices,
  pricesError,
  balances,
  walletAddress,
  onRefresh,
}: {
  prices: JupiterPriceMap | null;
  pricesError: string | null;
  balances: AccountBalances | null;
  walletAddress: string | null;
  onRefresh: () => void;
}) {
  const [sparks, setSparks] = useState<SparklinesResponse | null>(null);
  const [expandedMint, setExpandedMint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<XStockCategory | "all">("all");
  // Categories the user has clicked "See all" on. Only meaningful while the
  // full catalog is showing; picking one category or typing a search reveals
  // every match on its own.
  const [openGroups, setOpenGroups] = useState<XStockCategory[]>([]);
  // One shared in-memory Trigger JWT for the whole table, so placing an order and
  // viewing it in the same expanded row don't each prompt a wallet signature.
  const auth = useTriggerAuth(walletAddress);

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

  const trimmed = query.trim();
  // Only the unfiltered catalog collapses. Once the user has narrowed to one
  // category or typed a query, hiding matches behind "See all" would bury the
  // thing they just asked for.
  const collapsible = category === "all" && trimmed === "";

  const groups = useMemo(() => {
    const q = trimmed.toLowerCase();
    return XSTOCK_CATEGORIES.filter(
      (c) => category === "all" || category === c.id,
    )
      .map((c) => ({
        ...c,
        assets: XSTOCKS.filter(
          (x) =>
            x.category === c.id &&
            (q === "" ||
              x.symbol.toLowerCase().includes(q) ||
              x.name.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.assets.length > 0);
  }, [category, trimmed]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Markets
          </div>
          <h2 className="font-light text-2xl tracking-tight text-white">
            Buy, sell and use as collateral
          </h2>
        </div>
        {pricesError ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-aeras-warning">
            <span className="inline-block size-1.5 rounded-full bg-aeras-warning" />
            Price feed offline
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-white/50">
            <span className="inline-block size-1.5 rounded-full bg-aeras-positive" />
            Live · 10s
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/40" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets"
            aria-label="Search assets"
            className="w-full rounded-lg border border-white/15 bg-white/5 py-2 pl-9 pr-3 text-sm tracking-tight text-white outline-none transition-colors placeholder:text-white/30 focus:border-aeras-blue"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <CategoryPill
            label="All"
            active={category === "all"}
            onClick={() => setCategory("all")}
          />
          {XSTOCK_CATEGORIES.map((c) => (
            <CategoryPill
              key={c.id}
              label={c.label}
              active={category === c.id}
              onClick={() => setCategory(c.id)}
            />
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className={`${GLASS_SURFACE} p-8 text-center text-sm text-white/50`}>
          No assets match that search.
        </div>
      ) : (
        groups.map((g) => {
          const open = !collapsible || openGroups.includes(g.id);
          const rows = open ? g.assets : g.assets.slice(0, GROUP_PREVIEW_ROWS);
          const truncated = collapsible && g.assets.length > GROUP_PREVIEW_ROWS;
          return (
            <div key={g.id} className={`${GLASS_SURFACE} p-5 lg:p-6`}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-medium tracking-tight text-white">
                    {g.label}
                  </h3>
                  <span className="text-[11px] tabular-nums text-white/40">
                    {g.assets.length}
                  </span>
                </div>
                {truncated && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((prev) =>
                        prev.includes(g.id)
                          ? prev.filter((id) => id !== g.id)
                          : [...prev, g.id],
                      )
                    }
                    className="text-[11px] font-medium text-white/60 transition-colors hover:text-white"
                  >
                    {open ? "Show less" : `See all ${g.assets.length}`}
                  </button>
                )}
              </div>

              <div className="mt-4 divide-y divide-white/10">
                <MarketsRowHeader />
                {rows.map((x) => {
                  const expanded = expandedMint === x.mint;
                  return (
                    <div key={x.mint}>
                      <MarketsRow
                        xstock={x}
                        entry={prices?.[x.mint]}
                        sparkline={sparks?.[x.mint]}
                        held={balances?.xstocks[x.mint] ?? 0}
                        expanded={expanded}
                        borrowable={hasLendingMarket(x.mint)}
                        onToggle={() =>
                          setExpandedMint(expanded ? null : x.mint)
                        }
                      />
                      {expanded && (
                        <MarketsRowExpanded
                          xstock={x}
                          prices={prices}
                          balances={balances}
                          walletAddress={walletAddress}
                          auth={auth}
                          onRefresh={onRefresh}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// Rows shown per category before "See all". Five keeps every group to roughly
// one screen of the card while still showing enough to judge the group.
const GROUP_PREVIEW_ROWS = 5;

// Column geometry for the catalog, shared by the header and every row so the
// figures line up. Each numeric column is a fixed width and always rendered,
// including holdings: sizing it to its content would let the rows the user
// holds shift every column left and break alignment down the list.
const MK_HOLDINGS = "hidden w-24 shrink-0 text-right lg:block";
const MK_PRICE = "w-24 shrink-0 text-right";
const MK_SPARK = "hidden w-24 shrink-0 md:block";
// Sized for a chevron alone now, not the "Trade" pill it used to hold.
const MK_ACTION = "w-8 shrink-0 flex justify-end";

function CategoryPill({
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
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium tracking-tight transition-colors ${
        active
          ? "border-white/[0.18] bg-white/[0.12] text-white"
          : "border-white/10 bg-white/[0.04] text-white/55 hover:border-white/20 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function MarketsRowHeader() {
  return (
    <div className="flex items-center gap-3 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
      <div className="min-w-0 flex-1">Asset</div>
      <div className={MK_HOLDINGS}>Holdings</div>
      <div className={MK_PRICE}>Price</div>
      <div className={`${MK_SPARK} text-center`}>7d</div>
      <div className={MK_ACTION} />
    </div>
  );
}

function MarketsRow({
  xstock,
  entry,
  sparkline,
  held,
  expanded,
  borrowable,
  onToggle,
}: {
  xstock: XStock;
  entry: JupiterPriceMap[string] | undefined;
  sparkline: number[] | undefined;
  held: number;
  expanded: boolean;
  borrowable: boolean;
  onToggle: () => void;
}) {
  const price = entry?.usdPrice;
  const change = entry?.priceChange24h;
  const positive = change == null ? null : change >= 0;
  const changeColor =
    positive == null
      ? "text-white/50"
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
    // The whole row is the control, as on the Borrow tab. "Trade" stays as a
    // visible affordance but is a span, not a button: a button inside a button
    // is invalid markup and swallows the row's own click.
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`group flex w-full items-center gap-3 py-3 text-left text-sm transition-colors ${
        expanded ? "bg-white/[0.03]" : "hover:bg-white/5"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <AssetLogo xstock={xstock} size={32} />
        <div className="min-w-0">
          <div className="truncate font-medium tracking-tight text-white">
            {xstock.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="text-[11px] text-white/45">{xstock.symbol}</span>
            {borrowable && <LendingBadge />}
          </div>
        </div>
      </div>
      <div className={MK_HOLDINGS}>
        {held > 0 ? (
          <>
            <div className="font-mono tabular-nums text-white">
              {held.toFixed(4)}
            </div>
            {heldUsd != null && (
              <div className="font-mono text-[11px] text-white/45">
                ${heldUsd.toFixed(2)}
              </div>
            )}
          </>
        ) : (
          <span className="font-mono text-[11px] text-white/35">—</span>
        )}
      </div>
      <div className={MK_PRICE}>
        <div className="font-mono tabular-nums text-white">
          {price == null ? "—" : `$${formatPrice(price)}`}
        </div>
        <div className={`font-mono text-[11px] tabular-nums ${changeColor}`}>
          {change == null ? "—" : `${positive ? "+" : ""}${change.toFixed(2)}%`}
        </div>
      </div>
      <div className={MK_SPARK}>
        <RowSparkline values={sparkline} strokeClassName={sparkStroke} />
      </div>
      {/* Just the chevron. "Trade" was a pill sitting in a row that is itself
          the button, so it read as the thing to click when clicking anywhere
          did the same job. The chevron stays because it is the only signal that
          the row opens rather than navigating, which is what the Borrow rows
          use too. */}
      <div className={MK_ACTION}>
        <ChevronDown
          className={`size-4 text-white/40 transition-transform group-hover:text-white/70 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </div>
    </button>
  );
}

function MarketsRowExpanded({
  xstock,
  prices,
  balances,
  walletAddress,
  auth,
  onRefresh,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  walletAddress: string | null;
  auth: ReturnType<typeof useTriggerAuth>;
  onRefresh: () => void;
}) {
  return (
    <div className="border-t border-white/10 px-1 py-5">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* No card around the chart. It sits flush the way Home's asset view
            draws it, and the trade panel beside it has no card either, so the
            grey box was the only thing on this row pretending to be a surface
            inside a row that is already inside one. */}
        <PriceChart ticker={xstock} heightClass="h-72" />

        <div className="space-y-4">
          {/* Opening a market is a decision to trade it, so the amount field
              takes focus with the cursor waiting, the same as Home's asset
              view. The row mounts this fresh on expand, so the focus effect
              fires each time; AmountField focuses with preventScroll, so the
              page does not jump out from under the row that was just clicked. */}
          <AssetTradePanel
            xstock={xstock}
            prices={prices}
            balances={balances}
            walletAddress={walletAddress}
            auth={auth}
            onRefresh={onRefresh}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}

// Home's drilled-in asset view. Replaces the grid in place rather than opening
// a sheet, so the chart card below stays on screen and keeps tracking the asset
// being traded. Back returns to the full grid.
function HomeAssetDetail({
  xstock,
  prices,
  balances,
  walletAddress,
  auth,
  onRefresh,
  onBack,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  walletAddress: string | undefined;
  auth: ReturnType<typeof useTriggerAuth>;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const entry = prices?.[xstock.mint];
  const change = entry?.priceChange24h;
  const positive = change == null ? null : change >= 0;
  const changeColor =
    positive == null
      ? "text-white/40"
      : positive
        ? "text-aeras-positive"
        : "text-aeras-negative";

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50 transition-colors hover:text-white"
      >
        <ChevronLeft className="size-3.5" />
        Assets
      </button>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <AssetLogo xstock={xstock} size={32} />
          <div>
            <div className="text-sm font-medium tracking-tight text-white">
              {xstock.name}
            </div>
            <div className="text-xs text-white/50">{xstock.symbol}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm tabular-nums text-white">
            {entry?.usdPrice == null ? "—" : `$${formatPrice(entry.usdPrice)}`}
          </div>
          <div className={`font-mono text-xs tabular-nums ${changeColor}`}>
            {change == null
              ? "—"
              : `${positive ? "+" : ""}${change.toFixed(2)}%`}
          </div>
        </div>
      </div>

      {/* Chart first, then the ticket. Drilling into an asset to buy it without
          seeing its price history meant leaving for the chart card below and
          losing the panel, so the full chart lives here as it does on the
          Markets tab. Unboxed and headingless: the row above already names the
          asset and prices it, and the card around this panel is border enough. */}
      <PriceChart ticker={xstock} heightClass="h-40" showHeading={false} />

      <AssetTradePanel
        xstock={xstock}
        prices={prices}
        balances={balances}
        walletAddress={walletAddress ?? null}
        auth={auth}
        onRefresh={onRefresh}
        autoFocus
      />
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
  onAddFunds,
}: {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
  onAddFunds: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
          Borrow
        </div>
        <h2 className="font-light text-2xl tracking-tight text-white">
          Borrow USDC against your tokenized stocks
        </h2>
      </div>

      <BorrowPanel
        walletAddress={walletAddress}
        balances={balances}
        prices={prices}
        onRefresh={onRefresh}
        onAddFunds={onAddFunds}
      />
    </div>
  );
}


type Section =
  | "portfolio"
  | "markets"
  | "earn"
  | "borrow"
  | "hedge"
  | "perps"
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
          ? "border border-white/[0.09] bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
          : interactive
            ? "border border-transparent text-white/55 hover:bg-white/5 hover:text-white"
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
