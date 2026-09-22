// The Earn grid in Trader mode: one card per venue a user can put Solana USDC
// into and hold a yielding position. This is the registry of what a card
// says; the live figures come from lib/trader/use-earn-venues.ts and the
// position from the page's earn read (lib/positions/use-earn-positions.ts),
// matched by `positionKey`.
//
// Deliberately short. The Trader Earn surface lists the venues the product
// owner named for it (docs/trader-mode-plan.md, D3): shMON staking today and
// Uniswap liquidity pools when that venue is built. The USDC vaults the
// Investor Earn tab carries are not here unless that decision changes.

import { SHMON_SYMBOL } from "@/lib/shmonad/constants";
import { VENUE_LOGOS } from "@/lib/tokens/logos";
import type { WalletChain } from "@/lib/ui/chains";

export type EarnVenueId = "shmonad" | "uniswap";

export interface EarnVenueCard {
  id: EarnVenueId;
  // The card's title and the product behind it.
  name: string;
  operator: string;
  // The chain the position settles on, or null for a venue that spans
  // several and names them on its own card.
  chain: WalletChain["id"] | null;
  // The mark for the position token and the operator's mark.
  logo: string;
  operatorLogo: string;
  // What the user pays with and what they end up holding.
  put: string;
  hold: string;
  kind: "Staking" | "Liquidity pool";
  // One sentence of mechanism for the card. The venue's own component
  // carries the full disclosure.
  summary: string;
  // How the position leaves, for the card's foot.
  exit: string;
  // Prefix of the PositionRow.key values lib/positions/earn.ts gives this
  // venue. A venue with one position matches exactly; one with a row per
  // pool matches them all, and the card sums them.
  positionKey: string;
  // Words the search box matches on top of the name and operator.
  search: string[];
}

export const EARN_VENUES: readonly EarnVenueCard[] = [
  {
    id: "shmonad",
    name: "shMON staking",
    operator: "FastLane",
    chain: "monad",
    logo: "/logos/shmonad.png",
    operatorLogo: VENUE_LOGOS.shmonad,
    put: "USDC",
    hold: SHMON_SYMBOL,
    kind: "Staking",
    summary:
      "USDC becomes MON and is staked. Rewards compound into the share price every epoch.",
    exit: "Instant with a fee, or free after about a day",
    positionKey: "earn:shmonad",
    search: ["mon", "monad", "stake", "staking", "fastlane"],
  },
  {
    id: "uniswap",
    name: "Liquidity pools",
    operator: "Uniswap",
    // Twelve pools across four chains; the card lists them by group.
    chain: null,
    logo: VENUE_LOGOS.uniswap,
    operatorLogo: VENUE_LOGOS.uniswap,
    put: "USDC",
    hold: "LP",
    kind: "Liquidity pool",
    summary:
      "USDC becomes both sides of a pair and earns a share of every trade through the pool.",
    exit: "Withdraw any time; the position comes back as both tokens",
    // Positions are one row per pool, so the grid sums them itself.
    positionKey: "earn:uniswap:",
    search: ["uniswap", "lp", "liquidity", "pool", "fees", "robinhood", "monad", "base", "ethereum"],
  },
];

export function earnVenueById(id: string): EarnVenueCard | undefined {
  return EARN_VENUES.find((v) => v.id === id);
}
