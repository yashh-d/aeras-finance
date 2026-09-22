// The Bitwise Mag7X portfolio on Glider, and how this app names its parts.
//
// Read docs/glider.md before touching anything here. The short version: Mag7X
// is not a token. It is a Bitwise model portfolio that Glider runs inside a
// smart account per investor on Base, holding eight Coinbase-issued tokenized
// stocks at equal weight. Nothing in this file is an address a user can be
// sent to buy; the smart account is created per user at enrollment.

import { BASE_CHAIN_ID } from "@/lib/base/constants";

// Glider's strategy id (a ULID). The public page is glider.fi/strategy/<id>.
export const GLIDER_STRATEGY_ID = "01KZY1G56YFYWKS8AH0PR1YMQX";
export const GLIDER_STRATEGY_NAME = "Bitwise Mag7X";
export const GLIDER_STRATEGY_URL = `https://glider.fi/strategy/${GLIDER_STRATEGY_ID}`;

// The chain the strategy's assets live on. Enrollment asks Glider for a
// smart account here and nowhere else.
export const GLIDER_CHAIN_ID = BASE_CHAIN_ID;

// The B2B API. Keyed with GLIDER_API_KEY, server-side only.
export const GLIDER_API_BASE_URL = "https://api.glider.fi/v2";

// Glider's own frontend API, keyless. Read for two things the B2B API does
// not carry: the boosted-APR campaign behind the "10%" and the live TVL and
// user counts the strategy page shows. It is the frontend's contract, not a
// partner one, so scripts/glider-check.mts pins the shapes read here.
export const GLIDER_PUBLIC_API_BASE_URL = "https://api.glider.fi/v1/trpc";

// The fee the strategy page states. Display only; the B2B API does not
// return it, and Glider deducts it on-chain from rebalance swaps.
export const MAG7X_STRATEGY_FEE = 0.002;

// One holding of the model portfolio. `contract` is the Coinbase tokenized
// stock on Base (lowercased, as Glider returns it); `xstockSymbol` is the
// Backed xStock in lib/jupiter/xstocks.ts that tracks the same share, which
// is what prices the exposure table without a second price feed.
export interface Mag7xHolding {
  ticker: string;
  name: string;
  symbol: string;
  contract: string;
  xstockSymbol: string;
  // Fraction of 1.
  weight: number;
}

// Read from Glider's blueprint for the strategy on 2026-09-22, in the order
// the blueprint lists them. Every contract is on Coinbase's own registry at
// base.org/stocks. The check script compares this table to the live strategy
// allocation and fails if either the set or a weight has moved.
export const MAG7X_HOLDINGS: readonly Mag7xHolding[] = [
  { ticker: "AAPL", name: "Apple", symbol: "AAPLc", contract: "0xb200000000000000000000c2e324d24d7eecd1fb", xstockSymbol: "AAPLx", weight: 0.125 },
  { ticker: "GOOGL", name: "Alphabet", symbol: "GOOGLc", contract: "0xb2000000000000000000002d0ba3164cc74f58b7", xstockSymbol: "GOOGLx", weight: 0.125 },
  { ticker: "META", name: "Meta", symbol: "METAc", contract: "0xb2000000000000000000008bc8786b856e61707c", xstockSymbol: "METAx", weight: 0.125 },
  { ticker: "NVDA", name: "NVIDIA", symbol: "NVDAc", contract: "0xb20000000000000000000078ee7ce2fe4908108c", xstockSymbol: "NVDAx", weight: 0.125 },
  { ticker: "AMZN", name: "Amazon", symbol: "AMZNc", contract: "0xb200000000000000000000d9192b6b456483c2e8", xstockSymbol: "AMZNx", weight: 0.125 },
  { ticker: "TSLA", name: "Tesla", symbol: "TSLAc", contract: "0xb2000000000000000000001e800a7f5189430cd0", xstockSymbol: "TSLAx", weight: 0.125 },
  { ticker: "SPCX", name: "SpaceX", symbol: "SPCXc", contract: "0xb2000000000000000000007b9fcbd005511acbd5", xstockSymbol: "SPCXx", weight: 0.125 },
  { ticker: "MSFT", name: "Microsoft", symbol: "MSFTc", contract: "0xb200000000000000000000ab99cfa739e253872b", xstockSymbol: "MSFTx", weight: 0.125 },
] as const;

export function mag7xHoldingByContract(contract: string): Mag7xHolding | undefined {
  const key = contract.toLowerCase();
  return MAG7X_HOLDINGS.find((h) => h.contract === key);
}

// Glider skips any holding whose slice is under the strategy's swap
// threshold, which is **$5 per asset** on this strategy (read from
// GET /v2/strategies/{id}/preferences on 2026-09-22: thresholdUsd "5.00",
// slippageBps 1000). Eight equal slices at $5 is a $40 hard floor; below it
// some slices are simply never bought and the USDC sits idle. Fifty keeps
// every slice at $6.25 before the strategy's swap fees. The route itself is
// cheap: 25 USDC from Solana delivered 24.94 on Base for about $0.06 of
// fees the same day, a fifth of what the return leg costs
// (lib/trustware/base.ts).
export const MAG7X_MIN_DEPOSIT_USD = 50;

// Where a bare deposit stops being worth explaining and starts being worth
// warning about, in the ticket's copy.
export const MAG7X_SMALL_DEPOSIT_USD = 100;

// The sentinel a ladder round records when its borrowed USDC went into Mag7X
// rather than into a catalog asset. Namespaced so it can never collide with a
// Solana mint, which is base58 and cannot contain a colon.
export const GLIDER_LADDER_MINT = "glider:mag7x";

// How long the app waits for Glider to run a rebalance it asked for before it
// stops watching. The deposit is already in the smart account either way and
// the scheduler runs daily, so a timeout here is a display concern, not money.
export const GLIDER_OPERATION_TIMEOUT_MS = 4 * 60_000;
export const GLIDER_OPERATION_POLL_MS = 3_000;
