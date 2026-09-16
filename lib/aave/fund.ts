"use client";

// Fund an Aave deposit from the user's Solana USDC.
//
// The vault deposit itself (lib/aave/deposit.ts) spends USDC or USDT that is
// already in the Ethereum wallet. This module covers everything that wallet is
// missing: when the asset balance is short it plans and executes a Trustware
// conversion of Solana USDC into the asset on Ethereum, and when the wallet
// holds too little ETH to pay for a full lifecycle it adds a gas leg sized
// from the live gas price (lib/trustware/eth-gas.ts, shared with the gold
// market). Both legs broadcast up front and settle in parallel, then the
// normal deposit runs. Same machinery as lib/morpho/fund.ts pointed at
// Ethereum instead of Monad; the two differences are that the destination
// asset can be USDT (a real swap, priced rather than assumed at par) and that
// gas is a computed amount rather than a fixed 0.5 USDC.
//
// Trustware route shapes, all already allowed by lib/trustware/server.ts:
//   Solana USDC -> Ethereum USDC / USDT / ETH   the swap shape (both sides in
//                                              lib/trustware/swap-tokens.ts)
//   Ethereum USDC / USDT -> Solana USDC        the return shape
// Verified live by scripts/aave-check.mts; see docs/aave.md for the numbers.
//
// The same rules as lib/trustware/execute.ts apply: nothing downstream treats
// funds as delivered before Trustware reports success, and every validation
// that can happen before the user signs does.

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { addBps, atomicToUi } from "@/lib/trustware/amounts";
import {
  fetchTrustwareQuoteViaProxy,
  fetchTrustwareRouteViaProxy,
} from "@/lib/trustware/client";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import {
  needsEthGas as needsEthGasFor,
  planEthGas,
  priceLeg,
  quoteRequest,
  requiredEthWei as requiredEthWeiFor,
  type QuoteFn,
  type TrustwareLeg,
} from "@/lib/trustware/eth-gas";
import {
  executeEvmRoute,
  submitTrustwareReceipt,
  trackTrustwareSettlement,
  type EvmSigner,
  type SolanaSigner,
} from "@/lib/trustware/execute";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
} from "@/lib/trustware/types";

import { ETHEREUM_CHAIN_ID } from "./constants";
import { depositToAaveVault, type AaveTxProgress } from "./deposit";
import type { AaveVault } from "./vaults";

export type { EvmSigner, SolanaSigner } from "@/lib/trustware/execute";

// Sizing headroom over the quoted rate, matching lib/morpho/fund.ts: the rate
// can drift between planning and execution. Any oversend is not lost; it lands
// in the Ethereum wallet and stays the user's.
const FUNDING_HEADROOM_BPS = 150;

// Margin taken off the Solana balance when computing the deposit ceiling.
// Covers the slippage floor, the sizing headroom, and the bridge's fixed fee.
// The plan validates the real number; this only keeps Max honest.
const MAX_BUFFER_BPS = 300;

// Reserved off the Solana balance for the ETH leg when the wallet needs gas.
// The real figure is solved from the live gas price in the plan and can be
// larger; this is what Max leaves aside so an ordinary-gas day does not end in
// a plan that blocks on the last dollar.
const GAS_RESERVE_USDC_ATOMIC = 5_000_000n; // 5 USDC

// Gas units for one full Umbrella lifecycle, which is the more expensive of
// the two kinds: ERC-20 approve (~50k), the helper's deposit (stata wrap plus
// Aave supply plus stake, ~400k), cooldown (~70k), the stake-token approve
// (~50k), the helper's redeem (unstake plus unwrap plus Aave withdraw, ~350k)
// and a reward claim (~150k). A supply vault uses well under half, and paying
// for the larger case means a user who moves from one to the other never
// strands. The multiples and the dollar cap live in lib/trustware/eth-gas.ts.
const GAS_UNITS_FULL_CYCLE = 1_100_000n;

// How long to wait for delivered funds to become readable after Trustware
// reports success. The destination transaction has already mined by then;
// this only covers RPC read lag.
const ARRIVAL_TIMEOUT_MS = 90_000;
const ARRIVAL_POLL_MS = 3_000;

export function requiredEthWei(gasPriceWei: string): bigint {
  return requiredEthWeiFor(gasPriceWei, GAS_UNITS_FULL_CYCLE);
}

