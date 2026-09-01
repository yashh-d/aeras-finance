"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AmountField } from "@/components/AmountField";
import { FundMenu, type FundGroup } from "@/components/FundMenu";
import {
  LAMPORTS_PER_SOL,
  SOLSCAN_TX_BASE,
  SOL_DECIMALS,
  SOL_MINT,
  ULTRA_MIN_USD,
  USDC_DECIMALS,
  USDC_MINT,
} from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import {
  executeUltraOrder,
  fetchUltraOrderViaProxy,
  fromAtomic,
  toAtomic,
  type UltraOrderResponse,
} from "@/lib/jupiter/ultra";
import type { XStock } from "@/lib/jupiter/xstocks";
import {
  bestPayAsset,
  payAssets,
  type PayAsset,
} from "@/lib/jupiter/pay-assets";
import { bridgeUsdcToSolana } from "@/lib/jupiter/pay-bridge";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import {
  atomicToUiString,
  type AccountBalances,
} from "@/lib/solana/balances";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";

// Chain marks for the pay-with menu's group headers.
const CHAIN_LOGOS: Record<string, string> = {
  Solana: "/logos/solana.png",
  Ethereum: "/logos/eth.png",
  "BNB Chain": "/logos/bnb.png",
  Base: "/logos/eth.png",
};

// Native gas token per source chain, named in the gas-shortfall message.
const NATIVE_SYMBOL: Record<string, string> = {
  "1": "ETH",
  "56": "BNB",
  "8453": "ETH",
};

type QuoteAsset = "USDC" | "SOL";
type Direction = "buy" | "sell";

type Status =
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "quoted"; quote: UltraOrderResponse }
  | { kind: "buying" }
  // Leg one of a bridged buy. Held separately from "buying" because it is a
  // different signature on a different chain, and a user watching a wallet
  // prompt should be told which leg it belongs to.
  | { kind: "bridging"; message: string }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string };

