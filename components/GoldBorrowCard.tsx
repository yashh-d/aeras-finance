"use client";

// Borrow USDT against tokenized gold, in the Morpho Blue XAUt/USDT market on
// Ethereum.
//
// Reads its own live data (market state and position from Ethereum, both via
// our API routes) and signs with the Privy embedded EVM wallet. Supplying
// collateral funds itself: gold the user holds on Solana is converted into XAUt
// on Ethereum through Trustware first (lib/morpho/gold-fund.ts), including a
// one-time ETH purchase so the wallet can pay its own gas.
//
// Two things this card is required to be honest about, because both are easy to
// get wrong and expensive to get wrong:
//
//   1. **Supplied gold earns nothing.** This is a Blue market, not a vault.
//      Collateral is inert; only USDT suppliers earn. The rate on screen is
//      what the user PAYS. The header says so rather than leaving a percentage
//      next to someone's deposit to be read as yield.
//   2. **Gold can be liquidated.** The liquidation price sits beside the debt,
//      not behind a disclosure, and the borrow slider defaults to a buffer
//      rather than the maximum.

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";

import { AssetLogo, VenueMark } from "@/components/AssetLogo";
import { VENUE_LOGOS } from "@/lib/tokens/logos";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import {
  fetchGoldMarkets,
  fetchGoldPositions,
  type GoldMarketMetric,
  type GoldPosition,
} from "@/lib/morpho/gold-client";
import {
  borrowAgainstGold,
  repayGoldDebt,
  supplyGoldCollateral,
  withdrawGoldCollateral,
  type GoldTxProgress,
} from "@/lib/morpho/gold-borrow";
import {
  executeGoldFunding,
  needsEthGas,
  planGoldFunding,
  type GoldFundingPlan,
  type SolanaSigner,
} from "@/lib/morpho/gold-fund";
import {
  ETHEREUM_EXPLORER_TX_BASE,
  GOLD_MARKETS,
  XAUT,
  type MorphoBlueMarket,
} from "@/lib/morpho/gold-market";
import { SUGGESTED_LTV_BUFFER_BPS } from "@/lib/morpho/gold-math";
import type { GoldHolding } from "@/lib/trustware/gold-holdings";

type Mode = "supply" | "borrow" | "repay" | "withdraw";

// "XAUt already in your Ethereum wallet" is a funding source with no conversion
// attached, so it is not in the registry. This sentinel selects it.
const WALLET_XAUT = "wallet:xaut";

// How long to sit still before pricing a conversion. Each plan is up to four
// upstream quotes, so pricing on every keystroke would hammer Trustware and
// return answers for amounts the user has already typed past.
const PLAN_DEBOUNCE_MS = 600;