// True when the wallet cannot pay for a full lifecycle at today's gas price.
// Exported for the form's hint copy.
export function needsEthGas(ethBalanceAtomic: string, gasPriceWei: string): boolean {
  return needsEthGasFor(ethBalanceAtomic, gasPriceWei, GAS_UNITS_FULL_CYCLE);
}

export type AaveDepositPlan =
  | { kind: "direct" }
  | {
      kind: "fund-then-deposit";
      shortfallAtomic: string;
      // Asset leg. Absent when the Ethereum balance already covers the deposit.
      funding?: TrustwareLeg;
      // ETH gas leg. Absent when the wallet already holds enough.
      gas?: TrustwareLeg;
      gasCostUsd: number | null;
    }
  | { kind: "blocked"; reason: string };

// The deposit ceiling the form should offer: the Ethereum asset balance at par
// plus the Solana USDC discounted by the funding margin, less a gas reserve
// when the wallet still needs one.
export function maxFundableDepositAtomic(args: {
  walletAssetAtomic: string;
  solanaUsdcAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
}): string {
  const onEthereum = BigInt(args.walletAssetAtomic || "0");
  let onSolana = BigInt(args.solanaUsdcAtomic || "0");
  if (needsEthGas(args.ethBalanceAtomic, args.gasPriceWei)) {
    onSolana = onSolana > GAS_RESERVE_USDC_ATOMIC ? onSolana - GAS_RESERVE_USDC_ATOMIC : 0n;
  }
  const usable = (onSolana * BigInt(10_000 - MAX_BUFFER_BPS)) / 10_000n;
  return (onEthereum + usable).toString();
}

function fundingRequest(
  vault: AaveVault,
  fromAmountAtomic: string,
  solanaAddress: string,
  evmAddress: string,
) {
  return quoteRequest({
    fromChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: USDC_MINT,
    toChain: String(ETHEREUM_CHAIN_ID),
    toToken: vault.asset.address,
    fromAmount: fromAmountAtomic,
    fromAddress: solanaAddress,
    toAddress: evmAddress,
    fromAmountUSD: String(
      Math.max(1, Math.round(Number(fromAmountAtomic) / 10 ** USDC_DECIMALS)),
    ),
  });
}