export function SwapForm({
  ticker,
  walletAddress,
  prices,
  balances,
  scan,
  onBalanceChange,
  modeToggle,
  autoFocus = false,
}: {
  ticker: XStock;
  walletAddress: string;
  prices: JupiterPriceMap | null;
  balances: AccountBalances | null;
  // The shared cross-chain scan. Only the off-Solana USDC is used, and only to
  // offer it as a way to pay; omitted, the ticket simply falls back to what is
  // on Solana.
  scan?: WalletScan;
  onBalanceChange: () => void;
  // Market/limit switch, rendered beside buy/sell rather than in a row of its
  // own. Owned by AssetTradePanel, which is what the switch actually controls.
  modeToggle?: ReactNode;
  autoFocus?: boolean;
}) {
  const [direction, setDirection] = useState<Direction>("buy");
  const [quoteAsset, setQuoteAsset] = useState<QuoteAsset>("USDC");
  // Starts empty, showing a placeholder zero under a blinking caret. A seeded
  // default saves nobody a keystroke: it has to be cleared before any other
  // figure can be typed, and it puts a number on screen the user did not
  // choose.
  const [amountInput, setAmountInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Which held asset a BUY is paid with. Null means "use the default", which is
  // recomputed as balances load rather than frozen at mount.
  const [payId, setPayId] = useState<string | null>(null);
  // Whether the amount field is read as dollars or as tokens. Dollars is the
  // default: "$50 of Tesla" is how someone decides a trade, and expressing it
  // in tokens means dividing by a moving price in their head.
  const [denom, setDenom] = useState<"usd" | "token">("usd");
  const signTxBase64 = useSignSolanaTxBase64();
  const evmWallet = useEmbeddedEvmWallet();

  const solPrice = prices?.[SOL_MINT]?.usdPrice;
  const marketPrice = prices?.[ticker.mint]?.usdPrice;
  const isBuy = direction === "buy";

  // Everything the wallet holds that could pay for this asset, on Solana or a
  // chain away. Selling still pays out in USDC or SOL only, so the quote-asset
  // toggle below is untouched: there is no sense in "selling into" USDC that
  // lives on Ethereum.
  const priceUsdByMint = useMemo(() => {
    const map: Record<string, number | undefined> = {};
    map[SOL_MINT] = solPrice;
    for (const [mint, entry] of Object.entries(prices ?? {})) {
      map[mint] = entry?.usdPrice;
    }
    return map;
  }, [prices, solPrice]);

  const payOptions = useMemo(
    () =>
      payAssets({
        balances,
        priceUsdByMint,
        stables: scan?.stables ?? [],
        buyingMint: ticker.mint,
      }),
    [balances, priceUsdByMint, scan?.stables, ticker.mint],
  );

  const payAsset =
    payOptions.find((a) => a.id === payId) ?? bestPayAsset(payOptions) ?? null;

  // Resolve which side is the input vs output of the swap.
  const quoteMint = quoteAsset === "USDC" ? USDC_MINT : SOL_MINT;
  const quoteDecimals = quoteAsset === "USDC" ? USDC_DECIMALS : SOL_DECIMALS;

  // A bridged source is quoted as the Solana USDC it becomes, because that is
  // what the swap will actually spend once leg one settles. The figure the user
  // types is USDC either way, so the preview is accurate to within the bridge's
  // own loss bound rather than being a different unit.
  const bridged = isBuy && payAsset?.kind === "bridged";
  const payMint = bridged ? USDC_MINT : payAsset?.mint ?? USDC_MINT;
  const payDecimals = bridged ? USDC_DECIMALS : payAsset?.decimals ?? USDC_DECIMALS;

  const inputSymbol = isBuy ? payAsset?.symbol ?? "USDC" : ticker.symbol;
  const inputMint = isBuy ? payMint : ticker.mint;
  const inputDecimals = isBuy ? payDecimals : ticker.decimals;
  const inputBalance = isBuy
    ? payAsset?.balance ?? null
    : balances?.xstocks[ticker.mint] ?? null;
  // The exact balance as a lossless string. Max fills THIS: the display
  // rounding (toFixed) rounds UP for high-decimal mints, so filling it made
  // Max request more than the wallet holds and fail its own check with
  // "Need 0.1188, have 0.1188". SOL has no stored atomic figure, so its float
  // is rendered at full precision instead.
  const inputBalanceExact = !balances
    ? null
    : isBuy
      ? payAsset?.balanceExact ?? null
      : atomicToUiString(
          balances.xstocksAtomic[ticker.mint] ?? "0",
          ticker.decimals,
        );
  const inputPriceUsd = isBuy ? payAsset?.priceUsd ?? null : marketPrice;

  const outputSymbol = isBuy ? ticker.symbol : quoteAsset;
  const outputDecimals = isBuy ? ticker.decimals : quoteDecimals;

  // Minimum input expressed in input units, derived from Jupiter's $5 floor.
  const minInputAmount = inputPriceUsd
    ? ULTRA_MIN_USD / inputPriceUsd
    : isBuy && inputSymbol === "USDC"
      ? ULTRA_MIN_USD
      : 0.05;

  const payAssetId = payAsset?.id ?? null;

  useEffect(() => {
    // Clear whenever the input asset changes: an amount typed in USDC means
    // nothing once the field is denominated in SOL or in the stock itself, and
    // a quote fetched for the old pair is no longer the one on offer. The
    // pay-with asset is part of that identity now, so switching from Solana
    // USDC to gold clears the figure too.
    setAmountInput("");
    setStatus({ kind: "idle" });
  }, [direction, quoteAsset, payAssetId, ticker.mint]);

  // Dollars or tokens, for the figure being typed.
  //
  // Costs nothing upstream: the price map is already polled every 10 seconds
  // and shared across the app, so this is arithmetic on a number we hold, not
  // a quote. Only the interpretation of the field changes; everything below
  // works in token units exactly as before.
  const canPriceInUsd = inputPriceUsd != null && inputPriceUsd > 0;
  const usdMode = denom === "usd" && canPriceInUsd;

  const typedNumber = Number(amountInput);
  // Token units, whatever the field is denominated in. The single value the
  // quote, the minimum and the balance check are all derived from.
  const inputAmount =
    usdMode && Number.isFinite(typedNumber) && inputPriceUsd
      ? typedNumber / inputPriceUsd
      : typedNumber;
  const belowMin = !Number.isFinite(inputAmount) || inputAmount < minInputAmount;
  // Compared in atomic units (toAtomic truncates, matching what the quote
  // will actually request), so an exact-balance Max always passes.
  const insufficient =
    inputBalanceExact != null &&
    Number.isFinite(inputAmount) &&
    BigInt(toAtomic(inputAmount, inputDecimals)) >
      BigInt(toAtomic(Number(inputBalanceExact), inputDecimals));

  async function fetchQuote(): Promise<UltraOrderResponse> {
    const quote = await fetchUltraOrderViaProxy({
      inputMint,
      outputMint: isBuy ? ticker.mint : quoteMint,
      amount: toAtomic(inputAmount, inputDecimals),
      taker: walletAddress,
    });
    if (quote.error || quote.errorMessage) {
      throw new Error(quote.errorMessage ?? quote.error ?? "Quote failed");
    }
    if (!quote.transaction || !quote.requestId) {
      throw new Error("Quote missing transaction or requestId");
    }
    return quote;
  }

  async function handlePreview() {
    setStatus({ kind: "quoting" });
    try {
      // Refresh balances first so the insufficient-balance check uses fresh data.
      onBalanceChange();
      const quote = await fetchQuote();
      setStatus({ kind: "quoted", quote });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleBuy() {
    try {
      // Leg one, when paying with USDC that is not on Solana yet. It settles
      // to the user's OWN wallet, so abandoning the buy after this point
      // leaves spendable Solana USDC rather than anything stranded.
      if (isBuy && payAsset?.kind === "bridged" && payAsset.chain && payAsset.contract) {
        if (!evmWallet.address) {
          throw new Error(
            "No Ethereum wallet available to send this from. Pay with an asset already on Solana instead.",
          );
        }
        setStatus({
          kind: "bridging",
          message: `Bringing ${inputAmount} USDC from ${payAsset.chainLabel} to Solana.`,
        });
        await bridgeUsdcToSolana({
          chain: payAsset.chain,
          chainLabel: payAsset.chainLabel,
          contract: payAsset.contract,
          amountAtomic: BigInt(toAtomic(inputAmount, payAsset.decimals)),
          evm: {
            address: evmWallet.address,
            switchChain: evmWallet.switchChain,
            getProvider: evmWallet.getProvider,
          },
          solanaAddress: walletAddress,
          nativeSymbol: NATIVE_SYMBOL[payAsset.chain] ?? "ETH",
          onProgress: (p) =>
            setStatus({ kind: "bridging", message: p.message }),
        });
        // The swap below quotes against the wallet's fresh Solana USDC.
        onBalanceChange();
      }

      setStatus({ kind: "buying" });
      const fresh = await fetchQuote();
      const signed = await signTxBase64(fresh.transaction!);
      const result = await executeUltraOrder({
        signedTransaction: signed,
        requestId: fresh.requestId,
      });
      if (result.status !== "Success" || !result.signature) {
        throw new Error(result.error ?? "Swap failed");
      }
      // Clear the field before the refreshed balances land.
      //
      // The amount stays whatever was typed, and a moment later the new
      // balances arrive lower, so `insufficient` flips true and a *successful*
      // sell ended with "Not enough TSLAx. You have 0.0000." under it. Selling
      // the whole position hit this every time: the field still held the size
      // that had just been sold. The order is finished, so the amount is spent
      // input, not pending input.
      //
      // Deliberately not folded into reset(): that runs on every keystroke and
      // on Max, where clearing the field would make it impossible to type.
      setAmountInput("");
      setStatus({ kind: "done", signature: result.signature });
      onBalanceChange();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function reset() {
    setStatus({ kind: "idle" });
  }

  const inputAmountFmtDigits = inputSymbol === "USDC" ? 2 : inputSymbol === "SOL" ? 4 : 4;

  // Nothing under the amount unless the amount is actually a problem. The
  // minimum used to be stated at rest, where it told a user something they had
  // not done wrong yet; it now appears only once a figure is typed under it.
  const typedAmount = amountInput !== "" && inputAmount > 0;
  const amountNote = insufficient
    ? `Not enough ${inputSymbol}. You have ${inputBalance?.toFixed(inputAmountFmtDigits)}.`
    : typedAmount && belowMin
      ? `Minimum ~${minInputAmount.toFixed(inputAmountFmtDigits)} ${inputSymbol}.`
      : null;

  // Which of USDC or SOL the trade is denominated in. On a buy this is the
  // unit of the figure being typed, so it renders as that unit; on a sell the
  // figure is in the xStock and this is the payout, which sits lower down.
  const quoteToggle = (
    <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
      {(["USDC", "SOL"] as QuoteAsset[]).map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => setQuoteAsset(a)}
          className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
            quoteAsset === a
              ? "bg-white/10 text-white"
              : "text-white/50 hover:text-white"
          }`}
        >
          {a}
        </button>
      ))}
    </div>
  );

  // What a buy is paid with, grouped by chain in the same shape as the
  // wallet's Fund control. A menu rather than the old two-segment toggle
  // because the answer is no longer two options: it is everything the wallet
  // holds, and on more than one chain.
  const payGroups: FundGroup[] = (() => {
    const byChain = new Map<string, PayAsset[]>();
    for (const a of payOptions) {
      const list = byChain.get(a.chainLabel);
      if (list) list.push(a);
      else byChain.set(a.chainLabel, [a]);
    }
    return [...byChain.entries()].map(([chainLabel, assets]) => ({
      chain: chainLabel,
      chainLogo: CHAIN_LOGOS[chainLabel],
      options: assets.map((a) => ({
        id: a.id,
        label: a.symbol,
        hint:
          (a.balanceUsd === null
            ? `${a.balance.toFixed(4)} held`
            : `$${a.balanceUsd.toFixed(2)}`) +
          (a.kind === "bridged" ? " · bridges to Solana first" : ""),
        logo: a.logo,
        onSelect: () => {
          setPayId(a.id);
          reset();
        },
      })),
    }));
  })();

  const payMenu = (
    <div className="w-32">
      <FundMenu label={payAsset?.symbol ?? "USDC"} groups={payGroups} />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* No asset identity here. Both places this form renders (the Home detail
          and the Markets row expansion) already name the asset directly above
          it, so repeating it was the same line twice on one screen.

          Direction and mode sit on the amount's own row rather than in a strip
          above it, so the ticket opens on the figure instead of on two rows of
          controls. They wrap underneath when the panel is too narrow. */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <AmountField
            id="amount"
            ariaLabel={`Amount to ${direction} in ${inputSymbol}`}
            autoFocus={autoFocus}
            value={amountInput}
            prefix={usdMode ? "$" : undefined}
            onChange={(v) => {
              setAmountInput(v);
              reset();
            }}
            unit={
              isBuy ? (
                payMenu
              ) : (
                <span className="text-sm text-white/40">{inputSymbol}</span>
              )
            }
          />
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
              {(["buy", "sell"] as Direction[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    direction === d
                      ? "bg-aeras-blue text-white"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {d === "buy" ? "Buy" : "Sell"}
                </button>
              ))}
            </div>
            {modeToggle}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/40">
          <span>
            {inputBalance == null
              ? "..."
              : `${inputBalance.toFixed(inputAmountFmtDigits)} ${inputSymbol} available`}
            {inputBalanceExact != null && Number(inputBalanceExact) > 0 && (
              <button
                type="button"
                onClick={() => {
                  // In dollars, Max is the balance's value FLOORED to a cent.
                  // Flooring matters: dividing an unrounded dollar figure back
                  // by the price can land a hair above the balance and fail
                  // its own check with "Need 0.1188, have 0.1188". Floored, the
                  // conversion is always strictly inside what the wallet holds.
                  setAmountInput(
                    usdMode && inputPriceUsd
                      ? String(
                          Math.floor(
                            Number(inputBalanceExact) * inputPriceUsd * 100,
                          ) / 100,
                        )
                      : inputBalanceExact,
                  );
                  reset();
                }}
                className="ml-1.5 text-white/60 underline-offset-2 hover:text-white hover:underline"
              >
                Max
              </button>
            )}
            {/* Dollars or tokens. Only offered when the input has a price;
                without one there is nothing to convert with. */}
            {canPriceInUsd && (
              <span className="ml-2 inline-flex rounded-md border border-white/10 p-0.5 align-middle">
                {(["usd", "token"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      if (d === denom) return;
                      // Carry the figure across rather than clearing it.
                      // Someone who typed $50 and switches to tokens meant the
                      // same trade, and an emptied field reads as a reset.
                      if (amountInput !== "" && Number.isFinite(typedNumber)) {
                        setAmountInput(
                          d === "usd"
                            ? String(
                                Math.floor(inputAmount * (inputPriceUsd ?? 0) * 100) /
                                  100,
                              )
                            : trimTo(inputAmount, inputDecimals),
                        );
                      }
                      setDenom(d);
                      reset();
                    }}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                      denom === d
                        ? "bg-white/10 text-white"
                        : "text-white/40 hover:text-white"
                    }`}
                  >
                    {d === "usd" ? "$" : inputSymbol}
                  </button>
                ))}
              </span>
            )}
          </span>
          {!isBuy && (
            <span className="flex items-center gap-1.5">
              Receive in
              {quoteToggle}
            </span>
          )}
        </div>

        {/* The same figure in the other unit, so the one being typed is never
            the only thing on screen. A dollar amount of a $347 stock is a
            fraction of a token, and that fraction is worth seeing before the
            preview rather than after it. */}
        {typedAmount && canPriceInUsd && inputPriceUsd && (
          <p className="mt-1 text-xs text-white/35">
            {usdMode
              ? `≈ ${trimTo(inputAmount, inputDecimals)} ${inputSymbol}`
              : `≈ $${(inputAmount * inputPriceUsd).toFixed(2)}`}
          </p>
        )}

        {amountNote && (
          <p className="mt-2 text-xs text-aeras-negative">{amountNote}</p>
        )}

        {/* Said before the button, not discovered at the wallet prompt. A
            bridged buy costs gas on the source chain and cannot be atomic; if
            it is abandoned after leg one the money is Solana USDC in the
            user's own wallet, which is worth knowing up front. */}
        {bridged && payAsset && (
          <p className="mt-2 text-xs text-white/45">
            Paying from {payAsset.chainLabel}: this bridges to Solana first, so
            it takes two signatures and costs{" "}
            {NATIVE_SYMBOL[payAsset.chain ?? ""] ?? "ETH"} for gas there. If you
            stop after the bridge, the USDC is in your Solana wallet.
          </p>
        )}
      </div>

      {status.kind === "quoted" && (
        <QuoteCard
          quote={status.quote}
          inputSymbol={inputSymbol}
          inputDecimals={inputDecimals}
          outputSymbol={outputSymbol}
          outputDecimals={outputDecimals}
          marketPrice={isBuy ? marketPrice : undefined}
          solPrice={solPrice}
        />
      )}
      {status.kind === "done" && <SuccessCard signature={status.signature} />}
      {status.kind === "error" && (
        <p className="rounded-lg bg-white/5 px-3 py-2 text-sm text-aeras-negative">
          {status.message}
        </p>
      )}

      {(status.kind === "idle" ||
        status.kind === "quoting" ||
        status.kind === "error") && (
        <button
          type="button"
          onClick={handlePreview}
          disabled={
            belowMin || insufficient || status.kind === "quoting"
          }
          className="aeras-press w-full rounded-lg bg-aeras-blue px-4 py-3 text-sm font-medium text-white hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status.kind === "quoting" ? "Fetching quote..." : "Preview"}
        </button>
      )}

      {status.kind === "quoted" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="aeras-press flex-1 rounded-lg border border-white/10 px-4 py-3 text-sm font-medium text-white/60 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleBuy}
            className="aeras-press flex-1 rounded-lg bg-aeras-blue px-4 py-3 text-sm font-medium text-white hover:bg-aeras-blue-medium"
          >
            {/* A bridged buy is two signatures on two chains, so the button
                says so rather than presenting it as one click. */}
            {!isBuy
              ? "Confirm sell"
              : bridged
                ? `Bring to Solana and buy`
                : "Confirm buy"}
          </button>
        </div>
      )}

      {status.kind === "buying" && (
        <p className="text-center text-sm text-white/50">
          Signing and submitting...
        </p>
      )}

      {status.kind === "bridging" && (
        <p className="text-center text-sm text-white/50">{status.message}</p>
      )}

      {status.kind === "done" && (
        <button
          type="button"
          onClick={reset}
          className="aeras-press w-full rounded-lg border border-white/10 px-4 py-3 text-sm font-medium text-white/60 hover:bg-white/5"
        >
          New order
        </button>
      )}
    </div>
  );
}

