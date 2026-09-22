"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { ChevronDown, ChevronLeft, Search } from "lucide-react";
import { ActivityPanel } from "@/components/ActivityPanel";
import { AssetGrid } from "@/components/AssetGrid";
import { AssetLogo, LendingBadge } from "@/components/AssetLogo";
import { AssetTile, ViewToggle } from "@/components/AssetTile";
import { AssetTradePanel } from "@/components/AssetTradePanel";
import { GliderMag7xCard, gliderMatchesQuery } from "@/components/glider/GliderMag7xCard";
import { BorrowPanel } from "@/components/BorrowPanel";
import { EarnPanel } from "@/components/EarnPanel";
import { HedgePanel } from "@/components/HedgePanel";
import { HomeCharts } from "@/components/HomeCharts";
import { PerpsPanel } from "@/components/PerpsPanel";
import { PositionsPanel } from "@/components/PositionsPanel";
import {
  AssetStrategyStrip,
  AssetStrategyTicket,
  useAssetStrategies,
} from "@/components/strategies/AssetStrategies";
import { StrategiesPanel } from "@/components/strategies/StrategiesPanel";
import { ModeSwitch } from "@/components/trader/ModeSwitch";
import {
  TraderShell,
  TRADER_SECTIONS,
  type TraderSection,
} from "@/components/trader/TraderShell";
import { TerminalPanel } from "@/components/TerminalPanel";
import { PriceChart } from "@/components/PriceChart";
import { WalletPanel } from "@/components/WalletPanel";
import { WaitlistPending, type UserView } from "@/components/WaitlistPending";
import { WithdrawPanel } from "@/components/WithdrawPanel";
import { hasLendingMarket } from "@/lib/borrow/availability";
import { GLIDER_LADDER_MINT } from "@/lib/glider/constants";
import { formatUsdPrice } from "@/lib/format";
import {
  DEFAULT_CHART_SELECTIONS,
  nextChartSelection,
  type ChartSelection,
} from "@/lib/jupiter/chart-assets";
import { fetchSparklines, type SparklinesResponse } from "@/lib/jupiter/charts";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { useJupiterPrices } from "@/lib/jupiter/use-prices";
import { useLighterBalance } from "@/lib/lighter/use-lighter-balance";
import { useMonadBalances } from "@/lib/morpho/use-monad-balances";
import {
  portfolioHoldings,
  sumHoldingsUsd,
  type PortfolioHolding,
} from "@/lib/solana/holdings";
import { useWalletScan, type WalletScan } from "@/lib/trustware/use-wallet-scan";
import { useTriggerAuth } from "@/lib/jupiter/use-trigger-auth";
import { useEarnPositions } from "@/lib/positions/use-earn-positions";
import { useAppMode } from "@/lib/ui/use-app-mode";
import { useViewMode } from "@/lib/ui/use-view-mode";
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
        data-app-canvas
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
        data-app-canvas
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
        data-app-canvas
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
        data-app-canvas
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
  // What the three Home charts show. Held here rather than in the chart
  // component because the asset grid steers the first slot: clicking a row
  // has to land in the same state the chart pickers write to.
  const [chartSelections, setChartSelections] = useState<ChartSelection[]>(
    () => [...DEFAULT_CHART_SELECTIONS],
  );
  // Which asset Home's grid has drilled into. Null shows the full grid.
  const [openAsset, setOpenAsset] = useState<XStock | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("portfolio");
  // Investor or Trader. Investor is every section below as it has always
  // been; Trader is components/trader, four card-first sections over the
  // same account. Trader keeps its own section so switching back and forth
  // returns each mode to where it was. See docs/trader-mode-plan.md.
  const [mode, setMode] = useAppMode();
  const [traderSection, setTraderSection] = useState<TraderSection>("earn");
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
  // The account enumerated once, one entry per asset per chain. Everything that
  // shows a total or draws holding rows reads this list, so the two cannot
  // disagree. `ondo` and `stables` are in it because the wallet panel renders
  // them as rows: USDC withdrawn from Lighter lands on Ethereum and arrives in
  // `stables`, and without it a withdrawal read as money vanishing.
  const solanaHoldings = useMemo(
    () =>
      portfolioHoldings(
        balances,
        prices,
        walletScan.held,
        walletScan.native,
        walletScan.nativePrices,
        walletScan.ondo,
        walletScan.stables,
      ),
    [
      balances,
      prices,
      walletScan.held,
      walletScan.native,
      walletScan.nativePrices,
      walletScan.ondo,
      walletScan.stables,
    ],
  );
  // Monad and Lighter sit outside the Trustware scan, so they are read
  // separately and appended here. Both count 0 while their read is in flight,
  // so a slow response can only understate the total, never invent value.
  const monPrice = walletScan.nativePrices["monad"];
  const offSolanaHoldings = useMemo<PortfolioHolding[]>(() => {
    const out: PortfolioHolding[] = [];
    const usdc = monad.balances?.usdcUi ?? 0;
    if (usdc > 0)
      out.push({
        key: "monad:USDC",
        symbol: "USDC",
        name: "US Dollar",
        chainLabel: "Monad",
        amount: usdc,
        usd: usdc,
        kind: "stable",
      });
    const mon = monad.balances?.monUi ?? 0;
    if (mon > 0 && monPrice)
      out.push({
        key: "monad:MON",
        symbol: "MON",
        name: "Gas",
        chainLabel: "Monad",
        amount: mon,
        usd: mon * monPrice,
        kind: "native",
      });
    // Not a wallet balance: it left the wallet when it was deposited, but it is
    // still the user's money. Total account value, so it moves with open
    // positions' PnL, which is why the amount and the USD figure are the same
    // number rather than a token quantity.
    if (lighter.usd != null && lighter.usd > 0)
      out.push({
        key: "lighter:USDC",
        symbol: "USDC",
        name: "Perps margin",
        chainLabel: "Lighter",
        amount: lighter.usd,
        usd: lighter.usd,
        kind: "stable",
      });
    return out;
  }, [monad.balances, monPrice, lighter.usd]);

  // Vault deposits. Same reasoning as the Lighter margin row above: the assets
  // left the token account when they were deposited and are still the user's,
  // so they are holdings rather than positions as far as this total is
  // concerned. Nothing here is double counted, because AccountBalances tracks
  // USDC, SOL and the curated xStock mints, and a deposit is held as vault
  // SHARES under a different mint entirely.
  //
  // Read once, here, and handed to the wallet card. Both totals then move on
  // one number instead of two sums of the same thing.
  const earn = useEarnPositions({
    walletAddress: walletAddress ?? undefined,
    evmAddress: walletScan.evmAddress ?? undefined,
  });
  const earnHoldings = useMemo<PortfolioHolding[]>(
    () =>
      earn.rows.map((row) => ({
        key: row.key,
        symbol: row.symbol,
        name: row.venue,
        chainLabel: row.venue,
        amount: row.amount ?? row.usd,
        usd: row.usd,
        // Every vault the app offers takes a dollar-denominated deposit today,
        // so flat is right. A vault in a volatile asset would need a chartMint
        // here or the trend line would understate it, the same gap the caption
        // already states for gas.
        kind: "stable" as const,
      })),
    [earn.rows],
  );

  const holdings = useMemo(
    () => [...solanaHoldings, ...offSolanaHoldings, ...earnHoldings],
    [solanaHoldings, offSolanaHoldings, earnHoldings],
  );
  const offSolanaUsd = sumHoldingsUsd([...offSolanaHoldings, ...earnHoldings]);
  const totalUsd =
    balances != null
      ? sumHoldingsUsd(holdings)
      : offSolanaUsd > 0
        ? offSolanaUsd
        : null;

  // Jupiter Trigger auth for the Home asset detail's limit tab. Cheap to hold:
  // it signs nothing until an order is actually placed.
  const auth = useTriggerAuth(walletAddress ?? null);

  function handleAssetSelect(x: XStock) {
    setTicker(x);
    setOpenAsset(x);
    // The first chart follows the grid, as the single chart did before there
    // were three. The other two keep whatever the user picked.
    setChartSelections((prev) => [
      { kind: "asset", key: x.mint },
      ...prev.slice(1),
    ]);
  }

  return (
    // The night canvas, on every section. It is set inline rather than as a
    // theme token: a token added to @theme needs a dev-server restart to
    // register, and a class that silently fails here drops the whole page onto
    // the white body background with white type on top of it.
    //
    // data-app-canvas carries that same colour up to the page canvas; globals.css
    // says why. Every wrapper on this surface needs it, not just this one.
    <div
      className="relative flex min-h-screen flex-col text-white lg:flex-row"
      data-app-canvas
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
      {/* No backdrop blur, for the reason GLASS_SURFACE gives: this sits beside
          the content in a flex row rather than over it, so the blur only ever
          resampled the flat canvas behind it, once per scrolled frame. */}
      <aside className="relative border-b border-white/[0.08] bg-white/[0.035] text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-72 lg:flex-col lg:border-b-0 lg:border-r lg:p-7 xl:w-80">
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

        <div className="px-6 pb-5 lg:mt-5 lg:px-0 lg:pb-0">
          <ModeSwitch mode={mode} onChange={setMode} />
        </div>

        <div className="px-6 pb-6 lg:mt-8 lg:px-0 lg:pb-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Total balance
          </div>
          <div className="mt-1 font-mono text-[2.5rem] font-light leading-none tracking-tight tabular-nums">
            {totalUsd == null ? "—" : `$${totalUsd.toFixed(2)}`}
          </div>
          <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/50">
            <span className="inline-block size-1.5 rounded-full bg-aeras-positive" />
            Live
          </div>
        </div>

        <nav className="hidden lg:mt-10 lg:flex lg:flex-col lg:gap-0.5">
          {mode === "trader" ? (
            TRADER_SECTIONS.map((s) => (
              <SidebarNavItem
                key={s.id}
                label={s.label}
                active={traderSection === s.id}
                onClick={() => setTraderSection(s.id)}
              />
            ))
          ) : (
            <>
          <SidebarNavItem
            label="Home"
            active={activeSection === "portfolio"}
            onClick={() => setActiveSection("portfolio")}
          />
          <SidebarNavItem
            label="Terminal"
            active={activeSection === "terminal"}
            onClick={() => setActiveSection("terminal")}
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
            label="Strategies"
            active={activeSection === "strategies"}
            onClick={() => setActiveSection("strategies")}
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
            </>
          )}
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
          {mode === "trader" ? (
            <TraderShell
              section={traderSection}
              walletAddress={walletAddress}
              balances={balances}
              balancesError={balancesError}
              balancesRefreshing={balancesRefreshing}
              prices={prices}
              scan={walletScan}
              earn={earn}
              holdings={holdings}
              totalUsd={totalUsd}
              onRefresh={refreshAll}
              onSettled={settleAll}
              onSwitchToInvestor={() => setMode("investor")}
            />
          ) : activeSection === "earn" ? (
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
                holdings={holdings}
                walletUsd={totalUsd}
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
          ) : activeSection === "strategies" ? (
            walletAddress ? (
              <StrategiesPanel
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
          ) : activeSection === "terminal" ? (
            // The ticket handles a wallet that is still provisioning itself,
            // so the tape, strip, chart and news show without one.
            <TerminalPanel
              prices={prices}
              pricesError={pricesError}
              balances={balances}
              scan={walletScan}
              walletAddress={walletAddress ?? null}
              auth={auth}
              onRefresh={settleAll}
            />
          ) : activeSection === "markets" ? (
            <MarketsSection
              prices={prices}
              scan={walletScan}
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

              {/* Top row on desktop: Wallet | Assets.
                  Three columns split 1/2, so the asset list gets two thirds of
                  the row. It briefly ran as five split 2/3 to line the seam up
                  with the Chart | Borrow row below, which breaks at two fifths.
                  That bought the alignment by taking 79px off the asset list
                  (measured at a 1440px viewport, so a 1160px content column),
                  and the list is what the row is for. The seam is back at a
                  third, so the two rows break 79px apart rather than on the
                  same line. Same figure either way: it is one seam moving. */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <WalletPanel
                    walletAddress={walletAddress}
                    balances={balances}
                    balancesError={balancesError}
                    balancesRefreshing={balancesRefreshing}
                    prices={prices}
                    scan={walletScan}
                    earn={earn}
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
                      scan={walletScan}
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

              {/* Charts + Borrow side by side on desktop. Three charts, each
                  its own card with its own picker across equities,
                  commodities, RWA, perps and crypto; the grid click above
                  steers the first one. HomeCharts draws its own cards, so
                  this column is a plain span rather than a Card. */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                <div className="lg:col-span-2">
                  <HomeCharts
                    selections={chartSelections}
                    onChange={(index, next) =>
                      setChartSelections((prev) =>
                        prev.map((s, i) => (i === index ? next : s)),
                      )
                    }
                    onAdd={() =>
                      setChartSelections((prev) => [
                        ...prev,
                        nextChartSelection(prev),
                      ])
                    }
                    onRemove={(index) =>
                      setChartSelections((prev) =>
                        prev.filter((_, i) => i !== index),
                      )
                    }
                  />
                </div>

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
  scan,
  walletAddress,
  onRefresh,
}: {
  prices: JupiterPriceMap | null;
  pricesError: string | null;
  balances: AccountBalances | null;
  // Forwarded to the buy ticket so off-Solana USDC can pay for a purchase.
  scan: WalletScan;
  walletAddress: string | null;
  onRefresh: () => void;
}) {
  const [sparks, setSparks] = useState<SparklinesResponse | null>(null);
  const [expandedMint, setExpandedMint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Markets keeps its own remembered layout, separate from Home's. The two
  // surfaces show different things: this one carries a holdings column and the
  // whole catalog, so the dense table can be right here and tiles right there.
  const [view, setView] = useViewMode(MARKETS_VIEW_STORAGE_KEY);
  // "portfolios" is the one group that is not a catalog category: the
  // Bitwise Mag7X portfolio, which is not a token (see components/glider).
  const [category, setCategory] = useState<XStockCategory | "all" | "portfolios">("all");
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
  // The portfolio group has no ticker to match, so its search terms live
  // with the card. Shown under "All" and under its own pill.
  const showPortfolios =
    (category === "all" || category === "portfolios") && gliderMatchesQuery(trimmed);

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
        <div className="flex shrink-0 items-center gap-3">
          {pricesError ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-aeras-warning">
              <span className="inline-block size-1.5 rounded-full bg-aeras-warning" />
              Price feed offline
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-white/50">
              <span className="inline-block size-1.5 rounded-full bg-aeras-positive" />
              Live
            </span>
          )}
          <ViewToggle view={view} onChange={setView} />
        </div>
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
          <CategoryPill
            label="Portfolios"
            active={category === "portfolios"}
            onClick={() => setCategory("portfolios")}
          />
        </div>
      </div>

      {groups.length === 0 && !showPortfolios ? (
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

              {view === "grid" ? (
                // The ticket is a full-width GRID ITEM rather than something
                // nested under a tile. `col-span-full` makes auto-placement put
                // it on its own row, so it opens beneath the clicked tile's row
                // and pushes the rest down, which is what the list view does.
                // Nesting it inside the tile's cell would instead stretch one
                // column and leave the row ragged.
                //
                // Fragment rather than a wrapping div for the same reason: a
                // wrapper would become a single grid cell holding both.
                //
                // `grid-flow-row-dense` is load-bearing, not a flourish. Without
                // it, a full-width item that cannot fit in the rest of the
                // current row moves to the next one and LEAVES THE REMAINING
                // CELLS EMPTY: clicking the second of four tiles opened the
                // ticket under a row with two blank holes beside it. Dense
                // backfills those cells with the following tiles, so the row
                // stays full and the ticket still lands directly under it.
                // Reading order is preserved because every tile is one column
                // wide; the only effect is that tiles after the ticket in the
                // DOM can render before it, which is exactly the intent.
                <div className="mt-4 grid grid-flow-row-dense grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {rows.map((x) => {
                    const expanded = expandedMint === x.mint;
                    return (
                      <Fragment key={x.mint}>
                        <AssetTile
                          xstock={x}
                          entry={prices?.[x.mint]}
                          sparkline={sparks?.[x.mint]}
                          selected={expanded}
                          held={balances?.xstocks[x.mint] ?? 0}
                          onClick={() =>
                            setExpandedMint(expanded ? null : x.mint)
                          }
                        />
                        {expanded && (
                          <div className="col-span-full">
                            <MarketsRowExpanded
                              xstock={x}
                              prices={prices}
                              balances={balances}
                              scan={scan}
                              walletAddress={walletAddress}
                              auth={auth}
                              onRefresh={onRefresh}
                            />
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              ) : (
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
                            scan={scan}
                            walletAddress={walletAddress}
                            auth={auth}
                            onRefresh={onRefresh}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      {showPortfolios && (
        <GliderMag7xCard
          prices={prices}
          balances={balances}
          walletAddress={walletAddress}
          expanded={expandedMint === GLIDER_LADDER_MINT}
          onToggle={() =>
            setExpandedMint(expandedMint === GLIDER_LADDER_MINT ? null : GLIDER_LADDER_MINT)
          }
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

// Rows shown per category before "See all". Five keeps every group to roughly
// one screen of the card while still showing enough to judge the group. It is a
// count of ENTRIES, not of rendered lines, so the grid shows the same five and
// "See all" means the same thing in both views.
const GROUP_PREVIEW_ROWS = 5;

// Markets remembers its layout separately from Home's. See the comment where it
// is read, and lib/ui/use-view-mode.ts for why this is an external store.
const MARKETS_VIEW_STORAGE_KEY = "aeras.markets.assets.view";

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
  scan,
  walletAddress,
  auth,
  onRefresh,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  scan: WalletScan;
  walletAddress: string | null;
  auth: ReturnType<typeof useTriggerAuth>;
  onRefresh: () => void;
}) {
  // Null for an asset with no borrow market, which keeps the market ticket
  // alone. See components/strategies/AssetStrategies.tsx.
  const strategies = useAssetStrategies(xstock, walletAddress);
  return (
    <div className="border-t border-white/10 px-1 py-5">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* No card around the chart. It sits flush the way Home's asset view
            draws it, and the trade panel beside it has no card either, so the
            grey box was the only thing on this row pretending to be a surface
            inside a row that is already inside one. */}
        {/* No logo in the heading: the row above this one already draws it, and
            a second badge lands a few pixels under the first. Detailed: this is
            the surface a user opens to read the price, so it gets the axes and
            the full range set rather than the dashboard card's four. */}
        <div className="space-y-4">
          <PriceChart
            ticker={xstock}
            heightClass="h-72"
            showLogo={false}
            variant="detailed"
          />
          {/* Buy + Earn, Buy + Leverage and Buy + Buy more, under the chart.
              Pressing one swaps the ticket beside it for that strategy's. */}
          {strategies && <AssetStrategyStrip strategies={strategies} />}
        </div>

        <div className="space-y-4">
          {/* Opening a market is a decision to trade it, so the amount field
              takes focus with the cursor waiting, the same as Home's asset
              view. The row mounts this fresh on expand, so the focus effect
              fires each time; AmountField focuses with preventScroll, so the
              page does not jump out from under the row that was just clicked. */}
          {strategies?.selected ? (
            <AssetStrategyTicket
              strategies={strategies}
              balances={balances}
              prices={prices}
              onRefresh={onRefresh}
            />
          ) : (
            <AssetTradePanel
              xstock={xstock}
              prices={prices}
              balances={balances}
              scan={scan}
              walletAddress={walletAddress}
              auth={auth}
              onRefresh={onRefresh}
              autoFocus
            />
          )}
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
  scan,
  walletAddress,
  auth,
  onRefresh,
  onBack,
}: {
  xstock: XStock;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  scan: WalletScan;
  walletAddress: string | undefined;
  auth: ReturnType<typeof useTriggerAuth>;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const strategies = useAssetStrategies(xstock, walletAddress);
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
      {/* h-48 rather than h-40: the detailed variant spends the bottom 26px of
          the plot box on the x-axis labels, and the line should not pay for
          them. Same reasoning as the Home chart column. */}
      <PriceChart
        ticker={xstock}
        heightClass="h-48"
        showHeading={false}
        variant="detailed"
      />

      {/* Buy + Earn, Buy + Leverage and Buy + Buy more, under the chart, for
          an asset with a borrow market. Pressing one swaps the ticket below
          for that strategy's; "Market order" on the ticket comes back. */}
      {strategies && <AssetStrategyStrip strategies={strategies} />}

      {strategies?.selected ? (
        <AssetStrategyTicket
          strategies={strategies}
          balances={balances}
          prices={prices}
          onRefresh={onRefresh}
        />
      ) : (
        <AssetTradePanel
          xstock={xstock}
          prices={prices}
          balances={balances}
          scan={scan}
          walletAddress={walletAddress ?? null}
          auth={auth}
          onRefresh={onRefresh}
          autoFocus
        />
      )}
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
  return formatUsdPrice(price);
}

function BorrowSection({
  walletAddress,
  balances,
  prices,
  onRefresh,
  onAddFunds,
  initialExpanded,
}: {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
  onAddFunds: () => void;
  initialExpanded?: string;
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
        initialExpanded={initialExpanded}
      />
    </div>
  );
}


type Section =
  | "portfolio"
  | "terminal"
  | "markets"
  | "earn"
  | "borrow"
  | "strategies"
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