// Work out what the requested deposit is missing on Ethereum (the asset, gas,
// or both), and price the legs that deliver it. Read-only: signs nothing,
// moves nothing.
export async function planAaveDeposit(args: {
  vault: AaveVault;
  // Requested deposit, 6-decimal atomic.
  depositAtomic: bigint;
  walletAssetAtomic: string;
  solanaUsdcAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
  solanaAddress: string | undefined;
  evmAddress: string;
  // Override the quote transport. The default hits our proxy on a relative
  // path, which only resolves in the browser; scripts pass a direct fetcher.
  fetchQuote?: QuoteFn;
}): Promise<AaveDepositPlan> {
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;
  const { vault } = args;
  const requested = args.depositAtomic;
  if (requested <= 0n) return { kind: "blocked", reason: "Enter an amount above zero." };

  const onEthereum = BigInt(args.walletAssetAtomic || "0");
  const needsGas = needsEthGas(args.ethBalanceAtomic, args.gasPriceWei);
  const shortfall = requested > onEthereum ? requested - onEthereum : 0n;

  if (shortfall === 0n && !needsGas) return { kind: "direct" };

  const symbol = vault.asset.symbol;
  const shortfallUi = atomicToUi(shortfall.toString(), vault.asset.decimals);
  let onSolana = BigInt(args.solanaUsdcAtomic || "0");

  if (!args.solanaAddress) {
    return {
      kind: "blocked",
      reason: needsGas
        ? "Your Ethereum wallet needs ETH for gas and no Solana wallet is available to buy it."
        : `You need ${shortfallUi} more ${symbol} on Ethereum and no Solana wallet is available to convert from.`,
    };
  }

  // Price the gas leg first and reserve its spend, so the asset leg is sized
  // against what is actually left.
  const gasPlan = await planEthGas({
    ethBalanceAtomic: args.ethBalanceAtomic,
    gasPriceWei: args.gasPriceWei,
    solanaUsdcAtomic: onSolana.toString(),
    solanaAddress: args.solanaAddress,
    evmAddress: args.evmAddress,
    gasUnits: GAS_UNITS_FULL_CYCLE,
    positionValueUsd: Number(requested) / 10 ** vault.asset.decimals,
    fetchQuote,
  });
  if (gasPlan.kind === "blocked") return gasPlan;
  if (gasPlan.leg) onSolana -= BigInt(gasPlan.leg.sourceAmountAtomic);

  let funding: TrustwareLeg | undefined;
  if (shortfall > 0n) {
    if (onSolana <= 0n) {
      return {
        kind: "blocked",
        reason: `You need ${shortfallUi} more ${symbol} on Ethereum and your Solana wallet holds no USDC to convert${gasPlan.leg ? " after the gas top-up" : ""}.`,
      };
    }

    // Both sides are dollar stablecoins, so par is a close first guess and the
    // probe only corrects for fees, slippage and (for USDT) the swap rate.
    // Clamp to the balance so the quote is one the user could execute.
    const probeAmount = shortfall > onSolana ? onSolana : shortfall;
    let probe: TrustwareLeg;
    try {
      probe = await priceLeg(
        fundingRequest(vault, probeAmount.toString(), args.solanaAddress, args.evmAddress),
        fetchQuote,
      );
    } catch (err) {
      return {
        kind: "blocked",
        reason: `No conversion route from Solana USDC to ${symbol} on Ethereum right now. ${
          err instanceof Error ? err.message : "Try again shortly."
        }`,
      };
    }
    const delivered = BigInt(probe.toAmountMinAtomic);
    if (delivered <= 0n) {
      return {
        kind: "blocked",
        reason: `The conversion to ${symbol} on Ethereum did not return a usable rate.`,
      };
    }

    // Solve for the source amount that clears the shortfall at the observed
    // rate, plus headroom for drift between planning and execution.
    let required = (shortfall * probeAmount + delivered - 1n) / delivered;
    required = BigInt(addBps(required.toString(), FUNDING_HEADROOM_BPS));
    if (required > onSolana) {
      return {
        kind: "blocked",
        reason: `Converting ${atomicToUi(onSolana.toString(), USDC_DECIMALS)} USDC on Solana${gasPlan.leg ? " (after the gas top-up)" : ""} is not enough. About ${atomicToUi(required.toString(), USDC_DECIMALS)} is needed to cover the ${shortfallUi} ${symbol} shortfall on Ethereum.`,
      };
    }

    // Re-quote at the solved amount: the probe priced a different size, so its
    // figures do not describe what would actually run.
    let quote: TrustwareLeg;
    try {
      quote = await priceLeg(
        fundingRequest(vault, required.toString(), args.solanaAddress, args.evmAddress),
        fetchQuote,
      );
    } catch (err) {
      return {
        kind: "blocked",
        reason: `Could not price the conversion to ${symbol} on Ethereum. ${
          err instanceof Error ? err.message : "Try again shortly."
        }`,
      };
    }
    if (BigInt(quote.toAmountMinAtomic) < shortfall) {
      return { kind: "blocked", reason: "The conversion rate moved while pricing. Try again." };
    }
    funding = quote;
  }

  return {
    kind: "fund-then-deposit",
    shortfallAtomic: shortfall.toString(),
    funding,
    gas: gasPlan.leg,
    gasCostUsd: gasPlan.costUsd,
  };
}

type Report = (p: AaveTxProgress) => void;

// Route one priced leg, sign its Solana source transaction, and hand Trustware
// the hash. Settlement tracking is separate so several legs can bridge at
// once.
async function broadcastSolanaLeg(args: {
  leg: TrustwareLeg;
  // The delivery floor the fresh route must still guarantee before the user
  // commits funds. Pass 0n to skip (the plan already validated the leg).
  minDeliveredAtomic: bigint;
  describe: string;
  solana: SolanaSigner;
  report: Report;
  signal?: AbortSignal;
}): Promise<string> {
  const { leg, solana, report, signal } = args;

  report({ stage: "funding", message: `Preparing the ${args.describe} conversion to Ethereum.` });
  const routeRes = await fetchTrustwareRouteViaProxy(leg.request);

  const intentId = extractIntentId(routeRes);
  const transaction = extractExecution(routeRes)?.transaction;
  if (!intentId) throw new Error("Trustware returned no intent to track.");
  // For a Solana source the transaction is a base64 payload in `data` alone.
  // Anything hex-shaped would be an EVM transaction we cannot sign here.
  if (!transaction?.data || transaction.data.startsWith("0x")) {
    throw new Error("Trustware returned no signable Solana transaction.");
  }

  // Last free abort point: verify the fresh route still delivers enough.
  const estimate = extractEstimate(routeRes);
  const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount;
  if (
    args.minDeliveredAtomic > 0n &&
    guaranteed &&
    BigInt(guaranteed) < args.minDeliveredAtomic
  ) {
    throw new Error(
      "The conversion rate moved and no longer covers this deposit. Try again to get a fresh quote.",
    );
  }

  report({
    stage: "funding",
    message: `Sending ${atomicToUi(leg.sourceAmountAtomic, USDC_DECIMALS)} USDC from your Solana wallet (${args.describe}).`,
  });
  const sourceTxHash = await solana.signAndSendBase64(transaction.data);

  // Submit immediately after broadcast; without this Trustware cannot track a
  // route the user has already paid for.
  await submitTrustwareReceipt(intentId, sourceTxHash, signal);
  return intentId;
}

