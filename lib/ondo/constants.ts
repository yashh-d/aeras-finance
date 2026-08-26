// Ondo Perps is an offchain perps exchange that accepts Ondo tokenized equities
// as margin, not just stablecoins. That is the only reason we use it: it lets a
// user short the stock they already hold, collateralised by that same stock.
//
// See docs/ondo-perps.md. Prefer the live API over the prose docs: they disagree
// on deposit networks, the collateral list, max leverage and trading hours.

// Production by default, sandbox only when asked for explicitly. Server-only so
// the environment cannot be flipped from the browser.
//
// This default flipped on 2026-08-25. It used to be sandbox, on the theory that
// nothing could be traded until Ondo issued a builder code. Both halves of that
// have since stopped being true: the code landed, and sandbox drifted far enough
// that it no longer models the venue. Sandbox does not list SPYon or QQQon in
// its token config at all now, so the self-collateralized hedge, the entire
// reason we are here, cannot be exercised there. Serving a sandbox catalog to
// the app would show markets and collateral that production does not have.
export type OndoEnv = "sandbox" | "production";

export const ONDO_ENV: OndoEnv =
  process.env.ONDO_PERPS_ENV === "sandbox" ? "sandbox" : "production";

export const ONDO_IS_PRODUCTION = ONDO_ENV === "production";

// The two environments are not the same exchange with fake money. Measured
// 2026-08-10, they disagree on things the hedge depends on:
//
//   - Collateral contract addresses differ for every equity token. Sandbox SPYon
//     is 0x86C75385..., production is 0xfedc5f4a.... A deposit built against the
//     wrong one is sent to a contract that does not exist on that chain.
//   - Sandbox lists a Solana USDC deposit path. Production does not.
//   - Sandbox has SPY-USD.P and QQQ-USD.P enabled. Production disables them,
//     which is the whole reason SPY and QQQ have to be hedged with index perps.
//
// So a hedge tested end to end in sandbox proves less than it appears to.
// scripts/ondo-hedge-check.mts asserts against production and diffs the two.
export const ONDO_API_HOSTS = {
  production: "api.ondoperps.xyz",
  sandbox: "api.ondoperps-sandbox.xyz",
} as const;

export const ONDO_API_HOST = ONDO_API_HOSTS[ONDO_ENV];

export const ONDO_API_BASE_URL = `https://${ONDO_API_HOST}`;
export const ONDO_WS_URL = `wss://${ONDO_API_HOST}/ws`;

// Issued by the Ondo team after emailing builders@ondoperps.xyz. Attributes
// routed fills to us. Not a secret: it travels on every order we send and
// identifies Aeras as the venue that routed the fill. Env-overridable so a
// second code can be pointed at without a code change.
export const ONDO_BUILDER_CODE = process.env.ONDO_BUILDER_CODE ?? "aeras";

// Builders are capped at 10 bps per order by Ondo.
export const ONDO_BUILDER_MAX_FEE_BPS = 10;

// What we charge on a routed fill, in bps. Fractional values are allowed.
//
// Zero by default, which means orders carry the code for attribution and
// collect no commission. Ondo applies no rate of its own to a builder code, so
// an unset rate is a free fill rather than a default one, and a rate above the
// cap is *not* rejected at request validation (measured 2026-08-25: 25 bps
// reached the margin check like any valid order). Both directions of that are
// silent, so lib/ondo/builder.ts is the only thing enforcing either bound.
export const ONDO_BUILDER_FEE_BPS = readFeeBps();

function readFeeBps(): number {
  const raw = process.env.ONDO_BUILDER_FEE_BPS;
  if (raw === undefined || raw.trim() === "") return 0;

  const bps = Number(raw);
  if (!Number.isFinite(bps) || bps < 0) {
    throw new Error(`ONDO_BUILDER_FEE_BPS must be a non-negative number, got ${raw}`);
  }
  if (bps > ONDO_BUILDER_MAX_FEE_BPS) {
    throw new Error(
      `ONDO_BUILDER_FEE_BPS is ${bps}, above Ondo's ${ONDO_BUILDER_MAX_FEE_BPS} bps builder cap`,
    );
  }
  return bps;
}

// Auth is SIWE on Ethereum mainnet regardless of which chain the deposit lands
// on, so this is not the deposit chain.
export const ONDO_AUTH_CHAIN_ID = "1";

// The JWT Ondo mints lives exactly 24 hours (exp - iat = 86400, measured
// 2026-08-25). The session cookie is capped to the same, so a cookie can never
// outlive the token it carries and present an expired session as a live one.
export const ONDO_JWT_TTL_SECONDS = 86_400;

// The SIWE challenge itself expires five minutes after it is issued, which the
// message states inline. A user who leaves the signing prompt open longer than
// that signs a dead challenge, so the flow re-issues rather than retrying.
export const ONDO_CHALLENGE_TTL_SECONDS = 300;

// httpOnly, so the Ondo JWT never reaches page JavaScript. It authorises
// trading on the user's own Ondo account, and unlike the Privy token it is not
// scoped to a single action.
export const ONDO_SESSION_COOKIE = "ondo_session";

// Every accepted collateral asset is Ethereum-only in production (USDC is also
// on Arbitrum). There is no production Solana deposit path for anything, despite
// provision_address advertising a `solana` enum value and sandbox listing one.
// Verified against live tokenConfig.
export const ONDO_DEPOSIT_NETWORK = "ethereum";

// Discount applied to tokenized-equity collateral before it counts as margin.
// Not returned by any endpoint, so it is a constant here and will go stale
// silently if Ondo changes it. Re-check against docs/ondo-perps.md periodically.
export const ONDO_EQUITY_HAIRCUT = 0.1;

// At this loan-to-value the exchange auto-sells collateral to clear USDC debt.
// Also prose-only, also not returned by any endpoint.
export const ONDO_AUTO_EXCHANGE_LTV = 0.3;

// Auto-exchange has a second trigger the LTV threshold hides: debt above this
// figure fires it regardless of how much collateral backs the position.
//
//   Allowed USDC Debt = min(Non-USDC Margin Value x 30%, $100,000)
//
// The two bind in opposite regimes. Below about $333k of credited collateral
// the LTV threshold is reached first; above it, this cap is. A hedge sized
// against LTV alone would put the trigger in the wrong place for exactly the
// accounts with the most at stake. Public Beta parameter, stated as adjustable.
export const ONDO_MAX_USDC_DEBT = 100_000;

// Auto-exchange during a weekend or a US market holiday costs an extra 2.5% of
// the debt repaid, funded by selling that much more collateral. It exists
// because converting a tokenized equity while the underlying market is closed
// runs into thin on-chain liquidity.
//
// This matters more for a hedge than the number suggests. A hedge is a short,
// so it accrues debt precisely when the market rallies, and the weekend is when
// the collateral cannot be sold into a real market. Weekends run Friday 20:00
// ET through Sunday 20:00 ET.
export const ONDO_CLOSED_MARKET_AE_FEE = 0.025;
