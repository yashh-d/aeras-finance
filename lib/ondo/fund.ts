"use client";

// Posting collateral to Ondo Perps from whatever the user already holds.
//
// This is the leg that makes the venue worth using: the tokenized stock pays
// for its own hedge. It converts a Solana holding into the Ondo margin asset on
// Ethereum and delivers it straight to the deposit address Ondo provisioned for
// the account, which is then credited as margin at the mark price less the
// haircut.
//
// **One signature, no ETH, no chain switch.** That is the point of routing the
// bridge at the deposit address rather than at the user's own EVM wallet. Ondo
// deposit addresses are permanently bound to an account and credit any
// supported asset sent to them, so the bridge solver performs the destination
// -side delivery. The alternative, delivering into the embedded EVM wallet and
// transferring in, needs an Ethereum mainnet ERC-20 transfer from a wallet that
// holds zero ETH, which means a native-gas top-up leg and a second signature
// on the most expensive chain in the system.
//
// What that costs is recoverability. The funds land at an address the user
// cannot sign for, so if Ondo does not credit a bridge-delivered transfer the
// money sits until Ondo moves it. Their funding docs say "any transfers to this
// address of a supported asset will be credited", with no mention of the
// sender, and their deposit addresses are described as permanent rather than
// per-transfer. That is strong but it is not the same as having watched it
// work, which is why ONDO_FUNDING_ENABLED gates execution until one small live
// deposit confirms it. Planning and pricing are not gated.
//
// Three guards run before anything is signed, and each exists because of
// something measured rather than imagined:
//
//   1. **The destination is never caller-supplied.** It is fetched from Ondo
//      through our own authenticated session at plan time. A funding call that
//      accepted an address argument would be a way to route a user's bridge
//      output anywhere.
//   2. **The asset must be one Ondo actually credits.** `provision_address`
//      returns a perfectly valid address for TSLAon, which is not collateral.
//      A deposit address proves nothing, so the token config is checked first.
//   3. **The route must not be lossy.** SNDKon quoted at roughly half of
//      SNDK's mark on 2026-08-25 while SPYon quoted at 99%. Bridging into a
//      thin market silently converts a deposit into a 50% loss, so the plan
//      compares the delivered market value against what went in and refuses
//      past MAX_FUNDING_LOSS_BPS.

import { atomicToUi, toNumberOrNull } from "@/lib/trustware/amounts";
import {
  fetchTrustwareQuoteViaProxy,
  fetchTrustwareRouteViaProxy,
} from "@/lib/trustware/client";
import { TRUSTWARE_DEFAULT_SLIPPAGE } from "@/lib/trustware/constants";
import {
  submitTrustwareReceipt,
  trackTrustwareSettlement,
  type SolanaSigner,
} from "@/lib/trustware/execute";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
  type TrustwareStatusResponse,
} from "@/lib/trustware/types";

import { provisionOndoDepositAddress } from "./client";
import type { OndoCollateral } from "./collateral";
import { creditedMargin } from "./collateral";

export type { SolanaSigner } from "@/lib/trustware/execute";

// Ondo credits margin on Ethereum only.
const ETHEREUM_CHAIN = "1";

// Refuse a route that delivers less than 90% of the value put into it, measured
// against Ondo's own mark rather than the bridge's USD estimate. Set here
// rather than at a call site because it is a safety floor, not a preference.
//
// Re-measured 2026-08-26 by quoting the same route at four sizes, which
// separated the two things the old 1000 bps bound had conflated:
//
//   SPCXx -> SPCXon    $20 -> 431 bps    $138 -> 137    $690 -> 46    $2,759 -> 54
//   USDC  -> USDC      $20 ->  25 bps                   $690 ->  1
//
// The bridge is close to free. Essentially all of the cost is the spread on
// converting a thin Solana token into a thin Ethereum one, plus fixed relayer
// costs that only amortise above a few hundred dollars. The floor for a
// tokenized-stock deposit is about 45 bps and it is reached around $500.
//
// 1000 bps was therefore not a safety bound at all: it would wave through a
// $20 deposit losing 431 bps, ten times the achievable rate, without a word.
// 150 bps refuses that while still allowing a well-sized deposit through the
// thin-but-usable markets. SNDKon, which delivered about 50%, stays blocked.
export const MAX_FUNDING_LOSS_BPS = 150;

