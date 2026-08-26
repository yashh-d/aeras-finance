// Getting assets back out of Ondo Perps.
//
// This is the leg that was missing. Aeras could put collateral into Ondo
// (lib/ondo/fund.ts) and had no path back out, which meant the deposit was a
// one-way door: a user could self-collateralize a hedge and then had no way to
// reach their own tokens from this app.
//
// The exit is two steps on Ondo's side and one on ours:
//
//   1. Register a payout address. SIWE-gated, separate from login, one
//      off-chain signature, free.
//   2. POST /v1/withdraw. **Ondo performs the Ethereum transfer and pays the
//      gas**, which is why this leg needs no ETH from a wallet that has none.
//
// What lands is the asset that was deposited, on the chain it was deposited on.
// Ondo is explicit: "You withdraw the assets you deposited. You cannot deposit
// $100 of SPYon and withdraw $100 of USDC." Every collateral asset in the live
// token config is Ethereum-only, so every withdrawal lands on Ethereum. Getting
// it from there to Solana is a separate bridge leg and is not built here.
//
// ---------------------------------------------------------------------------
// The hard part is not the call. It is knowing how much there is to withdraw.
// ---------------------------------------------------------------------------
//
// **Ondo exposes no per-asset balance.** Not on /v1/perps/balance, which is
// pooled USD totals, and not anywhere else: the full path list has no holdings
// endpoint at all. There is no spot wallet to read, because collateral is part
// of the margin account. So held quantity has to be reconstructed, and this
// module does it twice, from two independent sources, and trusts the smaller:
//
//   Ledger      sum(completed deposits) - sum(open or completed withdrawals),
//               per asset. Exact for deposits and withdrawals, and blind to
//               anything else that moves collateral.
//
//   Margin      Ondo's own credited value, recovered in lib/ondo/risk.ts as
//               marginBalance - walletBalance - unrealizedPnl, divided back
//               through mark price and haircut. Live, and reflects auto-
//               exchange having sold collateral, which the ledger cannot see.
//               Only separable per asset when the account holds one non-USDC
//               asset, which is the common case for a self-collateralized
//               hedge.
//
// Auto-exchange is the reason both are needed. It sells collateral to clear
// USDC debt without any deposit or withdrawal record, so after it fires the
// ledger overstates the holding. Taking the lesser of the two means the offered
// amount can be stale-low, never stale-high, and a stale-low figure costs a
// second withdrawal while a stale-high one costs a rejected request.
//
// **But the margin figure only gets to cap when its haircut is published.** It
// is derived by dividing through `1 - haircut`, and Ondo publishes a haircut
// for three of its eight collateral assets. For the other five the 10% in
// lib/ondo/collateral.ts is an assumption, and where the real figure is larger
// the division understates the balance. Live SPCXon is haircut around 25%, so
// capping by the 10%-derived figure would have offered 0.1137 of a 0.136373
// balance and withheld 17% of someone's tokens with no explanation. An
// untrusted derivation therefore informs and never caps. See
// marginDerivedQuantity.
//
// Nothing here is treated as authoritative. Ondo decides what can leave, and
// the amount this module computes is an offer, not a promise: describeWithdrawalError
// below turns Ondo's refusal codes into something readable rather than pretending
// the arithmetic here pre-empted them.

import type { OndoCollateral } from "./collateral";
import { ONDO_DEPOSIT_NETWORK } from "./constants";
import type { LiveCollateralHealth } from "./risk";
import type {
  OndoBalance,
  OndoDeposit,
  OndoPosition,
  OndoWalletWithdrawal,
  OndoWithdrawRequest,
  OndoWithdrawalLimits,
} from "./types";

// Ondo's own withdrawal network for every asset it credits. Not configurable:
// assets come back on the chain they went out on, and the token config carries
// an `ethereum` entry for all eight and nothing else. USDC additionally lists
// arbitrum for deposits, but the withdraw enum is avalanche|ethereum|solana, so
// there is no arbitrum path out either.
export const ONDO_WITHDRAWAL_NETWORK = ONDO_DEPOSIT_NETWORK;

