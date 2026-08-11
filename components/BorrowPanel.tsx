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
import { SOLSCAN_TX_BASE } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { assetIdentity, xstockByMint } from "@/lib/jupiter/xstocks";
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
import {
  fetchKaminoPosition,
  type KaminoPosition,
} from "@/lib/kamino/positions";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import {
  atomicToUiString,
  getConnection,
  type AccountBalances,
} from "@/lib/solana/balances";
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
import BN from "bn.js";

// Matches the loop surface so a borrow-side unwind sizes its swap identically.
const UNWIND_SLIPPAGE_BPS = 150;


interface Props {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}

export function BorrowPanel({
  walletAddress,
  balances,
  prices,
  onRefresh,
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

  // The user's single Kamino obligation in this market, if any. Fetched once so
  // an expanded Kamino card shows an existing position immediately.
  const [kaminoPosition, setKaminoPosition] = useState<KaminoPosition | null>(
    null,
  );
  const [kaminoRefreshTick, setKaminoRefreshTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchKaminoPosition(walletAddress);
        if (!cancelled) setKaminoPosition(p);
      } catch (err) {
        console.error("[kamino obligation]", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, kaminoRefreshTick]);

  // Live borrow APR and market size for every row. Lightweight — one call per
  // Jupiter vault plus one Kamino metrics call — so it can drive the collapsed
  // list without mounting any card.
  const { stats, loading: statsLoading } = useBorrowMarketStats();

  // Which market row is expanded to reveal its full borrow card. Only one at a
  // time. The heavy card (live vault state, position, NFT recovery) mounts
  // lazily on expand rather than once per market up front.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Borrow
        </div>
        <span className="text-xs text-white/50">USDC</span>
      </div>

      <div className="divide-y divide-white/10">
        {XSTOCK_BORROW_VAULTS.map((vault) => {
          const key = jupiterMarketKey(vault.vaultId);
          const expanded = expandedKey === key;
          return (
            <div key={key}>
              <BorrowMarketRow
                symbol={vault.collateralSymbol}
                mint={vault.collateralMint}
                borrowSymbol={vault.borrowSymbol}
                venue="Jupiter Lend"
                cfPct={vault.collateralFactor / 10}
                ltPct={vault.liquidationThreshold / 10}
                stat={stats.get(key)}
                statsLoading={statsLoading}
                held={balances?.xstocks[vault.collateralMint] ?? 0}
                price={prices?.[vault.collateralMint]?.usdPrice ?? null}
                expanded={expanded}
                onToggle={() => setExpandedKey(expanded ? null : key)}
              />
              {expanded && (
                <div className="pb-3 pt-1">
                  <VaultCard
                    vault={vault}
                    walletAddress={walletAddress}
                    walletUsdc={balances?.usdc ?? 0}
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
                    onRefresh={onRefresh}
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
                borrowSymbol="USDC"
                venue="Kamino"
                cfPct={collateral.maxLtvSnapshot * 100}
                ltPct={collateral.liquidationThreshold}
                stat={stats.get(key)}
                statsLoading={statsLoading}
                held={balances?.xstocks[collateral.collateralMint] ?? 0}
                price={prices?.[collateral.collateralMint]?.usdPrice ?? null}
                expanded={expanded}
                onToggle={() => setExpandedKey(expanded ? null : key)}
              />
              {expanded && (
                <div className="pb-3 pt-1">
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
                    initialPosition={kaminoPosition}
                    onRefresh={onRefresh}
                    onPositionChange={() => setKaminoRefreshTick((n) => n + 1)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Collapsed catalog row: symbol, live borrow APR + market size, the user's
// holding, and a chevron. Clicking anywhere on the row expands the full borrow
// card below it. Kept deliberately light so the whole list renders without
// mounting a single card.
function BorrowMarketRow({
  symbol,
  mint,
  borrowSymbol,
  venue,
  cfPct,
  ltPct,
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
  borrowSymbol: string;
  // Which protocol settles this market. Shown as a badge so a stock listed on
  // both venues reads as two distinct, comparable rows.
  venue: "Jupiter Lend" | "Kamino";
  cfPct: number;
  ltPct: number;
  stat: MarketStat | undefined;
  statsLoading: boolean;
  held: number;
  price: number | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const heldUsd = price != null ? held * price : null;
  const apr =
    stat?.borrowAprPct != null
      ? `${stat.borrowAprPct.toFixed(2)}%`
      : statsLoading
        ? "…"
        : "—";
  const size =
    stat?.sizeUsd != null
      ? formatUsdCompact(stat.sizeUsd)
      : statsLoading
        ? "…"
        : "—";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-white/5"
    >
      <AssetLogo xstock={assetIdentity(mint, symbol)} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium tracking-tight text-white">
            {symbol} → {borrowSymbol}
          </span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
              venue === "Jupiter Lend"
                ? "bg-aeras-blue/15 text-aeras-blue"
                : "bg-white/10 text-white/60"
            }`}
          >
            {venue}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-white/50">
          Max LTV {cfPct.toFixed(0)}% · LT {ltPct.toFixed(0)}%
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm tabular-nums text-white">{apr}</div>
        <div className="font-mono text-[11px] text-white/50">{size} size</div>
      </div>
      <div className="hidden w-20 text-right sm:block">
        {held > 0 ? (
          <>
            <div className="font-mono text-sm tabular-nums text-white">
              {held.toFixed(4)}
            </div>
            {heldUsd != null && (
              <div className="font-mono text-[11px] text-white/50">
                ${heldUsd.toFixed(2)}
              </div>
            )}
          </>
        ) : (
          <span className="rounded-md bg-aeras-blue/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aeras-blue">
            Buy
          </span>
        )}
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
  collateralBalance,
  collateralBalanceAtomic,
  heldEquivalents,
  evmAddress,
  onEquivalentsChanged,
  prices,
  onRefresh,
}: VaultCardProps) {
  const [live, setLive] = useState<LiveVaultState | null>(null);
  const [position, setPosition] = useState<UserPositionState | null>(null);
  const [positionLoading, setPositionLoading] = useState(true);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });
  const [closingState, setClosingState] = useState<FormState>({ kind: "idle" });

  const signTxBase64 = useSignSolanaTxBase64();
  const conversion = useConversionRunner();

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
  const collateralUsd = oraclePrice != null ? collateralBalance * oraclePrice : null;
  const cfPct = vault.collateralFactor / 10;
  const ltPct = vault.liquidationThreshold / 10;
  const borrowRatePct = live ? live.borrowRateAnnual * 100 : null;

  // Everything convertible into this vault's collateral, summed as a 1:1
  // notional before fees. The deposit runs one conversion per source in
  // sequence, so the whole unified balance is spendable rather than just the
  // largest single holding.
  const convertibleUi = useMemo(
    () => totalConvertibleUi(heldEquivalents, vault.collateralDecimals),
    [heldEquivalents, vault.collateralDecimals],
  );

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
      const sig = await conn.sendRawTransaction(signedBytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await conn.confirmTransaction(sig, "confirmed");
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
      const sig = await conn.sendRawTransaction(signedBytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await conn.confirmTransaction(sig, "confirmed");
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
    <div className="space-y-4 rounded-xl border border-white/10 bg-gradient-to-br from-aeras-hero-from to-aeras-hero-to p-4 shadow-lg shadow-black/10">
      <div className="flex items-center gap-3">
        <AssetLogo
          xstock={assetIdentity(vault.collateralMint, vault.collateralSymbol)}
          size={32}
        />
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium tracking-tight text-white">
            {vault.collateralSymbol} → {vault.borrowSymbol}
          </div>
          <div className="font-mono text-[11px] text-white/50">
            Max LTV {cfPct.toFixed(0)}% · LT {ltPct.toFixed(0)}%
            {borrowRatePct != null && ` · ${borrowRatePct.toFixed(2)}% APR`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          dark
          label="Your collateral"
          value={`${collateralBalance.toFixed(4)} ${vault.collateralSymbol}`}
          sub={collateralUsd != null ? `$${collateralUsd.toFixed(2)}` : undefined}
        />
        <Stat
          dark
          label="Oracle price"
          value={oraclePrice != null ? `$${oraclePrice.toFixed(2)}` : "…"}
        />
      </div>

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
      ) : position && (position.collateralAtomic.gtn(0) || position.debtAtomic.gtn(0)) ? (
        <>
          <PositionCard
            vault={vault}
            position={position}
            oraclePrice={oraclePrice}
          />
          <ClosePositionControl
            vault={vault}
            position={position}
            walletUsdc={walletUsdc}
            state={closingState}
            onClose={handleClose}
            onReset={() => setClosingState({ kind: "idle" })}
          />
        </>
      ) : null}

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
        onSubmit={handleSubmit}
        formState={formState}
        resetForm={() => setFormState({ kind: "idle" })}
        recovering={recovering}
      />
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
          dark
          dot="bg-aeras-positive"
          label="Collateral"
          value={`${colUi.toFixed(4)} ${vault.collateralSymbol}`}
          sub={colUsd != null ? `$${colUsd.toFixed(2)}` : undefined}
        />
        <Stat
          dark
          dot="bg-aeras-warning"
          label="Debt"
          value={`${debtUi.toFixed(4)} ${vault.borrowSymbol}`}
        />
        <Stat
          dark
          dot={statusDot}
          label="Projected LTV"
          value={`${ltvPct.toFixed(1)}% / LT ${liquidationPct.toFixed(0)}%`}
        />
        <Stat
          dark
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

  // Default: deposit a small amount of collateral and borrow conservatively against it.
  const safeCFPct = (vault.collateralFactor / 10) * 0.6; // borrow up to 60% of CF for safety
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

  const maxBorrowUsd = totalCollateralUsd ? totalCollateralUsd * (safeCFPct / 100) : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={`Deposit ${vault.collateralSymbol}`}
          value={colInput}
          onChange={(v) => {
            setColInput(v);
            resetForm();
          }}
          right={vault.collateralSymbol}
          balanceLabel={
            convertibleUi > 0
              ? // Floored, so the stated number is one Max can actually produce.
                `${Number(ceilingInput).toFixed(4)} avail${quotedMax.loading ? " (pricing)" : ""}`
              : `${collateralBalance.toFixed(4)} avail`
          }
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
          label={`Borrow ${vault.borrowSymbol}`}
          value={borrowInput}
          onChange={(v) => {
            setBorrowInput(v);
            resetForm();
          }}
          right={vault.borrowSymbol}
          balanceLabel={
            maxBorrowUsd > 0 ? `${maxBorrowUsd.toFixed(2)} max safe` : undefined
          }
          onMax={
            maxBorrowUsd > 0
              ? () => {
                  setBorrowInput(maxBorrowUsd.toFixed(2));
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

          <div className="flex justify-between">
            <span className="text-white/50">Projected LTV</span>
            <span
              className={`font-mono tabular-nums ${
                tooClose ? "text-aeras-negative" : "text-white"
              }`}
            >
              {projectedLtv.toFixed(1)}% / LT {ltPct.toFixed(0)}%
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
  state,
  onClose,
  onReset,
}: {
  vault: XStockBorrowVault;
  position: UserPositionState;
  walletUsdc: number;
  state: FormState;
  onClose: (method: "repay" | "sell") => void;
  onReset: () => void;
}) {
  const debtUi = fromAtomicBN(position.debtAtomic, vault.borrowDecimals);
  const colUi = fromAtomicBN(position.collateralAtomic, vault.collateralDecimals);
  const submitting = state.kind === "submitting";

  // A small buffer over the displayed debt covers interest that accrues between
  // this render and settlement, so we don't offer a repay the tx would reject.
  const canRepayFromWallet = walletUsdc >= debtUi * 1.005;

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
          ? "Closing position…"
          : `Close · repay ${debtUi.toFixed(4)} ${vault.borrowSymbol} + withdraw ${colUi.toFixed(4)} ${vault.collateralSymbol}`}
      </button>
      {canRepayFromWallet ? (
        <p className="text-[11px] text-white/50">
          Repays the loan from your wallet {vault.borrowSymbol} and returns your{" "}
          {vault.collateralSymbol} in full.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-white/50">
            Needs ≥ {debtUi.toFixed(4)} {vault.borrowSymbol} in your wallet to
            repay and keep your {vault.collateralSymbol}. You have{" "}
            {walletUsdc.toFixed(2)} {vault.borrowSymbol}.
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

function NumberField({
  label,
  value,
  onChange,
  right,
  balanceLabel,
  onMax,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  right: string;
  balanceLabel?: string;
  onMax?: () => void;
}) {
  return (
    <div>
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
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
          {right}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  dark,
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
  dark?: boolean;
  // Tailwind bg-* class for a small color dot before the label.
  dot?: string;
}) {
  return (
    <div>
      <div
        className={`flex items-center gap-1.5 text-[11px] ${dark ? "text-white/50" : "text-aeras-300"}`}
      >
        {dot && (
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        )}
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-sm tabular-nums ${
          dark ? "text-white" : "text-aeras-900"
        }`}
      >
        {value}
        {sub && (
          <span className={dark ? "text-white/50" : "text-aeras-300"}>
            {" "}
            · {sub}
          </span>
        )}
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
