"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import { usePrivy } from "@privy-io/react-auth";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { PriceChart } from "@/components/PriceChart";
import { RepayForm } from "@/components/RepayPanel";
import { RepayKindToggle } from "@/components/BorrowMarketDetail";
import type { OpenBorrowPosition } from "@/lib/borrow/use-borrow-summary";
import { SOLSCAN_TX_BASE, SOL_MINT } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { xstockByMint } from "@/lib/jupiter/xstocks";
import {
  buildKaminoBorrowTx,
  buildKaminoDepositTx,
  KaminoKtxError,
  toAtomicString,
} from "@/lib/kamino/borrow";
import {
  buildKaminoRepayTx,
  buildKaminoWithdrawTx,
  fetchKaminoPosition,
  type KaminoPosition,
} from "@/lib/kamino/positions";
import {
  KAMINO_USDC_BORROW,
  type KaminoCollateralReserve,
} from "@/lib/kamino/reserves";
import type { MarketStat } from "@/lib/borrow/use-market-stats";
import {
  atomicToNumber,
  availableToBorrowAtomic,
  ltvBpsFromDecimal,
  parseScaled,
  priceFromDecimal,
  PRICE_SCALE,
  type CollateralInput,
} from "@/lib/borrow/limit";
import { createPortal } from "react-dom";

import {
  BORROW_PILL_CLASS,
  MarketDetailHeader,
  type BorrowMode,
} from "@/components/BorrowMarketDetail";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import {
  atomicToUiString,
  getConnection,
} from "@/lib/solana/balances";
import { sendAndConfirm } from "@/lib/solana/send-confirm";
import { floorToDisplay } from "@/lib/trustware/selection";
import { useGasGate } from "@/lib/gas/use-gas-gate";
import {
  pendingRecordFor,
  recordPositionSetup,
  type PendingSetupRecord,
} from "@/lib/position-setup-client";
import { estimateKaminoSetupCost } from "@/lib/kamino/first-position";
import {
  describeInsufficientLamports,
  estimateSolanaFeeCost,
  needsSetup,
} from "@/lib/borrow/setup-cost";

// USDC is the only borrow asset in this market for v1.
const BORROW_SYMBOL = "USDC";

interface Props {
  collateral: KaminoCollateralReserve;
  walletAddress: string;
  // Solana USDC, used to buy the SOL a first position needs. See
  // components/GasSheet.tsx.
  walletUsdc: number;
  // Exact atomic Solana USDC, SOL balance and SOL price: the partial repay in
  // Repay mode funds a shortfall from Monad USDC and spare SOL the way the
  // headline Repay panel does, and sizes that against the real figure.
  solanaUsdcAtomic: string;
  solBalance: number;
  solPriceUsd: number | null;
  collateralBalance: number;
  // Exact base-unit balance as a decimal string. Used to defeat float rounding
  // when depositing the full wallet balance.
  collateralBalanceAtomic: string;
  prices: JupiterPriceMap | null;
  // Rate and size for this market, already fetched for the collapsed row. Passed
  // down so the detail's stat grid renders with the list's figures rather than
  // reading the reserve a second time.
  stat: MarketStat | undefined;
  // Position pre-fetched by the parent (single obligation per market). Passed so
  // the card renders an existing position without an extra round-trip on mount.
  initialPosition: KaminoPosition | null;
  onRefresh: () => Promise<void> | void;
  // Ask the parent to re-read the obligation after an open/close so the card
  // stays visible once collateral has moved out of the wallet.
  onPositionChange: () => void;
  // Drop the two typed fields and leave the slider as the control, posting
  // everything the wallet holds. The Terminal's ticket uses this; the Borrow
  // tab keeps the fields.
  sliderOnly?: boolean;
}

// Submitting carries a human-readable step because opening or closing a Kamino
// position is two transactions (deposit then borrow / repay then withdraw), each
// signed separately.
type FormState =
  | { kind: "idle" }
  | { kind: "submitting"; step: string }
  | { kind: "error"; message: string }
  | { kind: "done"; signature: string };

