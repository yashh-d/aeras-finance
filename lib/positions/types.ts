// The shape of a position row, shared by every venue reader.
//
// Its own module because two of those readers import each other otherwise:
// lib/positions/earn.ts builds earn rows and use-positions.ts consumes them
// alongside borrow, hedge and perps.

import type { XStock } from "@/lib/jupiter/xstocks";

export type PositionKind = "borrow" | "earn" | "hedge" | "perps";

export type PositionTone = "neutral" | "positive" | "negative" | "warning";

export interface PositionRow {
  key: string;
  kind: PositionKind;
  // The asset or market the position is in. Drawn as the row's title.
  symbol: string;
  // Where it is held, and on what chain when that is not Solana.
  venue: string;
  venueLogo?: string;
  // Token identity for the row's logo. Absent for a perp on something we do not
  // list as a token, which falls back to a monogram.
  asset?: Pick<XStock, "symbol" | "name" | "logo">;
  // The position in dollars. Debt owed for a borrow, deposited value for earn,
  // notional for a perp. Groups total this, which is why each group states what
  // its own total means.
  usd: number;
  // The position in TOKENS, when the row is denominated in one. Set by the earn
  // venues, where a deposit really is a quantity of an asset, so the row can be
  // folded into the wallet's holdings list without inferring a quantity from a
  // dollar figure. Undefined where the venue reports value only.
  amount?: number;
  // What kind of earn position an earn row is, for the badge the wallet card
  // draws beside it. Every vault venue leaves it unset and reads "Vault";
  // shMON is a staking position and says so. Unset on every other kind.
  earnKind?: "vault" | "stake";
  // Size and direction, under the title.
  detail: string;
  // The one figure worth reading next to the value: a rate, a health factor,
  // coverage, unrealized PnL. Null when the venue gives us none.
  note: string | null;
  tone: PositionTone;
}

export interface PositionGroup {
  kind: PositionKind;
  label: string;
  rows: PositionRow[];
  totalUsd: number;
  // Totals mean different things per group, so each one says so rather than
  // stacking four unlabelled dollar figures that do not add up to anything.
  totalLabel: string;
}

export interface PositionsView {
  groups: PositionGroup[];
  count: number;
  // True only until the first read of every venue lands. A refresh must not
  // blank rows out from under someone reading them.
  loading: boolean;
  refresh: () => Promise<void>;
}