// The signing chain for the address-book SIWE challenge. Ondo's enum is EVM
// only ("1" | "43114"), which is the first of two independent reasons a
// withdrawal cannot be pointed at a Solana address.
export const ONDO_ADDRESS_BOOK_CHAIN_ID = "1";

// How far the ledger and margin-derived quantities may disagree before the
// difference is surfaced rather than silently resolved by taking the lesser.
//
// Some disagreement is expected and harmless: the ledger is in token units and
// the margin figure is recovered through a mark price and an assumed haircut,
// so it moves with the market between the two reads. 5% absorbs that. A gap
// wider than that means something moved the collateral that neither the deposit
// nor the withdrawal history records, and auto-exchange is the candidate.
const RECONCILE_TOLERANCE = 0.05;

// A withdrawal below this is refused before it is sent. Ondo answers
// `withdrawal_amount_too_small` with no published threshold, and a token
// withdrawal carries no fee, so this exists only to catch a fat-fingered zero
// rather than to model a real minimum.
const MIN_WITHDRAWAL_TOKENS = 1e-9;

// Deposit statuses that mean the tokens are credited and spendable.
//
// Ondo's published enum for a deposit is exactly `pending | confirmed`, which
// shares no success word with the withdrawal enum (`complete | failure |
// pending | cancelled | unknown`). `confirmed` is the real one; the other two
// are here because the two endpoints already disagree and a false negative
// here reads as "you have no balance" rather than as an error.
const DEPOSIT_CREDITED = new Set(["confirmed", "complete", "completed"]);

export interface OndoHolding {
  symbol: string;
  label: string;
  decimals: number;
  // Best estimate of what the account holds, in tokens. The lesser of the two
  // reconstructions described at the top of this file.
  quantity: number;
  // The two sources, kept separate so a caller can show its work rather than
  // presenting a reconciled number as if it were read from an endpoint.
  ledgerQuantity: number;
  marginQuantity: number | null;
  // False when marginQuantity was derived through an assumed haircut rather
  // than a published one, which makes it informative but not a cap. See
  // marginDerivedQuantity.
  marginQuantityTrusted: boolean;
  // The haircut Ondo's credited value actually implies, taking the ledger
  // quantity as given. The only measurement of it available: Ondo publishes no
  // haircut field on any endpoint, and its docs cover three assets of eight.
  impliedHaircut: number | null;
  // What lib/ondo/collateral.ts assumed. Differs from impliedHaircut when the
  // assumption is wrong, which is the point of carrying both.
  assumedHaircut: number;
  haircutDocumented: boolean;
  // True when the two quantity sources disagree by more than
  // RECONCILE_TOLERANCE. On a documented asset that means collateral moved
  // without a ledger record, and auto-exchange is the candidate. On an
  // undocumented one it more likely means the assumed haircut is wrong, which
  // is why impliedHaircut is carried alongside.
  reconciliationWarning: boolean;
  markPriceUsd: number | null;
  marketValueUsd: number | null;
  // Tokens this account may withdraw right now. Capped by margin only when
  // there are open positions or USDC debt; see withdrawableTokens.
  withdrawableQuantity: number;
  // What binds the withdrawable figure, for copy that explains a blocked
  // withdrawal instead of just showing a zero.
  limitedBy: "balance" | "margin" | "debt" | null;
}

export interface OndoWithdrawalView {
  holdings: OndoHolding[];
  // Registered payout addresses, lowercased for comparison.
  registeredAddresses: string[];
  // The wallet that owns the session. The only address this app will ever
  // register or withdraw to.
  ownAddress: string;
  ownAddressRegistered: boolean;
  // Seconds a newly registered address is held before it can receive. Zero
  // means none is active. Read from /v1/account rather than assumed: it is
  // undocumented outside the field description and differs by environment.
  cooldownPeriodSecs: number;
  limits: OndoWithdrawalLimits | null;
  // USD still available under the rolling cap, or null when Ondo returned no
  // limits. Independent of margin.
  limitRemainingUsd: number | null;
  withdrawalFeeUsd: number;
  history: OndoWalletWithdrawal[];
}

