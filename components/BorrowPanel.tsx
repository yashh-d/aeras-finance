"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ChevronDown } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { PriceChart } from "@/components/PriceChart";
import { KaminoBorrowCard } from "@/components/KaminoBorrowCard";
import { GoldBorrowSection } from "@/components/GoldBorrowCard";
import { SOLSCAN_TX_BASE, SOL_MINT } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { assetIdentity, xstockByMint } from "@/lib/jupiter/xstocks";
import { GLASS_SURFACE } from "@/lib/ui/surface";
import { AssetLogo } from "@/components/AssetLogo";
import {
  buildOperateTx,
  fetchLiveVaultStateViaProxy,
  fetchPositionState,
  findExistingNftId,
  fromAtomicBN,
  getMaxSentinels,
  toAtomicBN,
  XSTOCK_BORROW_VAULTS,
  type LiveVaultState,
  type UserPositionState,
  type XStockBorrowVault,
} from "@/lib/jupiter/borrow";
import { buildUnwindTx } from "@/lib/jupiter/multiply";
import {
  formatUsdCompact,
  jupiterMarketKey,
  kaminoMarketKey,
  useBorrowMarketStats,
  type MarketStat,
} from "@/lib/borrow/use-market-stats";
import { KAMINO_XSTOCK_COLLATERALS } from "@/lib/kamino/reserves";
import { useBorrowSummary } from "@/lib/borrow/use-borrow-summary";
import {
  MarketDetailHeader,
  type BorrowMode,
} from "@/components/BorrowMarketDetail";
import { fundRepayUsdc, repayFundingSources } from "@/lib/borrow/fund-repay";
import { useMonadBalances } from "@/lib/morpho/use-monad-balances";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64, useSignSolanaTxBase64 } from "@/lib/privy/sign";
import {
  atomicToUiString,
  getConnection,
  type AccountBalances,
} from "@/lib/solana/balances";
import { sendAndConfirm } from "@/lib/solana/send-confirm";
import { awaitTokenBalance } from "@/lib/solana/await-balance";
import {
  floorToDisplay,
  groupEquivalentsByVault,
  needsConversion,
  totalConvertibleUi,
} from "@/lib/trustware/selection";
import {
  planUnifiedDeposit,
  type UnifiedDepositPlan,
} from "@/lib/trustware/unified";
import { useMaxDepositable } from "@/lib/trustware/use-max";
import {
  describePlan,
  type BlockedPlan,
  type HeldEquivalent,
} from "@/lib/trustware/planner";
import { useConversionRunner } from "@/lib/trustware/use-conversion";
import {
  useConversionPreview,
  type ConversionPreview,
} from "@/lib/trustware/use-preview";
import { useEquivalentBalances } from "@/lib/trustware/use-equivalents";
import { RepayPanel } from "@/components/RepayPanel";
import BN from "bn.js";

// Matches the loop surface so a borrow-side unwind sizes its swap identically.
const UNWIND_SLIPPAGE_BPS = 150;


interface Props {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
  // Sends the user somewhere they can acquire collateral. Omitted where the
  // panel is embedded without anywhere to send them.
  onAddFunds?: () => void;
  // Drops the panel's own card chrome. Set where the panel is already inside a
  // card (Home) so cards don't nest; the Borrow tab renders it straight onto
  // the page canvas and draws its own. Type is always light-on-dark either way:
  // both surfaces are the night canvas.
  unboxed?: boolean;
}

