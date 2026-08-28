// How borrowed USDC gets from Solana to a Lighter margin account.
//
// The money always starts as Solana USDC, because that is what both borrow
// venues pay out. What differs is the road to Lighter, and for a hedge the road
// matters more than it does for ordinary onboarding: between the borrow landing
// and the short filling, the user holds the full stock exposure *and* the debt
// with nothing offsetting either. Latency here is not a convenience figure, it
// is the length of the window in which the position is unhedged. That is why
// every route below carries one.
//
// Four roads, in the order a planner should want them:
//
//   solana-uda        Lighter's Fun.xyz bridge (POST /v1/uda) hands back a
//                     solanaAddr alongside the EVM one. Not CCTP, so it settles
//                     in minutes rather than on Solana finality plus attestation.
//                     One SPL transfer, no EVM wallet touched. Needs a builder
//                     API key that Lighter issues over Discord, which is the
//                     only reason this is not simply the default.
//   trustware-base     Trustware routes Solana USDC to Lighter's Base intent
//   trustware-arbitrum address directly. The user signs once, on Solana. No gas
//                     on the destination and no chain switch, because we never
//                     sign there: the solver performs the delivery. Same shape
//                     as lib/ondo/fund.ts, which delivers to Ondo's provisioned
//                     deposit address for exactly this reason. Base is the
//                     preferred road; Arbitrum backs it up.
//
//                     They price well: 25.0 bps guaranteed, flat across sizes,
//                     with a routing ETA of 1 to 3 seconds. The expected figure
//                     is 2.7 bps and the gap is the 0.3% slippage tolerance the
//                     request carries. Sizing uses the guaranteed number,
//                     because that is what execute.ts commits against.
//
//                     What they cannot do is promise to be signable. Trustware
//                     multiplexes across bridge providers and picks on price.
//                     LI.FI returns a signable Solana transaction; relay and
//                     Khalani return an estimate and an intentId and nothing to
//                     sign, which is the defect lib/trustware/execute.ts:170
//                     already documents for Solana-to-Solana. So a road works
//                     exactly when LI.FI wins its auction, and that is a live
//                     price contest that moves within the hour:
//
//                       Base       signable to $10 in one run, to $50 in the
//                                  next, relay above that
//                       Arbitrum   signable at every size to $5,000, 8 runs out
//                                  of 8, then refusing $1,000 while still
//                                  signing $250 twenty minutes later
//                       Monad      signable at every size, because relay does
//                                  not compete there. This is why
//                                  lib/morpho/fund.ts works and is the control
//                                  that proves the Solana source is fine.
//
//                     No constant can express that, and two attempts at one were
//                     contradicted the same afternoon. So there is no ceiling in
//                     this file. Signability is asked at runtime about a
//                     specific size, and lib/lighter/one-click.ts asks it BEFORE
//                     it borrows: a lost auction then costs a slower road rather
//                     than a position stranded behind a debt.
//
//                     Levers tried and rejected: roughly twenty
//                     provider-preference field names (`providers`, `bridges`,
//                     `allowBridges`, `excludeProviders`, `order`) are ignored or
//                     perturb selection without landing on LI.FI; twenty retries
//                     on Base gave relay nineteen times and Khalani once.
//                     Slippage makes no difference.
//
//                     One trap worth keeping: a repeated-digit placeholder
//                     destination (0x2222...2222) is screened somewhere upstream
//                     and silently drops an otherwise healthy route to relay.
//                     That made Monad look like a production outage for an
//                     afternoon. Test with ordinary-looking addresses.
//   solana-cctp       What ships today. One SPL transfer to the address
//                     createIntentAddress returns, then CCTP. Costs nothing and
//                     needs no key, but Solana finality plus attestation is 15
//                     to 20 minutes of unhedged exposure.
//
// The EVM roads are not free the way the Solana ones are. A bridge takes a
// spread, and a hedge sized from the pre-bridge figure would post less margin
// than it planned for and end up under-hedged. So a route carries its loss in
// basis points and the plan sizes from what actually lands.

import {
  LIGHTER_INTENT_CHAIN_IDS,
  LIGHTER_MIN_CCTP_DEPOSIT_USDC,
  type LighterIntentChain,
} from "./constants";

export type FundingRouteId =
  | "solana-uda"
  | "trustware-arbitrum"
  | "trustware-base"
  | "solana-cctp";

