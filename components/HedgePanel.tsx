"use client";

// Hedge surface. A user long a tokenized stock opens an offsetting short
// without selling the stock.
//
// Two venues, switched at the top. Lighter is the default and is the body of
// this file. Ondo lives in components/OndoHedgeSection.tsx rather than behind a
// shared abstraction, because the venues differ in ways worth showing rather
// than hiding: Lighter takes USDC margin and has its own candles, Ondo accepts
// the tokenized stock itself as margin and carries a second way a hedge ends
// (collateral auto-exchange, which is not liquidation). A common component
// would have to suppress all of that to fit both.
//
// The panel is organized around one row per holding, because the decision the
// user is making is per holding: this position, how much of it, offset or not.
// Portfolio-level coverage sits at the top as context, not as a control, since
// there is no single order that hedges a basket.
//
// It renders dark in both app themes. This is the only surface in Aeras that
// does. A hedge is priced against a live order book and read in a glance next to
// the venue's own screen, so it borrows that convention: near-black ground,
// tabular figures, colour reserved for direction and state rather than for
// decoration.
//
// Two things are stated rather than implied, both because getting them wrong
// costs the user money. Margin is the user's own USDC on Lighter and is separate
// from the wallet balance shown elsewhere in the app. And a hedge is liquidated
// exactly when the stock it offsets has risen, so the liquidation distance is
// presented as a number to size collateral against, not as a safety rating.

import { useMemo, useState } from "react";

import { LighterChart } from "@/components/LighterChart";
import { OndoMarketsCard } from "@/components/OndoMarketsCard";
import { AssetLogo } from "@/components/AssetLogo";
import { assetIdentity, XSTOCKS } from "@/lib/jupiter/xstocks";
import { OndoHedgeSection } from "@/components/OndoHedgeSection";
import { OneClickHedge } from "@/components/OneClickHedge";
import { LighterWithdrawCard } from "@/components/LighterWithdrawCard";
import { Sparkline } from "@/components/Sparkline";
import { useOndoHedge } from "@/lib/ondo/use-ondo-hedge";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useEmbeddedSolanaWallet } from "@/lib/privy/solana";
import { useVaultCollateral } from "@/lib/borrow/use-vault-collateral";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { AccountBalances } from "@/lib/solana/balances";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import type { HedgeView } from "@/lib/lighter/exposure";
import { closeHedge, placeHedge } from "@/lib/lighter/order";
import {
  estimateFundingFromInterest,
  liquidationDistance,
  liquidationPrice,
  marginForLeverage,
} from "@/lib/lighter/risk";
import { computeHedgeSize } from "@/lib/lighter/sizing";
import { useHedge } from "@/lib/lighter/use-hedge";
import { useSparklines } from "@/lib/lighter/use-candles";
import { useMarginFunding } from "@/lib/lighter/use-margin-funding";

interface Props {
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  scan: WalletScan;
}

// Leverage the hedge is opened at. 2x rather than the market maximum: a hedge
// held against a stock is a long-lived position, and the margin saved by opening
// it at 20x is the same margin that keeps it alive through a rally.
const HEDGE_LEVERAGE = 2;

const RATIOS = [0.25, 0.5, 0.75, 1] as const;

type Status =
  | { kind: "idle" }
  | { kind: "working"; symbol: string }
  | { kind: "registering"; txHash: string }
  | { kind: "done"; symbol: string; txHash: string }
  | { kind: "error"; message: string };

import { GLASS_SURFACE, INSET_PANEL } from "@/lib/ui/surface";

const PANEL = INSET_PANEL;
const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.14em] text-white/35";

type Venue = "lighter" | "ondo";

// Lighter first because it is the venue that is fully wired: permissionless,
// zero fees, and margin funded natively from Solana. Ondo is the one that
// accepts the stock itself as collateral, which costs an Ethereum leg.
const VENUES: { id: Venue; label: string }[] = [
  { id: "lighter", label: "Lighter" },
  { id: "ondo", label: "Ondo" },
];