// Per-asset quantity from the deposit and withdrawal ledgers.
//
// Withdrawals are counted while still pending, not only once complete. A
// pending withdrawal has already left the withdrawable balance on Ondo's side,
// so ignoring it would offer the same tokens twice. `failure` and `cancelled`
// are the two that release, and they are the two excluded here.
export function ledgerQuantities(
  deposits: OndoDeposit[],
  withdrawals: OndoWalletWithdrawal[],
): Map<string, number> {
  const out = new Map<string, number>();

  for (const d of deposits) {
    // **Deposits and withdrawals use different status vocabularies**, and
    // getting this wrong is silent and total. A deposit is `pending` or
    // `confirmed`; a withdrawal is `complete`, `failure`, `pending`,
    // `cancelled` or `unknown`. There is no `complete` deposit, so filtering
    // deposits on that word drops every one of them and reports a zero balance
    // to a user who is holding collateral.
    //
    // The accept-list is wider than the enum on purpose. Ondo's published
    // enums have already proved incomplete once here
    // (`withdrawal_exceeds_chain_deposits` is real and unlisted), and every
    // word below is unambiguously terminal-success. `pending` is excluded
    // because an uncredited deposit is not spendable.
    if (!DEPOSIT_CREDITED.has(d.status.toLowerCase())) continue;
    const size = Number(d.size);
    if (!Number.isFinite(size)) continue;
    out.set(d.coin, (out.get(d.coin) ?? 0) + size);
  }

  for (const w of withdrawals) {
    if (w.status === "failure" || w.status === "cancelled") continue;
    const size = Number(w.size);
    if (!Number.isFinite(size)) continue;
    out.set(w.coin, (out.get(w.coin) ?? 0) - size);
  }

  return out;
}

// Ondo's credited collateral value divided back into a token quantity, plus the
// haircut that division implies.
//
// Only attempted when exactly one priceable non-USDC asset appears in the
// ledger. With two or more, the pooled figure cannot be split between them and
// guessing a division would be worse than declining to: the whole point of this
// second source is that it is independent of the ledger, and a split derived
// from the ledger would not be.
//
// **The derived quantity is only trustworthy when the haircut is.** It divides
// by `1 - collateral.haircut`, and that figure is published for USDC, SPYon and
// QQQon and *inferred at 10%* for everything else (see lib/ondo/collateral.ts).
// Where the real haircut is larger, dividing by the assumed one understates the
// quantity and would hide tokens the user owns. Measured on live SPCXon:
// 0.136373 tokens marking near $18.83 credited $14.13 of margin, a haircut of
// about 25%, not 10%. Capping the ledger by that derived figure would have
// offered 0.1137 SPCXon and silently withheld 17% of the balance.
//
// So `trustworthy` is returned alongside, and only a documented haircut earns
// it. `impliedHaircut` is reported either way, because for an undocumented
// asset it is the most direct measurement of the real haircut available
// anywhere: Ondo publishes no field for it.
interface MarginDerived {
  quantity: number;
  impliedHaircut: number | null;
  trustworthy: boolean;
}

function marginDerivedQuantity(
  symbol: string,
  collateral: OndoCollateral,
  health: LiveCollateralHealth,
  ledgerQuantity: number,
  nonUsdcSymbols: string[],
): MarginDerived | null {
  if (symbol === "USDC") return null;
  if (nonUsdcSymbols.length !== 1 || nonUsdcSymbols[0] !== symbol) return null;

  const mark = Number(collateral.markPriceUsd);
  if (!collateral.priceable || !(mark > 0)) return null;

  const postHaircut = mark * (1 - collateral.haircut);
  if (!(postHaircut > 0)) return null;

  const creditedUsd = Math.max(health.nonUsdcMarginValueUsd, 0);

  // What Ondo is actually discounting by, taking the ledger quantity as given.
  // Only meaningful when the ledger has something in it to divide by.
  const marketValueUsd = ledgerQuantity * mark;
  const impliedHaircut =
    marketValueUsd > 0 ? 1 - creditedUsd / marketValueUsd : null;

  return {
    quantity: creditedUsd / postHaircut,
    impliedHaircut,
    trustworthy: collateral.documented,
  };
}

