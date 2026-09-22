"use client";

// The step between clicking Borrow (or Deposit, on the Earn tab) and signing
// anything, shown when this is the user's first position at a venue and there
// are accounts to pay for.
//
// Solana charges rent to keep an account alive, and a lending venue has to
// allocate per-user accounts before it can track a loan. That cost is invisible
// everywhere else in this app, because every other flow spends tokens the user
// can see. Here it is SOL, it is a one-off, and until this existed the only
// notice a user got was a failed transaction quoting lamport counts.
//
// Deliberately not a generic "add funds" prompt. It names what is being created
// and what each account costs, because the user is being asked to spend money
// on something they did not ask for and cannot see afterwards.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useFundWallet } from "@privy-io/react-auth/solana";

import { BORROW_PILL_CLASS } from "@/components/BorrowMarketDetail";
import {
  formatSol,
  formatSolUsd,
  lamportsToSol,
  type SetupCost,
} from "@/lib/borrow/setup-cost";
import {
  awaitLamports,
  executeSetupFunding,
  quoteSetupFunding,
  sourceAmountNeeded,
  sourceCanCover,
  usdNeededFor,
  type FundingSource,
  type SetupFundingPlan,
} from "@/lib/borrow/fund-setup";
import { getConnection } from "@/lib/solana/balances";

type Phase =
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "confirming"; plan: SetupFundingPlan }
  | { kind: "buying" }
  // Privy's hosted funding modal is open over us.
  | { kind: "onramp" }
  // Money is on its way in from outside and we are polling for it. Cancellable,
  // unlike "settling": nothing has been signed here, the user is only waiting,
  // and a wait they cannot leave is what made this phase its own state.
  | { kind: "awaiting" }
  | { kind: "settling" }
  | { kind: "error"; message: string };

// How the shortfall got covered. Carried out to the caller so the setup log can
// tell "already had the SOL" apart from "swapped USDC" apart from "bought with
// a card", which is the difference between a user who sailed through and one who
// had to reach for a payment method.
// Which of Privy's funding methods the user actually used. Privy reports this
// on exit; null means they closed the flow before choosing one.
export type PrivyFundingMethod =
  | "moonpay"
  | "coinbase-onramp"
  | "external"
  | "manual"
  | null;

export type SetupFunding =
  | { via: "usdc_swap"; usdc: number; signature: string }
  // Sold a sliver of the stock being posted as collateral. Carries the dollar
  // value because the caller has to re-read the wallet afterwards: the deposit
  // it was about to make just got smaller.
  | { via: "collateral_sale"; usd: number; signature: string }
  | { via: "privy_funding"; method: PrivyFundingMethod };