export function HedgePanel({ balances, prices, scan }: Props) {
  const wallet = useEmbeddedEvmWallet();
  const { address: solanaAddress } = useEmbeddedSolanaWallet();

  // Stock posted as Jupiter borrow collateral still counts as hedgeable
  // exposure. Without this, the borrow-funded hedge removes its own row the
  // moment it deposits the stock, and a user whose funding leg stalled has no
  // surface left to finish the short from.
  const vaultCollateral = useVaultCollateral(solanaAddress);
  const vaultCollateralAtomic = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [mint, c] of Object.entries(vaultCollateral.byMint)) {
      out[mint] = c.atomic;
    }
    return out;
  }, [vaultCollateral.byMint]);

  const hedge = useHedge({
    l1Address: wallet.address,
    balances,
    prices,
    vaultCollateralAtomic,
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Lighter is the default venue. Ondo held this slot while it was the venue
  // that could post the stock as its own margin, but its API now answers 502
  // and the borrow-funded flow gives Lighter the same self-funding property
  // (borrow against the stock, margin with the proceeds), so defaulting to
  // Ondo bought four failed requests per page load and nothing else.
  const [venue, setVenue] = useState<Venue>("lighter");

  // The margin deposit and withdraw forms, opened from the stat strip's Add
  // and Withdraw buttons. One at a time: both describe the same balance.
  const [marginOpen, setMarginOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  // Both hooks run, because hooks cannot be called conditionally, but the Ondo
  // one no-ops while another venue is selected rather than holding a session
  // open and polling a catalog nobody is looking at.
  const ondo = useOndoHedge({
    evmAddress: wallet.address,
    balances,
    prices,
    enabled: venue === "ondo",
  });

  const margin = useMarginFunding({
    balances,
    scan,
    depositAddress: hedge.state?.depositAddress,
  });

  const collateralUsd = Number(hedge.state?.detail?.availableBalanceUsd ?? "0");

  // Which holding the big chart is showing. Held as a mint rather than a market
  // id so a holding whose market is missing can still be selected and explain
  // itself, and so the choice survives the catalog reloading underneath it.
  const [selectedMint, setSelectedMint] = useState<string | null>(null);

  const charted =
    hedge.views.find((view) => view.holding.mint === selectedMint) ??
    // Default to the largest exposure that has a market. That is the position
    // most worth watching and the one a user is most likely to hedge first.
    hedge.views.find((view) => view.market) ??
    hedge.views[0] ??
    null;

  const sparklineIds = useMemo(
    () =>
      hedge.views
        .map((view) => view.market?.marketId)
        .filter((id): id is number => id != null),
    [hedge.views],
  );
  const sparklines = useSparklines(sparklineIds);

  async function withProvider(
    symbol: string,
    run: (provider: Awaited<ReturnType<typeof wallet.getProvider>>) => Promise<void>,
  ) {
    setStatus({ kind: "working", symbol });
    try {
      const provider = await wallet.getProvider();
      await run(provider);
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onOpen(view: HedgeView, ratio: number) {
    if (!wallet.address || !view.market) return;
    const market = view.market;

    await withProvider(view.holding.xstockSymbol, async (provider) => {
      const outcome = await placeHedge({
        provider,
        l1Address: wallet.address as string,
        market,
        quantity: view.holding.quantity,
        tokenPriceUsd: String(view.holding.tokenPriceUsd),
        hedgeRatio: ratio,
      });

      if (outcome.kind === "submitted") {
        setStatus({
          kind: "done",
          symbol: view.holding.xstockSymbol,
          txHash: outcome.txHash,
        });
        await hedge.refresh();
      } else if (outcome.kind === "key-registering") {
        setStatus({ kind: "registering", txHash: outcome.txHash });
      } else if (outcome.kind === "too-small") {
        setStatus({
          kind: "error",
          message:
            outcome.size.limitedBy === "below-min-notional"
              ? `That hedge is under Lighter's ${market.minQuoteAmount} USD order minimum.`
              : `That hedge is smaller than the minimum order size for ${market.symbol}.`,
        });
      } else {
        setStatus({ kind: "error", message: outcome.reason });
      }
    });
  }

  async function onClose(view: HedgeView) {
    if (!wallet.address || !view.market || !view.position) return;
    const market = view.market;
    const size = view.position.size;

    await withProvider(view.holding.xstockSymbol, async (provider) => {
      const outcome = await closeHedge({
        provider,
        l1Address: wallet.address as string,
        market,
        size,
      });

      if (outcome.kind === "submitted") {
        setStatus({
          kind: "done",
          symbol: view.holding.xstockSymbol,
          txHash: outcome.txHash,
        });
        await hedge.refresh();
      } else if (outcome.kind === "key-registering") {
        setStatus({ kind: "registering", txHash: outcome.txHash });
      } else if (outcome.kind === "not-ready") {
        setStatus({ kind: "error", message: outcome.reason });
      }
    });
  }

  return (
    <div className={`${GLASS_SURFACE} p-4 text-white lg:p-5`}>
      <TopBar
        venue={venue}
        onVenue={setVenue}
        refreshing={venue === "ondo" ? ondo.refreshing : hedge.refreshing}
        onRefresh={() =>
          void (venue === "ondo" ? ondo.refresh() : hedge.refresh())
        }
      />

      {venue === "ondo" ? (
        <div className="mt-3 space-y-3">
          <OndoMarketsCard />
          <OndoHedgeSection hedge={ondo} />
        </div>
      ) : (
        // Called, not rendered as <LighterBody />. A function declared inside a
        // component is a new function identity on every render, so React would
        // treat it as a different component type each time and remount the
        // whole subtree, resetting the open/ratio state inside every row. A
        // plain call returns the same JSX with no component boundary at all.
        LighterBody()
      )}
    </div>
  );

  // The Lighter surface, unchanged. Kept as a closure rather than lifted to its
  // own component so the venue switch stays a small change to this file and
  // nothing about the existing layout, state or handlers moves.
  function LighterBody() {
    return (
      <>
      <StatStrip
        exposureUsd={hedge.totals.exposureUsd}
        shortNotionalUsd={hedge.totals.shortNotionalUsd}
        coverageRatio={hedge.totals.coverageRatio}
        collateralUsd={collateralUsd}
        walletUsd={margin.funding.readyUsd}
        onAddMargin={
          hedge.onboarding.status === "no-wallet"
            ? undefined
            : () => {
                setWithdrawOpen(false);
                setMarginOpen(true);
              }
        }
        onWithdrawMargin={
          // Withdrawing needs an account with margin in it; before that the
          // button would only open a form that refuses.
          hedge.state?.account && collateralUsd > 0
            ? () => {
                setMarginOpen(false);
                setWithdrawOpen(true);
              }
            : undefined
        }
      />

      <div className="mt-3 space-y-3">
        {hedge.error && <Notice tone="error">{hedge.error}</Notice>}
        {status.kind === "error" && <Notice tone="error">{status.message}</Notice>}
        {status.kind === "registering" && (
          <Notice tone="info">
            Your trading key is being registered on Lighter. This takes a few
            seconds. Refresh and place the hedge again once it lands.
          </Notice>
        )}
        {status.kind === "done" && (
          <Notice tone="success">
            {status.symbol} hedge submitted. Lighter transaction{" "}
            <span className="font-mono">{status.txHash.slice(0, 10)}…</span>
          </Notice>
        )}

        {hedge.onboarding.status === "no-wallet" ? (
          <div className={`${PANEL} p-4 text-sm text-white/45`}>
            Waiting for the embedded wallet to provision.
          </div>
        ) : (
          <MarginCard
            margin={margin}
            needsAccount={hedge.onboarding.status === "needs-deposit"}
            open={marginOpen}
            onClose={() => setMarginOpen(false)}
          />
        )}
        {withdrawOpen && hedge.onboarding.status !== "no-wallet" && (
          <LighterWithdrawCard
            accountIndex={hedge.state?.account?.index}
            availableUsd={collateralUsd}
            solanaUsdcAtomic={balances?.usdcAtomic ?? "0"}
            onClose={() => setWithdrawOpen(false)}
            onSettled={() => void hedge.refresh()}
          />
        )}

        {hedge.loading ? (
          <div className={`${PANEL} p-4 text-sm text-white/45`}>
            Loading markets and positions.
          </div>
        ) : hedge.views.length === 0 ? (
          <div className={`${PANEL} p-4`}>
            <h3 className="text-sm font-medium text-white">Nothing to hedge yet</h3>
            <p className="mt-1 text-sm text-white/45">
              Buy a tokenized stock and it will appear here with the market that
              offsets it.
            </p>
          </div>
        ) : (
          <>
            {charted && (
              <LighterChart
                marketId={charted.market?.marketId ?? null}
                symbol={charted.route.market}
                markPrice={
                  charted.market ? Number(charted.market.markPrice) : undefined
                }
                // The line that ends the hedge. Drawn only when a short is open,
                // because on a market with no position it would be a price with
                // no meaning.
                marker={
                  charted.position
                    ? {
                        price: Number(charted.position.liquidationPriceUsd),
                        label: "Liq",
                      }
                    : undefined
                }
              />
            )}

            <div className="@container divide-y divide-white/10 border-t border-white/10">
              <RowHeader />
                {hedge.views.map((view) => (
                  <HedgeRow
                    key={view.holding.mint}
                    view={view}
                    collateralUsd={collateralUsd}
                    busy={
                      status.kind === "working" &&
                      status.symbol === view.holding.xstockSymbol
                    }
                    sparkline={
                      view.market ? sparklines[view.market.marketId] : undefined
                    }
                    selected={charted?.holding.mint === view.holding.mint}
                    onSelect={() => setSelectedMint(view.holding.mint)}
                    onOpen={(ratio) => onOpen(view, ratio)}
                    onClose={() => onClose(view)}
                    depositAddress={hedge.state?.depositAddress}
                    onBorrowed={() => {
                      // The whole wallet holding just became vault collateral.
                      // Registered synchronously so the next balance poll
                      // cannot filter the row out from under the running flow.
                      const x = XSTOCKS.find(
                        (entry) => entry.mint === view.holding.mint,
                      );
                      const quantity =
                        view.holding.walletQuantity ?? view.holding.quantity;
                      if (x && Number(quantity) > 0) {
                        vaultCollateral.noteDeposit(
                          view.holding.mint,
                          BigInt(
                            Math.floor(Number(quantity) * 10 ** x.decimals),
                          ).toString(),
                          x.decimals,
                        );
                      }
                    }}
                    onFunded={() => {
                      vaultCollateral.refresh();
                      void hedge.refresh();
                    }}
                  />
                ))}
            </div>
          </>
        )}

        <Disclosure />
      </div>
      </>
    );
  }
}

function TopBar({
  venue,
  onVenue,
  refreshing,
  onRefresh,
}: {
  venue: Venue;
  onVenue: (v: Venue) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-medium tracking-tight text-white">Hedge</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-white/10 p-0.5">
          {VENUES.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onVenue(v.id)}
              className={`rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                venue === v.id
                  ? "bg-white/10 text-white"
                  : "text-white/45 hover:text-white/70"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
        >
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

function StatStrip({
  exposureUsd,
  shortNotionalUsd,
  coverageRatio,
  collateralUsd,
  walletUsd,
  onAddMargin,
  onWithdrawMargin,
}: {
  exposureUsd: number;
  shortNotionalUsd: number;
  coverageRatio: number;
  collateralUsd: number;
  walletUsd: number;
  onAddMargin?: () => void;
  onWithdrawMargin?: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-white/[0.07] py-3 lg:grid-cols-4">
      <Metric label="Hedgeable exposure" value={usd(exposureUsd)} />
      <Metric label="Currently offset" value={usd(shortNotionalUsd)} />
      <Metric
        label="Coverage"
        value={exposureUsd > 0 ? percent(coverageRatio) : "—"}
      />
      {/* The margin stat carries its own action. Funding used to be a separate
          bar below this strip saying the same two numbers over again; the stat
          is where the eye already goes when margin is short, so the button
          belongs on it. */}
      <div>
        <div className={LABEL}>Margin available</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-base tabular-nums text-white">
            {usd(collateralUsd)}
          </span>
          {onAddMargin && (
            <button
              type="button"
              onClick={onAddMargin}
              className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white"
            >
              Add
            </button>
          )}
          {onWithdrawMargin && (
            <button
              type="button"
              onClick={onWithdrawMargin}
              className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white"
            >
              Withdraw
            </button>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-white/30">
          {usd(walletUsd)} USDC in wallet
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? "text-emerald-400"
      : tone === "negative"
        ? "text-red-400"
        : "text-white";
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className={`mt-1 font-mono text-base tabular-nums ${color}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-white/30">{hint}</div>}
    </div>
  );
}

// Funding margin, in the app.
//
// The old version of this card printed Lighter's deposit address and asked the
// user to send USDC to it by hand. The address is a bare token account, so that
// was both a chore and a way to lose funds to a mistyped character. The wallet
// is already connected and the address is already known, so the transfer is ours
// to make.
function MarginCard({
  margin,
  needsAccount,
  open,
  onClose,
}: {
  margin: ReturnType<typeof useMarginFunding>;
  needsAccount: boolean;
  // Controlled by the Add button on the stat strip. The card renders nothing
  // when closed: its two figures already live on the strip, and repeating them
  // in a bar of their own pushed the hedge rows below the fold.
  open: boolean;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const { funding, block, status } = margin;

  const showForm = needsAccount || open;

  const entered = Number(amount);
  const overBalance = entered > funding.readyUsd;
  const underMinimum = entered > 0 && entered < funding.minimumUsd;
  const canSubmit =
    margin.ready &&
    status.kind !== "sending" &&
    entered > 0 &&
    !overBalance &&
    !underMinimum;

  if (!showForm) return null;

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-white">
            {needsAccount ? "Fund your Lighter margin" : "Add margin"}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-white/45">
            Hedges are margined with USDC held on Lighter, which is separate from
            the USDC in your wallet. This moves it for you and credits in about
            15 to 20 minutes.
          </p>
        </div>
        {!needsAccount && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-white/35 transition-colors hover:text-white/70"
          >
            Close
          </button>
        )}
      </div>

      {status.kind === "sent" ? (
        <div className="mt-3">
          <Notice tone="success">
            {usd(Number(amount))} USDC sent to Lighter. Solana signature{" "}
            <span className="font-mono">{status.signature.slice(0, 10)}…</span>.
            Your margin appears once Lighter credits it.
          </Notice>
          <button
            type="button"
            onClick={() => {
              setAmount("");
              margin.reset();
            }}
            className="mt-2 text-xs text-white/40 transition-colors hover:text-white/70"
          >
            Send more
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[180px] flex-1 items-center rounded-lg border border-white/10 bg-black/40 px-3 py-2 focus-within:border-white/25">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0.00"
                className="w-full bg-transparent font-mono text-base tabular-nums text-white outline-none placeholder:text-white/20"
              />
              <span className="ml-2 text-xs text-white/35">USDC</span>
            </div>
            {([0.25, 0.5, 1] as const).map((fraction) => (
              <button
                key={fraction}
                type="button"
                onClick={() =>
                  setAmount(String(Math.floor(funding.readyUsd * fraction * 100) / 100))
                }
                disabled={funding.readyUsd <= 0}
                className="rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white disabled:opacity-30"
              >
                {fraction === 1 ? "Max" : `${fraction * 100}%`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void margin.deposit(amount)}
              disabled={!canSubmit}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {status.kind === "sending" ? "Sending…" : "Deposit"}
            </button>
          </div>

          <div className="mt-2 text-[11px] text-white/35">
            {overBalance
              ? `That is more than the ${usd(funding.readyUsd)} USDC in your wallet.`
              : underMinimum
                ? `Lighter's minimum deposit is ${usd(funding.minimumUsd)}.`
                : `${usd(funding.readyUsd)} USDC available on Solana.`}
          </div>

          {status.kind === "error" && (
            <div className="mt-3">
              <Notice tone="error">{status.message}</Notice>
            </div>
          )}

          {block.kind === "bridge-first" && (
            <div className="mt-3">
              <Notice tone="info">
                You hold {usd(block.bridgeableUsd)} USDC off Solana. Move it to
                your Solana wallet and it becomes available here.
              </Notice>
            </div>
          )}

          {funding.sources.some((s) => s.route === "bridge-then-transfer") && (
            <div className="mt-3 space-y-1">
              <div className={LABEL}>Elsewhere</div>
              {funding.sources
                .filter((s) => s.route === "bridge-then-transfer")
                .map((source) => (
                  <div
                    key={source.chain}
                    className="flex items-center justify-between text-xs text-white/45"
                  >
                    <span>{source.chainLabel}</span>
                    <span className="font-mono tabular-nums">
                      {usd(source.amountUsd)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Fixed-width, right-aligned numeric columns shared by the header and every
// row so the figures align down the list, exactly as the Borrow list does.
// Drops are on CONTAINER width, not viewport, matching that precedent.
const COL_EXPOSURE = "w-24 shrink-0 text-right";
const COL_SHORT = "hidden w-24 shrink-0 text-right @md:block";
const COL_PRICE = "hidden w-24 shrink-0 text-right @xl:block";

// The action column, reserved at its WIDEST state: a hedged row shows Close
// beside the action button, and the action button is at its longest while busy
// ("Working…"). Sized to that rather than to the common case, because the
// column is shrink-0 and right-aligned, so anything wider than the reserve
// overflows leftward and lands on top of the Price figure.
const COL_ACTIONS = "w-[11.5rem] shrink-0";
// Fixed floor so the label going Hedge -> Working… -> Add does not resize the
// button and shuffle the row under the cursor mid-click.
const ACTION_BUTTON_MIN = "min-w-[6.5rem]";

function RowHeader() {
  return (
    <div className="flex items-center gap-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
      <div className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">Holding</div>
      <div className="hidden w-[60px] shrink-0 @3xl:block" />
      <div className={COL_EXPOSURE}>Exposure</div>
      <div className={COL_SHORT}>Short</div>
      <div className={COL_PRICE}>Price</div>
      <div className={COL_ACTIONS} />
    </div>
  );
}

function HedgeRow({
  view,
  collateralUsd,
  busy,
  sparkline,
  selected,
  onSelect,
  onOpen,
  onClose,
  depositAddress,
  onFunded,
  onBorrowed,
}: {
  view: HedgeView;
  collateralUsd: number;
  busy: boolean;
  sparkline: number[] | undefined;
  selected: boolean;
  onSelect: () => void;
  onOpen: (ratio: number) => void;
  onClose: () => void;
  depositAddress: string | undefined;
  onFunded: () => void;
  onBorrowed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState<number>(1);

  const { holding, market, position, route } = view;

  return (
    <div className={selected ? "bg-white/[0.03]" : ""}>
      {/* The whole row is the chart selector, with the Borrow list's hover
          wash. The action pills sit inside it and stop propagation, because a
          row that swaps the chart and a button that opens a ticket are
          different intents that happen to share pixels. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect();
        }}
        className="flex w-full cursor-pointer items-center gap-3 py-4 text-left transition-colors hover:bg-white/5"
      >
        <AssetLogo
          xstock={assetIdentity(holding.mint, holding.xstockSymbol)}
          size={32}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-sm font-medium tracking-tight ${
                selected ? "text-white" : "text-white/80"
              }`}
            >
              {holding.xstockSymbol}
            </span>
            <CoverageTag view={view} />
          </div>
          <div className="mt-0.5 truncate text-[11px] text-white/50">
            <span className="font-mono tabular-nums">
              {trim(holding.quantity)}
            </span>{" "}
            tokens · {route.market}
            {market ? "" : " · not tradeable"}
          </div>
        </div>

        <div className="hidden w-[60px] shrink-0 @3xl:block">
          <Sparkline values={sparkline} />
        </div>

        <div
          className={`${COL_EXPOSURE} font-mono text-sm tabular-nums text-white`}
        >
          {usd(holding.exposureUsd)}
        </div>

        <div className={COL_SHORT}>
          {position ? (
            <span className="font-mono text-sm tabular-nums text-white/90">
              {usd(Number(position.notionalUsd))}
            </span>
          ) : (
            <span className="font-mono text-sm tabular-nums text-white/30">
              —
            </span>
          )}
        </div>

        <div
          className={`${COL_PRICE} font-mono text-sm tabular-nums text-white/90`}
        >
          {market ? usd(Number(market.markPrice)) : "—"}
        </div>

        <div className={`flex ${COL_ACTIONS} items-center justify-end gap-2`}>
          {position && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              disabled={busy}
              className="rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Close
            </button>
          )}
          {market && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
                setOpen((v) => !v);
              }}
              disabled={busy}
              className={`${ACTION_BUTTON_MIN} rounded-full bg-aeras-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {busy ? "Working…" : position ? "Add" : "Hedge"}
            </button>
          )}
        </div>
      </div>

      {position && (
        <div className="mb-3 grid grid-cols-2 gap-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 lg:grid-cols-4">
          <Metric label="Short" value={`${trim(position.size)} ${route.market}`} />
          <Metric label="Entry" value={usd(Number(position.entryPriceUsd))} />
          <Metric
            label="Liquidation"
            value={usd(Number(position.liquidationPriceUsd))}
            // Distance from the LIVE mark, not the entry: the entry is history,
            // and what the user is sizing against is how far the market can
            // still move before the hedge is taken out.
            hint={
              market && Number(market.markPrice) > 0
                ? `${
                    Number(position.liquidationPriceUsd) >=
                    Number(market.markPrice)
                      ? "rise"
                      : "drop"
                  } of ${percent(
                    Math.abs(
                      Number(position.liquidationPriceUsd) -
                        Number(market.markPrice),
                    ) / Number(market.markPrice),
                  )} away`
                : undefined
            }
          />
          <Metric
            label="Unrealized"
            value={usd(Number(position.unrealizedPnlUsd))}
            tone={
              Number(position.unrealizedPnlUsd) >= 0 ? "positive" : "negative"
            }
          />
        </div>
      )}

      {open && market && (
        <HedgeForm
          view={view}
          ratio={ratio}
          onRatio={setRatio}
          collateralUsd={collateralUsd}
          busy={busy}
          depositAddress={depositAddress}
          onFunded={onFunded}
          onBorrowed={onBorrowed}
          onConfirm={() => {
            setOpen(false);
            onOpen(ratio);
          }}
        />
      )}
    </div>
  );
}

function HedgeForm({
  view,
  ratio,
  onRatio,
  collateralUsd,
  busy,
  depositAddress,
  onFunded,
  onBorrowed,
  onConfirm,
}: {
  view: HedgeView;
  ratio: number;
  onRatio: (r: number) => void;
  collateralUsd: number;
  busy: boolean;
  depositAddress: string | undefined;
  onFunded: () => void;
  onBorrowed: () => void;
  onConfirm: () => void;
}) {
  const market = view.market;
  if (!market) return null;

  // Sized with the same function that builds the order, so the preview cannot
  // disagree with what is submitted.
  const size = computeHedgeSize({
    quantity: view.holding.quantity,
    tokenPriceUsd: String(view.holding.tokenPriceUsd),
    hedgeRatio: ratio,
    marketPriceUsd: market.markPrice,
    sizeDecimals: market.sizeDecimals,
    minBaseAmount: market.minBaseAmount,
    minQuoteAmount: market.minQuoteAmount,
    orderQuoteLimit: market.orderQuoteLimit,
  });

  const notionalUsd = Number(size.notionalUsd);
  const margin = marginForLeverage(notionalUsd, HEDGE_LEVERAGE, market);
  const liqInputs = {
    entryPriceUsd: Number(market.markPrice),
    size: Number(size.size),
    collateralUsd: margin.marginUsd,
    isShort: true,
    market,
  };
  const liqPrice = liquidationPrice(liqInputs);
  const distance = liquidationDistance(liqInputs);
  const funding = estimateFundingFromInterest(notionalUsd, market, true);
  const affordable = margin.marginUsd <= collateralUsd;
  const tooSmall = size.baseAmount === "0";

  return (
    <div className="mb-4 space-y-4 rounded-xl border border-white/10 bg-white/5 p-5">
      <div>
        <div className={LABEL}>How much to offset</div>
        <div className="mt-2 flex gap-2">
          {RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRatio(r)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                r === ratio
                  ? "border-white/25 bg-white/10 text-white"
                  : "border-white/10 text-white/45 hover:border-white/20 hover:text-white/80"
              }`}
            >
              {Math.round(r * 100)}%
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Metric
          label="Short size"
          value={tooSmall ? "—" : `${trim(size.size)} ${market.symbol}`}
        />
        <Metric label="Notional" value={usd(notionalUsd)} />
        <Metric
          label="Margin"
          value={usd(margin.marginUsd)}
          hint={`${margin.leverage}x`}
        />
        {/* A short is liquidated by a rally, so the distance is a rise. The
            hint keeps the direction visible where a bare price would read as
            just another number. */}
        <Metric
          label="Liquidation"
          value={liqPrice !== null && !tooSmall ? usd(liqPrice) : "—"}
          hint={
            distance !== null && !tooSmall
              ? `if ${market.symbol} rises ${percent(distance)}`
              : undefined
          }
        />
        <Metric
          label="Funding"
          value={`${funding.annualizedPercent >= 0 ? "" : "+"}${Math.abs(
            funding.annualizedPercent,
          ).toFixed(2)}%`}
          hint={funding.annualizedPercent < 0 ? "received, est" : "paid, est"}
          tone={funding.annualizedPercent < 0 ? "positive" : undefined}
        />
      </div>

      {view.route.match === "proxy" && view.route.basis && (
        <p className="text-[11px] leading-relaxed text-white/40">
          {view.route.basis}
        </p>
      )}

      {size.limitedBy === "quote-limit" && (
        <p className="text-[11px] leading-relaxed text-white/40">
          Capped at Lighter&apos;s per-order limit, so this offsets{" "}
          {percent(size.effectiveRatio)} of the holding. Place another to cover
          the rest.
        </p>
      )}

      {!affordable && !tooSmall && (
        <>
          {/* The fact, stated plainly. When the asset can borrow against
              itself the section below offers the way out; when it cannot,
              this stands alone and adding margin above is the only path, so
              the sentence must not promise more than the row can deliver. */}
          <Notice tone="info">
            This needs {usd(margin.marginUsd)} of margin and you have{" "}
            {usd(collateralUsd)} on Lighter.
          </Notice>
        </>
      )}
      {/* Mounted OUTSIDE the affordability gate on purpose. A run in flight
          flips both affordable (margin credits) and tooSmall (the wallet
          empties into the vault), and gating the component on either used to
          unmount the progress box and the outcome mid-run. The component
          gates its own idle offer on offerBorrow instead. */}
      <OneClickHedge
        xstockSymbol={view.holding.xstockSymbol}
        mint={view.holding.mint}
        // Wallet stock only. The merged quantity includes collateral that
        // is already in the vault, and a borrow can only deposit what the
        // wallet still holds.
        quantity={view.holding.walletQuantity ?? view.holding.quantity}
        totalQuantity={view.holding.quantity}
        tokenPriceUsd={view.holding.tokenPriceUsd}
        market={market}
        hedgeRoute={view.route}
        depositAddress={depositAddress}
        onSettled={onFunded}
        onBorrowed={onBorrowed}
        offerBorrow={!affordable && !tooSmall}
      />

      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || tooSmall || !affordable}
        className="w-full rounded-xl bg-red-500/90 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
      >
        {tooSmall
          ? "Below the minimum order size"
          : `Short ${usd(notionalUsd)} of ${market.symbol}`}
      </button>
    </div>
  );
}

function CoverageTag({ view }: { view: HedgeView }) {
  const label =
    view.coverage === "hedged"
      ? "Hedged"
      : view.coverage === "partial"
        ? `${percent(view.coverageRatio)}`
        : view.coverage === "over-hedged"
          ? "Over-hedged"
          : "Unhedged";

  const tone =
    view.coverage === "hedged"
      ? "bg-emerald-400/10 text-emerald-400"
      : view.coverage === "over-hedged"
        ? "bg-amber-400/10 text-amber-400"
        : view.coverage === "partial"
          ? "bg-white/10 text-white/70"
          : "bg-white/[0.06] text-white/40";

  return (
    <span
      className={`rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wider tabular-nums ${tone}`}
    >
      {label}
    </span>
  );
}

function Disclosure() {
  return (
    <p className="text-[11px] leading-relaxed text-white/30">
      Hedges are perpetual futures on Lighter, margined with USDC you hold there.
      A perp tracks the underlying but is a separate instrument with its own
      funding and its own liquidation risk, and it does not settle against the
      tokenized stock in your wallet. Closing a hedge realizes its profit or loss
      in USDC.
    </p>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "info" | "success";
  children: React.ReactNode;
}) {
  const style =
    tone === "error"
      ? "border-red-500/25 bg-red-500/10 text-red-300"
      : tone === "success"
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
        : "border-white/15 bg-white/[0.06] text-white/70";

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${style}`}>
      {children}
    </div>
  );
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function percent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(0)}%`;
}

// Trailing zeros on an 8-decimal token amount are noise in a row of figures.
function trim(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