// How much of a holding can leave right now.
//
// Ondo publishes `Withdrawable = max(0, min(Margin Balance - Used Margin,
// Wallet Balance))` and returns `withdrawableMargin` precomputed, but that
// formula is about *margin*, and reading it as a token cap gets the common case
// exactly wrong. `walletBalance` is the USDC balance (see liveCollateralHealth
// in lib/ondo/risk.ts), so an account holding only tokenized collateral and no
// USDC has a withdrawableMargin of zero while Ondo's own docs say the full
// token quantity comes back:
//
//   "The haircut does not reduce what you own. With no open positions and no
//    USDC Debt, you can withdraw your full deposited token quantity."
//
// So the carve-out is applied first and the margin cap only binds when there is
// something for it to bind against. Getting this backwards would have shown a
// withdrawable balance of zero to precisely the user who has no positions and
// nothing owed, which is the person most entitled to their tokens.
export function withdrawableTokens(args: {
  symbol: string;
  heldTokens: number;
  collateral: OndoCollateral;
  balance: OndoBalance;
  positions: OndoPosition[];
}): { quantity: number; limitedBy: OndoHolding["limitedBy"] } {
  const { symbol, heldTokens, collateral, balance, positions } = args;

  if (!(heldTokens > 0)) return { quantity: 0, limitedBy: "balance" };

  const withdrawableMargin = Number(balance.withdrawableMargin);
  const hasPositions = positions.length > 0;
  // `walletBalance` IS the USDC balance on this account (see the derivation in
  // liveCollateralHealth). Negative means the account owes USDC, which both
  // blocks USDC withdrawals outright and reduces token withdrawals.
  const usdcBalance = Number(balance.walletBalance);
  const owesUsdc = usdcBalance < 0;

  if (symbol === "USDC") {
    // USDC is the one asset the published formula reads correctly as-is: it is
    // denominated in the same units as the margin figure, and `walletBalance`
    // is exactly the "Wallet Balance" term in it.
    if (owesUsdc) return { quantity: 0, limitedBy: "debt" };
    const cap = Math.max(Math.min(withdrawableMargin, usdcBalance), 0);
    if (cap <= 0) return { quantity: 0, limitedBy: "margin" };
    return {
      quantity: Math.min(heldTokens, cap),
      limitedBy: cap < heldTokens ? "margin" : "balance",
    };
  }

  // The documented carve-out. Nothing is reserving the collateral, so all of it
  // is withdrawable regardless of what the margin figure says.
  if (!hasPositions && !owesUsdc) {
    return { quantity: heldTokens, limitedBy: "balance" };
  }

  const mark = Number(collateral.markPriceUsd);
  const postHaircut = collateral.priceable && mark > 0 ? mark * (1 - collateral.haircut) : 0;
  if (!(postHaircut > 0)) {
    // GLDon and SLVon: no market to mark against, so the margin cap cannot be
    // converted into tokens. Offering the full balance and letting Ondo refuse
    // is better than offering zero, since Ondo's refusal is informative and a
    // zero here is not.
    return { quantity: heldTokens, limitedBy: null };
  }

  const marginCapTokens = Math.max(withdrawableMargin, 0) / postHaircut;
  if (marginCapTokens < heldTokens) {
    return { quantity: marginCapTokens, limitedBy: owesUsdc ? "debt" : "margin" };
  }
  return { quantity: heldTokens, limitedBy: "balance" };
}