export interface FundingRoute {
  id: FundingRouteId;
  label: string;
  // The chain the USDC is delivered on. Solana routes never touch an EVM wallet.
  deliversOn: "solana" | "arbitrum" | "base";
  // Which createIntentAddress chain this route's destination comes from, when it
  // uses one. The UDA route does not: its address comes from bridge.lighter.xyz.
  intentChain?: LighterIntentChain;
  // Whether the destination address is fetched from Lighter's builder API, which
  // requires a key we may not hold.
  requiresBuilderKey: boolean;
  // Signatures the user must produce. Every route here is one, on Solana. An
  // EVM-signed route would need gas the embedded wallet is born without, which
  // is precisely why none of these are shaped that way.
  solanaSignatures: number;
  evmSignatures: number;
  // Planning estimate for how long the user is unhedged, in minutes. Upper end
  // of the range, because a hedge should be sized against the bad case.
  latencyMinutesEstimate: number;
  // Value given up in transit, in basis points, as a planning bound rather than
  // a quote. Solana routes are transfers and lose nothing; the Trustware routes
  // are priced live and this is only the ceiling a plan will accept before it
  // asks for a real quote.
  plannedLossBps: number;
  // Lighter's own floor for a deposit on this road, in USDC.
  minimumUsd: number;
  // Whether this road's signability has to be probed at runtime before it is
  // used. True for the bridge roads: whether Trustware hands back something
  // signable depends on which provider wins its price auction at that exact
  // size, and that moves within the hour. There is deliberately no static
  // ceiling here, because every constant tried was wrong within the hour.
  probeBeforeUse: boolean;
}

// Deposit minimums, from Lighter's docs (updated 2026-08-19). The bridge path
// distinguishes a new account from an existing one ($5 against $3); the higher
// figure is used for both, because a plan cannot tell which the user is and
// under-sizing a deposit means it does not credit at all.
const MIN_BRIDGE_DEPOSIT_USD = 5;

// Most a Trustware leg may give up before the plan refuses it outright. Mirrors
// MAX_FUNDING_LOSS_BPS in lib/ondo/fund.ts, and exists for the same reason:
// some routes are quietly terrible, and a hedge funded through one arrives
// materially smaller than the exposure it was sized to offset.
export const MAX_FUNDING_LOSS_BPS = 150;

// What a plan assumes a bridge costs before it has a quote in hand.
//
// Sized against the *guaranteed* figure, not the expected one. LI.FI on Arbitrum
// guarantees 25.0 bps, flat from $10 to $5,000, measured 2026-08-27.
// execute.ts commits against toAmountMin, so that is the honest number here too.
// Erring high is the safe direction: assuming too little loss overstates the
// margin that will land and quietly under-hedges the position.
const PLANNED_BRIDGE_LOSS_BPS = 40;

// There is deliberately no signable-size constant in this module.
//
// Every value measured for one was contradicted within the hour. Base signed to
// $10 in one run and to $50 in the next. Arbitrum signed every size to $5,000,
// eight runs out of eight, then refused $1,000 while still signing $250 twenty
// minutes later. The boundary is where LI.FI stops outbidding relay, which is a
// live auction, not a limit anyone declares.
//
// So signability is a question asked at runtime, about a specific size, at PAY
// time: prepareSolanaBridge in lib/lighter/borrow-bridge.ts makes the one route
// request and the transaction it validates is the one that is signed. A road
// that declines costs nothing and the flow falls through to the next, ending at
// the Solana transfer, which has no auction to lose.