export function KaminoBorrowCard({
  collateral,
  walletAddress,
  walletUsdc,
  solanaUsdcAtomic,
  solBalance,
  solPriceUsd,
  collateralBalance,
  collateralBalanceAtomic,
  prices,
  stat,
  initialPosition,
  onRefresh,
  onPositionChange,
  sliderOnly = false,
}: Props) {
  const signTxBase64 = useSignSolanaTxBase64();

  const matchesThis = (p: KaminoPosition | null) =>
    p && p.collateral.collateralMint === collateral.collateralMint ? p : null;

  const [position, setPosition] = useState<KaminoPosition | null>(
    matchesThis(initialPosition),
  );
  const [positionError, setPositionError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });
  const [closingState, setClosingState] = useState<FormState>({ kind: "idle" });

  // Which of the two actions is on screen. Borrow first: a user opening a market
  // they have no position in is here to draw, not to repay.
  const [mode, setMode] = useState<BorrowMode>("borrow");
  // Within Repay mode: close the whole position, or pay part of the debt and
  // leave the collateral deposited. Same shape as the Jupiter card.
  const [repayKind, setRepayKind] = useState<"close" | "partial">("close");
  // Header cell the borrow form portals its submit into. See BorrowMarketDetail.
  const [borrowSlot, setBorrowSlot] = useState<HTMLDivElement | null>(null);

  // Held from the moment the user accepts the setup cost until the position
  // actually settles, then written once. Recording at acceptance instead would
  // log rent for borrows that were abandoned or that failed, which is the same
  // bookkeeping-outruns-reality bug in a different place.
  const [pendingSetup, setPendingSetup] = useState<PendingSetupRecord | null>(
    null,
  );
  const { getAccessToken } = usePrivy();

  // The wallet's collateral balance, read from chain at submit time rather than
  // taken from the prop.
  //
  // The prop is a snapshot from before the sheet opened, and the collateral-sale
  // funding route spends some of that very balance on the way through. Clamping
  // a deposit against the stale figure asks for stock the wallet no longer holds
  // and fails simulation. Jupiter's card has read fresh for this reason since
  // before funding existed; this brings Kamino in line.
  //
  // "processed" matches what simulation reads: "confirmed" can lag a few slots
  // and let a stale max through, which is the same bug one commitment level up.
  const readFreshCollateralAtomic = useCallback(async (): Promise<string> => {
    try {
      const meta = xstockByMint(collateral.collateralMint);
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(collateral.collateralMint),
        new PublicKey(walletAddress),
        false,
        meta?.tokenProgram === "token" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID,
      );
      const fresh = await getConnection().getTokenAccountBalance(
        ata,
        "processed",
      );
      return fresh.value.amount;
    } catch {
      // No ATA or an RPC hiccup. Fall back to the prop rather than blocking a
      // borrow that may not need the deposit leg at all.
      return collateralBalanceAtomic;
    }
  }, [collateral.collateralMint, walletAddress, collateralBalanceAtomic]);

  const refreshPosition = useCallback(async () => {
    try {
      const p = await fetchKaminoPosition(walletAddress);
      setPosition(
        p && p.collateral.collateralMint === collateral.collateralMint
          ? p
          : null,
      );
      setPositionError(null);
    } catch (err) {
      console.error("[kamino position]", err);
      setPositionError(err instanceof Error ? err.message : String(err));
    }
  }, [walletAddress, collateral.collateralMint]);

  // Derive this card's position from the parent's single obligation fetch rather
  // than every card round-tripping on mount. With the full market catalog
  // rendered, self-fetching would fire one identical request per card (and could
  // paint several "couldn't load position" boxes if the API hiccups). Only the
  // one card matching the user's actual collateral shows a live position; the
  // rest stay inert. After an open/close, the acting card still calls
  // refreshPosition directly for an immediate update.
  useEffect(() => {
    setPosition(
      initialPosition &&
        initialPosition.collateral.collateralMint === collateral.collateralMint
        ? initialPosition
        : null,
    );
    setPositionError(null);
  }, [initialPosition, collateral.collateralMint]);

  const oraclePrice =
    position?.oraclePriceUsd ??
    prices?.[collateral.collateralMint]?.usdPrice ??
    null;

  // Every signature here goes through this. A first position allocates
  // accounts the user pays rent for, and every transaction needs the fee;
  // the sheet opens only when the wallet cannot cover it, selling a little
  // of the collateral or USDC for SOL. See lib/gas/use-gas-gate.tsx.
  const gas = useGasGate({
    walletAddress,
    walletUsdc,
    asset: {
      symbol: collateral.symbol,
      mint: collateral.collateralMint,
      decimals: collateral.decimals,
      balanceUi: collateralBalance,
      priceUsd: oraclePrice,
    },
    solPriceUsd: prices?.[SOL_MINT]?.usdPrice ?? null,
    signTxBase64,
  });

  // The wallet's collateral balance at "processed", for the quote below.
  //
  // This is what makes the limit deterministic instead of a race. The prop is
  // read through the shared Connection, which is opened at "confirmed"
  // (lib/solana/balances.ts), so it can still show stock that a landed deposit
  // has already spent -- while the obligation read, which comes from Kamino's
  // API, may already include it. When the two disagree in that direction the
  // same stock is counted twice, once as deposited collateral and once as
  // wallet stock, and the card offers double the real limit. That is the
  // $600-against-$500 report: $500 of GOOGLx at its 60% max LTV is $300.
  //
  // "processed" is never behind a confirmed deposit, so the overlap cannot
  // happen in that direction. The other direction, an obligation read that
  // lags the wallet, just under-quotes, which is safe.
  const [freshWalletAtomic, setFreshWalletAtomic] = useState<string | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    readFreshCollateralAtomic().then((atomic) => {
      if (!cancelled) setFreshWalletAtomic(atomic);
    });
    return () => {
      cancelled = true;
    };
    // Re-reads when the posted amount changes, which is exactly when the prop
    // is most likely to be behind.
  }, [readFreshCollateralAtomic, position?.collateralAtomic]);

  // Max LTV in basis points: Kamino's live value where the metrics read landed,
  // the registry snapshot only if it did not. Derived once and shared by the
  // quote below and the submit-time cap, so the number the user is shown and
  // the number the borrow is sized against cannot drift apart.
  //
  // Sizing against the snapshot is what lib/kamino/reserves.ts already warns
  // about in maxLtvSnapshot's own comment ("the UI should refresh this from
  // /reserves/metrics rather than trust it for math"). It was being trusted for
  // math until the proxy stopped dropping the live field.
  const ltvBps = useMemo(
    () =>
      ltvBpsFromDecimal(
        stat?.maxLtv != null && stat.maxLtvKind === "decimal"
          ? stat.maxLtv
          : String(collateral.maxLtvSnapshot),
      ),
    [stat?.maxLtv, stat?.maxLtvKind, collateral.maxLtvSnapshot],
  );

  // What this market will lend against collateral deposited here plus the same
  // stock sitting in the wallet, less what is already drawn. Wallet stock counts
  // because the form below deposits it as part of the borrow.
  //
  // Capped by undrawn USDC in the reserve: earned headroom is not drawable from
  // a reserve that has already lent everything out, and quoting it would let the
  // user submit a borrow that fails on chain.
  //
  // The arithmetic is lib/borrow/limit.ts: integers on atomic units, flooring,
  // so the figure offered is one the chain will actually honour. The max LTV is
  // Kamino's live value where the metrics read landed, and the registry
  // snapshot only if it did not -- sizing a borrow against a snapshot is what
  // lib/kamino/reserves.ts already warns against in maxLtvSnapshot's own
  // comment.
  const availableUsd = useMemo(() => {
    if (oraclePrice == null) return null;
    // The price is a float by the time it reaches here (Kamino reports the
    // obligation's USD totals, and the price map is JSON numbers), so this is
    // exact for the float it is given rather than exact outright. What the
    // module guarantees is that nothing further is lost and that the result is
    // floored, which is the half that was producing unfillable quotes.
    const priceScaled = priceFromDecimal(oraclePrice.toFixed(PRICE_SCALE));
    const pool = (atomic: bigint): CollateralInput => ({
      atomic,
      decimals: collateral.decimals,
      priceScaled,
      ltvBps,
    });

    const pools: CollateralInput[] = [];
    const deposited = BigInt(position?.collateralAtomic ?? "0");
    if (deposited > 0n) pools.push(pool(deposited));
    const inWallet = BigInt(freshWalletAtomic ?? collateralBalanceAtomic ?? "0");
    if (inWallet > 0n) pools.push(pool(inWallet));

    const borrowDecimals = KAMINO_USDC_BORROW.decimals;
    const atomic = availableToBorrowAtomic({
      pools,
      borrowDecimals,
      debtAtomic: parseScaled(
        (position?.debtUsdc ?? 0).toFixed(borrowDecimals),
        borrowDecimals,
      ),
      liquidityAtomic:
        stat?.liquidityUsd != null
          ? parseScaled(
              Math.max(0, stat.liquidityUsd).toFixed(borrowDecimals),
              borrowDecimals,
            )
          : undefined,
    });
    return atomicToNumber(atomic, borrowDecimals);
  }, [
    oraclePrice,
    position?.collateralAtomic,
    position?.debtUsdc,
    freshWalletAtomic,
    collateralBalanceAtomic,
    collateral.decimals,
    ltvBps,
    stat?.liquidityUsd,
  ]);

  // Sign, submit, and confirm one base64 transaction. Shared by both legs of the
  // open and close flows.
  const signSend = useCallback(
    async (base64Tx: string): Promise<string> => {
      const conn = getConnection();
      const signed = await signTxBase64(base64Tx);
      const bytes = base64ToBytes(signed);
      return sendAndConfirm(conn, bytes);
    },
    [signTxBase64],
  );

  // Price the rent and the fee before asking for a signature, and stop here
  // if the wallet cannot cover it. The rent is logged either way.
  async function handleSubmit(args: {
    collateralUi: number;
    borrowUi: number;
  }) {
    setFormState({ kind: "submitting", step: "Checking your wallet…" });
    const blocked = await gas.guard({
      estimate: () =>
        estimateKaminoSetupCost({ connection: getConnection(), walletAddress }),
      resume: () => runSubmit(args),
      onCovered: (cost) => {
        if (needsSetup(cost)) setPendingSetup(pendingRecordFor("kamino", cost));
      },
      onFunded: (funding, cost) =>
        setPendingSetup(pendingRecordFor("kamino", cost, funding)),
    });
    if (blocked) {
      setFormState({ kind: "idle" });
      return;
    }
    await runSubmit(args);
  }

  async function runSubmit(args: {
    collateralUi: number;
    borrowUi: number;
  }) {
    // Carried out of the deposit leg so the borrow below can size against what
    // was actually posted, not what was typed. Declared outside the try because
    // the catch needs it too: "deposit before borrowing" is the wrong thing to
    // say to someone whose deposit just landed.
    let depositedUi = 0;
    try {
      let lastSig: string | null = null;

      if (args.collateralUi > 0) {
        setFormState({
          kind: "submitting",
          step: `Depositing ${collateral.symbol}…`,
        });
        // Clamp to the exact on-chain balance so a "Max" deposit can't request
        // one atomic unit more than the wallet holds.
        const freshAtomic = await readFreshCollateralAtomic();
        const wantedAtomic = toAtomicString(
          args.collateralUi,
          collateral.decimals,
        );
        const clampedAtomic =
          BigInt(wantedAtomic) > BigInt(freshAtomic)
            ? freshAtomic
            : wantedAtomic;
        depositedUi = Number(
          atomicToUiString(clampedAtomic, collateral.decimals),
        );
        if (depositedUi <= 0) {
          throw new Error(
            `No ${collateral.symbol} left in this wallet to deposit.`,
          );
        }
        const depTx = await buildKaminoDepositTx({
          walletAddress,
          collateral,
          collateralUi: depositedUi,
        });
        lastSig = await signSend(depTx);
      }

      if (args.borrowUi > 0) {
        // Cap the draw at what the posted collateral can actually carry.
        //
        // Paying for the setup by selling collateral shrinks the deposit, and a
        // borrow sized against the pre-sale figure can land above max LTV and be
        // refused on chain. Concrete rather than theoretical: a max-LTV borrow
        // has only the form's 1% buffer of headroom, and the sale eats it on any
        // position where the setup cost is more than 1% of the collateral. The
        // 1% here mirrors that same buffer.
        //
        // Note this CAPS rather than scales. A borrow the smaller deposit still
        // carries safely is left exactly as the user asked for it; reducing it
        // proportionally would quietly hand back less than they typed for no
        // reason the chain requires.
        //
        // This can only ever reduce the borrow, never raise it.
        //
        // Sized through lib/borrow/limit.ts on atomic units, at the live max
        // LTV, flooring. This is the figure that becomes a transaction, so it
        // is the one place where a float that rounded the wrong way is not a
        // display glitch but a borrow the chain refuses.
        let borrowUi = args.borrowUi;
        if (oraclePrice != null) {
          const borrowDecimals = KAMINO_USDC_BORROW.decimals;
          // One percentage point is 100 basis points. Same buffer as before,
          // now subtracted from the live ratio rather than the snapshot.
          const bufferedBps = ltvBps > 100n ? ltvBps - 100n : 0n;
          // The obligation state here is the pre-deposit one: `position` has
          // not been refreshed yet inside this submit. Adding what this run
          // just deposited gives what the chain now holds.
          const postedAtomic =
            BigInt(position?.collateralAtomic ?? "0") +
            parseScaled(
              depositedUi.toFixed(collateral.decimals),
              collateral.decimals,
            );
          const capAtomic = availableToBorrowAtomic({
            pools: [
              {
                atomic: postedAtomic,
                decimals: collateral.decimals,
                priceScaled: priceFromDecimal(oraclePrice.toFixed(PRICE_SCALE)),
                ltvBps: bufferedBps,
              },
            ],
            borrowDecimals,
            debtAtomic: parseScaled(
              (position?.debtUsdc ?? 0).toFixed(borrowDecimals),
              borrowDecimals,
            ),
          });
          if (capAtomic <= 0n) {
            throw new Error(
              `The deposited ${collateral.symbol} does not support a loan this size. Deposit more, or borrow less.`,
            );
          }
          borrowUi = Math.min(borrowUi, atomicToNumber(capAtomic, borrowDecimals));
        }
        setFormState({ kind: "submitting", step: `Borrowing ${BORROW_SYMBOL}…` });
        const borrowTx = await buildKaminoBorrowTx({
          walletAddress,
          borrowUi,
          // A deposit in this same submit means the obligation may be newer
          // than Kamino's view of the chain. See lib/kamino/borrow.ts.
          afterDeposit: depositedUi > 0,
        });
        lastSig = await signSend(borrowTx);
      }

      if (!lastSig) {
        setFormState({ kind: "idle" });
        return;
      }
      setFormState({ kind: "done", signature: lastSig });
      // Best effort, and after the confirmation is on screen: a failed write
      // here must not read as a failed borrow. See lib/position-setup-client.ts.
      if (pendingSetup) {
        void recordPositionSetup(getAccessToken, pendingSetup);
        setPendingSetup(null);
      }
      await onRefresh();
      await refreshPosition();
      onPositionChange();
    } catch (err) {
      console.error("[kamino open]", err);
      const message =
        err instanceof KaminoKtxError &&
        err.code === "KLEND_OBLIGATION_NOT_FOUND"
          ? depositedUi > 0
            ? // The deposit landed and Kamino still cannot see it after the
              // wait in buildKaminoBorrowTx. Say that, because the collateral
              // is posted and re-submitting the form would deposit it twice.
              `Your ${collateral.symbol} is deposited, but Kamino has not caught up enough to build the loan yet. Wait a minute, then borrow without depositing again.`
            : `Deposit ${collateral.symbol} before borrowing ${BORROW_SYMBOL}.`
          : // Ran out of SOL for the account rent. The preflight above normally
            // catches this, but a balance can move between the check and the
            // signature, and CLAUDE.md forbids putting the raw simulation dump
            // on screen.
            (describeInsufficientLamports(err) ??
            (err instanceof Error ? err.message : String(err)));
      setFormState({ kind: "error", message });
    }
  }

  async function handleClose() {
    if (!position) return;
    if (
      await gas.guard({
        estimate: () =>
          estimateSolanaFeeCost({
            connection: getConnection(),
            walletAddress,
            venueLabel: "Kamino",
          }),
        resume: () => handleClose(),
      })
    ) {
      return;
    }
    try {
      let lastSig: string | null = null;
      if (position.debtUsdc > 0) {
        setClosingState({
          kind: "submitting",
          step: `Repaying ${BORROW_SYMBOL}…`,
        });
        const repayTx = await buildKaminoRepayTx(
          walletAddress,
          position.debtUsdc,
        );
        lastSig = await signSend(repayTx);
      }
      setClosingState({
        kind: "submitting",
        step: `Withdrawing ${collateral.symbol}…`,
      });
      const withdrawTx = await buildKaminoWithdrawTx(walletAddress, position);
      lastSig = await signSend(withdrawTx);

      setClosingState({ kind: "done", signature: lastSig });
      await onRefresh();
      await refreshPosition();
      onPositionChange();
    } catch (err) {
      console.error("[kamino close]", err);
      setClosingState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const hasPosition =
    position != null && (position.collateralUi > 0 || position.debtUsdc > 0);

  // This obligation in the shape the headline Repay form takes, so the partial
  // repay below is that form and not a second copy of the path. Null when
  // nothing is owed.
  const repayTarget: OpenBorrowPosition | null =
    position && position.debtUsdc > 0
      ? {
          key: `kamino:${position.collateral.reserve}`,
          venueLabel: "Kamino",
          collateralSymbol: position.collateral.symbol,
          collateralMint: position.collateral.collateralMint,
          collateralUi: position.collateralUi,
          debtUi: position.debtUsdc,
          debtSymbol: BORROW_SYMBOL,
          ref: { venue: "kamino", position },
        }
      : null;

  return (
    <div className="space-y-5 rounded-xl border border-white/10 bg-white/5 p-5">
      <MarketDetailHeader
        mint={collateral.collateralMint}
        symbol={collateral.symbol}
        borrowSymbol={BORROW_SYMBOL}
        availableUsd={availableUsd}
        owedUsd={position?.debtUsdc ?? 0}
        mode={mode}
        onModeChange={setMode}
        canRepay={hasPosition}
        borrowActionSlot={setBorrowSlot}
      />

      {positionError ? (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
          <div className="font-medium text-white">
            Couldn&apos;t load position
          </div>
          <div className="mt-1 break-all text-white/50">{positionError}</div>
        </div>
      ) : hasPosition && position ? (
        <KaminoPositionCard
          collateral={collateral}
          position={position}
          oraclePrice={oraclePrice}
        />
      ) : null}

      {mode === "repay" && hasPosition && position ? (
        <div className="space-y-3">
          {repayKind === "partial" && repayTarget ? (
            <RepayForm
              key={repayTarget.key}
              position={repayTarget}
              walletUsdc={walletUsdc}
              solanaUsdcAtomic={solanaUsdcAtomic}
              sol={solBalance}
              solPriceUsd={solPriceUsd}
              walletAddress={walletAddress}
              onSettled={async () => {
                await onRefresh();
                await refreshPosition();
                onPositionChange();
              }}
              onClose={() => setRepayKind("close")}
              embedded
            />
          ) : (
            <KaminoCloseControl
              collateral={collateral}
              position={position}
              state={closingState}
              onClose={handleClose}
              onReset={() => setClosingState({ kind: "idle" })}
            />
          )}
          {repayTarget && (
            <RepayKindToggle kind={repayKind} onChange={setRepayKind} />
          )}
        </div>
      ) : mode === "borrow" ? (
        <KaminoOperateForm
          collateral={collateral}
          existingPosition={hasPosition ? position : null}
          collateralBalance={collateralBalance}
          collateralBalanceAtomic={collateralBalanceAtomic}
          oraclePrice={oraclePrice}
          aprPct={stat?.borrowAprPct ?? null}
          onSubmit={handleSubmit}
          formState={formState}
          resetForm={() => setFormState({ kind: "idle" })}
          actionSlot={borrowSlot}
          sliderOnly={sliderOnly}
        />
      ) : null}

      {gas.element}
    </div>
  );
}

function KaminoPositionCard({
  collateral,
  position,
  oraclePrice,
}: {
  collateral: KaminoCollateralReserve;
  position: KaminoPosition;
  oraclePrice: number | null;
}) {
  const colUi = position.collateralUi;
  const debtUi = position.debtUsdc;
  const colUsd = oraclePrice != null ? colUi * oraclePrice : position.collateralUsd;
  const ltvPct =
    position.ltvPct > 0
      ? position.ltvPct
      : colUsd > 0
        ? (debtUi / colUsd) * 100
        : 0;
  const liquidationPct =
    position.liquidationLtvPct > 0
      ? position.liquidationLtvPct
      : collateral.liquidationThreshold;
  // Collateral price at which LTV reaches LT for the current debt.
  const liquidationPrice =
    colUi > 0 && debtUi > 0
      ? debtUi / (colUi * (liquidationPct / 100))
      : null;
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
          value={`${colUi.toFixed(4)} ${collateral.symbol}`}
          sub={colUsd > 0 ? `$${colUsd.toFixed(2)}` : undefined}
        />
        <Stat
          dot="bg-aeras-warning"
          label="Debt"
          value={`${debtUi.toFixed(2)} ${BORROW_SYMBOL}`}
        />
        <Stat
          dot={statusDot}
          label="LTV"
          value={`${ltvPct.toFixed(1)}% / LT ${liquidationPct.toFixed(0)}%`}
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
              ${liquidationPrice.toFixed(2)} / {collateral.symbol}
            </span>
          </div>
          {oraclePrice != null && (
            <div className="mt-1 text-[11px] text-white/50">
              {oraclePrice > liquidationPrice
                ? `${collateral.symbol} would need to drop ${(((oraclePrice - liquidationPrice) / oraclePrice) * 100).toFixed(1)}% from $${oraclePrice.toFixed(2)} to liquidate.`
                : "Position is at the liquidation threshold."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KaminoOperateForm({
  collateral,
  existingPosition,
  collateralBalance,
  collateralBalanceAtomic,
  oraclePrice,
  aprPct,
  onSubmit,
  formState,
  resetForm,
  actionSlot,
  sliderOnly = false,
}: {
  collateral: KaminoCollateralReserve;
  existingPosition: KaminoPosition | null;
  collateralBalance: number;
  collateralBalanceAtomic: string;
  oraclePrice: number | null;
  // Annual borrow rate, shown against the amount being drawn rather than as a
  // standalone market figure.
  aprPct: number | null;
  onSubmit: (args: { collateralUi: number; borrowUi: number }) => void;
  formState: FormState;
  resetForm: () => void;
  // Header cell to render the submit into; falls back in place when absent.
  actionSlot: HTMLElement | null;
  sliderOnly?: boolean;
}) {
  const safeCFPct = collateral.maxLtvSnapshot * 100 * 0.6; // 60% of max LTV
  // Rounded DOWN to the displayed precision, never up. toFixed rounds half away
  // from zero, so a wallet holding 0.35779 prefilled "0.3578", which fails its
  // own `collateralUi <= collateralBalance` check below and left the Borrow
  // button disabled with nothing on screen saying why. Same fix, and same
  // reason, as the Jupiter card in components/BorrowPanel.tsx.
  const balanceInput = floorToDisplay(collateralBalance);

  const [colInput, setColInput] = useState<string>(() =>
    collateralBalance > 0 ? balanceInput : "0",
  );
  const [borrowInput, setBorrowInput] = useState<string>("");

  useEffect(() => {
    if (collateralBalance > 0 && colInput === "0") {
      setColInput(balanceInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collateralBalance]);

  const collateralUi = Number(colInput);
  const borrowUi = Number(borrowInput);

  const colDeltaValid =
    Number.isFinite(collateralUi) &&
    collateralUi >= 0 &&
    collateralUi <= collateralBalance;
  const borrowValid = Number.isFinite(borrowUi) && borrowUi >= 0;

  const existingColUi = existingPosition?.collateralUi ?? 0;
  const existingDebtUi = existingPosition?.debtUsdc ?? 0;
  const totalCollateralUsd =
    oraclePrice != null
      ? (existingColUi + collateralUi) * oraclePrice
      : null;
  const totalDebtUi = existingDebtUi + borrowUi;
  const projectedLtv =
    totalCollateralUsd && totalCollateralUsd > 0
      ? (totalDebtUi / totalCollateralUsd) * 100
      : 0;
  const ltPct = collateral.liquidationThreshold;
  const cfPct = collateral.maxLtvSnapshot * 100;
  const tooClose = projectedLtv >= cfPct;
  const liquidationPrice =
    oraclePrice != null && projectedLtv > 0
      ? oraclePrice * (projectedLtv / ltPct)
      : null;
  const drawdownPct =
    liquidationPrice != null && oraclePrice != null && oraclePrice > 0
      ? ((oraclePrice - liquidationPrice) / oraclePrice) * 100
      : null;
  const ticker = xstockByMint(collateral.collateralMint);
  // Additional borrow that brings the position to the max LTV, less a 1% buffer
  // so interest accrued between preview and settlement can't push it over.
  const maxNewBorrow =
    totalCollateralUsd != null
      ? Math.max(0, totalCollateralUsd * ((cfPct - 1) / 100) - existingDebtUi)
      : 0;
  const submitting = formState.kind === "submitting";
  const disabled =
    !colDeltaValid ||
    !borrowValid ||
    submitting ||
    tooClose ||
    // The button borrows, so it waits for an amount to borrow. See the Jupiter
    // card's matching change.
    borrowUi <= 0;
  const submitButton = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSubmit({ collateralUi, borrowUi })}
      className={BORROW_PILL_CLASS}
    >
      {/* See the Jupiter card: one word until there is an amount to borrow.
          The slider-only form always shows the figure, since the slider is the
          only place the amount is set and the button is where it is read. */}
      {submitting
        ? formState.step
        : sliderOnly
          ? `Borrow $${(borrowUi || 0).toFixed(2)}`
          : borrowUi > 0
            ? `Borrow $${borrowUi.toFixed(2)} against ${collateral.symbol}`
            : "Borrow"}
    </button>
  );

  const maxBorrowUsd = totalCollateralUsd
    ? totalCollateralUsd * (safeCFPct / 100)
    : 0;

  return (
    <div className="space-y-3">
      {!sliderOnly && (
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={`Deposit ${collateral.symbol}`}
          value={colInput}
          onChange={(v) => {
            setColInput(v);
            resetForm();
          }}
          right={collateral.symbol}
          balanceLabel={`${balanceInput} avail`}
          onMax={() => {
            setColInput(
              atomicToUiString(collateralBalanceAtomic, collateral.decimals),
            );
            resetForm();
          }}
        />
        <NumberField
          label={`Borrow ${BORROW_SYMBOL}`}
          value={borrowInput}
          onChange={(v) => {
            setBorrowInput(v);
            resetForm();
          }}
          right={BORROW_SYMBOL}
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
      )}

      {sliderOnly && collateralUi > 0 && (
        <p className="text-xs text-white/50">
          Posting {balanceInput} {collateral.symbol}, everything in the wallet.
        </p>
      )}

      {maxNewBorrow > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between text-xs">
            <span className="text-white/50">Borrow amount</span>
            <span className="font-mono tabular-nums text-white">
              {(borrowUi || 0).toFixed(2)} {BORROW_SYMBOL} ·{" "}
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
              Max {maxNewBorrow.toFixed(2)} {BORROW_SYMBOL}
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
                showRanges={!sliderOnly}
              />
            </div>
          )}

          {borrowUi > 0 && (
            <div className="flex justify-between">
              <span className="text-white/50">You receive</span>
              <span className="font-mono tabular-nums text-white">
                {borrowUi.toFixed(2)} {BORROW_SYMBOL}
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
                  {collateral.symbol} would need to fall{" "}
                  {drawdownPct.toFixed(1)}% to ${liquidationPrice.toFixed(2)}{" "}
                  before your position is closed to repay the loan.
                </p>
              </>
            )}

          {tooClose && (
            <p className="text-aeras-negative">
              Borrow exceeds the max LTV ({cfPct.toFixed(0)}%). Reduce the borrow
              amount or add more collateral.
            </p>
          )}
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

      {/* Rendered here, shown in the header's Borrow pill. Same reasoning as
          the Jupiter card: the label and the enabled state are decided by this
          form, only the position on screen belongs to the header. */}
      {actionSlot ? createPortal(submitButton, actionSlot) : submitButton}
    </div>
  );
}

function KaminoCloseControl({
  collateral,
  position,
  state,
  onClose,
  onReset,
}: {
  collateral: KaminoCollateralReserve;
  position: KaminoPosition;
  state: FormState;
  onClose: () => void;
  onReset: () => void;
}) {
  const debtUi = position.debtUsdc;
  const colUi = position.collateralUi;
  const submitting = state.kind === "submitting";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? state.step
          : `Close · repay ${debtUi.toFixed(2)} ${BORROW_SYMBOL} + withdraw ${colUi.toFixed(4)} ${collateral.symbol}`}
      </button>
      <p className="text-[11px] text-white/50">
        {debtUi > 0
          ? `Needs ≥ ${debtUi.toFixed(2)} ${BORROW_SYMBOL} in your wallet to repay the loan plus accrued interest, then withdraws your collateral.`
          : `Withdraws your ${collateral.symbol} collateral back to your wallet.`}
      </p>
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
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
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