// Everything the withdraw surface needs, assembled from the reads that already
// exist plus the two ledgers.
export function buildWithdrawalView(args: {
  ownAddress: string;
  collateral: OndoCollateral[];
  deposits: OndoDeposit[];
  withdrawals: OndoWalletWithdrawal[];
  positions: OndoPosition[];
  balance: OndoBalance;
  health: LiveCollateralHealth;
  addressBook: string[];
  cooldownPeriodSecs: number;
  withdrawalFeeUsd: number;
  limits: OndoWithdrawalLimits | null;
}): OndoWithdrawalView {
  const ledger = ledgerQuantities(args.deposits, args.withdrawals);

  // USDC is the exception to the whole reconstruction problem: `walletBalance`
  // IS the live USDC balance, so it is read rather than reconstructed. It has
  // to be, because USDC moves for reasons no ledger records: realized PnL,
  // trading fees, funding payments, and auto-exchange all land in it. Overwrite
  // rather than merge, since the ledger figure is strictly worse.
  const usdcBalance = balanceOrZero(args.balance.walletBalance);
  if (usdcBalance > MIN_WITHDRAWAL_TOKENS) {
    ledger.set("USDC", usdcBalance);
  } else {
    ledger.delete("USDC");
  }

  // Symbols with a positive ledger quantity, excluding USDC. Decides whether the
  // margin-derived cross-check is separable.
  const nonUsdcSymbols = [...ledger.entries()]
    .filter(([symbol, qty]) => symbol !== "USDC" && qty > 0)
    .map(([symbol]) => symbol);

  const holdings: OndoHolding[] = [];

  for (const [symbol, ledgerQuantity] of ledger) {
    if (!(ledgerQuantity > MIN_WITHDRAWAL_TOKENS)) continue;

    const collateral = args.collateral.find((c) => c.symbol === symbol);
    // An asset in the ledger that is no longer in the token config. It can still
    // be withdrawn, so it is shown rather than dropped; what cannot be done is
    // valuing it or capping it by margin.
    if (!collateral) {
      holdings.push({
        symbol,
        label: symbol,
        decimals: 18,
        quantity: ledgerQuantity,
        ledgerQuantity,
        marginQuantity: null,
        marginQuantityTrusted: false,
        impliedHaircut: null,
        assumedHaircut: 0,
        haircutDocumented: false,
        reconciliationWarning: false,
        markPriceUsd: null,
        marketValueUsd: null,
        withdrawableQuantity: ledgerQuantity,
        limitedBy: null,
      });
      continue;
    }

    const derived = marginDerivedQuantity(
      symbol,
      collateral,
      args.health,
      ledgerQuantity,
      nonUsdcSymbols,
    );

    // The lesser of the two, but ONLY when the derived figure is trustworthy.
    //
    // Where the haircut is inferred rather than published, the derived quantity
    // is arithmetic on a guess: it would have withheld 17% of a real SPCXon
    // balance. So an untrusted derivation informs the user and never caps them.
    // Stale-low costs a second withdrawal, which is fine when the figure is
    // sound and unacceptable when it is not.
    const quantity =
      derived && derived.trustworthy
        ? Math.min(ledgerQuantity, derived.quantity)
        : ledgerQuantity;

    const reconciliationWarning =
      derived !== null &&
      ledgerQuantity > 0 &&
      Math.abs(derived.quantity - ledgerQuantity) / ledgerQuantity > RECONCILE_TOLERANCE;

    const mark = Number(collateral.markPriceUsd);
    const markPriceUsd = collateral.priceable && mark > 0 ? mark : null;

    const { quantity: withdrawableQuantity, limitedBy } = withdrawableTokens({
      symbol,
      heldTokens: quantity,
      collateral,
      balance: args.balance,
      positions: args.positions,
    });

    holdings.push({
      symbol,
      label: collateral.label,
      decimals: collateral.decimals,
      quantity,
      ledgerQuantity,
      marginQuantity: derived?.quantity ?? null,
      marginQuantityTrusted: derived?.trustworthy ?? false,
      impliedHaircut: derived?.impliedHaircut ?? null,
      assumedHaircut: collateral.haircut,
      haircutDocumented: collateral.documented,
      reconciliationWarning,
      markPriceUsd,
      marketValueUsd: markPriceUsd === null ? null : quantity * markPriceUsd,
      withdrawableQuantity,
      limitedBy,
    });
  }

  // Largest first, so the asset a hedge is collateralized with leads.
  holdings.sort((a, b) => (b.marketValueUsd ?? 0) - (a.marketValueUsd ?? 0));

  const registeredAddresses = args.addressBook.map((a) => a.toLowerCase());
  const limitRemainingUsd = args.limits
    ? Math.max(
        Number(args.limits.withdrawalLimitUsd) - Number(args.limits.currentWithdrawalsUsd),
        0,
      )
    : null;

  return {
    holdings,
    registeredAddresses,
    ownAddress: args.ownAddress,
    ownAddressRegistered: registeredAddresses.includes(args.ownAddress.toLowerCase()),
    cooldownPeriodSecs: args.cooldownPeriodSecs,
    limits: args.limits,
    limitRemainingUsd: Number.isFinite(limitRemainingUsd ?? NaN) ? limitRemainingUsd : null,
    withdrawalFeeUsd: args.withdrawalFeeUsd,
    history: args.withdrawals,
  };
}