function QuoteCard({
  quote,
  inputSymbol,
  inputDecimals,
  outputSymbol,
  outputDecimals,
  marketPrice,
  solPrice,
}: {
  quote: UltraOrderResponse;
  inputSymbol: string;
  inputDecimals: number;
  outputSymbol: string;
  outputDecimals: number;
  marketPrice: number | undefined;
  solPrice: number | undefined;
}) {
  const outAmount = fromAtomic(quote.outAmount, outputDecimals);
  const inAmount = fromAtomic(quote.inAmount, inputDecimals);
  const slippagePct = quote.slippageBps / 100;

  // Effective $/xStock price: USD value of the leg / amount of xStock in that leg.
  // Buys put xStock on the output side; sells put it on the input side.
  const isBuy = inputSymbol === "USDC" || inputSymbol === "SOL";
  const effectivePrice = isBuy
    ? outAmount > 0
      ? quote.inUsdValue / outAmount
      : 0
    : inAmount > 0
      ? quote.outUsdValue / inAmount
      : 0;

  const priceDelta =
    marketPrice && marketPrice > 0
      ? ((effectivePrice - marketPrice) / marketPrice) * 100
      : null;
  const deltaIsPremium = priceDelta != null && priceDelta >= 0;

  const priority = quote.prioritizationFeeLamports ?? 0;
  const signature = quote.signatureFeeLamports ?? 0;
  const rent = quote.rentFeeLamports ?? 0;
  const totalLamports = priority + signature + rent;
  const totalSol = totalLamports / LAMPORTS_PER_SOL;
  const totalUsd = solPrice ? totalSol * solPrice : null;

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <div>
        <div className="flex justify-between">
          <span className="text-white/50">You pay</span>
          <span className="text-white tabular-nums">
            {inAmount.toFixed(inputSymbol === "USDC" ? 2 : 6)} {inputSymbol} ·{" "}
            <span className="text-white/50">${quote.inUsdValue.toFixed(2)}</span>
          </span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-white/50">You receive</span>
          <span className="font-medium text-white tabular-nums">
            {outAmount.toFixed(outputSymbol === "USDC" ? 2 : 6)} {outputSymbol} ·{" "}
            <span className="text-white/50">
              ${quote.outUsdValue.toFixed(2)}
            </span>
          </span>
        </div>
      </div>

      <Divider />

      <Row label="Effective price">
        <span className="tabular-nums">
          ${effectivePrice.toFixed(2)} / {isBuy ? outputSymbol : inputSymbol}
        </span>
      </Row>
      <Row label="Market (Jupiter)">
        <span className="tabular-nums">
          {marketPrice != null ? `$${marketPrice.toFixed(2)}` : "—"}
          {priceDelta != null && (
            <span
              className={`ml-2 ${
                deltaIsPremium ? "text-aeras-negative" : "text-aeras-positive"
              }`}
            >
              {deltaIsPremium ? "+" : ""}
              {priceDelta.toFixed(2)}%
            </span>
          )}
        </span>
      </Row>
      <Row label="Price impact">
        <span className="tabular-nums">
          {(quote.priceImpactPct * 100).toFixed(2)}%
        </span>
      </Row>
      <Row label="Max slippage">
        <span className="tabular-nums">{slippagePct.toFixed(2)}%</span>
      </Row>

      <Divider />

      <div>
        <div className="flex justify-between">
          <span className="text-white/50">
            Network costs{quote.gasless ? " (Jupiter pays)" : ""}
          </span>
          <span className="tabular-nums text-white">
            {totalSol.toFixed(6)} SOL
            {totalUsd != null && (
              <span className="text-white/50"> · ${totalUsd.toFixed(2)}</span>
            )}
          </span>
        </div>
        <div className="mt-1 space-y-0.5 pl-2 text-xs text-white/50">
          <FeeLine label="Priority" lamports={priority} />
          <FeeLine label="Signature" lamports={signature} />
          <FeeLine label="Rent" lamports={rent} />
        </div>
      </div>

      <Divider />

      <Row label="Route">
        <span className="text-white/60">
          {quote.router}
          {quote.swapType ? ` · ${quote.swapType}` : ""}
        </span>
      </Row>
    </div>
  );
}

function FeeLine({ label, lamports }: { label: string; lamports: number }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">
        {(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/50">{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-white/10" />;
}

function SuccessCard({ signature }: { signature: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
      <div className="font-medium text-aeras-positive">Filled</div>
      <a
        href={`${SOLSCAN_TX_BASE}${signature}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block break-all font-mono text-xs text-aeras-positive underline decoration-white/10"
      >
        {signature}
      </a>
    </div>
  );
}

// A token amount at its own precision, with trailing zeros removed. Truncated
// rather than rounded: a figure rounded UP is one the wallet may not hold, and
// switching the field from dollars to tokens must never ask for more than the
// dollar figure it came from.
function trimTo(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const places = Math.min(decimals, 8);
  const factor = 10 ** places;
  const floored = Math.floor(value * factor) / factor;
  const fixed = floored.toFixed(places);
  return fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
}