// The bound above is a *soft* one: past it the deposit is priced, named and
// offered for explicit confirmation rather than refused. Losing 431 bps on a
// small holding is a bad deal, not a broken one, and whether it is worth paying
// to avoid selling the stock is the user's call, not this module's.
//
// This one is hard and has no override. Nothing at this level is a spread; it
// is a broken market, and SNDKon quoted here on 2026-08-25.
export const HARD_MAX_FUNDING_LOSS_BPS = 1_000;

// The size below which fixed relayer and bridge costs dominate. Advisory: it
// drives the warning copy and the default confirmation prompt, and does not by
// itself refuse anything.
export const MIN_FUNDING_USD = 250;

// Execution is off until a live deposit confirms Ondo credits a bridge-
// delivered transfer. Planning, pricing and the loss guard all run regardless,
// so the path can be exercised end to end short of signing.
export const ONDO_FUNDING_ENABLED =
  process.env.NEXT_PUBLIC_ONDO_FUNDING_ENABLED === "true";

export interface OndoFundingSource {
  // Trustware chain id. Solana is the string alias, EVM chains are numeric.
  chain: string;
  token: string;
  decimals: number;
  symbol: string;
  // Atomic units of `token` to spend.
  amountAtomic: string;
  // What the caller believes it is spending, from its own price source. Used
  // for the loss guard, which cannot run without it: Trustware's own
  // fromAmountUsd came back null on every measured quote.
  amountUsd: number | null;
  // The address holding it, and the signer for the source leg.
  ownerAddress: string;
}

export interface OndoFundingPlan {
  kind: "ready";
  collateral: OndoCollateral;
  // Provisioned by Ondo for this account and this asset. Never caller-supplied.
  depositAddress: string;
  source: OndoFundingSource;
  // Atomic units of the collateral token, at its own decimals.
  deliveredAtomic: string;
  deliveredMinAtomic: string;
  deliveredTokens: string;
  // Market value of what lands, before Ondo's haircut.
  deliveredValueUsd: number | null;
  // What it is worth as margin once credited: delivered x mark x (1 - haircut),
  // capped. Null for an asset with no market to mark against.
  creditedMarginUsd: number | null;
  // How much value the conversion costs, in bps of the input. Null when the
  // caller passed no source valuation and Trustware returned none either.
  lossBps: number | null;
  bridgeFeesUsd: number | null;
  // True when the asset has no pricing market, so nothing above could be
  // checked and the credited value is only knowable after it lands.
  valueUnverified: boolean;
  // True when Ondo's docs do not name this asset as accepted collateral. It is
  // in their live token config and routable, but the haircut, the cap, and
  // whether it credits at all are inferred. Ondo's collateral page still says
  // "supported assets at launch: QQQon and SPYon". A caller must surface this;
  // it is not a detail.
  collateralUndocumented: boolean;
  // True when the plan is priced but signing is disabled.
  executionDisabled: boolean;
}

export interface OndoFundingBlocked {
  kind: "blocked";
  reason: string;
}

// Priced, legal, and more expensive than the soft bound. Carries the numbers
// the user has to see before they can agree to it.
export interface OndoFundingNeedsConfirmation {
  kind: "needs-confirmation";
  collateral: OndoCollateral;
  lossBps: number;
  costUsd: number;
  inputValueUsd: number;
  deliveredValueUsd: number;
  reason: string;
}

export type OndoFundingResult =
  | OndoFundingPlan
  | OndoFundingBlocked
  | OndoFundingNeedsConfirmation;