export function BorrowPanel({
  walletAddress,
  balances,
  prices,
  onRefresh,
  onAddFunds,
  unboxed,
}: Props) {
  // Same-underlying holdings on other chains (and Ondo's native Solana mints),
  // scanned once for the whole section rather than per card.
  const equivalents = useEquivalentBalances(walletAddress);

  // Holdings grouped by the vault they can be converted into. A user holding
  // TSLAon on Ethereum can open the TSLAx vault even with no TSLAx on Solana,
  // so this feeds the deposit itself when a card is expanded.
  const equivalentsByVault = useMemo(
    () => groupEquivalentsByVault(equivalents.held),
    [equivalents.held],
  );

  // Account-wide debt and headroom, read across both venues. Also carries the
  // user's Kamino obligation, so an expanded Kamino card shows an existing
  // position immediately without fetching it a second time.
  const summary = useBorrowSummary({
    walletAddress,
    prices,
    balances,
    equivalents: equivalents.held,
  });

  // A settled borrow or repay changes both the wallet and the headline figures.
  const summaryRefresh = summary.refresh;
  const refreshAll = useCallback(async () => {
    await onRefresh();
    summaryRefresh();
  }, [onRefresh, summaryRefresh]);

  // Live borrow APR and market size for every row. Lightweight — one call per
  // Jupiter vault plus one Kamino metrics call — so it can drive the collapsed
  // list without mounting any card.
  const { stats, loading: statsLoading } = useBorrowMarketStats();

  // Which market row is expanded to reveal its full borrow card. Only one at a
  // time. The heavy card (live vault state, position, NFT recovery) mounts
  // lazily on expand rather than once per market up front.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Repay opens under the headline rather than inside a market card, since the
  // position it targets is chosen in the panel itself.
  const [repayOpen, setRepayOpen] = useState(false);

  // Inside Home's card the panel drops its own chrome rather than nesting one
  // card inside another; on the Borrow tab it is the card.
  const sectionClass = unboxed ? "" : `${GLASS_SURFACE} p-5 lg:p-6`;

  return (
    <div className="space-y-6">
      <BorrowSummaryHero
        debtUsd={summary.debtUsd}
        capacityUsd={summary.capacityUsd}
        availableUsd={summary.availableUsd}
        loading={summary.loading}
        onAddFunds={onAddFunds}
        onRepay={() => setRepayOpen((open) => !open)}
        hasDebt={summary.positions.length > 0}
      />

      {repayOpen && (
        <RepayPanel
          positions={summary.positions}
          walletUsdc={balances?.usdc ?? 0}
          solanaUsdcAtomic={balances?.usdcAtomic ?? "0"}
          sol={balances?.sol ?? 0}
          solPriceUsd={prices?.[SOL_MINT]?.usdPrice ?? null}
          walletAddress={walletAddress}
          onSettled={refreshAll}
          onClose={() => setRepayOpen(false)}
        />
      )}

      <div className={sectionClass}>
        <div className="space-y-1.5">
          <h3 className="font-light text-lg tracking-tight text-white">
            Loan options
          </h3>
          <p className="text-sm text-white/50">
            Borrow USDC against your tokenized stocks. Collateral keeps its
            market exposure while it backs the loan.
          </p>
        </div>

        <div className="@container mt-5 divide-y divide-white/10 border-t border-white/10">
          <MarketRowHeader />
          {XSTOCK_BORROW_VAULTS.map((vault) => {
            const key = jupiterMarketKey(vault.vaultId);
            const expanded = expandedKey === key;
            return (
              <div key={key}>
                <BorrowMarketRow
                  symbol={vault.collateralSymbol}
                  mint={vault.collateralMint}
                  venue="Jupiter Lend"
                  stat={stats.get(key)}
                  statsLoading={statsLoading}
                  held={balances?.xstocks[vault.collateralMint] ?? 0}
                  price={prices?.[vault.collateralMint]?.usdPrice ?? null}
                  expanded={expanded}
                  onToggle={() => setExpandedKey(expanded ? null : key)}
                />
                {expanded && (
                  <div className="pb-4">
                    <VaultCard
                      vault={vault}
                      walletAddress={walletAddress}
                      walletUsdc={balances?.usdc ?? 0}
                      solanaUsdcAtomic={balances?.usdcAtomic ?? "0"}
                      solBalance={balances?.sol ?? 0}
                      solPriceUsd={prices?.[SOL_MINT]?.usdPrice ?? null}
                      collateralBalance={
                        balances?.xstocks[vault.collateralMint] ?? 0
                      }
                      collateralBalanceAtomic={
                        balances?.xstocksAtomic[vault.collateralMint] ?? "0"
                      }
                      heldEquivalents={
                        equivalentsByVault.get(vault.vaultId) ?? []
                      }
                      evmAddress={equivalents.evmAddress}
                      onEquivalentsChanged={equivalents.refresh}
                      prices={prices}
                      stat={stats.get(key)}
                      onRefresh={refreshAll}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {KAMINO_XSTOCK_COLLATERALS.map((collateral) => {
            const key = kaminoMarketKey(collateral.reserve);
            const expanded = expandedKey === key;
            return (
              <div key={key}>
                <BorrowMarketRow
                  symbol={collateral.symbol}
                  mint={collateral.collateralMint}
                  venue="Kamino"
                  stat={stats.get(key)}
                  statsLoading={statsLoading}
                  held={balances?.xstocks[collateral.collateralMint] ?? 0}
                  price={prices?.[collateral.collateralMint]?.usdPrice ?? null}
                  expanded={expanded}
                  onToggle={() => setExpandedKey(expanded ? null : key)}
                />
                {expanded && (
                  <div className="pb-4">
                    <KaminoBorrowCard
                      collateral={collateral}
                      walletAddress={walletAddress}
                      collateralBalance={
                        balances?.xstocks[collateral.collateralMint] ?? 0
                      }
                      collateralBalanceAtomic={
                        balances?.xstocksAtomic[collateral.collateralMint] ?? "0"
                      }
                      prices={prices}
                      stat={stats.get(key)}
                      initialPosition={summary.kaminoPosition}
                      onRefresh={refreshAll}
                      onPositionChange={summaryRefresh}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* Gold sits below the equity markets rather than beside them. It is
              a different collateral, a different chain and a different loan
              asset, and the row shape above (one xStock, USDC borrowed on
              Solana) does not describe it. Its own section says so plainly
              instead of hiding an Ethereum position inside a Solana list. */}
          <GoldBorrowSection
            walletAddress={walletAddress}
            goldHoldings={equivalents.gold}
            solanaUsdcAtomic={balances?.usdcAtomic ?? "0"}
            onRefresh={refreshAll}
          />
        </div>
      </div>
    </div>
  );
}

// Account-wide headline: what is owed, how much of the available headroom that
// consumes, and what is left. Sits on the page rather than in a card so it reads
// as the state of the account, not as one more market panel.
function BorrowSummaryHero({
  debtUsd,
  capacityUsd,
  availableUsd,
  loading,
  onAddFunds,
  onRepay,
  hasDebt = false,
}: {
  debtUsd: number;
  capacityUsd: number;
  availableUsd: number;
  loading: boolean;
  onAddFunds?: () => void;
  onRepay?: () => void;
  // Whether there is actually a loan to pay down. Repay renders either way, so
  // the action is always discoverable; this only decides whether it is live.
  hasDebt?: boolean;
}) {
  const utilisationPct =
    capacityUsd > 0 ? Math.min(100, (debtUsd / capacityUsd) * 100) : 0;
  const muted = "text-white/50";
  const strong = "text-white";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div
          className={`text-[10px] font-medium uppercase tracking-[0.12em] ${muted}`}
        >
          Borrowed
        </div>
        <div
          className={`font-mono text-[2.75rem] font-light leading-none tracking-tight tabular-nums ${strong}`}
        >
          {loading ? "—" : `$${debtUsd.toFixed(2)}`}
        </div>
      </div>

      <div className="max-w-xl">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-aeras-blue transition-all"
            style={{ width: `${utilisationPct}%` }}
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between text-sm">
          <span className={muted}>Available to borrow</span>
          <span className={`font-mono tabular-nums ${strong}`}>
            {loading ? "—" : `$${availableUsd.toFixed(2)}`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {onAddFunds && (
          <button
            type="button"
            onClick={onAddFunds}
            className="rounded-full bg-aeras-blue px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium"
          >
            Add funds
          </button>
        )}
        {/* Repay is always rendered, and carries its own colour.
            It used to appear only once a position existed, so the way out of a
            loan was invisible right up until you had one, and then arrived as a
            quiet grey outline beside a solid Add funds. That put all the visual
            encouragement on borrowing more. Paying down keeps a permanent slot
            and a colour of its own instead.
            Disabled when nothing is owed, but never during the initial load:
            positions arrive a beat after the page, and gating on them alone
            made the button flick from dead to live on every visit. */}
        <button
          type="button"
          onClick={onRepay}
          disabled={!loading && !hasDebt}
          title={!loading && !hasDebt ? "Nothing to repay yet" : undefined}
          className="rounded-full bg-aeras-purple px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-purple-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          Repay
        </button>
      </div>
    </div>
  );
}

// Column geometry for the catalog, shared by the header and every row so the
// figures line up. Each numeric column is a fixed width and is always rendered,
// including the balance column: sizing it to its content would let the two rows
// the user holds shift every column left and break the alignment down the list.
// Dropped on container width, not viewport width. This table renders both full
// bleed on the Borrow tab and inside a two-fifths card on Home, so a viewport
// breakpoint showed every column at desktop sizes and pushed the APY figure off
// the right edge of the narrow placement.
const COL_SIZE = "hidden w-24 shrink-0 text-right @md:block";
const COL_LIQUIDITY = "hidden w-24 shrink-0 text-right @xl:block";
const COL_BALANCE = "hidden w-24 shrink-0 text-right @3xl:block";
const COL_APY = "w-20 shrink-0 text-right";

// Labels the rows would otherwise repeat under every figure. One header keeps
// the list scannable as a table instead of fourteen stacked label/value pairs.
function MarketRowHeader() {
  return (
    <div className="flex items-center gap-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
      {/* Gutters matching the row's logo and chevron. */}
      <div className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">Market</div>
      <div className={COL_SIZE}>Market size</div>
      <div className={COL_LIQUIDITY}>Liquidity</div>
      <div className={COL_BALANCE}>Balance</div>
      <div className={COL_APY}>APY</div>
      <div className="size-4 shrink-0" />
    </div>
  );
}

// Collapsed catalog row: the asset, which venue settles it, how deep the market
// is, how much USDC it can still lend, what the user holds, and the live borrow
// rate. Risk parameters stay in the risk section, so scanning the list compares
// rate against liquidity — the two things that decide where a loan should go.
// Clicking anywhere expands the full card below.
function BorrowMarketRow({
  symbol,
  mint,
  venue,
  stat,
  statsLoading,
  held,
  price,
  expanded,
  onToggle,
}: {
  symbol: string;
  // Collateral mint, used only to resolve the asset logo.
  mint: string;
  // Which protocol settles this market. Shown as a subtitle so a stock listed on
  // both venues reads as two distinct, comparable rows.
  venue: "Jupiter Lend" | "Kamino";
  stat: MarketStat | undefined;
  statsLoading: boolean;
  held: number;
  price: number | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const heldUsd = price != null ? held * price : null;
  // A market with no data yet reads "…" rather than "—", so a slow venue is not
  // mistaken for an empty one.
  const show = (n: number | null | undefined) =>
    n != null ? formatUsdCompact(n) : statsLoading ? "…" : "—";
  const apr =
    stat?.borrowAprPct != null
      ? `${stat.borrowAprPct.toFixed(2)}%`
      : statsLoading
        ? "…"
        : "—";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-center gap-3 py-4 text-left transition-colors hover:bg-white/5"
    >
      <AssetLogo xstock={assetIdentity(mint, symbol)} size={32} />
      {/* Name leads, token symbol and venue share the line under it. The venue
          has to stay visible here: the same asset is listed by both. */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium tracking-tight text-white">
          {assetIdentity(mint, symbol).name}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-white/50">
          {symbol} · {venue}
        </div>
      </div>
      {/* Depth of the collateral side, then what is actually drawable. Dropped
          first on narrow screens, where the rate has to win the space. */}
      <div className={`${COL_SIZE} font-mono text-sm tabular-nums text-white/90`}>
        {show(stat?.sizeUsd)}
      </div>
      <div
        className={`${COL_LIQUIDITY} font-mono text-sm tabular-nums text-white/90`}
      >
        {show(stat?.liquidityUsd)}
      </div>
      <div className={COL_BALANCE}>
        {held > 0 ? (
          <>
            <div className="font-mono text-sm tabular-nums text-white">
              {held.toFixed(4)}
            </div>
            {heldUsd != null && (
              <div className="font-mono text-[11px] tabular-nums text-white/50">
                ${heldUsd.toFixed(2)}
              </div>
            )}
          </>
        ) : (
          <span className="font-mono text-sm tabular-nums text-white/30">—</span>
        )}
      </div>
      <div className={`${COL_APY} font-mono text-sm tabular-nums text-white`}>
        {apr}
      </div>
      <ChevronDown
        className={`size-4 shrink-0 text-white/50 transition-transform ${
          expanded ? "rotate-180" : ""
        }`}
      />
    </button>
  );
}

interface VaultCardProps {
  vault: XStockBorrowVault;
  walletAddress: string;
  // Wallet USDC, used to decide whether a close can repay directly from the
  // wallet (returning the stock) or would need the user to sell collateral.
  walletUsdc: number;
  // Exact atomic Solana USDC, so a cross-chain close sizes its Monad funding
  // leg against the real figure rather than a display float.
  solanaUsdcAtomic: string;
  // SOL balance and price: spare SOL swaps into USDC as a close-repay source.
  solBalance: number;
  solPriceUsd: number | null;
  collateralBalance: number;
  // Exact base-unit balance as a decimal string. Used to defeat float rounding
  // in Max/submit so we never request more than the wallet actually holds.
  collateralBalanceAtomic: string;
  // Same-underlying holdings elsewhere that can be converted into this vault's
  // collateral. Empty when the user only holds the collateral itself.
  heldEquivalents: HeldEquivalent[];
  // Signer for EVM-sourced conversions. Undefined until Privy provisions the
  // embedded EVM wallet; a Solana-sourced conversion does not need it.
  evmAddress: string | undefined;
  // Re-scan cross-chain holdings after a conversion spends one.
  onEquivalentsChanged: () => void;
  prices: JupiterPriceMap | null;
  // Rate and size for this market, already fetched for the collapsed row. Passed
  // down so the detail's stat grid renders with the list's figures instead of
  // waiting on this card's own vault read.
  stat: MarketStat | undefined;
  onRefresh: () => Promise<void> | void;
}

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  // A conversion is running. This can last minutes on a bridged route, so the
  // message is the engine's own progress copy rather than a static label.
  | { kind: "converting"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done"; signature: string };

function VaultCard({
  vault,
  walletAddress,
  walletUsdc,
  solanaUsdcAtomic,
  solBalance,
  solPriceUsd,
  collateralBalance,
  collateralBalanceAtomic,
  heldEquivalents,
  evmAddress,
  onEquivalentsChanged,
  prices,
  stat,
  onRefresh,
}: VaultCardProps) {
  const [live, setLive] = useState<LiveVaultState | null>(null);
  const [position, setPosition] = useState<UserPositionState | null>(null);
  const [positionLoading, setPositionLoading] = useState(true);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });
  const [closingState, setClosingState] = useState<FormState>({ kind: "idle" });

  const signTxBase64 = useSignSolanaTxBase64();
  const sendSolanaTx = useSendSolanaTxBase64();
  const conversion = useConversionRunner();
  // A close can fund its repay from the account's other balances (Monad USDC
  // through Trustware, spare SOL through a Jupiter swap) when the Solana
  // wallet is short, mirroring the headline Repay panel.
  const evm = useEmbeddedEvmWallet();
  const monad = useMonadBalances(evm.address);
  const fundableUsdc =
    repayFundingSources({
      solanaUsdc: 0,
      sol: solBalance,
      solPriceUsd,
      monadUsdcAtomic: monad.balances?.usdcAtomic ?? "0",
    }).total;

  // Tracked nftId — mirrors localStorage but mutable via state so React re-renders
  // when auto-recovery rebinds an existing on-chain position NFT.
  const storageKey = `aeras:borrow:${walletAddress}:${vault.vaultId}`;
  const initialNftId = (() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();
  const [storedNftId, setStoredNftId] = useState<number | null>(initialNftId);
  // Gate on initial NFT scan to avoid accidentally creating a second NFT (and
  // paying rent again) before recovery has had a chance to bind an existing one.
  const [recovering, setRecovering] = useState<boolean>(initialNftId == null);
  const persistNftId = useCallback(
    (nftId: number) => {
      localStorage.setItem(storageKey, String(nftId));
      setStoredNftId(nftId);
    },
    [storageKey],
  );

  // Auto-recover: if localStorage has no nftId for this (wallet, vault), scan
  // the wallet on-chain for existing Jupiter Lend position NFTs and rebind.
  useEffect(() => {
    if (storedNftId != null) {
      setRecovering(false);
      return;
    }
    let cancelled = false;
    setRecovering(true);
    (async () => {
      try {
        const found = await findExistingNftId(
          walletAddress,
          vault,
          getConnection(),
        );
        if (cancelled) return;
        if (found != null) {
          console.log(
            `[borrow auto-recover] rebound nftId ${found} for vault ${vault.vaultId}`,
          );
          persistNftId(found);
        }
      } catch (err) {
        console.error("[borrow auto-recover]", err);
      } finally {
        if (!cancelled) setRecovering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedNftId, walletAddress, vault, persistNftId]);

  const refreshLive = useCallback(async () => {
    try {
      setLive(await fetchLiveVaultStateViaProxy(vault.vaultId));
    } catch (err) {
      console.error("[borrow live]", err);
    }
  }, [vault.vaultId]);

  const refreshPosition = useCallback(async () => {
    if (!storedNftId) {
      setPosition(null);
      setPositionError(null);
      setPositionLoading(false);
      return;
    }
    setPositionLoading(true);
    try {
      const state = await fetchPositionState(
        vault,
        storedNftId,
        getConnection(),
      );
      setPosition(state);
      setPositionError(null);
    } catch (err) {
      console.error("[borrow position]", err);
      setPositionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPositionLoading(false);
    }
  }, [storedNftId, vault]);

  useEffect(() => {
    refreshLive();
  }, [refreshLive]);

  useEffect(() => {
    refreshPosition();
  }, [refreshPosition]);

  const oraclePrice = live?.oraclePriceUsd ?? prices?.[vault.collateralMint]?.usdPrice ?? null;

  // Which of the two actions is on screen. Borrow first: a user opening a market
  // they have no position in is here to draw, not to repay.
  const [mode, setMode] = useState<BorrowMode>("borrow");

  // Everything convertible into this vault's collateral, summed as a 1:1
  // notional before fees. The deposit runs one conversion per source in
  // sequence, so the whole unified balance is spendable rather than just the
  // largest single holding.
  const convertibleUi = useMemo(
    () => totalConvertibleUi(heldEquivalents, vault.collateralDecimals),
    [heldEquivalents, vault.collateralDecimals],
  );

  const debtUi = position
    ? fromAtomicBN(position.debtAtomic, vault.borrowDecimals)
    : 0;
  const positionCollateralUi = position
    ? fromAtomicBN(position.collateralAtomic, vault.collateralDecimals)
    : 0;
  const hasPosition =
    position != null &&
    (position.collateralAtomic.gtn(0) || position.debtAtomic.gtn(0));

  // What this market will lend against everything the user can put behind it:
  // collateral already deposited, the same stock sitting in the wallet, and what
  // converts into it from another chain. Wallet stock counts because the form
  // below deposits it as part of the borrow. Capped by the vault's own
  // liquidity, since headroom is not drawable from an empty vault.
  const availableUsd = useMemo(() => {
    if (oraclePrice == null || live == null) return null;
    const collateralUi =
      positionCollateralUi + collateralBalance + convertibleUi;
    const capacityUsd =
      collateralUi * oraclePrice * (vault.collateralFactor / 1000);
    const liquidityUsd = Number(
      atomicToUiString(live.borrowableAtomic, vault.borrowDecimals),
    );
    return Math.max(0, Math.min(capacityUsd - debtUi, liquidityUsd));
  }, [
    oraclePrice,
    live,
    positionCollateralUi,
    collateralBalance,
    convertibleUi,
    debtUi,
    vault,
  ]);

  // Exact on-chain collateral balance. The prop is the parent's last refresh,
  // which can be stale if the user just topped up a position (NFT 463 case) or
  // moved funds in another tab.
  const readCollateralAtomic = useCallback(async (): Promise<string> => {
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(vault.collateralMint),
      new PublicKey(walletAddress),
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    try {
      // `processed` matches what simulation reads — `confirmed` can lag a few
      // slots and let a stale "max" through.
      const fresh = await getConnection().getTokenAccountBalance(
        ata,
        "processed",
      );
      return fresh.value.amount;
    } catch {
      // ATA doesn't exist or RPC error — fall back to the prop value so we
      // don't block a borrow-only op against an existing position.
      return collateralBalanceAtomic;
    }
  }, [vault.collateralMint, walletAddress, collateralBalanceAtomic]);

  // Bring the requested collateral onto Solana, converting a same-underlying
  // holding from another chain when the wallet is short. Returns the balance
  // that is actually available to deposit afterwards.
  //
  // This runs before anything is signed on the Jupiter Lend side, and that
  // order matters: a conversion that fails refunds the source chain, and a
  // deposit that was never started leaves nothing half-done.
  async function convertShortfall(
    requestedUi: number,
    onSolanaAtomic: string,
  ): Promise<string> {
    let onSolana = onSolanaAtomic;
    // Sources already spent this submit. The cross-chain scan behind
    // heldEquivalents does not refresh mid-flight, so a spent source would
    // otherwise be re-planned against a balance it no longer has.
    let available = [...heldEquivalents];
    let converted = false;

    // One conversion per source, largest first, until the deposit is covered.
    // Re-planned before each leg rather than up front: a leg can run for
    // minutes, and the next leg should be priced against the rate that exists
    // when it starts, not the one that existed when the user clicked.
    for (let leg = 0; leg < heldEquivalents.length; leg++) {
      const plan = await planUnifiedDeposit({
        vault,
        requestedUi,
        solanaAddress: walletAddress,
        evmAddress,
        solanaCollateralAtomic: onSolana,
        heldEquivalents: available,
      });
      // Covered. Either the wallet already held enough or the previous legs
      // delivered it.
      if (plan.kind === "unified-deposit" && plan.legs.length === 0) break;
      // It cannot be covered. The planner's reason names the specific source and
      // the amount that would be needed, which is far more use than the generic
      // "not enough collateral" the clamp below would otherwise produce.
      if (plan.kind !== "unified-deposit") throw new Error(plan.reason);

      const next = plan.legs[0];
      if (!conversion.canRun(next)) {
        throw new Error(
          `Your ${next.source.chainLabel} wallet is not ready yet. Reload and try again.`,
        );
      }

      const step =
        plan.legs.length > 1
          ? ` (conversion ${leg + 1} of ${leg + plan.legs.length})`
          : "";
      setFormState({
        kind: "converting",
        message: `${describePlan(next)}${step}`,
      });
      await conversion.run(next, (progress) =>
        setFormState({ kind: "converting", message: `${progress.message}${step}` }),
      );

      // Trustware reports success once the destination transaction lands, but
      // our RPC can be a few slots behind it, and the token account may have
      // been created by that same transaction. Read until the balance reflects
      // it. Wait on this leg's own floor: the deposit total is only reached
      // once every leg has landed.
      setFormState({
        kind: "converting",
        message: `Confirming ${vault.collateralSymbol} balance.${step}`,
      });
      onSolana = await awaitTokenBalance({
        mint: vault.collateralMint,
        owner: walletAddress,
        atLeastAtomic: (
          BigInt(onSolana) + BigInt(next.quote.toAmountMinAtomic)
        ).toString(),
        // Every Jupiter borrow vault's collateral is a Backed xStock, and all
        // of those are Token-2022. Revisit if a vault ever lists a classic
        // SPL collateral the way the buy catalog now does (XAUt0).
        programId: TOKEN_2022_PROGRAM_ID,
      });
      available = available.filter(
        (h) =>
          h.source.chain !== next.source.chain ||
          h.source.token !== next.source.token,
      );
      converted = true;
    }

    // The source holdings were spent, so the cross-chain scan is now stale.
    if (converted) onEquivalentsChanged();
    setFormState({ kind: "submitting" });
    return onSolana;
  }

  async function handleSubmit(args: {
    collateralUi: number;
    borrowUi: number;
  }) {
    setFormState({ kind: "submitting" });
    try {
      let colAtomic = toAtomicBN(args.collateralUi, vault.collateralDecimals);
      const debtAtomic = toAtomicBN(args.borrowUi, vault.borrowDecimals);
      const conn = getConnection();
      if (colAtomic.gtn(0)) {
        let onSolana = await readCollateralAtomic();

        // Short on Solana but holding the same equity elsewhere: convert first.
        if (
          needsConversion({
            requestedAtomic: colAtomic.toString(),
            onSolanaAtomic: onSolana,
            collateralDecimals: vault.collateralDecimals,
            heldCount: heldEquivalents.length,
          })
        ) {
          onSolana = await convertShortfall(args.collateralUi, onSolana);
        }

        // Clamp to what the wallet actually holds. The Borrow program scales col
        // 8-dec → 9-dec internally and converts back to mint-atomic when wiring
        // the TransferChecked. Combined with Earn-vault exchange-price rounding,
        // the on-chain transfer can ask for 1 atomic unit more than `colAtomic`.
        // Reserve a 1-unit cushion so a user typing "Max" doesn't fail
        // simulation by a hair.
        const freshAtomic = new BN(onSolana);
        const cushion = freshAtomic.gtn(1) ? freshAtomic.subn(1) : new BN(0);
        if (colAtomic.gt(cushion)) colAtomic = cushion;
        if (colAtomic.isZero() && args.collateralUi > 0) {
          throw new Error(
            `You don't have enough ${vault.collateralSymbol} in this wallet to deposit. Buy more before depositing.`,
          );
        }
      }
      const { base64Tx, nftId } = await buildOperateTx({
        vaultId: vault.vaultId,
        positionId: storedNftId ?? 0,
        collateralDeltaAtomic: colAtomic,
        debtDeltaAtomic: debtAtomic,
        signerAddress: walletAddress,
        connection: conn,
      });
      const signed = await signTxBase64(base64Tx);
      const signedBytes = base64ToBytes(signed);
      const sig = await sendAndConfirm(conn, signedBytes);
      // Persist nftId for future operations on this vault.
      const finalNftId = nftId ?? storedNftId;
      if (finalNftId) persistNftId(finalNftId);
      setFormState({ kind: "done", signature: sig });
      await onRefresh();
      await refreshPosition();
    } catch (err) {
      console.error("[borrow submit]", err);
      setFormState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Close a borrow position. Two paths, chosen explicitly by the caller — never
  // inferred from a stored flag, so a plain borrow can never silently sell the
  // underlying stock:
  //   "repay" — repay the USDC debt from the wallet and withdraw the collateral.
  //             Returns the stock intact. This is the default.
  //   "sell"  — sell enough collateral to clear the debt and return the rest.
  //             Only used when the wallet can't cover the debt, and only after
  //             the user explicitly confirms disposing of the stock.
  async function handleClose(method: "repay" | "sell") {
    if (!position) return;
    setClosingState({ kind: "submitting" });
    try {
      // A wallet-funded repay can draw on the Monad balance: bring the Solana
      // wallet up to the payoff (plus the interest buffer the gate below uses)
      // before building the close transaction. The sell path never needs this;
      // it pays the debt out of the collateral.
      if (method === "repay") {
        const debtUi = fromAtomicBN(position.debtAtomic, vault.borrowDecimals);
        const walletAtLeastAtomic = BigInt(Math.ceil(debtUi * 1.005 * 1e6));
        if (walletAtLeastAtomic > BigInt(solanaUsdcAtomic || "0")) {
          await fundRepayUsdc({
            walletAtLeastAtomic,
            solanaUsdcAtomic,
            sol: solBalance,
            solPriceUsd,
            monadUsdcAtomic: monad.balances?.usdcAtomic ?? "0",
            monBalanceAtomic: monad.balances?.monAtomic ?? "0",
            evm: evm.address
              ? {
                  address: evm.address,
                  switchChain: evm.switchChain,
                  getProvider: evm.getProvider,
                }
              : undefined,
            solana: { address: walletAddress, signAndSendBase64: sendSolanaTx },
            onProgress: (p) =>
              setClosingState({ kind: "converting", message: p.message }),
          });
          setClosingState({ kind: "submitting" });
        }
      }

      const conn = getConnection();
      let base64Tx: string;
      if (method === "sell") {
        if (oraclePrice == null) {
          throw new Error("Oracle price unavailable — can't size the sale.");
        }
        ({ base64Tx } = await buildUnwindTx({
          vault,
          positionId: position.nftId,
          collateralAtomic: position.collateralAtomic,
          debtAtomic: position.debtAtomic,
          oraclePriceUsd: oraclePrice,
          signerAddress: walletAddress,
          connection: conn,
          slippageBps: UNWIND_SLIPPAGE_BPS,
        }));
      } else {
        const { maxRepay, maxWithdraw } = await getMaxSentinels();
        ({ base64Tx } = await buildOperateTx({
          vaultId: vault.vaultId,
          positionId: position.nftId,
          collateralDeltaAtomic: maxWithdraw,
          debtDeltaAtomic: maxRepay,
          signerAddress: walletAddress,
          connection: conn,
        }));
      }
      const signed = await signTxBase64(base64Tx);
      const signedBytes = base64ToBytes(signed);
      const sig = await sendAndConfirm(conn, signedBytes);
      // Position is zeroed but the on-chain position-NFT account stays alive
      // (Jupiter Lend has no close-position instruction). Keep the nftId in
      // localStorage so future borrows in this vault reuse it instead of
      // paying ~0.015 SOL rent for a new NFT. Clear any leftover loop tag from
      // the looping surface so it can never influence a future close here.
      try {
        localStorage.removeItem(`aeras:loop:${walletAddress}:${vault.vaultId}`);
      } catch {}
      setClosingState({ kind: "done", signature: sig });
      await onRefresh();
      await refreshPosition();
    } catch (err) {
      console.error("[borrow close]", err);
      setClosingState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-5 rounded-xl border border-white/10 bg-white/5 p-5">
      <MarketDetailHeader
        mint={vault.collateralMint}
        symbol={vault.collateralSymbol}
        borrowSymbol={vault.borrowSymbol}
        availableUsd={availableUsd}
        owedUsd={debtUi}
        mode={mode}
        onModeChange={setMode}
        canRepay={hasPosition}
      />

      {positionLoading ? (
        <p className="text-xs text-white/50">Loading position…</p>
      ) : positionError ? (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
          <div className="font-medium text-white">
            Couldn&apos;t load position
          </div>
          <div className="mt-1 break-all text-white/50">{positionError}</div>
          {storedNftId != null && (
            <div className="mt-1 font-mono text-[10px] text-white/50">
              Stored nftId: {storedNftId} · clear devtools localStorage if stale
            </div>
          )}
        </div>
      ) : hasPosition && position ? (
        <PositionCard
          vault={vault}
          position={position}
          oraclePrice={oraclePrice}
        />
      ) : null}

      {mode === "repay" && hasPosition && position ? (
        <ClosePositionControl
          vault={vault}
          position={position}
          walletUsdc={walletUsdc}
          fundableUsdc={fundableUsdc}
          state={closingState}
          onClose={handleClose}
          onReset={() => setClosingState({ kind: "idle" })}
        />
      ) : mode === "borrow" ? (
        <OperateForm
          vault={vault}
          existingPosition={position}
          walletAddress={walletAddress}
          evmAddress={evmAddress}
          collateralBalance={collateralBalance}
          collateralBalanceAtomic={collateralBalanceAtomic}
          convertibleUi={convertibleUi}
          heldEquivalents={heldEquivalents}
          oraclePrice={oraclePrice}
          aprPct={
            stat?.borrowAprPct ?? (live ? live.borrowRateAnnual * 100 : null)
          }
          onSubmit={handleSubmit}
          formState={formState}
          resetForm={() => setFormState({ kind: "idle" })}
          recovering={recovering}
        />
      ) : null}
    </div>
  );
}

function PositionCard({
  vault,
  position,
  oraclePrice,
}: {
  vault: XStockBorrowVault;
  position: UserPositionState;
  oraclePrice: number | null;
}) {
  const colUi = fromAtomicBN(position.collateralAtomic, vault.collateralDecimals);
  const debtUi = fromAtomicBN(position.debtAtomic, vault.borrowDecimals);
  const colUsd = oraclePrice != null ? colUi * oraclePrice : null;
  const ltvPct = colUsd && colUsd > 0 ? (debtUi / colUsd) * 100 : 0;
  const liquidationPct = vault.liquidationThreshold / 10;
  // Collateral price at which LTV would reach LT, given current debt:
  //   LT = debt / (col * priceLiq) => priceLiq = debt / (col * LT)
  const liquidationPrice =
    colUi > 0 && debtUi > 0
      ? debtUi / (colUi * (vault.liquidationThreshold / 1000))
      : null;
  // Health factor: how much room before liquidation. 1.0x = at LT.
  const health = ltvPct > 0 ? liquidationPct / ltvPct : Infinity;
  const healthy = ltvPct < liquidationPct * 0.8;
  const warning = !healthy && ltvPct < liquidationPct;
  const liquidatable = ltvPct >= liquidationPct;

  let badgeBg = "bg-aeras-blue/20 text-aeras-blue-medium";
  let badgeText = "Healthy";
  let cardBg = "bg-aeras-blue/15 border-aeras-blue/30";
  let statusDot = "bg-aeras-blue";
  if (liquidatable) {
    badgeBg = "bg-white/10 text-aeras-negative";
    badgeText = "At risk";
    cardBg = "bg-white/5 border-white/10";
    statusDot = "bg-aeras-negative";
  } else if (warning) {
    badgeBg = "bg-white/10 text-aeras-warning";
    badgeText = "Watch";
    cardBg = "bg-white/5 border-white/10";
    statusDot = "bg-aeras-warning";
  }

  return (
    <div className={`space-y-3 rounded-xl border p-3.5 ${cardBg}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-white/50">
          Position
        </span>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badgeBg}`}
        >
          {badgeText}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          dot="bg-aeras-positive"
          label="Collateral"
          value={`${colUi.toFixed(4)} ${vault.collateralSymbol}`}
          sub={colUsd != null ? `$${colUsd.toFixed(2)}` : undefined}
        />
        <Stat
          dot="bg-aeras-warning"
          label="Debt"
          value={`${debtUi.toFixed(4)} ${vault.borrowSymbol}`}
        />
        <Stat
          dot={statusDot}
          label="Loan vs collateral"
          value={`${ltvPct.toFixed(1)}% · closes at ${liquidationPct.toFixed(0)}%`}
        />
        <Stat
          dot={statusDot}
          label="Health"
          value={health === Infinity ? "—" : `${health.toFixed(2)}×`}
        />
      </div>
      {liquidationPrice != null && (
        <div className="border-t border-white/10 pt-3 text-xs">
          <div className="flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 text-white/50">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-aeras-negative" />
              Liquidation price
            </span>
            <span className="font-mono tabular-nums text-white">
              ${liquidationPrice.toFixed(2)} / {vault.collateralSymbol}
            </span>
          </div>
          {oraclePrice != null && (
            <div className="mt-1 text-[11px] text-white/50">
              {oraclePrice > liquidationPrice
                ? `${vault.collateralSymbol} would need to drop ${(((oraclePrice - liquidationPrice) / oraclePrice) * 100).toFixed(1)}% from $${oraclePrice.toFixed(2)} to liquidate.`
                : "Position is at the liquidation threshold."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OperateForm({
  vault,
  existingPosition,
  walletAddress,
  evmAddress,
  collateralBalance,
  collateralBalanceAtomic,
  convertibleUi,
  heldEquivalents,
  oraclePrice,
  aprPct,
  onSubmit,
  formState,
  resetForm,
  recovering,
}: {
  vault: XStockBorrowVault;
  existingPosition: UserPositionState | null;
  walletAddress: string;
  evmAddress: string | undefined;
  collateralBalance: number;
  collateralBalanceAtomic: string;
  // Additional collateral reachable by converting a holding on another chain,
  // as a 1:1 notional before fees.
  convertibleUi: number;
  heldEquivalents: HeldEquivalent[];
  oraclePrice: number | null;
  // Annual borrow rate, shown against the amount being drawn rather than as a
  // standalone market figure.
  aprPct: number | null;
  onSubmit: (args: { collateralUi: number; borrowUi: number }) => void;
  formState: FormState;
  resetForm: () => void;
  recovering: boolean;
}) {
  // Everything the user can deposit: what is already on Solana plus what a
  // conversion would actually deliver from the rest.
  //
  // The quoted figure is authoritative. Summing holdings at par overstates the
  // ceiling by the conversion cost, which put a number in the field that the
  // planner then refused to fund. Par is only the fallback for when no route
  // could be priced, and the planner still guards the submit either way.
  const quotedMax = useMaxDepositable({
    vault,
    solanaAddress: walletAddress,
    evmAddress,
    solanaCollateralAtomic: collateralBalanceAtomic,
    heldEquivalents,
  });
  const depositCeiling =
    quotedMax.max && quotedMax.max.priced > 0
      ? Number(
          atomicToUiString(quotedMax.max.maxAtomic, vault.collateralDecimals),
        )
      : collateralBalance + convertibleUi;
  // Rounded DOWN to the displayed precision, never up. toFixed rounds half away
  // from zero, so a ceiling of 1.00005 would render as "1.0001" and fail its own
  // `collateralUi <= depositCeiling` check, leaving the button disabled until
  // the user retyped the field.
  const ceilingInput = floorToDisplay(depositCeiling);

  const [colInput, setColInput] = useState<string>(() =>
    depositCeiling > 0 ? ceilingInput : "0",
  );
  const [borrowInput, setBorrowInput] = useState<string>("");

  useEffect(() => {
    if (depositCeiling > 0 && colInput === "0") {
      setColInput(ceilingInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositCeiling]);

  const collateralUi = Number(colInput);
  const borrowUi = Number(borrowInput);

  const colDeltaValid =
    Number.isFinite(collateralUi) &&
    collateralUi >= 0 &&
    collateralUi <= depositCeiling;
  const borrowValid = Number.isFinite(borrowUi) && borrowUi >= 0;
  const totalCollateralUsd =
    oraclePrice != null
      ? ((existingPosition
          ? fromAtomicBN(existingPosition.collateralAtomic, vault.collateralDecimals)
          : 0) +
          collateralUi) *
        oraclePrice
      : null;
  const totalDebtUi =
    (existingPosition
      ? fromAtomicBN(existingPosition.debtAtomic, vault.borrowDecimals)
      : 0) + borrowUi;
  const projectedLtv =
    totalCollateralUsd && totalCollateralUsd > 0
      ? (totalDebtUi / totalCollateralUsd) * 100
      : 0;
  const ltPct = vault.liquidationThreshold / 10;
  const cfPct = vault.collateralFactor / 10;
  const tooClose = projectedLtv >= cfPct;
  // Price at which the projected position would reach LT and be closed. LTV
  // scales inversely with collateral price, so priceLiq / priceNow = LTV / LT.
  const liquidationPrice =
    oraclePrice != null && projectedLtv > 0
      ? oraclePrice * (projectedLtv / ltPct)
      : null;
  const drawdownPct =
    liquidationPrice != null && oraclePrice != null && oraclePrice > 0
      ? ((oraclePrice - liquidationPrice) / oraclePrice) * 100
      : null;
  const ticker = xstockByMint(vault.collateralMint);
  const existingDebtUi = existingPosition
    ? fromAtomicBN(existingPosition.debtAtomic, vault.borrowDecimals)
    : 0;
  // Upper bound for the borrow slider: the additional borrow that brings the
  // position to the collateral factor, minus a 1% buffer so interest accrued
  // between preview and settlement can't push it over CF and fail the tx.
  const maxNewBorrow =
    totalCollateralUsd != null
      ? Math.max(0, totalCollateralUsd * ((cfPct - 1) / 100) - existingDebtUi)
      : 0;
  // Whether this deposit needs a conversion. The planner makes the real,
  // priced decision at submit time; this is the disclosure that goes in front of
  // the user beforehand, so it errs toward showing rather than hiding.
  const willConvert =
    heldEquivalents.length > 0 && collateralUi > collateralBalance;

  // Price the conversion while the user is still deciding. Same planner the
  // submit path runs, so the numbers on screen are the ones that will be quoted
  // again a moment later, not a different estimate.
  const preview = useConversionPreview({
    vault,
    requestedUi: collateralUi,
    solanaAddress: walletAddress,
    evmAddress,
    solanaCollateralAtomic: collateralBalanceAtomic,
    heldEquivalents,
    enabled: willConvert,
  });
  const previewPlan =
    preview.plan?.kind === "unified-deposit" && preview.plan.legs.length > 0
      ? preview.plan
      : null;
  // A priced "no". Blocking submit on it saves the user a signature prompt for
  // a deposit that cannot be funded.
  const previewBlocked =
    preview.plan?.kind === "insufficient" || preview.plan?.kind === "unavailable"
      ? preview.plan
      : null;

  const converting = formState.kind === "converting";
  const submitting = formState.kind === "submitting" || converting;
  const disabled =
    !colDeltaValid ||
    !borrowValid ||
    submitting ||
    tooClose ||
    recovering ||
    Boolean(previewBlocked) ||
    (collateralUi === 0 && borrowUi === 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          value={colInput}
          onChange={(v) => {
            setColInput(v);
            resetForm();
          }}
          right={vault.collateralSymbol}
          onMax={() => {
            // With nothing to convert, use the exact on-chain base-unit string
            // so the resulting atomic amount never exceeds what the wallet
            // holds. With a conversion in play the ceiling is a pre-fee
            // estimate anyway, so it is rounded down to the displayed
            // precision to avoid asking for more than a route can deliver.
            setColInput(
              convertibleUi > 0
                ? ceilingInput
                : atomicToUiString(
                    collateralBalanceAtomic,
                    vault.collateralDecimals,
                  ),
            );
            resetForm();
          }}
        />
        <NumberField
          value={borrowInput}
          onChange={(v) => {
            setBorrowInput(v);
            resetForm();
          }}
          right={vault.borrowSymbol}
          onMax={
            // The real ceiling, matching the slider beside it: everything the
            // collateral factor allows, less the 1% settlement buffer and any
            // debt already outstanding. Not a safety-discounted figure.
            maxNewBorrow > 0
              ? () => {
                  setBorrowInput(maxNewBorrow.toFixed(2));
                  resetForm();
                }
              : undefined
          }
        />
      </div>

      {maxNewBorrow > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between text-xs">
            <span className="text-white/50">Borrow amount</span>
            <span className="font-mono tabular-nums text-white">
              {(borrowUi || 0).toFixed(2)} {vault.borrowSymbol} ·{" "}
              <span className={tooClose ? "text-aeras-negative" : undefined}>
                {projectedLtv.toFixed(1)}% LTV
              </span>
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={maxNewBorrow}
            step={Math.max(maxNewBorrow / 100, 0.01)}
            value={Math.min(Math.max(borrowUi || 0, 0), maxNewBorrow)}
            onChange={(e) => {
              setBorrowInput(Number(e.target.value).toFixed(2));
              resetForm();
            }}
            className="w-full accent-aeras-blue"
          />
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-white/50">
            <span>0</span>
            <span>
              Max {maxNewBorrow.toFixed(2)} {vault.borrowSymbol}
            </span>
          </div>
        </div>
      )}

      {(collateralUi > 0 || borrowUi > 0) && (
        <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs">
          {ticker && oraclePrice != null && liquidationPrice != null && (
            <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
              <PriceChart
                ticker={ticker}
                marker={{ price: liquidationPrice, label: "Safety floor" }}
              />
            </div>
          )}

          {borrowUi > 0 && (
            <div className="flex justify-between">
              <span className="text-white/50">You receive</span>
              <span className="font-mono tabular-nums text-white">
                {borrowUi.toFixed(2)} {vault.borrowSymbol}
              </span>
            </div>
          )}

          {borrowUi > 0 && aprPct != null && (
            <div className="flex justify-between">
              <span className="text-white/50">Interest</span>
              <span className="font-mono tabular-nums text-white">
                {aprPct.toFixed(2)}% APY
              </span>
            </div>
          )}

          {/* "Projected LTV / LT" named the ratio rather than saying what it
              means. The figure is unchanged; only the wording is. */}
          <div className="flex justify-between">
            <span className="text-white/50">Loan vs collateral</span>
            <span
              className={`font-mono tabular-nums ${
                tooClose ? "text-aeras-negative" : "text-white"
              }`}
            >
              {projectedLtv.toFixed(1)}% · closes at {ltPct.toFixed(0)}%
            </span>
          </div>

          {liquidationPrice != null &&
            drawdownPct != null &&
            drawdownPct > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-white/50">Safety floor</span>
                  <span className="font-mono tabular-nums text-white">
                    ${liquidationPrice.toFixed(2)} · {drawdownPct.toFixed(1)}%
                    below
                  </span>
                </div>
                <p className="text-[11px] text-white/50">
                  {vault.collateralSymbol} would need to fall{" "}
                  {drawdownPct.toFixed(1)}% to ${liquidationPrice.toFixed(2)}{" "}
                  before your position is closed to repay the loan.
                </p>
              </>
            )}

          {willConvert && (
            <ConversionPreviewBlock
              vault={vault}
              shortfallUi={collateralUi - collateralBalance}
              preview={preview}
              plan={previewPlan}
              blocked={previewBlocked}
            />
          )}

          {tooClose && (
            <p className="text-aeras-negative">
              Borrow exceeds the collateral factor ({cfPct.toFixed(0)}%). Reduce
              the borrow amount or add more collateral.
            </p>
          )}
        </div>
      )}

      {formState.kind === "converting" && (
        <div className="rounded-lg border border-aeras-blue/30 bg-aeras-blue/15 px-3 py-2 text-xs">
          <div className="font-medium text-white">Converting</div>
          <div className="mt-0.5 text-white/60">{formState.message}</div>
          <div className="mt-1 text-[11px] text-white/50">
            Keep this tab open. A cross-chain conversion can take a few minutes.
          </div>
        </div>
      )}
      {formState.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {formState.message}
        </p>
      )}
      {formState.kind === "done" && (
        <a
          href={`${SOLSCAN_TX_BASE}${formState.signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">Submitted</div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
            {formState.signature}
          </div>
        </a>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onSubmit({ collateralUi, borrowUi })}
        className="w-full rounded-xl bg-aeras-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {recovering
          ? "Checking for an existing position…"
          : converting
            ? "Converting…"
            : submitting
              ? "Signing and submitting…"
              : borrowUi > 0
              ? `Borrow $${borrowUi.toFixed(2)} against ${vault.collateralSymbol}`
              : collateralUi > 0
                ? `Deposit ${collateralUi.toFixed(4)} ${vault.collateralSymbol}`
                : existingPosition
                  ? "Update position"
                  : "Open position"}
      </button>
    </div>
  );
}

// What the conversion actually costs, priced before the user commits.
//
// Every number here comes from the live Trustware quote the planner solved
// against. The minimum is what the route guarantees after slippage, so it is
// the figure the deposit is sized from, not the optimistic estimate.
function ConversionPreviewBlock({
  vault,
  shortfallUi,
  preview,
  plan,
  blocked,
}: {
  vault: XStockBorrowVault;
  shortfallUi: number;
  preview: ConversionPreview;
  plan: UnifiedDepositPlan | null;
  blocked: BlockedPlan | null;
}) {
  if (blocked) {
    return (
      <div className="rounded-lg border border-aeras-warning/40 bg-white/5 px-3 py-2.5 text-[11px] text-white/70">
        <div className="font-medium text-aeras-warning">
          This deposit cannot be funded
        </div>
        <div className="mt-0.5">{blocked.reason}</div>
      </div>
    );
  }

  if (!plan) {
    return (
      <p className="text-[11px] text-white/50">
        {preview.error
          ? `Could not price the conversion. ${preview.error}`
          : `${shortfallUi.toFixed(4)} ${vault.collateralSymbol} of this deposit is not on Solana yet. Pricing the conversion.`}
      </p>
    );
  }

  // Guaranteed floors, summed. What the deposit is actually sized against.
  const minOutUi = plan.legs.reduce(
    (sum, leg) =>
      sum +
      Number(
        atomicToUiString(leg.quote.toAmountMinAtomic, vault.collateralDecimals),
      ),
    0,
  );
  const fees = plan.totalFeesUsd;
  const multi = plan.legs.length > 1;
  // Slippage can differ per leg, since a Solana route takes a tighter tolerance
  // than a bridged one. Show the range rather than implying one number.
  const slippages = [...new Set(plan.legs.map((l) => l.quote.slippagePct))];

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">
          {multi ? `Conversions · ${plan.legs.length}` : "Conversion"}
        </span>
        {preview.loading && (
          <span className="text-[10px] text-white/40">Repricing</span>
        )}
      </div>
      {plan.legs.map((leg) => (
        <PreviewRow
          key={`${leg.source.chain}:${leg.source.token}`}
          label="You convert"
          value={`${Number(
            atomicToUiString(leg.sourceAmountAtomic, leg.source.decimals),
          ).toFixed(6)} ${leg.source.symbol}`}
          sub={leg.source.chainLabel}
        />
      ))}
      <PreviewRow
        label="You receive at least"
        value={`${minOutUi.toFixed(6)} ${vault.collateralSymbol}`}
      />
      <PreviewRow
        label="Cost"
        value={fees != null ? `$${fees.toFixed(2)}` : "Not quoted"}
      />
      <PreviewRow
        label="Slippage"
        value={slippages.map((s) => `${s}%`).join(" · ")}
      />
      <p className="text-[11px] text-white/50">
        {multi
          ? "Each conversion runs in turn and has to settle before the deposit goes through. They are priced again when you submit, so the final rates can differ from this quote."
          : "The conversion runs first and has to settle before anything is deposited. It is priced again when you submit, so the final rate can differ from this quote."}
      </p>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-white/50">{label}</span>
      <span className="text-right font-mono tabular-nums text-white">
        {value}
        {sub && <span className="ml-1 text-white/50">{sub}</span>}
      </span>
    </div>
  );
}

function ClosePositionControl({
  vault,
  position,
  walletUsdc,
  fundableUsdc,
  state,
  onClose,
  onReset,
}: {
  vault: XStockBorrowVault;
  position: UserPositionState;
  walletUsdc: number;
  // What the Monad wallet can contribute after conversion costs; the close
  // bridges it in before repaying when the Solana wallet is short.
  fundableUsdc: number;
  state: FormState;
  onClose: (method: "repay" | "sell") => void;
  onReset: () => void;
}) {
  const debtUi = fromAtomicBN(position.debtAtomic, vault.borrowDecimals);
  const colUi = fromAtomicBN(position.collateralAtomic, vault.collateralDecimals);
  const submitting = state.kind === "submitting" || state.kind === "converting";

  // A small buffer over the displayed debt covers interest that accrues between
  // this render and settlement, so we don't offer a repay the tx would reject.
  const canRepayDirect = walletUsdc >= debtUi * 1.005;
  const canRepayFromWallet = walletUsdc + fundableUsdc >= debtUi * 1.005;

  // Selling collateral disposes of the underlying stock, so it is never the
  // default and never automatic. The user opts in explicitly (this arms the
  // control), and only a second, confirming click actually sells.
  const [sellArmed, setSellArmed] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onClose("repay")}
        disabled={submitting || !canRepayFromWallet}
        className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? state.kind === "converting"
            ? state.message
            : "Closing position…"
          : `Close · repay ${debtUi.toFixed(4)} ${vault.borrowSymbol} + withdraw ${colUi.toFixed(4)} ${vault.collateralSymbol}`}
      </button>
      {canRepayDirect ? (
        <p className="text-[11px] text-white/50">
          Repays the loan from your wallet {vault.borrowSymbol} and returns your{" "}
          {vault.collateralSymbol} in full.
        </p>
      ) : canRepayFromWallet ? (
        // Funded from the other balances automatically; the button's progress
        // copy narrates the legs, so no standing explainer is needed.
        <p className="text-[11px] text-white/50">Takes a few minutes.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-white/50">
            Needs ≥ {debtUi.toFixed(4)} {vault.borrowSymbol} across your
            balances to repay and keep your {vault.collateralSymbol}. Your
            USDC, SOL, and Monad USDC together cover{" "}
            {(walletUsdc + fundableUsdc).toFixed(2)} {vault.borrowSymbol}.
          </p>
          {!sellArmed ? (
            <button
              type="button"
              onClick={() => setSellArmed(true)}
              disabled={submitting}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Or sell {vault.collateralSymbol} collateral to repay instead
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-aeras-warning/40 bg-white/5 px-3 py-2.5">
              <p className="text-[11px] text-white/70">
                This sells enough {vault.collateralSymbol} to repay the{" "}
                {debtUi.toFixed(4)} {vault.borrowSymbol} loan and returns the
                rest. You will not get your {vault.collateralSymbol} back intact.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onClose("sell")}
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-aeras-warning/80 px-3 py-2 text-xs font-medium text-black transition-colors hover:bg-aeras-warning disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting
                    ? "Selling…"
                    : `Confirm · sell ${vault.collateralSymbol} to repay`}
                </button>
                <button
                  type="button"
                  onClick={() => setSellArmed(false)}
                  disabled={submitting}
                  className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/60 transition-colors hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {state.kind === "error" && (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {state.message}
          <button
            type="button"
            onClick={onReset}
            className="ml-2 text-white/50 underline-offset-2 hover:text-white hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {state.kind === "done" && (
        <a
          href={`${SOLSCAN_TX_BASE}${state.signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">Position closed</div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
            {state.signature}
          </div>
        </a>
      )}
    </div>
  );
}

// The label and balance hint are optional. With neither set the header row is
// dropped entirely and Max moves inside the field, next to the token suffix, so
// the control is one line instead of three.
function NumberField({
  label,
  value,
  onChange,
  right,
  balanceLabel,
  onMax,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  right: string;
  balanceLabel?: string;
  onMax?: () => void;
}) {
  const bare = !label && !balanceLabel;
  return (
    <div>
      {!bare && (
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            {label}
          </label>
          {balanceLabel && (
            <span className="font-mono text-[11px] text-white/50">
              {balanceLabel}
              {onMax && (
                <button
                  type="button"
                  onClick={onMax}
                  className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
                >
                  Max
                </button>
              )}
            </span>
          )}
        </div>
      )}
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label ?? right}
          className={`block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft ${
            bare && onMax ? "pr-24" : "pr-16"
          }`}
        />
        <span className="absolute inset-y-0 right-3 flex items-center gap-2 text-[11px] font-medium text-white/50">
          <span className="pointer-events-none">{right}</span>
          {bare && onMax && (
            <button
              type="button"
              onClick={onMax}
              className="text-white/70 underline-offset-2 hover:text-white hover:underline"
            >
              Max
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
  // Tailwind bg-* class for a small color dot before the label.
  dot?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-white/50">
        {dot && (
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        )}
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-white">
        {value}
        {sub && <span className="text-white/50"> · {sub}</span>}
      </div>
    </div>
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