// One fresh read of the wallet's Ethereum balances through our position route.
// Returns null when the route is unreachable; callers fall back to their state
// values rather than planning against zeros.
async function readEthereumWallet(evmAddress: string): Promise<{
  usdcAtomic: string;
  usdtAtomic: string;
  ethAtomic: string;
  gasPriceWei: string;
} | null> {
  try {
    const res = await fetch(
      `/api/aave/position?address=${encodeURIComponent(evmAddress)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      usdcBalanceAtomic?: string;
      usdtBalanceAtomic?: string;
      ethBalanceAtomic?: string;
      gasPriceWei?: string;
    };
    return {
      usdcAtomic: body.usdcBalanceAtomic ?? "0",
      usdtAtomic: body.usdtBalanceAtomic ?? "0",
      ethAtomic: body.ethBalanceAtomic ?? "0",
      gasPriceWei: body.gasPriceWei ?? "0",
    };
  } catch {
    return null;
  }
}

function walletAssetOf(
  vault: AaveVault,
  w: { usdcAtomic: string; usdtAtomic: string },
): string {
  return vault.asset.symbol === "USDT" ? w.usdtAtomic : w.usdcAtomic;
}

// Execute every leg of a funding plan: broadcast each source transaction (the
// signing is quick), let the bridges settle in parallel (the wait), then hold
// until the funds are readable on Ethereum.
async function executeFundingPlan(args: {
  plan: Extract<AaveDepositPlan, { kind: "fund-then-deposit" }>;
  vault: AaveVault;
  evmAddress: string;
  // The Ethereum asset balance that must be readable before returning.
  assetAtLeastAtomic: bigint;
  solana: SolanaSigner;
  report: Report;
  signal?: AbortSignal;
}): Promise<void> {
  const { plan, vault, solana, report, signal } = args;

  const intents: string[] = [];
  if (plan.gas) {
    report({
      stage: "funding",
      message: `Buying about $${plan.gasCostUsd?.toFixed(2)} of ETH for Ethereum gas.`,
    });
    intents.push(
      await broadcastSolanaLeg({
        leg: plan.gas,
        minDeliveredAtomic: 0n,
        describe: "ETH for gas",
        solana,
        report,
        signal,
      }),
    );
  }
  if (plan.funding) {
    intents.push(
      await broadcastSolanaLeg({
        leg: plan.funding,
        minDeliveredAtomic: BigInt(plan.shortfallAtomic),
        describe: vault.asset.symbol,
        solana,
        report,
        signal,
      }),
    );
  }

  const bridging = "Bridging to Ethereum. This can take a few minutes.";
  report({ stage: "funding", message: bridging });
  await Promise.all(
    intents.map((id) =>
      trackTrustwareSettlement(id, signal, (status) =>
        report({
          stage: "funding",
          message:
            status.data?.gas_status === "needs_gas"
              ? "The route stalled waiting for destination gas. Trustware is retrying."
              : bridging,
        }),
      ),
    ),
  );

  report({ stage: "funding", message: "Funds arrived. Confirming the Ethereum balance." });
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  for (;;) {
    if (signal?.aborted) break;
    const w = await readEthereumWallet(args.evmAddress);
    if (w) {
      const assetOk = BigInt(walletAssetOf(vault, w)) >= args.assetAtLeastAtomic;
      // Gas has arrived once the wallet clears the floor at the CURRENT price.
      const gasOk = !plan.gas || !needsEthGas(w.ethAtomic, w.gasPriceWei);
      if (assetOk && gasOk) return;
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, ARRIVAL_POLL_MS));
  }
  // The bridges settled, so the money is in the user's Ethereum wallet even if
  // our read has not caught up. A retry later sees the arrived balance.
  throw new Error(
    "The converted funds are on Ethereum but the balance read has not caught up. Your funds are safe. Try again in a moment.",
  );
}

// Deposit into an Aave vault, first delivering whatever the Ethereum wallet is
// missing (the asset, gas, or both) from the user's Solana USDC. One call,
// every stage reported. Returns the deposit tx hash.
export async function depositWithFunding(args: {
  vault: AaveVault;
  amountAtomic: bigint;
  walletAssetAtomic: string;
  solanaUsdcAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
  signer: EvmSigner;
  // Required only when funding is needed; the plan reports a readable reason
  // when it is missing.
  solana: SolanaSigner | undefined;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ txHash: string; funded: boolean }> {
  const report: Report = (p) => args.onProgress?.(p);

  // UI state can lag the chain: a retry could re-buy gas the first attempt
  // already delivered. Plan against a fresh read whenever one is available;
  // the passed-in values are only the fallback for a transient read failure.
  const fresh = await readEthereumWallet(args.signer.address);
  const walletAssetAtomic = fresh ? walletAssetOf(args.vault, fresh) : args.walletAssetAtomic;
  const ethBalanceAtomic = fresh?.ethAtomic ?? args.ethBalanceAtomic;
  const gasPriceWei = fresh?.gasPriceWei ?? args.gasPriceWei;

  const plan = await planAaveDeposit({
    vault: args.vault,
    depositAtomic: args.amountAtomic,
    walletAssetAtomic,
    solanaUsdcAtomic: args.solanaUsdcAtomic,
    ethBalanceAtomic,
    gasPriceWei,
    solanaAddress: args.solana?.address,
    evmAddress: args.signer.address,
  });
  if (plan.kind === "blocked") throw new Error(plan.reason);

  let funded = false;
  if (plan.kind === "fund-then-deposit") {
    if (!args.solana) {
      throw new Error("No Solana wallet is available to fund this deposit.");
    }
    await executeFundingPlan({
      plan,
      vault: args.vault,
      evmAddress: args.signer.address,
      assetAtLeastAtomic: args.amountAtomic,
      solana: args.solana,
      report,
      signal: args.signal,
    });
    funded = true;
  }

  const txHash = await depositToAaveVault({
    vault: args.vault,
    amountAtomic: args.amountAtomic,
    signer: args.signer,
    onProgress: args.onProgress,
  });
  return { txHash, funded };
}

// ── the return leg: Ethereum USDC / USDT -> Solana USDC ────────────────────
//
// A withdrawal lands the asset in the Ethereum wallet, which is a waypoint,
// not a home: nothing else in the app spends from there. This brings it back
// to the Solana wallet through the return shape the proxy already allows.
// Requires ETH for gas, which the wallet has whenever it was funded through
// this module; a gasless wallet gets a readable error rather than a doomed
// signature.
export async function sendAaveAssetToSolana(args: {
  vault: AaveVault;
  amountAtomic: bigint;
  walletAssetAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
  evm: EvmSigner;
  solanaAddress: string;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ deliveredAtomic: string | null }> {
  if (args.amountAtomic <= 0n) throw new Error("Enter an amount above zero.");
  if (args.amountAtomic > BigInt(args.walletAssetAtomic || "0")) {
    throw new Error(`Amount is above the wallet's ${args.vault.asset.symbol} balance on Ethereum.`);
  }
  // The return leg is one approve and one route transaction; the full-cycle
  // floor is far more than it needs, so only refuse a wallet with nothing.
  if (BigInt(args.ethBalanceAtomic || "0") === 0n) {
    throw new Error(
      "Your Ethereum wallet has no ETH to pay gas for this transfer. Funding a deposit from Solana adds gas automatically.",
    );
  }

  const result = await executeEvmRoute({
    request: quoteRequest({
      fromChain: String(ETHEREUM_CHAIN_ID),
      fromToken: args.vault.asset.address,
      toChain: TRUSTWARE_SOLANA_CHAIN,
      toToken: USDC_MINT,
      fromAmount: args.amountAtomic.toString(),
      fromAddress: args.evm.address,
      toAddress: args.solanaAddress,
    }),
    evm: args.evm,
    describe: args.vault.asset.symbol,
    onProgress: (p) =>
      args.onProgress?.({
        stage: p.stage === "settled" ? "done" : "funding",
        message: p.stage === "settled" ? "USDC arrived on Solana." : p.message,
      }),
    signal: args.signal,
  });
  return { deliveredAtomic: result.deliveredAtomic };
}
