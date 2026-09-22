"use client";

// Borrow USDC against tokenized gold, in the Aave V4 Gold spoke on Ethereum.
//
// The gold row of the Borrow tab's loan-options table, in the same column
// geometry as the Solana rows (components/borrow-table.ts), and on expand the
// same card the Jupiter Lend and Kamino markets open: the available-to-borrow
// figure with the Repay and Borrow pills, the position card with its status
// badge, a deposit-and-borrow form with the slider and the safety-floor chart,
// and one close control. It replaced the Morpho gold card (GoldBorrowCard.tsx)
// in that table on 2026-09-09; the Morpho module stays for the funding planner
// and for an existing Morpho position in the positions panel.
//
// Reads its own live data (spoke state and position from Ethereum, both via
// our API routes), signs with the Privy embedded EVM wallet, and funds a
// deposit through the Trustware conversion in lib/morpho/gold-fund.ts, pointed
// at this venue's oracle and gas cycle.
//
// Three things this card is required to be honest about:
//
//   1. **Supplied gold earns nothing.** The XAUt reserve is not borrowable and
//      its rate is zero. The rate on screen is what the user PAYS.
//   2. **There is no buffer in the protocol.** Aave V4 has one collateral
//      factor, which is both the borrowing limit and the liquidation
//      threshold, so the ceiling is one tick from liquidation. The slider's
//      maximum sits 1% below it, the same buffer the other cards keep.
//   3. **Small positions are liquidated whole.** A liquidation may not leave
//      less than $1,000 behind, so a position under that is not trimmed to the
//      target health, it is closed. Said where a small position is being
//      opened, not in a disclosure.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { formatUnits, parseUnits } from "viem";

import { DotStat, NumberField } from "@/components/borrow-fields";
import {
  BORROW_PILL_CLASS,
  MarketDetailHeader,
  type BorrowMode,
} from "@/components/BorrowMarketDetail";
import type { BorrowTableRow } from "@/components/borrow-table";
import { PriceChart } from "@/components/PriceChart";
import {
  AAVE_GAS_UNITS_FULL_CYCLE,
  borrowAgainstAaveGold,
  enableAaveGoldCollateral,
  repayAaveGoldDebt,
  supplyAaveGoldCollateral,
  withdrawAaveGoldCollateral,
} from "@/lib/aave/gold-borrow";
import {
  AAVE_GOLD_POSITION_ROUTE,
  fetchAaveGoldMarkets,
  fetchAaveGoldPositions,
  type AaveGoldMarketMetric,
  type AaveGoldPosition,
} from "@/lib/aave/gold-client";
import {
  AAVE_GOLD_MARKETS,
  DUST_LIQUIDATION_USD,
  ETHEREUM_EXPLORER_TX_BASE,
  type AaveGoldMarket,
} from "@/lib/aave/gold-market";
import { heldValueUsd } from "@/lib/borrow/sort";
import { xstockByMint } from "@/lib/jupiter/xstocks";
import {
  executeGoldFunding,
  needsEthGas,
  planGoldFunding,
  type GoldFundingPlan,
  type GoldFundingReady,
  type SolanaSigner,
} from "@/lib/morpho/gold-fund";
import {
  GOLD_COLLATERAL_SOURCES,
  type GoldCollateralSource,
} from "@/lib/morpho/gold-sources";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import { floorToDisplay } from "@/lib/trustware/selection";
import type { GoldHolding } from "@/lib/trustware/gold-holdings";

// "XAUt already in your Ethereum wallet" is a funding source with no conversion
// attached, so it is not in the registry. This sentinel selects it.
const WALLET_XAUT = "wallet:xaut";

// How long to sit still before pricing a conversion. Each plan is up to four
// upstream quotes, so pricing on every keystroke would hammer Trustware and
// return answers for amounts the user has already typed past.
const PLAN_DEBOUNCE_MS = 600;

// Below this collateral value a liquidation cannot leave $1,000 standing after
// the target-health trim, so the whole position goes. The dust warning shows
// under it.
const WHOLE_LIQUIDATION_BELOW_USD = DUST_LIQUIDATION_USD * 1.3;

// The slider's ceiling sits this far below the collateral factor, so interest
// accrued between preview and settlement cannot push the borrow over the line
// and fail the transaction. Same buffer the Jupiter and Kamino cards keep.
const SETTLEMENT_BUFFER_PCT = 1;

// The Solana twin of the collateral, which is how the header finds Tether
// Gold's mark and how the chart finds a gold series: XAUt0 on Solana tracks the
// same bullion claim as XAUt on Ethereum, one issuer and one unit.
const XAUT0_SOLANA_MINT = GOLD_COLLATERAL_SOURCES.find(
  (s) => s.kind === "solana" && s.symbol === "XAUt0",
)?.token;
const GOLD_CHART = XAUT0_SOLANA_MINT ? xstockByMint(XAUT0_SOLANA_MINT) : undefined;