export interface WithdrawalPlan {
  kind: "ready";
  symbol: string;
  amount: string;
  address: string;
  network: string;
  customerWithdrawalId: string;
  valueUsd: number | null;
}

export interface WithdrawalBlocked {
  kind: "blocked";
  reason: string;
}

export type WithdrawalPlanResult = WithdrawalPlan | WithdrawalBlocked;

// Validate a requested withdrawal against the view, before anything is sent.
//
// The destination is never an argument. It is the session's own wallet, which
// is both the account identity and the only address this app registers. A
// withdrawal function that accepted an address would be a way to route someone
// else's funds out of their account, which is the exact shape lib/ondo/fund.ts
// refuses on the way in.
export function planWithdrawal(args: {
  view: OndoWithdrawalView;
  symbol: string;
  // Tokens, as a decimal string from the UI. Not atomic units: Ondo's withdraw
  // endpoint takes a human-readable decimal amount, unlike every on-chain path
  // in this codebase.
  amount: string;
  // Supplied so a retry of the same attempt reuses its key rather than minting
  // a second one and withdrawing twice.
  customerWithdrawalId: string;
}): WithdrawalPlanResult {
  const { view, symbol, amount, customerWithdrawalId } = args;

  const holding = view.holdings.find((h) => h.symbol === symbol);
  if (!holding) {
    return { kind: "blocked", reason: `No ${symbol} balance to withdraw.` };
  }

  const requested = Number(amount);
  if (!Number.isFinite(requested) || requested <= MIN_WITHDRAWAL_TOKENS) {
    return { kind: "blocked", reason: "Enter an amount above zero." };
  }

  if (!view.ownAddressRegistered) {
    return {
      kind: "blocked",
      reason:
        "Register your wallet as a withdrawal address first. It takes one signature and Ondo will not send to an unregistered address.",
    };
  }

  // Compared with a small tolerance rather than exactly: the offered maximum is
  // a float that has been through a mark price, and refusing a user's own "max"
  // by a rounding error would be indefensible.
  if (requested > holding.withdrawableQuantity * 1.000001) {
    return {
      kind: "blocked",
      reason: describeLimit(holding),
    };
  }

  if (view.limitRemainingUsd !== null && holding.markPriceUsd !== null) {
    const valueUsd = requested * holding.markPriceUsd;
    if (valueUsd > view.limitRemainingUsd) {
      return {
        kind: "blocked",
        reason: `That is about $${valueUsd.toFixed(2)} and only $${view.limitRemainingUsd.toFixed(2)} is left under your rolling withdrawal limit. The limit is separate from margin and resets on Ondo's schedule.`,
      };
    }
  }

  return {
    kind: "ready",
    symbol,
    // Trimmed to the token's own precision. Ondo answers
    // `transfer_amount_precision_overflow` for anything finer, and a rejected
    // withdrawal over a trailing digit is a bad way to find that out.
    amount: trimPrecision(amount, holding.decimals),
    address: view.ownAddress,
    network: ONDO_WITHDRAWAL_NETWORK,
    customerWithdrawalId,
    valueUsd: holding.markPriceUsd === null ? null : requested * holding.markPriceUsd,
  };
}

export function toWithdrawRequest(plan: WithdrawalPlan): OndoWithdrawRequest {
  return {
    customer_withdrawal_id: plan.customerWithdrawalId,
    symbol: plan.symbol,
    network: plan.network,
    amount: plan.amount,
    address: plan.address,
  };
}