function fmt(atomic: string | bigint | undefined, decimals: number, digits = 2): string {
  if (atomic === undefined) return "—";
  const value = Number(formatUnits(BigInt(atomic), decimals));
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtUsd(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

// Health is the number that decides whether someone keeps their gold, so it is
// coloured rather than left as a neutral figure. The bands are the same ones
// the borrow slider's default buffer targets.
function healthTone(health: number | null): string {
  if (health == null) return "text-white/70";
  if (health < 1.1) return "text-aeras-negative";
  if (health < 1.35) return "text-aeras-warning";
  return "text-aeras-positive";
}

export function GoldBorrowSection({
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
}) {
  const evm = useEmbeddedEvmWallet();
  const sendSolanaTx = useSendSolanaTxBase64();
  const [metrics, setMetrics] = useState<Map<string, GoldMarketMetric>>(new Map());
  const [positions, setPositions] = useState<Map<string, GoldPosition>>(new Map());
  const [wallet, setWallet] = useState({
    collateralBalanceAtomic: "0",
    loanBalanceAtomic: "0",
    ethBalanceAtomic: "0",
    gasPriceWei: "0",
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const solanaSigner = useMemo<SolanaSigner | undefined>(
    () =>
      walletAddress
        ? { address: walletAddress, signAndSendBase64: sendSolanaTx }
        : undefined,
    [walletAddress, sendSolanaTx],
  );

  const refresh = useCallback(async () => {
    try {
      setMetrics(await fetchGoldMarkets());
    } catch (err) {
      console.error("[gold market]", err);
    }
    if (evm.address) {
      try {
        const res = await fetchGoldPositions(evm.address);
        setPositions(res.positions);
        setWallet({
          collateralBalanceAtomic: res.collateralBalanceAtomic,
          loanBalanceAtomic: res.loanBalanceAtomic,
          ethBalanceAtomic: res.ethBalanceAtomic,
          gasPriceWei: res.gasPriceWei,
        });
      } catch (err) {
        console.error("[gold position]", err);
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

  return (
    <>
      <div className="flex items-baseline justify-between pt-4 pb-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          <VenueMark src={VENUE_LOGOS.ethereum} />
          Ethereum · Morpho
        </div>
        <div className="text-[11px] text-white/50">Settles on Ethereum (EVM)</div>
      </div>

      <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        <div className="col-span-5">Market</div>
        <div className="col-span-2 text-right">Borrow APY</div>
        <div className="col-span-2 text-right">Max LTV</div>
        <div className="col-span-2 text-right">Your debt</div>
        <div className="col-span-1" />
      </div>

      {GOLD_MARKETS.map((market) => {
        const key = market.id.toLowerCase();
        const metric = metrics.get(key);
        const position = positions.get(key);
        const expanded = openId === key;
        return (
          <div key={key}>
            <button
              type="button"
              onClick={() => setOpenId(expanded ? null : key)}
              className="grid w-full grid-cols-12 items-center gap-2 py-3 text-left"
            >
              <div className="col-span-5 flex items-center gap-2.5">
                {/* Tether Gold's mark, not GLD's. The collateral here is XAUt,
                    a claim on allocated bullion; GLD is the SPDR ETF and a
                    different issuer, asset and unit size. */}
                <AssetLogo
                  xstock={{
                    symbol: market.collateralToken.symbol,
                    name: market.collateralToken.name,
                    logo: "/logos/xaut.png",
                  }}
                  size={28}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">
                    {market.name}
                  </div>
                  <div className="text-[11px] text-white/50">
                    Borrow {market.loanToken.symbol} against gold
                  </div>
                </div>
              </div>
              {/* Not coloured positive: this is a cost, not a yield. */}
              <div className="col-span-2 text-right font-mono text-sm text-white">
                {metric ? `${(metric.borrowApy * 100).toFixed(2)}%` : "—"}
              </div>
              <div className="col-span-2 text-right font-mono text-xs text-white/70">
                {metric ? `${(metric.lltv * 100).toFixed(0)}%` : "—"}
              </div>
              <div className="col-span-2 text-right font-mono text-xs text-white/70">
                {position && position.debtAtomic !== "0"
                  ? fmt(position.debtAtomic, market.loanToken.decimals)
                  : "—"}
              </div>
              <div className="col-span-1 flex justify-end">
                <ChevronDown
                  className={`h-4 w-4 text-white/40 transition-transform ${
                    expanded ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>

            {expanded && (
              <GoldMarketForm
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
            )}
          </div>
        );
      })}
    </>
  );
}

// ── the form ───────────────────────────────────────────────────────────────

type FormState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "done"; txHash: string; label: string }
  | { kind: "error"; message: string };

function GoldMarketForm({
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
  market: MorphoBlueMarket;
  metric: GoldMarketMetric | undefined;
  position: GoldPosition | undefined;
  wallet: {
    collateralBalanceAtomic: string;
    loanBalanceAtomic: string;
    ethBalanceAtomic: string;
    gasPriceWei: string;
  };
  goldHoldings: GoldHolding[];
  solanaUsdcAtomic: string;
  solanaAddress: string | undefined;
  solanaSigner: SolanaSigner | undefined;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  onSettled: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("supply");
  const [input, setInput] = useState("");
  const [sourceId, setSourceId] = useState<string>(WALLET_XAUT);
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [plan, setPlan] = useState<GoldFundingPlan | null>(null);
  const [planning, setPlanning] = useState(false);

  const collateralDecimals = market.collateralToken.decimals;
  const loanDecimals = market.loanToken.decimals;

  const walletXaut = BigInt(wallet.collateralBalanceAtomic || "0");
  const debt = BigInt(position?.debtAtomic ?? "0");
  const liquidity = BigInt(metric?.liquidityAtomic ?? "0");
  const available = BigInt(position?.availableToBorrowAtomic ?? "0");
  // The market cannot lend what it does not have, however healthy the position
  // would be. Both limits bind, so the smaller wins.
  const borrowCeiling = available < liquidity ? available : liquidity;

  const holdings = useMemo(
    () => goldHoldings.filter((h) => Number(h.balanceAtomic) > 0),
    [goldHoldings],
  );
  const selectedHolding = holdings.find((h) => h.source.id === sourceId);

  // ── the amount ───────────────────────────────────────────────────────────

  const inputDecimals =
    mode === "supply"
      ? (selectedHolding?.source.decimals ?? collateralDecimals)
      : mode === "borrow" || mode === "repay"
        ? loanDecimals
        : collateralDecimals;

  const maxAtomic = (() => {
    switch (mode) {
      case "supply":
        return selectedHolding
          ? BigInt(selectedHolding.balanceAtomic)
          : walletXaut;
      case "borrow":
        return borrowCeiling;
      case "repay": {
        // Cannot repay more than is owed, and cannot repay more USDT than the
        // wallet holds.
        const held = BigInt(wallet.loanBalanceAtomic || "0");
        return debt < held ? debt : held;
      }
      case "withdraw":
        return BigInt(position?.withdrawableCollateralAtomic ?? "0");
    }
  })();

  const amountAtomic = (() => {
    try {
      return input ? parseUnits(input, inputDecimals) : 0n;
    } catch {
      return 0n;
    }
  })();
  const overLimit = amountAtomic > maxAtomic;
  const maxUi = Number(formatUnits(maxAtomic, inputDecimals));

  // A full repayment is sized in shares so the debt closes exactly rather than
  // leaving dust that keeps the position (and the collateral) locked.
  const repayAll = mode === "repay" && amountAtomic > 0n && amountAtomic >= debt;

  function switchMode(next: Mode) {
    setMode(next);
    setInput("");
    setPlan(null);
    setState({ kind: "idle" });
  }

  function setAmount(next: string) {
    setInput(next);
    setPlan(null);
    if (state.kind !== "idle") setState({ kind: "idle" });
  }

  // ── projected health ─────────────────────────────────────────────────────
  //
  // What the position looks like after this action, so the consequence is
  // visible before signing rather than after. Priced off the same oracle the
  // liquidation check uses.
  const projected = projectPosition({
    metric,
    position,
    mode,
    // A converted supply lands as XAUt, not as the source token, so the
    // projection uses the plan's guaranteed delivery rather than the amount
    // typed in. Without a plan yet, there is nothing honest to project.
    deliveredCollateralAtomic:
      mode === "supply" && selectedHolding
        ? plan?.kind === "ready"
          ? plan.minXautAtomic
          : null
        : null,
    amountAtomic,
    inputDecimals,
    collateralDecimals,
    loanDecimals,
    debtAtomic: debt,
  });

  // ── conversion planning ──────────────────────────────────────────────────
  //
  // Only supplying from a held source needs a plan; supplying XAUt already in
  // the Ethereum wallet is a plain approve-and-supply.
  const needsPlan = mode === "supply" && Boolean(selectedHolding);
  const planKey = needsPlan
    ? `${sourceId}|${amountAtomic}|${wallet.gasPriceWei}`
    : "";
  const planSeq = useRef(0);

  useEffect(() => {
    if (!planKey || amountAtomic <= 0n || overLimit || !evm.address || !metric) {
      return;
    }
    const holding = selectedHolding;
    if (!holding) return;

    const seq = ++planSeq.current;
    // setPlanning happens inside the timer, not in the effect body: a
    // synchronous setState here would cascade a render on every keystroke, and
    // the button already reads as pending while `plan` is null.
    const timer = setTimeout(async () => {
      setPlanning(true);
      try {
        const result = await planGoldFunding({
          source: holding.source,
          sourceAmountAtomic: amountAtomic,
          solanaAddress,
          evmAddress: evm.address!,
          solanaUsdcAtomic,
          ethBalanceAtomic: wallet.ethBalanceAtomic,
          gasPriceWei: wallet.gasPriceWei,
          oracleUnitPrice: metric.oracleUnitPrice,
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

  // ── submit ───────────────────────────────────────────────────────────────

  const onProgress = (p: GoldTxProgress) =>
    setState({ kind: "busy", message: p.message });

  async function handleSubmit() {
    if (!evm.address) {
      setState({ kind: "error", message: "No embedded EVM wallet available." });
      return;
    }
    setState({ kind: "busy", message: "Preparing…" });
    const signer = {
      address: evm.address,
      switchChain: evm.switchChain,
      getProvider: evm.getProvider,
    };

    try {
      let txHash: string;
      let label: string;

      if (mode === "supply") {
        let supplyAtomic = amountAtomic;

        if (selectedHolding) {
          if (!plan || plan.kind !== "ready") {
            throw new Error(
              plan?.kind === "blocked"
                ? plan.reason
                : "Still pricing the conversion. Try again in a moment.",
            );
          }
          const { xautDeliveredAtomic } = await executeGoldFunding({
            plan,
            source: selectedHolding.source,
            evmAddress: evm.address,
            solanaAddress,
            solana: solanaSigner,
            evm: signer,
            xautBeforeAtomic: wallet.collateralBalanceAtomic,
            onProgress: (p) => setState({ kind: "busy", message: p.message }),
          });
          // Supply what arrived, not what was planned. A conversion that beat
          // its floor should not leave the surplus stranded in the wallet.
          supplyAtomic = BigInt(xautDeliveredAtomic);
        }

        txHash = await supplyGoldCollateral({
          market,
          amountAtomic: supplyAtomic,
          signer,
          onProgress,
        });
        label = "Collateral supplied";
      } else if (mode === "borrow") {
        txHash = await borrowAgainstGold({
          market,
          amountAtomic,
          signer,
          onProgress,
        });
        label = "Borrowed";
      } else if (mode === "repay") {
        txHash = await repayGoldDebt({
          market,
          amountAtomic,
          repayAll,
          borrowSharesAtomic: position?.borrowSharesAtomic ?? "0",
          debtAtomic: position?.debtAtomic ?? "0",
          signer,
          onProgress,
        });
        label = "Repaid";
      } else {
        txHash = await withdrawGoldCollateral({
          market,
          amountAtomic,
          signer,
          onProgress,
        });
        label = "Collateral withdrawn";
      }

      setState({ kind: "done", txHash, label });
      setInput("");
      setPlan(null);
      await onSettled();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const busy = state.kind === "busy";
  const planBlocked = needsPlan && plan?.kind === "blocked";
  const planPending = needsPlan && (planning || !plan);
  const disabled =
    busy ||
    amountAtomic <= 0n ||
    overLimit ||
    !evm.ready ||
    planBlocked ||
    planPending;

  const unit =
    mode === "supply"
      ? (selectedHolding?.source.symbol ?? market.collateralToken.symbol)
      : mode === "borrow" || mode === "repay"
        ? market.loanToken.symbol
        : market.collateralToken.symbol;

  return (
    <div className="space-y-3 pb-4">
      {/* Position summary. Always shown, including at zero, so the shape of the
          product is legible before anyone commits to it. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 py-3 sm:grid-cols-4">
        <Stat
          label="Collateral"
          value={`${fmt(position?.collateralAtomic, collateralDecimals, 4)} ${market.collateralToken.symbol}`}
          sub={
            position && position.collateralValueAtomic !== "0"
              ? fmtUsd(Number(formatUnits(BigInt(position.collateralValueAtomic), loanDecimals)))
              : undefined
          }
        />
        <Stat
          label="Debt"
          value={`${fmt(position?.debtAtomic, loanDecimals)} ${market.loanToken.symbol}`}
          sub={metric ? `${(metric.borrowApy * 100).toFixed(2)}% APY` : undefined}
        />
        <Stat
          label="LTV"
          value={position?.ltv != null ? `${(position.ltv * 100).toFixed(1)}%` : "—"}
          sub={metric ? `${(metric.lltv * 100).toFixed(0)}% max` : undefined}
        />
        <Stat
          label="Liquidation"
          value={
            position?.liquidationPrice != null
              ? fmtUsd(position.liquidationPrice, 0)
              : "—"
          }
          sub={metric ? `gold at ${fmtUsd(metric.oracleUnitPrice, 0)}` : undefined}
          tone={healthTone(position?.healthFactor ?? null)}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap gap-1">
          {(["supply", "borrow", "repay", "withdraw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                mode === m
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "supply" && (
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
              Convert from
            </label>
            <select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setAmount("");
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
            {selectedHolding && (
              <p className="mt-1.5 text-[11px] text-white/50">
                {selectedHolding.source.denomination}. Converting sells it for{" "}
                {market.collateralToken.symbol}, which is a trade, not a
                transfer.
              </p>
            )}
          </div>
        )}

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
              {mode} {unit}
            </label>
            <span className="font-mono text-[11px] text-white/50">
              {maxUi.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
              {mode === "borrow"
                ? available <= liquidity
                  ? "borrowable"
                  : "market liquidity"
                : mode === "repay"
                  ? "owed"
                  : mode === "withdraw"
                    ? "free"
                    : "available"}
              <button
                type="button"
                onClick={() => setAmount(formatUnits(maxAtomic, inputDecimals))}
                className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
              >
                Max
              </button>
            </span>
          </div>

          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              value={input}
              onChange={(e) => setAmount(e.target.value)}
              className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-20 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
              {unit}
            </span>
          </div>

          {/* The borrow default is a buffer, not the ceiling. Borrowing to the
              limit is one tick from liquidation, and offering it as the obvious
              choice would be a trap. */}
          {mode === "borrow" && borrowCeiling > 0n && (
            <button
              type="button"
              onClick={() => {
                const target =
                  (borrowCeiling * BigInt(10_000 - SUGGESTED_LTV_BUFFER_BPS)) /
                  10_000n;
                setAmount(formatUnits(target, loanDecimals));
              }}
              className="mt-1.5 text-[11px] text-white/60 underline-offset-2 hover:text-white hover:underline"
            >
              Use a safer {(100 - SUGGESTED_LTV_BUFFER_BPS / 100).toFixed(0)}% of
              the limit
            </button>
          )}
        </div>

        {/* Conversion preview */}
        {needsPlan && amountAtomic > 0n && !overLimit && (
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px]">
            {planning || !plan ? (
              <span className="text-white/50">Pricing the conversion…</span>
            ) : plan.kind === "blocked" ? (
              <span className="text-aeras-negative">{plan.reason}</span>
            ) : (
              <div className="space-y-1 text-white/60">
                <div>
                  Delivers at least{" "}
                  <span className="font-mono text-white">
                    {fmt(plan.minXautAtomic, collateralDecimals, 4)}{" "}
                    {market.collateralToken.symbol}
                  </span>{" "}
                  ({fmtUsd(plan.deliveredValueUsd)} of{" "}
                  {fmtUsd(plan.sourceValueUsd)},{" "}
                  {(plan.lossBps / 100).toFixed(2)}% cost)
                  {plan.route.mode === "via-usdc" && " via USDC, in two steps"}.
                </div>
                {plan.gasCostUsd != null && (
                  <div>
                    Buys {fmtUsd(plan.gasCostUsd)} of ETH so your wallet can pay
                    Ethereum gas. One time, and it covers the exit too.
                  </div>
                )}
                <div>Bridging takes a few minutes.</div>
              </div>
            )}
          </div>
        )}

        {/* What the position becomes */}
        {projected && amountAtomic > 0n && !overLimit && !planBlocked && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/60">
            <span>
              After:{" "}
              <span className="font-mono text-white">
                {projected.ltv != null
                  ? `${(projected.ltv * 100).toFixed(1)}% LTV`
                  : "no debt"}
              </span>
            </span>
            {projected.health != null && (
              <span>
                Health{" "}
                <span className={`font-mono ${healthTone(projected.health)}`}>
                  {projected.health.toFixed(2)}
                </span>
              </span>
            )}
            {projected.liquidationPrice != null && (
              <span>
                Liquidated if gold falls to{" "}
                <span className="font-mono text-white">
                  {fmtUsd(projected.liquidationPrice, 0)}
                </span>
              </span>
            )}
          </div>
        )}

        {mode === "supply" && (
          <p className="text-[11px] text-white/50">
            Supplied gold earns nothing. It backs a loan, and the{" "}
            {metric ? `${(metric.borrowApy * 100).toFixed(2)}%` : ""} rate is
            what you pay on what you borrow.
          </p>
        )}
        {mode === "borrow" && (
          <p className="text-[11px] text-white/50">
            {market.loanToken.symbol} lands in your Ethereum wallet. You can
            swap it back to Solana USDC from the wallet panel.
          </p>
        )}
        {mode === "withdraw" && (
          <p className="text-[11px] text-white/50">
            {market.collateralToken.symbol} lands in your Ethereum wallet, where
            it earns nothing. Swap it back to Solana when you are done.
          </p>
        )}

        {mode !== "supply" &&
          needsEthGas(wallet.ethBalanceAtomic, wallet.gasPriceWei) && (
            <p className="text-[11px] text-aeras-warning">
              Your Ethereum wallet is low on ETH for gas. Supplying collateral
              tops it up automatically; otherwise send ETH to{" "}
              {evm.address ? `${evm.address.slice(0, 6)}…${evm.address.slice(-4)}` : "your wallet"}{" "}
              first.
            </p>
          )}
        {!evm.ready && (
          <p className="text-[11px] text-aeras-warning">
            An embedded EVM wallet is required. It is provisioned on login; try
            reconnecting if this persists.
          </p>
        )}
        {overLimit && (
          <p className="text-[11px] text-aeras-negative">
            Amount is above the {mode} limit.
          </p>
        )}
        {mode === "borrow" && available > liquidity && (
          <p className="text-[11px] text-white/50">
            Your collateral supports more, but the market only has{" "}
            {fmt(liquidity, loanDecimals)} {market.loanToken.symbol} free to
            lend right now.
          </p>
        )}
        {state.kind === "error" && (
          <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
            {state.message}
          </p>
        )}
        {state.kind === "done" && (
          <a
            href={`${ETHEREUM_EXPLORER_TX_BASE}${state.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
          >
            <div className="font-medium text-aeras-positive">{state.label}</div>
            <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
              {state.txHash}
            </div>
          </a>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={handleSubmit}
          className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? state.message
            : planPending && amountAtomic > 0n
              ? "Pricing…"
              : mode === "supply"
                ? `Supply ${market.collateralToken.symbol}`
                : mode === "borrow"
                  ? `Borrow ${market.loanToken.symbol}`
                  : mode === "repay"
                    ? repayAll
                      ? "Repay all"
                      : `Repay ${market.loanToken.symbol}`
                    : `Withdraw ${market.collateralToken.symbol}`}
        </button>
      </div>
    </div>
  );
}

// What the position looks like after this action.
//
// Shown before signing rather than after, because the consequence of borrowing
// is a liquidation price and nobody should have to compute one to see it.
// Priced off the market's own oracle and its LLTV, the same two inputs the
// on-chain solvency check uses, so this and the contract agree on when the
// position is in trouble.
//
// A plain function rather than a memo: it is a handful of arithmetic ops, and
// manual memoization here defeats the React Compiler for no measurable gain.
function projectPosition(args: {
  metric: GoldMarketMetric | undefined;
  position: GoldPosition | undefined;
  mode: Mode;
  // For a converted supply, the XAUt the plan guarantees. Null when the supply
  // is not converted (or is not yet priced), in which case the typed amount is
  // already denominated in collateral.
  deliveredCollateralAtomic: string | null;
  amountAtomic: bigint;
  inputDecimals: number;
  collateralDecimals: number;
  loanDecimals: number;
  debtAtomic: bigint;
}): {
  ltv: number | null;
  health: number | null;
  liquidationPrice: number | null;
} | null {
  const { metric, position, mode } = args;
  if (!metric || !position) return null;
  const oracle = metric.oracleUnitPrice;
  if (oracle <= 0) return null;

  const amount = Number(formatUnits(args.amountAtomic, args.inputDecimals));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  let collateral = Number(
    formatUnits(BigInt(position.collateralAtomic), args.collateralDecimals),
  );
  let owed = Number(formatUnits(args.debtAtomic, args.loanDecimals));

  if (mode === "supply") {
    const delivered = args.deliveredCollateralAtomic
      ? Number(
          formatUnits(
            BigInt(args.deliveredCollateralAtomic),
            args.collateralDecimals,
          ),
        )
      : amount;
    if (delivered <= 0) return null;
    collateral += delivered;
  } else if (mode === "borrow") {
    owed += amount;
  } else if (mode === "repay") {
    owed = Math.max(0, owed - amount);
  } else {
    collateral = Math.max(0, collateral - amount);
  }

  const value = collateral * oracle;
  const maxBorrow = value * metric.lltv;
  return {
    ltv: value > 0 ? owed / value : null,
    health: owed > 0 ? maxBorrow / owed : null,
    liquidationPrice:
      owed > 0 && collateral > 0 ? owed / (collateral * metric.lltv) : null,
  };
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        {label}
      </div>
      <div className={`font-mono text-sm ${tone ?? "text-white"}`}>{value}</div>
      {sub && <div className="font-mono text-[10px] text-white/40">{sub}</div>}
    </div>
  );
}

export { XAUT as GOLD_COLLATERAL_TOKEN };