// The four roads. Ordered fastest first, which is also the order a planner
// should prefer them in, since the fastest is the one that leaves the user
// unhedged for the shortest time.
export const FUNDING_ROUTES: readonly FundingRoute[] = [
  {
    id: "solana-uda",
    label: "Solana, via Lighter's bridge",
    deliversOn: "solana",
    requiresBuilderKey: true,
    solanaSignatures: 1,
    evmSignatures: 0,
    // Lighter documents "typically within a few minutes". Treated as five until
    // a real deposit has been timed, per the standing rule in constants.ts that
    // a returned address proves the road exists and not that crediting works.
    latencyMinutesEstimate: 5,
    plannedLossBps: 0,
    minimumUsd: MIN_BRIDGE_DEPOSIT_USD,
    probeBeforeUse: false,
  },
  {
    id: "trustware-base",
    label: "Base, via Trustware",
    deliversOn: "base",
    intentChain: "base",
    requiresBuilderKey: false,
    solanaSignatures: 1,
    evmSignatures: 0,
    // The bridge itself settles in seconds. This is Lighter's crediting on the
    // far side, which is the part that actually keeps the position unhedged.
    latencyMinutesEstimate: 5,
    plannedLossBps: PLANNED_BRIDGE_LOSS_BPS,
    minimumUsd: MIN_BRIDGE_DEPOSIT_USD,
    probeBeforeUse: true,
  },
  {
    id: "trustware-arbitrum",
    label: "Arbitrum, via Trustware",
    deliversOn: "arbitrum",
    intentChain: "arbitrum",
    requiresBuilderKey: false,
    solanaSignatures: 1,
    evmSignatures: 0,
    // The bridge itself settles in seconds. This is Lighter's crediting on the
    // far side, which is the part that actually keeps the position unhedged.
    latencyMinutesEstimate: 5,
    plannedLossBps: PLANNED_BRIDGE_LOSS_BPS,
    minimumUsd: MIN_BRIDGE_DEPOSIT_USD,
    probeBeforeUse: true,
  },
  {
    id: "solana-cctp",
    label: "Solana, direct",
    deliversOn: "solana",
    intentChain: "solana",
    requiresBuilderKey: false,
    solanaSignatures: 1,
    evmSignatures: 0,
    // Solana finality plus Circle attestation. Measured range is 15 to 20; the
    // upper bound is used so the unhedged window is never understated.
    latencyMinutesEstimate: 20,
    plannedLossBps: 0,
    minimumUsd: LIGHTER_MIN_CCTP_DEPOSIT_USDC,
    probeBeforeUse: false,
  },
] as const;

export function fundingRoute(id: FundingRouteId): FundingRoute {
  const route = FUNDING_ROUTES.find((r) => r.id === id);
  if (!route) throw new Error(`Unknown funding route: ${id}`);
  return route;
}

export interface FundingAvailability {
  // True once a Lighter builder key is configured server-side.
  hasBuilderKey: boolean;
  // Chains a Trustware route has been seen to return a *signable transaction*
  // for, not merely a price. The distinction is the whole point: as of
  // 2026-08-27 both Arbitrum and Base quote at 2.7 bps and neither returns a
  // transaction, because Trustware answers every Solana-source USDC route with
  // the relay provider and relay does not build one. A chain belongs in this
  // list only once scripts/lighter-borrow-hedge-check.mts section 6 reports it
  // executable, so today the honest value is empty.
  trustwareChains: readonly ("arbitrum" | "base")[];
}

// The road a plan should take, fastest available first.
//
// Returns undefined only when nothing is usable, which today means no builder
// key and no verified Trustware chain and a deposit below the CCTP minimum.
export function chooseFundingRoute(
  availability: FundingAvailability,
  amountUsd: number,
): FundingRoute | undefined {
  return FUNDING_ROUTES.find((route) => {
    if (route.requiresBuilderKey && !availability.hasBuilderKey) return false;
    if (
      route.deliversOn !== "solana" &&
      !availability.trustwareChains.includes(route.deliversOn)
    ) {
      return false;
    }
    return amountUsd >= route.minimumUsd;
  });
}

// What actually lands as margin after the road takes its cut.
//
// Sized from the delivered figure rather than the borrowed one, because a hedge
// sized on the pre-bridge number posts less margin than it planned for and comes
// out under-hedged by exactly the spread.
export function deliveredMarginUsd(
  route: FundingRoute,
  borrowedUsd: number,
  quotedLossBps?: number,
): number {
  const lossBps = quotedLossBps ?? route.plannedLossBps;
  return borrowedUsd * (1 - lossBps / 10_000);
}

// Guard on a destination address before anything is signed.
//
// The mirror of guard 1 in lib/ondo/fund.ts: a funding destination is never
// caller-supplied. It comes from Lighter, over Lighter's own API, derived from
// the user's L1 address. This checks only that the shape matches the road, which
// is the failure that actually loses money: an EVM-shaped address on the Solana
// road, or a base58 one on an EVM road, sends the funds somewhere nobody holds a
// key for. lib/lighter/deposit.ts does the deeper on-chain inspection for the
// Solana case.
export function destinationShapeMatches(
  route: FundingRoute,
  address: string,
): boolean {
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(address);
  return route.deliversOn === "solana" ? !isEvm : isEvm;
}

// Chain id for the intent address this route needs, or undefined for the UDA
// road, which addresses by wallet rather than by chain.
export function intentChainId(route: FundingRoute): number | undefined {
  return route.intentChain
    ? LIGHTER_INTENT_CHAIN_IDS[route.intentChain]
    : undefined;
}