function describeLimit(holding: OndoHolding): string {
  const max = holding.withdrawableQuantity;
  switch (holding.limitedBy) {
    case "margin":
      return `Only ${formatTokens(max)} ${holding.symbol} is withdrawable while your open positions are using margin. Close a position to free the rest.`;
    case "debt":
      return `Only ${formatTokens(max)} ${holding.symbol} is withdrawable while the account carries USDC debt. USDC debt reduces withdrawable margin dollar for dollar, so repaying it or closing the position releases the rest.`;
    default:
      return `You hold ${formatTokens(max)} ${holding.symbol}.`;
  }
}

function formatTokens(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function balanceOrZero(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// Cut a decimal string to at most `decimals` places without rounding up, so a
// "withdraw max" can never ask for more than the balance.
export function trimPrecision(amount: string, decimals: number): string {
  const [whole, fraction = ""] = amount.trim().split(".");
  if (fraction.length <= decimals) return amount.trim();
  const trimmed = fraction.slice(0, decimals).replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}

// Ondo's withdrawal rejections, in language a user can act on.
//
// The default in this codebase is to surface the upstream message, but these
// codes are the exception: several of them name an internal concept ("internal
// withdrawal address") or say nothing at all about the remedy, and a withdrawal
// is the one place a user needs to know whether their money is stuck or the
// request was simply wrong.
//
// **Ondo's published enum is incomplete.** `withdrawal_exceeds_chain_deposits`
// is not in the OpenAPI spec's error list and was found by attempting a real
// withdrawal in scripts/ondo-withdraw-check.mts. So the fallback matters: this
// switch is a best effort over a set Ondo has not fully published, not a
// closed mapping, and an unrecognised code must still reach the user.
export function describeWithdrawalError(code: string | undefined, fallback: string): string {
  switch (code) {
    // Undocumented, and the first check Ondo runs: it refuses before it ever
    // looks at the address book. Worth knowing, because it means withdrawals
    // are bounded per network by what was deposited on that network, which is
    // the same model the ledger reconstruction above uses.
    case "withdrawal_exceeds_chain_deposits":
      return "Ondo says this is more than was deposited on Ethereum. Withdrawals are capped per network by the deposits made on it. Try a smaller amount, or check the deposit history.";
    case "withdrawal_address_not_found":
    case "bad_withdrawal_address":
      return "Ondo does not have this address registered. Register it again, then retry the withdrawal.";
    case "internal_withdrawal_address":
      return "That address belongs to Ondo itself and cannot receive a withdrawal.";
    case "withdrawal_error_insufficient_balance":
    case "insufficient_funds":
      return "Ondo says the balance is lower than this app calculated. Ondo exposes no per-asset balance, so the figure shown here is reconstructed from deposit and withdrawal history and can be stale if auto-exchange sold collateral. Try a smaller amount.";
    case "withdrawal_limit_exceeded":
      return "This exceeds the rolling withdrawal limit on the account. The limit is separate from margin and resets on Ondo's schedule.";
    case "withdrawal_duplicate_customer_withdrawal_id":
      return "This withdrawal was already submitted. Check the withdrawal history before sending it again.";
    case "transfer_amount_precision_overflow":
      return "The amount has more decimal places than the token allows. Round it down and retry.";
    case "withdrawal_amount_too_small":
      return "Ondo rejected this amount as too small to withdraw.";
    case "invalid_withdrawal_network":
    case "invalid_network":
      return "Ondo will not send this asset on this network. Assets are withdrawn to the chain they were deposited on, which is Ethereum for everything Ondo credits.";
    case "withdrawal_try_later":
    case "service_unavailable":
      return "Ondo's withdrawal service is temporarily unavailable. Nothing was sent. Try again shortly.";
    case "withdrawal_system_error":
    case "withdrawal_failed":
      return "Ondo could not process this withdrawal. Nothing was sent. Check the withdrawal history before retrying.";
    default:
      return fallback;
  }
}