export function FirstPositionSheet({
  cost,
  walletAddress,
  walletUsdc,
  collateral,
  solPriceUsd,
  signTxBase64,
  onFunded,
  onProceed,
  onCancel,
  purpose = "borrow",
  depositSymbol,
}: {
  cost: SetupCost;
  walletAddress: string;
  walletUsdc: number;
  // The stock being posted as collateral, when the wallet holds any. Offered as
  // a funding route because this app's typical borrower bought a stock here and
  // holds nothing else: no SOL to pay the rent and no USDC to buy it with.
  // Omit it and the route simply is not offered. For a vault deposit this is
  // the asset being deposited; the name stays because the borrow cards are
  // the callers that pass it.
  collateral?: {
    symbol: string;
    mint: string;
    decimals: number;
    balanceUi: number;
    priceUsd: number | null;
  };
  solPriceUsd: number | null;
  signTxBase64: (base64Tx: string) => Promise<string>;
  // The shortfall is covered. The caller re-checks the balance and continues,
  // and carries the funding details into the setup log.
  onFunded: (funding: SetupFunding) => Promise<void> | void;
  // Wallet already covers it; go straight on to the borrow.
  onProceed: () => void;
  onCancel: () => void;
  // What the accounts are being opened for. The sheet was written for the
  // borrow tab and every sentence in it said "loan" and "collateral". A vault
  // deposit opens accounts for the same reason and pays for them the same
  // way, so it reuses the sheet and only the nouns change.
  purpose?: "borrow" | "deposit";
  // The asset being deposited, when purpose is "deposit". Decides whether the
  // USDC route spends the deposit itself (a USDC vault) or leaves it alone.
  depositSymbol?: string;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const depositing = purpose === "deposit";
  // "collateral" or "deposit": the thing each route promises not to touch.
  const subject = depositing ? "deposit" : "collateral";
  // Privy reports the chosen method on exit, and the callback is registered per
  // hook rather than per call, so it lands in a ref that the funding flow reads
  // once fundWallet resolves.
  const fundingMethodRef = useRef<PrivyFundingMethod>(null);
  const { fundWallet } = useFundWallet({
    onUserExited: ({ fundingMethod }) => {
      fundingMethodRef.current = (fundingMethod ??
        null) as PrivyFundingMethod;
    },
  });
  const short = cost.shortfallLamports > 0;
  const busy =
    phase.kind === "quoting" ||
    phase.kind === "buying" ||
    phase.kind === "onramp" ||
    phase.kind === "awaiting" ||
    phase.kind === "settling";

  // Cancel stays live while we are only waiting for money to arrive. Everything
  // else that sets `busy` has a signature in flight and must not be abandoned
  // half-done; waiting has nothing in flight at all.
  const cancellable = !busy || phase.kind === "awaiting";

  // Aborts the balance poll when the user gives up on it.
  const waitAbortRef = useRef<AbortController | null>(null);
  const stopWaiting = useCallback(() => {
    waitAbortRef.current?.abort();
    waitAbortRef.current = null;
  }, []);

  // Every route is decided BEFORE the user clicks, not discovered by failing.
  //
  // Ordered by what they cost the user:
  //
  //   USDC       spends dollars that were doing nothing. Position untouched.
  //   Collateral free and instant too, but it shrinks the deposit they are
  //              about to make, so it ranks second even though it is no slower.
  //   Privy      leaves the app: a card with a fee and a $20-30 minimum, or a
  //              transfer they have to go and make. Last resort, not a default.
  //
  // Both in-app routes go out gaslessly through Ultra, so they work from a
  // wallet holding no SOL at all, which is exactly the wallet reading this.
  const usdcSource: FundingSource = { kind: "usdc", balanceUi: walletUsdc };
  const collateralSource: FundingSource | null =
    collateral && collateral.priceUsd != null && collateral.priceUsd > 0
      ? {
          kind: "collateral",
          symbol: collateral.symbol,
          mint: collateral.mint,
          decimals: collateral.decimals,
          balanceUi: collateral.balanceUi,
          priceUsd: collateral.priceUsd,
        }
      : null;

  const canSwap = sourceCanCover(cost.shortfallLamports, solPriceUsd, usdcSource);
  const canSellCollateral =
    collateralSource != null &&
    sourceCanCover(cost.shortfallLamports, solPriceUsd, collateralSource);
  const collateralAmount =
    collateralSource == null
      ? null
      : sourceAmountNeeded(cost.shortfallLamports, solPriceUsd, collateralSource);

  // Escape closes, but never mid-transaction: the swap is already signed and
  // in flight by then, and hiding it would leave the user unsure whether their
  // USDC was spent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && cancellable) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancellable, onCancel]);

  // Never leave a poll running behind a closed sheet.
  useEffect(() => stopWaiting, [stopWaiting]);

  const startFunding = useCallback(
    async (source: FundingSource) => {
      setPhase({ kind: "quoting" });
      try {
        const plan = await quoteSetupFunding({
          walletAddress,
          shortfallLamports: cost.shortfallLamports,
          solPriceUsd,
          source,
        });
        setPhase({ kind: "confirming", plan });
      } catch (err) {
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [walletAddress, cost.shortfallLamports, solPriceUsd],
  );

  const confirmFunding = useCallback(
    async (plan: SetupFundingPlan) => {
      setPhase({ kind: "buying" });
      try {
        const signature = await executeSetupFunding({ plan, signTxBase64 });
        setPhase({ kind: "settling" });
        await onFunded(
          plan.sourceKind === "usdc"
            ? { via: "usdc_swap", usdc: plan.sourceUi, signature }
            : { via: "collateral_sale", usd: plan.sourceUsd, signature },
        );
      } catch (err) {
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [signTxBase64, onFunded],
  );

  // Get SOL into the wallet through Privy's hosted funding flow. Nothing about
  // it touches this app: no card details, no KYC, no webhook, no MoonPay SDK.
  // We pass an address and an amount.
  //
  // **Deliberately does not pin defaultFundingMethod.** Privy offers four ways
  // in (a card via MoonPay or Coinbase, a transfer from another wallet, an
  // exchange withdrawal, or sending SOL to the address by hand) and pinning it
  // to 'card' hid the three free ones. That was worse than the dead end it
  // replaced for anyone who already holds SOL somewhere: card rails carry a fee
  // and a minimum that is typically $20 to $30, against a $3.17 position setup,
  // while sending SOL from another wallet costs a network fee and has no floor.
  // Omitting it opens Privy's method picker, so the user chooses.
  //
  // preferredProvider stays: it decides WHICH card provider is used if they pick
  // a card, and does nothing otherwise.
  //
  // Buys SOL directly rather than USDC. The USDC path exists to convert money
  // the wallet already holds; once the user is funding from outside there is no
  // reason to acquire the wrong asset and swap it, paying spread and an extra
  // signature to arrive where a one-line config lands directly.
  const startOnramp = useCallback(async () => {
    setPhase({ kind: "onramp" });
    fundingMethodRef.current = null;
    try {
      await fundWallet({
        address: walletAddress,
        options: {
          asset: "native-currency",
          // Prefill the shortfall. Each method enforces its own minimum, and
          // Privy's UI surfaces that rather than us guessing at a floor that
          // varies by provider, method and country.
          amount: lamportsToSol(cost.shortfallLamports).toFixed(6),
          card: { preferredProvider: "moonpay" },
        },
      });

      // Privy reports the method on exit, and null means the user closed the
      // window without choosing one. Nothing is coming, so there is nothing to
      // wait for: go straight back to the routes rather than starting a
      // two-minute poll for money that was never sent. This was a real
      // complaint, and the fix is to believe the signal Privy already gives us.
      if (fundingMethodRef.current == null) {
        setPhase({ kind: "idle" });
        return;
      }

      // They picked a method, so money may genuinely be on its way. The promise
      // resolves when they leave the flow, which is not when the funds arrive:
      // card settlement takes minutes and a manual transfer takes as long as the
      // user does. Privy says so itself. Poll rather than assume, and let them
      // out of the wait at any point.
      const abort = new AbortController();
      waitAbortRef.current = abort;
      setPhase({ kind: "awaiting" });
      const landed = await awaitLamports({
        connection: getConnection(),
        walletAddress,
        atLeast: cost.totalLamports,
        timeoutMs: 120_000,
        signal: abort.signal,
      });
      waitAbortRef.current = null;
      // Cancelled out of the wait. The sheet is already closing or back at the
      // routes; do not overwrite that with an error about a wait they ended.
      if (abort.signal.aborted) return;
      if (landed < cost.totalLamports) {
        setPhase({
          kind: "error",
          message:
            "The SOL has not arrived yet. Card purchases and transfers can take a few minutes. Leave this open and try again, or close it and borrow once the SOL lands.",
        });
        return;
      }
      await onFunded({
        via: "privy_funding",
        method: fundingMethodRef.current,
      });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [fundWallet, walletAddress, cost.shortfallLamports, cost.totalLamports, onFunded]);

  // The routes actually open to this wallet, best first. The head of this list
  // is the primary button; the rest are offered underneath rather than hidden,
  // because "sell some of your collateral" is not a thing to do to someone
  // behind a generic Continue.
  type RouteKey = "usdc" | "collateral" | "privy";
  const routes: { key: RouteKey; label: string; note: React.ReactNode }[] = [];

  if (canSwap) {
    // On a USDC vault the USDC route spends the deposit itself, and the note
    // says by how much rather than promising it is untouched.
    const usdcSpent = usdNeededFor(cost.shortfallLamports, solPriceUsd);
    const spendsDeposit = depositing && depositSymbol === "USDC";
    routes.push({
      key: "usdc",
      label: `Get ${formatSol(cost.shortfallLamports)} SOL`,
      note: (
        <>
          Buys {formatSol(cost.shortfallLamports)} SOL with your USDC. Jupiter
          covers the gas, so this works with an empty SOL balance.{" "}
          {spendsDeposit
            ? usdcSpent != null
              ? `It comes out of the USDC you are depositing, so the deposit is about $${usdcSpent.toFixed(2)} smaller.`
              : "It comes out of the USDC you are depositing."
            : `Your ${subject} is not touched.`}
        </>
      ),
    });
  }

  if (canSellCollateral && collateralSource && collateralAmount != null) {
    const usd = collateralAmount * collateralSource.priceUsd;
    routes.push({
      key: "collateral",
      // Priced in dollars, not tokens. "Sell 0.0140 TSLAx" is the amount but
      // not the information: nobody reads four decimals of a share and knows
      // whether that is a lot. The dollar figure is what the decision turns on,
      // and it is the number the note underneath and the confirmation both use.
      // The token amount still appears on the confirmation, where the exact
      // quantity leaving the wallet is the point.
      label: `Sell $${usd.toFixed(2)} of ${collateralSource.symbol}`,
      note: (
        <>
          Sells ${usd.toFixed(2)} of the {collateralSource.symbol} you are
          depositing and keeps the SOL. Instant and free, and the{" "}
          {depositing ? "deposit is" : "position opens"} ${usd.toFixed(2)}{" "}
          smaller.
        </>
      ),
    });
  }

  routes.push({
    key: "privy",
    label: `Add ${formatSol(cost.shortfallLamports)} SOL`,
    note: (
      <>
        Opens funding options: send SOL from another wallet or an exchange, or
        buy it with a card. It goes straight to this wallet, and your {subject}{" "}
        is not touched.
      </>
    ),
  });

  const primary = routes[0];
  const alternatives = routes.slice(1);

  // The one place a route turns into an action. Reached only from a click, so
  // the ref startOnramp reads is never touched during render.
  const runRoute = useCallback(
    (key: RouteKey) => {
      if (key === "usdc") return void startFunding(usdcSource);
      if (key === "collateral" && collateralSource) {
        return void startFunding(collateralSource);
      }
      return void startOnramp();
    },
    // usdcSource and collateralSource are rebuilt every render from primitives,
    // so they are spread rather than passed as objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      startFunding,
      startOnramp,
      walletUsdc,
      collateralSource?.mint,
      collateralSource?.balanceUi,
      collateralSource?.priceUsd,
    ],
  );

  // Portals have no server output, so rendering one on the client's first pass
  // is a hydration mismatch: the server sent nothing where the client draws a
  // dialog. useSyncExternalStore is the hook that can answer "has this hydrated
  // yet" differently on each side without a setState-in-effect, which this
  // repo's lint rules reject. Subscribing to nothing is deliberate: the answer
  // changes exactly once, at hydration, and React already re-renders then.
  //
  // The borrow flow only mounts this after a click, so it never SSRs in
  // practice. This makes that a property of the component rather than a
  // property of how its callers happen to use it.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!hydrated) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 supports-backdrop-filter:backdrop-blur-xs"
        onClick={() => cancellable && onCancel()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`One-time setup for ${cost.venueLabel}`}
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#111415] p-6 text-white shadow-2xl"
      >
        <div className="space-y-1.5">
          <h2 className="font-light text-lg tracking-tight">
            {depositing ? "First deposit into" : "First position on"}{" "}
            {cost.venueLabel}
          </h2>
          <p className="text-sm text-white/50">
            {cost.venueLabel} needs its own accounts on Solana to{" "}
            {depositing ? "hold your deposit" : "track your loan"}. Solana
            charges rent to keep an account open, so opening these costs a
            small amount of SOL once. Later{" "}
            {depositing ? "deposits" : "positions"} here reuse them and cost
            nothing.
          </p>
        </div>

        <div className="mt-5 space-y-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-xs">
          {cost.items.map((item) => (
            <div key={item.label} className="flex justify-between gap-4">
              <span className="text-white/50">{item.label}</span>
              <span className="shrink-0 font-mono tabular-nums text-white">
                {formatSolUsd(item.lamports, solPriceUsd)}
              </span>
            </div>
          ))}
          <div className="flex justify-between gap-4">
            <span className="text-white/50">Network fees</span>
            <span className="shrink-0 font-mono tabular-nums text-white">
              {formatSolUsd(cost.feeLamports, solPriceUsd)}
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-4 border-t border-white/10 pt-2.5">
            <span className="text-white">Total</span>
            <span className="shrink-0 font-mono tabular-nums text-white">
              {formatSolUsd(cost.totalLamports, solPriceUsd)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-white/50">Your SOL</span>
            <span
              className={`shrink-0 font-mono tabular-nums ${
                short ? "text-aeras-negative" : "text-white"
              }`}
            >
              {formatSolUsd(cost.haveLamports, solPriceUsd)}
            </span>
          </div>
        </div>

        {/* Do not soften this into "refundable". It was checked: KLend's
            on-chain IDL has 66 instructions, initObligation and
            initUserMetadata among them, and no close or delete for either. The
            only delete is deleteReferrerStateAndShortUrl, which is referral
            state, not the borrower's. Jupiter Lend is the same story and
            lib/jupiter/borrow.ts already records it: closing a position zeroes
            it and the NFT lives on.

            The one genuinely recoverable piece is the lookup table, $0.12 of
            $3.17, where the user is the ALT authority. Reclaiming it needs a
            deactivate, a ~513 slot wait and a close, we ship none of that, and
            doing it would break their Kamino account. Not worth a sentence, and
            certainly not worth implying the rest comes back too.

            Ordinary token accounts DO refund, which is what every "reclaim your
            SOL" article is about. These are program-owned state accounts and
            they are not the same thing.

            A vault deposit is the mixed case: the share account is an ordinary
            token account, the Kamino farm user state is not, and nothing in
            this app closes either. So the deposit sentence says who does not
            close them rather than claiming a refund the app never performs. */}
        <p className="mt-3 text-[11px] text-white/50">
          Nobody collects this. It is not a fee to {cost.venueLabel} or to
          Aeras: Solana holds it inside the accounts for as long as they exist.{" "}
          {depositing
            ? "Aeras does not close them, so treat it as spent rather than recoverable."
            : `${cost.venueLabel} has no instruction to close them, so treat it as spent rather than recoverable.`}
        </p>

        {phase.kind === "confirming" && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-white/50">Selling</span>
              <span className="shrink-0 font-mono tabular-nums text-white">
                {phase.plan.sourceKind === "usdc"
                  ? `${phase.plan.sourceUi.toFixed(2)} USDC`
                  : `${phase.plan.sourceUi.toFixed(4)} ${phase.plan.sourceSymbol} · ${phase.plan.sourceUsd.toFixed(2)}`}
              </span>
            </div>
            <div className="mt-1.5 flex justify-between gap-4">
              <span className="text-white/50">You receive</span>
              <span className="shrink-0 font-mono tabular-nums text-white">
                {formatSol(phase.plan.expectedLamports)} SOL
              </span>
            </div>
            {phase.plan.raisedForGasless && (
              <p className="mt-2 text-white/70">
                Jupiter would not cover the network fee on a swap as small as
                this position needs, so this is the smallest size it will. The
                extra arrives as SOL in your wallet and is yours to keep.
              </p>
            )}
            {phase.plan.sourceKind === "collateral" && (
              <p className="mt-2 text-white/50">
                This comes out of the {phase.plan.sourceSymbol} you are about to
                deposit, so the {depositing ? "deposit is" : "position opens"} $
                {phase.plan.sourceUsd.toFixed(2)} smaller.
              </p>
            )}
            {!phase.plan.gasless && (
              <p className="mt-2 text-aeras-negative">
                Jupiter is charging fees on this swap, so it needs SOL in the
                wallet to go through. Add SOL another way instead.
              </p>
            )}
          </div>
        )}

        {phase.kind === "error" && (
          <p className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
            {phase.message}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              if (phase.kind === "awaiting") {
                // Back to the routes rather than out of the sheet: they may
                // want a different way in, and the money may still arrive.
                stopWaiting();
                setPhase({ kind: "idle" });
                return;
              }
              onCancel();
            }}
            disabled={!cancellable}
            className="aeras-press rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase.kind === "awaiting" ? "Stop waiting" : "Cancel"}
          </button>

          {!short ? (
            <button
              type="button"
              onClick={onProceed}
              className={BORROW_PILL_CLASS}
            >
              Continue
            </button>
          ) : phase.kind === "confirming" ? (
            <button
              type="button"
              onClick={() => confirmFunding(phase.plan)}
              disabled={!phase.plan.gasless}
              className={BORROW_PILL_CLASS}
            >
              Buy {formatSol(phase.plan.expectedLamports)} SOL
            </button>
          ) : (
            <button
              type="button"
              onClick={() => runRoute(primary.key)}
              disabled={busy}
              className={BORROW_PILL_CLASS}
            >
              {phase.kind === "quoting"
                ? "Pricing…"
                : phase.kind === "buying"
                  ? "Buying SOL…"
                  : phase.kind === "onramp"
                    ? "Funding window open…"
                    : phase.kind === "awaiting"
                      ? "Waiting for SOL…"
                      : phase.kind === "settling"
                        ? depositing
                          ? "Depositing…"
                          : "Opening position…"
                        : primary.label}
            </button>
          )}
        </div>

        {short && phase.kind !== "confirming" && !busy && (
          <div className="mt-2 flex flex-col gap-1.5">
            {alternatives.map((route) => (
              <button
                key={route.key}
                type="button"
                onClick={() => runRoute(route.key)}
                className="aeras-press w-full rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-white/60 hover:border-white/25 hover:text-white"
              >
                {route.label}
              </button>
            ))}
          </div>
        )}

        {short && phase.kind !== "confirming" && (
          <p className="mt-3 text-center text-[11px] text-white/50">
            {primary.note}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Exported for the callers' own copy, so the two borrow cards describe the same
// figure the same way.
export { lamportsToSol };