function fmt(atomic: string | bigint | undefined, decimals: number, digits = 2): string {
  if (atomic === undefined) return "—";
  const value = Number(formatUnits(BigInt(atomic), decimals));
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

// This venue's rows for the Borrow tab's table, in the shared row model.
//
// A hook rather than a section component because the table is sortable: the
// panel has to hold every row's figures before it draws any of them, so this
// venue reports its rows and the panel decides where they land. The card each
// row opens is still built here, since only this file knows what it needs.
export function useAaveGoldRows({
  walletAddress,
  goldHoldings,
  solanaUsdcAtomic,
  onRefresh,
}: {
  // The user's Solana wallet: where the gold is, and what pays for gas.
  walletAddress: string | undefined;
  // Gold held anywhere, from the shared wallet scan.
  goldHoldings: GoldHolding[];
  solanaUsdcAtomic: string;
  // Parent refresh, so a conversion's spend disappears from the wallet panel
  // without a reload.
  onRefresh?: () => Promise<void>;
}): BorrowTableRow[] {
  const evm = useEmbeddedEvmWallet();
  const sendSolanaTx = useSendSolanaTxBase64();
  const [metrics, setMetrics] = useState<Map<string, AaveGoldMarketMetric>>(new Map());
  const [positions, setPositions] = useState<Map<string, AaveGoldPosition>>(new Map());
  const [wallet, setWallet] = useState({
    collateralBalanceAtomic: "0",
    loanBalanceAtomic: "0",
    ethBalanceAtomic: "0",
    gasPriceWei: "0",
  });
  // True until the first market read lands, so a slow read shows "…" rather
  // than reading as an empty market.
  const [statsLoading, setStatsLoading] = useState(true);

  const solanaSigner = useMemo<SolanaSigner | undefined>(
    () =>
      walletAddress
        ? { address: walletAddress, signAndSendBase64: sendSolanaTx }
        : undefined,
    [walletAddress, sendSolanaTx],
  );

  const refresh = useCallback(async () => {
    try {
      setMetrics(await fetchAaveGoldMarkets());
    } catch (err) {
      console.error("[aave gold market]", err);
    } finally {
      setStatsLoading(false);
    }
    if (evm.address) {
      try {
        const res = await fetchAaveGoldPositions(evm.address);
        setPositions(res.positions);
        setWallet({
          collateralBalanceAtomic: res.collateralBalanceAtomic,
          loanBalanceAtomic: res.loanBalanceAtomic,
          ethBalanceAtomic: res.ethBalanceAtomic,
          gasPriceWei: res.gasPriceWei,
        });
      } catch (err) {
        console.error("[aave gold position]", err);
      }
    }
  }, [evm.address]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handleSettled = useCallback(async () => {
    await refresh();
    await onRefresh?.();
  }, [refresh, onRefresh]);

  return AAVE_GOLD_MARKETS.map((market) => {
    const metric = metrics.get(market.id);
    const position = positions.get(market.id);

    // The same four figures the Solana rows carry, in the same units: depth of
    // the collateral side, what is actually drawable, what the user holds, and
    // the live rate. All priced at the spoke's oracle.
    const sizeUsd = metric
      ? Number(
          formatUnits(
            BigInt(metric.totalSuppliedAtomic),
            market.collateralToken.decimals,
          ),
        ) * metric.oracleUnitPrice
      : null;
    const liquidityUsd = metric
      ? Number(
          formatUnits(BigInt(metric.liquidityAtomic), market.debtToken.decimals),
        ) * metric.debtUnitPrice
      : null;
    // Gold the user has on this venue's chain: supplied to the market plus
    // sitting in the Ethereum wallet. Both are XAUt, so they add.
    const heldAtomic =
      BigInt(position?.collateralAtomic ?? "0") +
      BigInt(wallet.collateralBalanceAtomic || "0");
    const held = Number(
      formatUnits(heldAtomic, market.collateralToken.decimals),
    );

    return {
      key: market.id,
      // Tether Gold's mark, not GLD's. The collateral here is XAUt, a claim on
      // allocated bullion; GLD is the SPDR ETF and a different issuer, asset
      // and unit size.
      identity: {
        symbol: market.collateralToken.symbol,
        name: market.collateralToken.name,
        logo: "/logos/xaut.png",
      },
      name: market.collateralToken.name,
      venue: "Aave",
      // The pair, the venue and the chain, because this is the one row that
      // does not settle on Solana.
      subtitle: `${market.name} · Aave · Ethereum`,
      sizeUsd,
      liquidityUsd,
      heldQty: held,
      heldUsd: heldValueUsd(held, metric ? metric.oracleUnitPrice : null),
      aprPct: metric ? metric.borrowApy * 100 : null,
      statsLoading,
      renderBody: () => (
        <AaveGoldMarketCard
          market={market}
          metric={metric}
          position={position}
          wallet={wallet}
          goldHoldings={goldHoldings}
          solanaUsdcAtomic={solanaUsdcAtomic}
          solanaAddress={walletAddress}
          solanaSigner={solanaSigner}
          evm={evm}
          onSettled={handleSettled}
        />
      ),
    };
  });
}

// ── the card ───────────────────────────────────────────────────────────────

// Submitting carries a human-readable step because opening a position here is
// up to three Ethereum transactions (approve, supply with enable, borrow) plus
// a bridge when the deposit is converted, and closing is up to three (approve,
// repay, withdraw), each signed separately.
type FormState =
  | { kind: "idle" }
  | { kind: "submitting"; step: string }
  | { kind: "error"; message: string }
  | { kind: "done"; txHash: string };

interface WalletState {
  collateralBalanceAtomic: string;
  loanBalanceAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
}

interface OpenArgs {
  // The XAUt to supply, atomic, or the source amount when converting.
  depositAtomic: bigint;
  source: GoldCollateralSource | null;
  plan: GoldFundingReady | null;
  borrowAtomic: bigint;
}

function AaveGoldMarketCard({
  market,
  metric,
  position,
  wallet,
  goldHoldings,
  solanaUsdcAtomic,
  solanaAddress,
  solanaSigner,
  evm,
  onSettled,
}: {
  market: AaveGoldMarket;
  metric: AaveGoldMarketMetric | undefined;
  position: AaveGoldPosition | undefined;
  wallet: WalletState;
  goldHoldings: GoldHolding[];
  solanaUsdcAtomic: string;
  solanaAddress: string | undefined;
  solanaSigner: SolanaSigner | undefined;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  onSettled: () => Promise<void>;
}) {
  // Borrow first: a user opening a market they have no position in is here to
  // draw, not to repay.
  const [mode, setMode] = useState<BorrowMode>("borrow");
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });
  const [closingState, setClosingState] = useState<FormState>({ kind: "idle" });
  const [enableState, setEnableState] = useState<FormState>({ kind: "idle" });
  // Header cell the borrow form portals its submit into. See BorrowMarketDetail.
  const [borrowSlot, setBorrowSlot] = useState<HTMLDivElement | null>(null);

  const collateralDecimals = market.collateralToken.decimals;
  const debtDecimals = market.debtToken.decimals;
  const collateral = BigInt(position?.collateralAtomic ?? "0");
  const debt = BigInt(position?.debtAtomic ?? "0");
  const hasPosition = collateral > 0n || debt > 0n;

  const oraclePrice = metric?.oracleUnitPrice ?? null;
  const debtPrice = metric?.debtUnitPrice ?? 1;
  const liquidity = BigInt(metric?.liquidityAtomic ?? "0");
  const available = BigInt(position?.availableToBorrowAtomic ?? "0");
  // What this market will lend right now: the position's headroom or the
  // drawable liquidity, whichever is smaller. Null until both have loaded.
  const availableUsd =
    metric && position
      ? Number(formatUnits(available < liquidity ? available : liquidity, debtDecimals)) *
        debtPrice
      : null;
  const owedUsd = Number(formatUnits(debt, debtDecimals)) * debtPrice;

  function signerOrThrow() {
    if (!evm.address) throw new Error("No embedded EVM wallet available.");
    return {
      address: evm.address,
      switchChain: evm.switchChain,
      getProvider: evm.getProvider,
    };
  }

  async function handleOpen(args: OpenArgs) {
    if (!evm.address) {
      setFormState({ kind: "error", message: "No embedded EVM wallet available." });
      return;
    }
    setFormState({ kind: "submitting", step: "Preparing…" });
    const step = (s: string) => setFormState({ kind: "submitting", step: s });
    try {
      const signer = signerOrThrow();
      let lastHash = "";

      if (args.depositAtomic > 0n) {
        let supplyAtomic = args.depositAtomic;
        if (args.source) {
          if (!args.plan) {
            throw new Error("Still pricing the conversion. Try again in a moment.");
          }
          const { xautDeliveredAtomic } = await executeGoldFunding({
            plan: args.plan,
            source: args.source,
            evmAddress: evm.address,
            solanaAddress,
            solana: solanaSigner,
            evm: signer,
            xautBeforeAtomic: wallet.collateralBalanceAtomic,
            positionRoute: AAVE_GOLD_POSITION_ROUTE,
            onProgress: (p) => step(p.message),
          });
          // Supply what arrived, not what was planned. A conversion that beat
          // its floor should not leave the surplus stranded in the wallet.
          supplyAtomic = BigInt(xautDeliveredAtomic);
        }

        // The spoke's supply cap binds on the delivered amount. Supply up to
        // it and leave the rest in the wallet rather than fail the whole
        // transaction after the conversion has already run.
        const headroom =
          metric?.supplyHeadroomAtomic == null
            ? null
            : BigInt(metric.supplyHeadroomAtomic);
        if (headroom !== null && supplyAtomic > headroom) {
          if (headroom <= 0n) {
            throw new Error(
              "Aave's supply cap for XAUt on this market is full right now. The XAUt is in your Ethereum wallet; try again when the cap has room.",
            );
          }
          supplyAtomic = headroom;
        }

        lastHash = await supplyAaveGoldCollateral({
          market,
          amountAtomic: supplyAtomic,
          signer,
          onProgress: (p) => step(p.message),
        });
      }

      if (args.borrowAtomic > 0n) {
        lastHash = await borrowAgainstAaveGold({
          market,
          amountAtomic: args.borrowAtomic,
          signer,
          onProgress: (p) => step(p.message),
        });
      }

      setFormState({ kind: "done", txHash: lastHash });
      await onSettled();
    } catch (err) {
      setFormState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleClose() {
    if (!evm.address) {
      setClosingState({ kind: "error", message: "No embedded EVM wallet available." });
      return;
    }
    setClosingState({ kind: "submitting", step: "Preparing…" });
    const step = (s: string) => setClosingState({ kind: "submitting", step: s });
    try {
      const signer = signerOrThrow();
      let lastHash = "";
      if (debt > 0n) {
        lastHash = await repayAaveGoldDebt({
          market,
          amountAtomic: 0n,
          repayAll: true,
          debtAtomic: debt.toString(),
          signer,
          onProgress: (p) => step(p.message),
        });
      }
      if (collateral > 0n) {
        lastHash = await withdrawAaveGoldCollateral({
          market,
          amountAtomic: collateral,
          signer,
          onProgress: (p) => step(p.message),
        });
      }
      setClosingState({ kind: "done", txHash: lastHash });
      await onSettled();
    } catch (err) {
      setClosingState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleEnable() {
    setEnableState({ kind: "submitting", step: "Preparing…" });
    try {
      const txHash = await enableAaveGoldCollateral({
        market,
        signer: signerOrThrow(),
        onProgress: (p) => setEnableState({ kind: "submitting", step: p.message }),
      });
      setEnableState({ kind: "done", txHash });
      await onSettled();
    } catch (err) {
      setEnableState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const collateralNotEnabled = collateral > 0n && position?.usingAsCollateral === false;
  const rebinds =
    position !== undefined &&
    metric !== undefined &&
    collateral > 0n &&
    position.dynamicConfigKey !== metric.dynamicConfigKey;

  return (
    <div className="space-y-5 rounded-xl border border-white/10 bg-white/5 p-5">
      <MarketDetailHeader
        mint={XAUT0_SOLANA_MINT ?? market.collateralToken.address}
        symbol={market.collateralToken.symbol}
        borrowSymbol={market.debtToken.symbol}
        availableUsd={availableUsd}
        owedUsd={owedUsd}
        mode={mode}
        onModeChange={setMode}
        canRepay={hasPosition}
        borrowActionSlot={setBorrowSlot}
      />

      {hasPosition && position && (
        <AavePositionCard
          market={market}
          position={position}
          oraclePrice={oraclePrice}
        />
      )}

      {/* A supply made elsewhere without the collateral flag backs nothing.
          Offer the one call that fixes it, above the forms. */}
      {collateralNotEnabled && (
        <div className="space-y-2 rounded-lg border border-aeras-warning/40 bg-white/5 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-aeras-warning">
              Your {fmt(collateral, collateralDecimals, 4)}{" "}
              {market.collateralToken.symbol} is supplied but not enabled as
              collateral, so it backs nothing yet.
            </span>
            <button
              type="button"
              disabled={enableState.kind === "submitting" || !evm.ready}
              onClick={handleEnable}
              className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white hover:bg-white/25 disabled:opacity-50"
            >
              {enableState.kind === "submitting"
                ? enableState.step
                : "Enable as collateral"}
            </button>
          </div>
          {enableState.kind === "error" && (
            <p className="text-aeras-negative">{enableState.message}</p>
          )}
        </div>
      )}

      {rebinds && (
        <p className="text-[11px] text-white/50">
          Aave has updated this market&apos;s risk parameters since your
          position last changed. Your position keeps its{" "}
          {((position?.collateralFactor ?? 0) * 100).toFixed(0)}% collateral
          factor until your next borrow or withdraw, which moves it to the
          current {((metric?.collateralFactor ?? 0) * 100).toFixed(0)}%.
        </p>
      )}
      {position && position.otherDebtUsd > 0 && (
        <p className="text-[11px] text-white/50">
          You also owe ${position.otherDebtUsd.toFixed(2)} on other reserves of
          this Aave market. It counts against your health here but is repaid on
          Aave directly.
        </p>
      )}

      {mode === "repay" && hasPosition && position ? (
        <AaveCloseControl
          market={market}
          position={position}
          wallet={wallet}
          state={closingState}
          onClose={handleClose}
          onReset={() => setClosingState({ kind: "idle" })}
        />
      ) : mode === "borrow" ? (
        <AaveOperateForm
          market={market}
          metric={metric}
          position={position}
          wallet={wallet}
          goldHoldings={goldHoldings}
          solanaUsdcAtomic={solanaUsdcAtomic}
          solanaAddress={solanaAddress}
          evmAddress={evm.address}
          walletReady={evm.ready}
          onSubmit={handleOpen}
          formState={formState}
          resetForm={() => setFormState({ kind: "idle" })}
          actionSlot={borrowSlot}
        />
      ) : null}
    </div>
  );
}

// ── the position ───────────────────────────────────────────────────────────

function AavePositionCard({
  market,
  position,
  oraclePrice,
}: {
  market: AaveGoldMarket;
  position: AaveGoldPosition;
  oraclePrice: number | null;
}) {
  const colUi = Number(formatUnits(BigInt(position.collateralAtomic), market.collateralToken.decimals));
  const debtUi = Number(formatUnits(BigInt(position.debtAtomic), market.debtToken.decimals));
  const colUsd = position.collateralValueUsd;
  const ltvPct = (position.ltv ?? 0) * 100;
  // In Aave V4 the collateral factor is the liquidation threshold: there is no
  // separate max LTV below it. "LT" here is the factor the position is bound
  // to, which can lag the reserve's latest.
  const liquidationPct = position.collateralFactor * 100;
  const health = position.healthFactor;
  const liquidationPrice = position.liquidationPrice;
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
        <span className="font-mono text-[11px] text-white/50">Position</span>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badgeBg}`}
        >
          {badgeText}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <DotStat
          dot="bg-aeras-positive"
          label="Collateral"
          value={`${colUi.toFixed(4)} ${market.collateralToken.symbol}`}
          sub={colUsd > 0 ? `$${colUsd.toFixed(2)}` : undefined}
        />
        <DotStat
          dot="bg-aeras-warning"
          label="Debt"
          value={`${debtUi.toFixed(2)} ${market.debtToken.symbol}`}
        />
        <DotStat
          dot={statusDot}
          label="LTV"
          value={`${ltvPct.toFixed(1)}% / LT ${liquidationPct.toFixed(0)}%`}
        />
        <DotStat
          dot={statusDot}
          label="Health"
          value={health == null ? "—" : `${health.toFixed(2)}×`}
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
              ${liquidationPrice.toFixed(2)} / {market.collateralToken.symbol}
            </span>
          </div>
          {oraclePrice != null && (
            <div className="mt-1 text-[11px] text-white/50">
              {oraclePrice > liquidationPrice
                ? `${market.collateralToken.symbol} would need to drop ${(((oraclePrice - liquidationPrice) / oraclePrice) * 100).toFixed(1)}% from $${oraclePrice.toFixed(2)} to liquidate.`
                : "Position is at the liquidation threshold."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── the form ───────────────────────────────────────────────────────────────

function AaveOperateForm({
  market,
  metric,
  position,
  wallet,
  goldHoldings,
  solanaUsdcAtomic,
  solanaAddress,
  evmAddress,
  walletReady,
  onSubmit,
  formState,
  resetForm,
  actionSlot,
}: {
  market: AaveGoldMarket;
  metric: AaveGoldMarketMetric | undefined;
  position: AaveGoldPosition | undefined;
  wallet: WalletState;
  goldHoldings: GoldHolding[];
  solanaUsdcAtomic: string;
  solanaAddress: string | undefined;
  evmAddress: string | undefined;
  walletReady: boolean;
  onSubmit: (args: OpenArgs) => void;
  formState: FormState;
  resetForm: () => void;
  // Header cell to render the submit into; falls back in place when absent.
  actionSlot: HTMLElement | null;
}) {
  const collateralDecimals = market.collateralToken.decimals;
  const debtDecimals = market.debtToken.decimals;
  const oraclePrice = metric?.oracleUnitPrice ?? null;
  const debtPrice = metric?.debtUnitPrice ?? 1;
  const factor = position?.collateralFactor ?? metric?.collateralFactor ?? 0;
  const factorPct = factor * 100;

  // What can be deposited. XAUt already on Ethereum is the default source;
  // gold held elsewhere is converted through Trustware first, and because the
  // sources are different denominations the field takes the source's units.
  const holdings = useMemo(
    () => goldHoldings.filter((h) => Number(h.balanceAtomic) > 0),
    [goldHoldings],
  );
  const [sourceId, setSourceId] = useState<string>(WALLET_XAUT);
  const selectedHolding = holdings.find((h) => h.source.id === sourceId);
  const source = selectedHolding?.source ?? null;
  const depositDecimals = source?.decimals ?? collateralDecimals;
  const depositSymbol = source?.symbol ?? market.collateralToken.symbol;

  const walletXaut = BigInt(wallet.collateralBalanceAtomic || "0");
  const supplyHeadroom =
    metric?.supplyHeadroomAtomic == null ? null : BigInt(metric.supplyHeadroomAtomic);
  const depositCeilingAtomic = (() => {
    if (selectedHolding) return BigInt(selectedHolding.balanceAtomic);
    if (supplyHeadroom === null) return walletXaut;
    return walletXaut < supplyHeadroom ? walletXaut : supplyHeadroom;
  })();
  const depositCeiling = Number(formatUnits(depositCeilingAtomic, depositDecimals));
  // Rounded DOWN to the displayed precision, never up, for the reason the
  // Jupiter and Kamino cards give: a ceiling of 1.00005 rendered as "1.0001"
  // fails its own check and leaves the button disabled with nothing on screen
  // saying why.
  const ceilingInput = floorToDisplay(depositCeiling);

  // The deposit field opens pre-filled with everything available and follows
  // that ceiling until the user types, the way the other cards open. Derived
  // rather than synced in an effect: null means "not typed yet".
  const [typedCol, setTypedCol] = useState<string | null>(null);
  const colInput = typedCol ?? (depositCeiling > 0 ? ceilingInput : "0");
  const setColInput = (v: string | null) => setTypedCol(v);
  const [borrowInput, setBorrowInput] = useState<string>("");

  const depositAtomic = (() => {
    try {
      return colInput ? parseUnits(colInput, depositDecimals) : 0n;
    } catch {
      return 0n;
    }
  })();
  const borrowUi = Number(borrowInput);
  const borrowAtomic = (() => {
    try {
      return borrowInput && borrowUi > 0 ? parseUnits(borrowUi.toFixed(debtDecimals), debtDecimals) : 0n;
    } catch {
      return 0n;
    }
  })();
  const colDeltaValid = depositAtomic >= 0n && depositAtomic <= depositCeilingAtomic;
  const borrowValid = Number.isFinite(borrowUi) && borrowUi >= 0;

  // ── conversion planning ──────────────────────────────────────────────────
  //
  // Only a deposit from a held source needs a plan; XAUt already in the
  // Ethereum wallet is a plain approve-and-supply. Priced while the user is
  // still deciding, with the same planner the submit path runs.
  const [plan, setPlan] = useState<GoldFundingPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  // The cost, in bps, the user has accepted for THIS amount from THIS source.
  // Cleared with the plan whenever either changes, so a figure accepted for
  // one conversion never carries over to a different one.
  const [acceptedLossBps, setAcceptedLossBps] = useState<number | null>(null);
  const needsPlan = Boolean(source) && depositAtomic > 0n;
  const planKey = needsPlan
    ? `${sourceId}|${depositAtomic}|${wallet.gasPriceWei}|${acceptedLossBps ?? ""}`
    : "";
  const planSeq = useRef(0);

  useEffect(() => {
    if (!planKey || !colDeltaValid || !evmAddress || !metric || !source) return;
    const seq = ++planSeq.current;
    const timer = setTimeout(async () => {
      setPlanning(true);
      try {
        const result = await planGoldFunding({
          source,
          sourceAmountAtomic: depositAtomic,
          solanaAddress,
          evmAddress,
          solanaUsdcAtomic,
          ethBalanceAtomic: wallet.ethBalanceAtomic,
          gasPriceWei: wallet.gasPriceWei,
          // USD per XAUt at the spoke's oracle, which is what the liquidation
          // check uses. The value bound is priced against it.
          oracleUnitPrice: metric.oracleUnitPrice,
          gasUnitsFullCycle: AAVE_GAS_UNITS_FULL_CYCLE,
          acceptLossBps: acceptedLossBps ?? undefined,
        });
        // A stale plan describes an amount the user has typed past. Drop it.
        if (seq === planSeq.current) setPlan(result);
      } catch (err) {
        if (seq === planSeq.current) {
          setPlan({
            kind: "blocked",
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (seq === planSeq.current) setPlanning(false);
      }
    }, PLAN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  const readyPlan = needsPlan && plan?.kind === "ready" ? plan : null;
  const planBlocked = needsPlan && plan?.kind === "blocked" ? plan : null;
  // Priced past the soft bound. The numbers are on screen and the button
  // waits for the user to accept them; nothing is signed on their behalf.
  const planConfirm =
    needsPlan && plan?.kind === "needs-confirmation" ? plan : null;
  const planPending = needsPlan && (planning || !plan);

  // ── the projection ───────────────────────────────────────────────────────
  //
  // Collateral after the deposit: what is posted plus what lands. A converted
  // deposit lands as XAUt, so it is the plan's guaranteed delivery, not the
  // amount typed in. Without a plan yet there is nothing honest to project.
  const existingColUi = Number(formatUnits(BigInt(position?.collateralAtomic ?? "0"), collateralDecimals));
  const existingDebtUi = Number(formatUnits(BigInt(position?.debtAtomic ?? "0"), debtDecimals));
  const otherDebtUsd = position?.otherDebtUsd ?? 0;
  const deliveredUi = source
    ? readyPlan
      ? Number(formatUnits(BigInt(readyPlan.minXautAtomic), collateralDecimals))
      : 0
    : Number(formatUnits(depositAtomic, collateralDecimals));
  const totalCollateralUsd =
    oraclePrice != null ? (existingColUi + deliveredUi) * oraclePrice : null;
  const totalDebtUsd = (existingDebtUi + borrowUi) * debtPrice + otherDebtUsd;
  const projectedLtv =
    totalCollateralUsd && totalCollateralUsd > 0
      ? (totalDebtUsd / totalCollateralUsd) * 100
      : 0;
  const tooClose = factorPct > 0 && projectedLtv >= factorPct;
  const liquidationPrice =
    oraclePrice != null && projectedLtv > 0 && factorPct > 0
      ? oraclePrice * (projectedLtv / factorPct)
      : null;
  const drawdownPct =
    liquidationPrice != null && oraclePrice != null && oraclePrice > 0
      ? ((oraclePrice - liquidationPrice) / oraclePrice) * 100
      : null;

  // Upper bound for the borrow slider: what the factor allows against the
  // collateral after the deposit, less the settlement buffer and any debt
  // already outstanding, and never more than the market can lend.
  const liquidityUi = Number(formatUnits(BigInt(metric?.liquidityAtomic ?? "0"), debtDecimals));
  const maxNewBorrow = (() => {
    if (totalCollateralUsd == null || debtPrice <= 0) return 0;
    const byFactor =
      (totalCollateralUsd * ((factorPct - SETTLEMENT_BUFFER_PCT) / 100) -
        existingDebtUi * debtPrice -
        otherDebtUsd) /
      debtPrice;
    return Math.max(0, Math.min(byFactor, liquidityUi));
  })();

  const projectedCollateralUsd = totalCollateralUsd ?? 0;
  const wholeLiquidation =
    totalDebtUsd > 0 &&
    projectedCollateralUsd > 0 &&
    projectedCollateralUsd < WHOLE_LIQUIDATION_BELOW_USD;

  const supplyClosed = Boolean(metric?.collateralPaused || metric?.collateralFrozen);
  const borrowClosed = Boolean(
    metric && (metric.debtPaused || metric.debtFrozen || !metric.debtBorrowable),
  );
  const lowGas = needsEthGas(
    wallet.ethBalanceAtomic,
    wallet.gasPriceWei,
    AAVE_GAS_UNITS_FULL_CYCLE,
  );

  const submitting = formState.kind === "submitting";
  const disabled =
    !colDeltaValid ||
    !borrowValid ||
    submitting ||
    tooClose ||
    !walletReady ||
    borrowClosed ||
    (depositAtomic > 0n && supplyClosed) ||
    Boolean(planBlocked) ||
    Boolean(planConfirm) ||
    (needsPlan && planPending) ||
    // The button borrows, so it waits for an amount to borrow. See the Jupiter
    // card's matching change.
    borrowUi <= 0;

  const submitButton = (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        onSubmit({ depositAtomic, source, plan: readyPlan, borrowAtomic })
      }
      className={BORROW_PILL_CLASS}
    >
      {/* One word until there is an amount to borrow, as on the other cards. */}
      {submitting
        ? formState.step
        : needsPlan && planPending && borrowUi > 0
          ? "Pricing…"
          : borrowUi > 0
            ? `Borrow $${(borrowUi * debtPrice).toFixed(2)} against ${market.collateralToken.symbol}`
            : "Borrow"}
    </button>
  );

  return (
    <div className="space-y-3">
      {holdings.length > 0 && (
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Deposit from
          </label>
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              // Back to the new source's own ceiling.
              setColInput(null);
              setPlan(null);
              setAcceptedLossBps(null);
              resetForm();
            }}
            className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
          >
            <option value={WALLET_XAUT} className="bg-neutral-900">
              {market.collateralToken.symbol} in your Ethereum wallet (
              {fmt(wallet.collateralBalanceAtomic, collateralDecimals, 4)})
            </option>
            {holdings.map((h) => (
              <option key={h.source.id} value={h.source.id} className="bg-neutral-900">
                {h.source.symbol} on {h.source.chainLabel} (
                {fmt(h.balanceAtomic, h.source.decimals, 4)})
              </option>
            ))}
          </select>
          {source && (
            <p className="mt-1.5 text-[11px] text-white/50">
              {source.denomination}. Converting sells it for{" "}
              {market.collateralToken.symbol}, which is a trade, not a transfer.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={`Deposit ${depositSymbol}`}
          value={colInput}
          onChange={(v) => {
            setColInput(v);
            setPlan(null);
            setAcceptedLossBps(null);
            resetForm();
          }}
          right={depositSymbol}
          balanceLabel={`${ceilingInput} avail`}
          onMax={() => {
            // The exact atomic balance for a wallet deposit, so the amount
            // never exceeds what the wallet holds; the rounded-down ceiling
            // for a conversion, which is priced by the planner anyway.
            setColInput(
              source
                ? ceilingInput
                : formatUnits(depositCeilingAtomic, collateralDecimals),
            );
            setPlan(null);
            setAcceptedLossBps(null);
            resetForm();
          }}
        />
        <NumberField
          label={`Borrow ${market.debtToken.symbol}`}
          value={borrowInput}
          onChange={(v) => {
            setBorrowInput(v);
            resetForm();
          }}
          right={market.debtToken.symbol}
          balanceLabel={maxNewBorrow > 0 ? `${maxNewBorrow.toFixed(2)} max` : undefined}
          onMax={
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
              {(borrowUi || 0).toFixed(2)} {market.debtToken.symbol} ·{" "}
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
            // Unitless 0-1 for .aeras-range, which uses it to keep the fill edge
            // under the thumb's centre. Guarded on a zero maximum: a market with
            // nothing left to draw would divide by zero and blank the track.
            style={
              {
                "--range-progress":
                  maxNewBorrow > 0
                    ? Math.min(1, Math.max(0, (borrowUi || 0) / maxNewBorrow))
                    : 0,
              } as CSSProperties
            }
            className="aeras-range"
          />
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-white/50">
            <span>0</span>
            <span>
              Max {maxNewBorrow.toFixed(2)} {market.debtToken.symbol}
            </span>
          </div>
        </div>
      )}

      {(depositAtomic > 0n || borrowUi > 0) && (
        <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs">
          {GOLD_CHART && oraclePrice != null && liquidationPrice != null && (
            <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
              <PriceChart
                ticker={GOLD_CHART}
                marker={{ price: liquidationPrice, label: "Safety floor" }}
              />
            </div>
          )}

          {needsPlan && (
            <div className="flex justify-between">
              <span className="text-white/50">Converts to</span>
              <span className="font-mono tabular-nums text-white">
                {planning || !plan
                  ? "pricing…"
                  : plan.kind === "blocked"
                    ? "—"
                    : `≥ ${fmt(plan.minXautAtomic, collateralDecimals, 4)} ${market.collateralToken.symbol} · ${(plan.lossBps / 100).toFixed(2)}% cost`}
              </span>
            </div>
          )}
          {readyPlan?.gasCostUsd != null && (
            <div className="flex justify-between">
              <span className="text-white/50">Ethereum gas</span>
              <span className="font-mono tabular-nums text-white">
                ${readyPlan.gasCostUsd.toFixed(2)} of ETH, one time
              </span>
            </div>
          )}

          {borrowUi > 0 && (
            <div className="flex justify-between">
              <span className="text-white/50">You receive</span>
              <span className="font-mono tabular-nums text-white">
                {borrowUi.toFixed(2)} {market.debtToken.symbol}
              </span>
            </div>
          )}

          {borrowUi > 0 && metric && (
            <div className="flex justify-between">
              <span className="text-white/50">Interest</span>
              <span className="font-mono tabular-nums text-white">
                {(metric.borrowApy * 100).toFixed(2)}% APY
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-white/50">Loan vs collateral</span>
            <span
              className={`font-mono tabular-nums ${
                tooClose ? "text-aeras-negative" : "text-white"
              }`}
            >
              {projectedLtv.toFixed(1)}% · closes at {factorPct.toFixed(0)}%
            </span>
          </div>

          {liquidationPrice != null && drawdownPct != null && drawdownPct > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-white/50">Safety floor</span>
                <span className="font-mono tabular-nums text-white">
                  ${liquidationPrice.toFixed(2)} · {drawdownPct.toFixed(1)}% below
                </span>
              </div>
              <p className="text-[11px] text-white/50">
                {market.collateralToken.symbol} would need to fall{" "}
                {drawdownPct.toFixed(1)}% to ${liquidationPrice.toFixed(2)} before
                your position is closed to repay the loan.
              </p>
            </>
          )}

          {wholeLiquidation && (
            <p className="text-[11px] text-aeras-warning">
              Aave does not leave less than ${DUST_LIQUIDATION_USD.toLocaleString()}{" "}
              of collateral behind in a liquidation. At this size a liquidation
              would take the whole position, not a slice of it.
            </p>
          )}

          {tooClose && (
            <p className="text-aeras-negative">
              Borrow exceeds the collateral factor ({factorPct.toFixed(0)}%),
              which is the liquidation threshold on Aave. Reduce the borrow
              amount or add more collateral.
            </p>
          )}
          {planBlocked && (
            <p className="text-aeras-negative">{planBlocked.reason}</p>
          )}
          {/* The cost is stated in dollars and in percent, worst case beside
              the likely case, and nothing is signed until it is accepted. The
              accept re-runs the planner with this exact figure, so a quote
              that has moved against the user by then asks again. */}
          {planConfirm && (
            <div className="space-y-2 rounded-lg border border-aeras-warning/40 bg-aeras-warning/[0.06] px-3 py-2.5">
              <div className="text-white">
                This conversion costs ${planConfirm.costUsd.toFixed(2)}
              </div>
              <p className="text-[11px] leading-relaxed text-white/60">
                {planConfirm.reason}
              </p>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <div className="text-white/50">You convert</div>
                  <div className="font-mono tabular-nums text-white">
                    ${planConfirm.sourceValueUsd.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-white/50">Arrives, at least</div>
                  <div className="font-mono tabular-nums text-white">
                    ${planConfirm.deliveredValueUsd.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-white/50">Cost</div>
                  <div className="font-mono tabular-nums text-white">
                    ${planConfirm.costUsd.toFixed(2)} ·{" "}
                    {(planConfirm.lossBps / 100).toFixed(1)}%
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAcceptedLossBps(planConfirm.lossBps);
                  resetForm();
                }}
                className="aeras-press rounded-full border border-aeras-warning/50 bg-aeras-warning/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-aeras-warning/25"
              >
                Accept the ${planConfirm.costUsd.toFixed(2)} cost and continue
              </button>
            </div>
          )}
          {readyPlan && acceptedLossBps != null && (
            <p className="text-[11px] text-white/50">
              You accepted a {(readyPlan.lossBps / 100).toFixed(1)}% conversion
              cost (${(readyPlan.sourceValueUsd - readyPlan.deliveredValueUsd).toFixed(2)}).
              Change the amount to price it again.
            </p>
          )}
        </div>
      )}

      {depositAtomic > 0n && supplyClosed && (
        <p className="text-[11px] text-aeras-warning">
          Aave has frozen or paused new {market.collateralToken.symbol} supply on
          this market. Repaying and withdrawing still work.
        </p>
      )}
      {borrowClosed && (
        <p className="text-[11px] text-aeras-warning">
          Aave has frozen or paused {market.debtToken.symbol} borrowing on this
          market. Repaying and withdrawing still work.
        </p>
      )}
      {lowGas && !source && (
        <p className="text-[11px] text-aeras-warning">
          Your Ethereum wallet is low on ETH for gas. Depositing from Solana gold
          tops it up automatically; otherwise send ETH to{" "}
          {evmAddress ? `${evmAddress.slice(0, 6)}…${evmAddress.slice(-4)}` : "your wallet"}{" "}
          first.
        </p>
      )}
      {!walletReady && (
        <p className="text-[11px] text-aeras-warning">
          An embedded EVM wallet is required. It is provisioned on login; try
          reconnecting if this persists.
        </p>
      )}
      {!colDeltaValid && (
        <p className="text-[11px] text-aeras-negative">
          Deposit is above the {ceilingInput} {depositSymbol} available.
        </p>
      )}
      <p className="text-[11px] text-white/50">
        Supplied gold earns nothing; the rate is what you pay on what you
        borrow. {market.debtToken.symbol} lands in your Ethereum wallet, and the
        wallet panel swaps it back to Solana USDC.
      </p>

      {formState.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {formState.message}
        </p>
      )}
      {formState.kind === "done" && (
        <a
          href={`${ETHEREUM_EXPLORER_TX_BASE}${formState.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">Submitted</div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
            {formState.txHash}
          </div>
        </a>
      )}

      {/* Rendered here, shown in the header's Borrow pill. Same reasoning as
          the other cards: the label and the enabled state are decided by this
          form, only the position on screen belongs to the header. */}
      {actionSlot ? createPortal(submitButton, actionSlot) : submitButton}
    </div>
  );
}

// ── closing ────────────────────────────────────────────────────────────────

function AaveCloseControl({
  market,
  position,
  wallet,
  state,
  onClose,
  onReset,
}: {
  market: AaveGoldMarket;
  position: AaveGoldPosition;
  wallet: WalletState;
  state: FormState;
  onClose: () => void;
  onReset: () => void;
}) {
  const debtUi = Number(formatUnits(BigInt(position.debtAtomic), market.debtToken.decimals));
  const colUi = Number(formatUnits(BigInt(position.collateralAtomic), market.collateralToken.decimals));
  const walletUsdc = Number(formatUnits(BigInt(wallet.loanBalanceAtomic || "0"), market.debtToken.decimals));
  const submitting = state.kind === "submitting";
  // The repay is sized on chain to the debt at the mined block, which is a
  // little above the figure here, so the wallet needs a hair more than it.
  const shortOfUsdc = debtUi > 0 && walletUsdc < debtUi * 1.001;
  const lowGas = needsEthGas(
    wallet.ethBalanceAtomic,
    wallet.gasPriceWei,
    AAVE_GAS_UNITS_FULL_CYCLE,
  );
  // Collateral the debt on other reserves keeps locked. The close withdraws
  // what this market's check allows; the contract refuses the rest.
  const withdrawableUi = Number(
    formatUnits(BigInt(position.withdrawableCollateralAtomic), market.collateralToken.decimals),
  );

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClose}
        disabled={submitting || shortOfUsdc}
        className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? state.step
          : debtUi > 0
            ? `Close · repay ${debtUi.toFixed(2)} ${market.debtToken.symbol} + withdraw ${colUi.toFixed(4)} ${market.collateralToken.symbol}`
            : `Withdraw ${colUi.toFixed(4)} ${market.collateralToken.symbol}`}
      </button>
      <p className="text-[11px] text-white/50">
        {debtUi > 0
          ? `Needs ≥ ${debtUi.toFixed(2)} ${market.debtToken.symbol} in your Ethereum wallet (you hold ${walletUsdc.toFixed(2)}) to repay the loan plus accrued interest, then withdraws your collateral. Two to three Ethereum transactions.`
          : `Withdraws your ${market.collateralToken.symbol} collateral back to your Ethereum wallet, where it earns nothing. Swap it back to Solana when you are done.`}
      </p>
      {position.otherDebtUsd > 0 && withdrawableUi < colUi && (
        <p className="text-[11px] text-aeras-warning">
          Debt on other reserves of this Aave market keeps{" "}
          {(colUi - withdrawableUi).toFixed(4)} {market.collateralToken.symbol}{" "}
          locked. That part stays until it is repaid on Aave.
        </p>
      )}
      {shortOfUsdc && (
        <p className="text-[11px] text-aeras-warning">
          Not enough {market.debtToken.symbol} on Ethereum to repay. Swap USDC
          to Ethereum from the wallet panel first.
        </p>
      )}
      {lowGas && (
        <p className="text-[11px] text-aeras-warning">
          Your Ethereum wallet is low on ETH for gas. Send ETH to it before
          closing.
        </p>
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
          href={`${ETHEREUM_EXPLORER_TX_BASE}${state.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">Position closed</div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
            {state.txHash}
          </div>
        </a>
      )}
    </div>
  );
}