type QuoteFn = (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;

export async function planOndoFunding(args: {
  collateral: OndoCollateral;
  source: OndoFundingSource;
  // The loss, in bps, the user has already been shown and accepted. Anything
  // costlier than this re-prompts.
  acceptLossBps?: number;
  // Override the transport. The default hits our proxy on a relative path,
  // which only resolves in the browser; scripts pass a direct fetcher.
  fetchQuote?: QuoteFn;
  // Override how the deposit address is obtained, for the same reason.
  provisionAddress?: (symbol: string) => Promise<{ address: string; contractAddress: string }>;
}): Promise<OndoFundingResult> {
  const { collateral, source } = args;
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;
  const provision = args.provisionAddress ?? defaultProvision;

  if (BigInt(source.amountAtomic || "0") <= 0n) {
    return { kind: "blocked", reason: "Enter an amount above zero." };
  }

  // Guard 2: an asset Ondo lists but does not credit is worse than one it
  // rejects outright, because the deposit succeeds and the margin does not
  // appear.
  if (!collateral.known) {
    return {
      kind: "blocked",
      reason: `Ondo lists ${collateral.symbol} as a deposit asset, but Aeras has not confirmed it is credited as margin. Fund with a known collateral asset instead.`,
    };
  }

  // Guard 1: the destination comes from Ondo, over our authenticated session.
  let provisioned: { address: string; contractAddress: string };
  try {
    provisioned = await provision(collateral.symbol);
  } catch (err) {
    return {
      kind: "blocked",
      reason: `Could not get a deposit address from Ondo. ${
        err instanceof Error ? err.message : "Try again shortly."
      }`,
    };
  }

  // Ondo returns the contract it expects the deposit in. If that disagrees with
  // the token we are about to bridge, something moved underneath us and the
  // right answer is to stop, not to deliver the wrong asset to a real address.
  if (
    provisioned.contractAddress.toLowerCase() !== collateral.contractAddress.toLowerCase()
  ) {
    return {
      kind: "blocked",
      reason: `Ondo expects ${collateral.symbol} at a different contract than the one Aeras would send. Refusing to route this deposit.`,
    };
  }

  const request: TrustwareQuoteRequest = {
    fromChain: source.chain,
    toChain: ETHEREUM_CHAIN,
    fromToken: source.token,
    toToken: collateral.contractAddress,
    fromAmount: source.amountAtomic,
    fromAddress: source.ownerAddress,
    toAddress: provisioned.address,
    // Crosses a bridge, so it keeps Trustware's default tolerance rather than
    // the tight Solana-swap setting.
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
  };

  let estimate;
  try {
    estimate = extractEstimate(await fetchQuote(request));
  } catch (err) {
    return {
      kind: "blocked",
      reason: `Could not price this deposit. ${
        err instanceof Error ? err.message : "Try again shortly."
      }`,
    };
  }

  if (!estimate?.toAmount) {
    return {
      kind: "blocked",
      reason: `No route from ${source.symbol} to ${collateral.symbol} on Ethereum right now.`,
    };
  }

  const deliveredAtomic = estimate.toAmount;
  const deliveredMinAtomic =
    estimate.toAmountMin ??
    (
      (BigInt(deliveredAtomic) *
        BigInt(Math.round((100 - TRUSTWARE_DEFAULT_SLIPPAGE) * 100))) /
      10_000n
    ).toString();

  const deliveredTokens = atomicToUi(deliveredMinAtomic, collateral.decimals);
  const credited = creditedMargin(collateral, Number(deliveredTokens));

  // Guard 3. The delivered value is marked against Ondo's own price, not the
  // bridge's opinion of it, because it is Ondo that decides what the deposit is
  // worth. Falls back to Trustware's figure only to detect a loss, never to
  // report credited margin.
  const markUsd = Number(collateral.markPriceUsd);
  const deliveredValueUsd = collateral.priceable && markUsd > 0
    ? Number(deliveredTokens) * markUsd
    : toNumberOrNull(estimate.toAmountUsd);

  const inputValueUsd = source.amountUsd ?? toNumberOrNull(estimate.fromAmountUsd);

  let lossBps: number | null = null;
  if (inputValueUsd !== null && inputValueUsd > 0 && deliveredValueUsd !== null) {
    lossBps = Math.round(((inputValueUsd - deliveredValueUsd) / inputValueUsd) * 10_000);

    if (lossBps > HARD_MAX_FUNDING_LOSS_BPS) {
      return {
        kind: "blocked",
        reason: `This route would deliver about $${deliveredValueUsd.toFixed(2)} of ${collateral.symbol} for $${inputValueUsd.toFixed(2)} of ${source.symbol}, a ${(lossBps / 100).toFixed(1)}% loss before Ondo's haircut. That is a broken market, not a spread. Refusing to route it.`,
      };
    }

    // Past the soft bound the caller must have seen this exact number and said
    // yes to it. `acceptLossBps` is the figure the user was shown, so a quote
    // that moves against them between confirming and signing re-prompts instead
    // of quietly costing more than they agreed to.
    const accepted = args.acceptLossBps ?? -1;
    if (lossBps > MAX_FUNDING_LOSS_BPS && lossBps > accepted) {
      return {
        kind: "needs-confirmation",
        collateral,
        lossBps,
        costUsd: inputValueUsd - deliveredValueUsd,
        inputValueUsd,
        deliveredValueUsd,
        reason: `Converting $${inputValueUsd.toFixed(2)} of ${source.symbol} delivers about $${deliveredValueUsd.toFixed(2)} of ${collateral.symbol}, costing $${(inputValueUsd - deliveredValueUsd).toFixed(2)} (${(lossBps / 100).toFixed(2)}%). Most of that is fixed bridge cost, so it falls to roughly 0.5% above $${MIN_FUNDING_USD}. Funding with USDC instead costs about 0.01%.`,
      };
    }
  }

  return {
    kind: "ready",
    collateral,
    depositAddress: provisioned.address,
    source,
    deliveredAtomic,
    deliveredMinAtomic,
    deliveredTokens,
    deliveredValueUsd,
    creditedMarginUsd: credited?.creditedUsd ?? null,
    lossBps,
    bridgeFeesUsd: toNumberOrNull(estimate.totalFeesUsd),
    // GLDon and SLVon land here: Ondo has no GLD or SLV market to mark them
    // against, so what they are worth as margin is only knowable from the
    // balance after they are credited.
    valueUnverified: !collateral.priceable,
    collateralUndocumented: !collateral.documented,
    executionDisabled: !ONDO_FUNDING_ENABLED,
  };
}

export type OndoFundingProgress =
  | { step: "routing" }
  | { step: "signing" }
  | { step: "broadcast"; txHash: string }
  | { step: "settling"; status: TrustwareStatusResponse }
  | { step: "delivered"; txHash: string };

// Signs and broadcasts the source leg, then tracks the bridge to settlement.
//
// Settlement here means Trustware delivered to the deposit address. Ondo
// crediting it as margin is a separate event on Ondo's side, visible through
// GET /v1/wallet/deposits and in the margin balance, and it is not treated as
// done until it shows up there. Nothing downstream should assume margin exists
// because this resolved.
export async function executeOndoFunding(args: {
  plan: OndoFundingPlan;
  solana: SolanaSigner;
  onProgress?: (progress: OndoFundingProgress) => void;
  signal?: AbortSignal;
}): Promise<{ txHash: string; status: TrustwareStatusResponse }> {
  const { plan, solana } = args;
  const report = args.onProgress ?? (() => {});

  if (!ONDO_FUNDING_ENABLED) {
    throw new Error(
      "Ondo margin funding is disabled. It stays off until one live deposit confirms Ondo credits a bridge-delivered transfer.",
    );
  }
  if (plan.source.chain !== "solana-mainnet-beta") {
    // Only the Solana source is wired. An EVM source would need an allowance
    // and a chain switch, which is the machinery lib/trustware/execute.ts
    // already owns and this module deliberately does not duplicate.
    throw new Error(`Ondo funding from ${plan.source.chain} is not supported yet.`);
  }

  report({ step: "routing" });

  const route = await fetchTrustwareRouteViaProxy({
    fromChain: plan.source.chain,
    toChain: ETHEREUM_CHAIN,
    fromToken: plan.source.token,
    toToken: plan.collateral.contractAddress,
    fromAmount: plan.source.amountAtomic,
    fromAddress: plan.source.ownerAddress,
    toAddress: plan.depositAddress,
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
  });

  const execution = extractExecution(route);
  const intentId = extractIntentId(route);

  // For a Solana source the route carries only `data`, a base64 transaction.
  // The EVM fields are absent, and the approvals array echoes an ERC-20-style
  // approval with a Solana mint that must be ignored rather than executed.
  const base64Tx = execution?.transaction?.data;
  if (!base64Tx || !intentId) {
    throw new Error("Trustware returned no signable transaction for this deposit.");
  }

  report({ step: "signing" });
  const txHash = await solana.signAndSendBase64(base64Tx);
  report({ step: "broadcast", txHash });

  await submitTrustwareReceipt(intentId, txHash, args.signal);

  const status = await trackTrustwareSettlement(intentId, args.signal, (tick) =>
    report({ step: "settling", status: tick }),
  );

  report({ step: "delivered", txHash });
  return { txHash, status };
}

async function defaultProvision(symbol: string) {
  const provisioned = await provisionOndoDepositAddress(symbol);
  return {
    address: provisioned.address,
    contractAddress: provisioned.contractAddress,
  };
}
