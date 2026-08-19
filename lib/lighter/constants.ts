// Lighter is a zk-rollup perps exchange. We use it to let a user who is long a
// tokenized stock open an offsetting short without selling the stock.
//
// It replaces the Ondo Perps route (lib/ondo) for hedging. The comparison that
// decided it, measured against both live APIs on 2026-08-16:
//
//   - Lighter lists SPY and QQQ as their own markets at share level. SPY marks
//     776 against the ETF's 776. Ondo disables SPY-USD.P and QQQ-USD.P in
//     production and forces the hedge through US500-USD.P and US100-USD.P, which
//     are priced at index level by a different factor each (10x and 41x).
//   - Ten of our eleven xStocks get an exact market here. Under Ondo only two of
//     four Jupiter Lend underlyings could even self-collateralize.
//   - Maker and taker fees are both 0.
//   - Access is permissionless. Ondo needs an invite code and a builder code
//     issued by email, which we still do not have.
//
// What we give up is self-collateralization. Ondo accepts SPYon and QQQon as
// margin, so the stock pays for its own hedge. Lighter margin is USDC, so a
// hedge needs separate capital. Multi-Asset Margin exists but is ETH-only with a
// 2000 ETH global cap, and will not accept Solana-issued xStocks.

export const LIGHTER_API_BASE_URL = "https://mainnet.zklighter.elliot.ai";
export const LIGHTER_API_PREFIX = "/api/v1";
export const LIGHTER_WS_URL = "wss://mainnet.zklighter.elliot.ai/stream";

// Lighter's own chain id, not an EVM one. It is mixed into every transaction
// hash, so a wrong value produces a signature the sequencer rejects rather than
// an obvious error. 300 is testnet.
export const LIGHTER_CHAIN_ID = 304;

// There is no sandbox to diff against, which is a simplification over Ondo: the
// numbers this module asserts come from the same host that orders go to. See
// scripts/lighter-check.mts.

// Margin fractions in orderBookDetails are integers scaled so that 10000 is
// 100%. Nothing in the docs states the scale, so it was derived: BTC and ETH
// carry min_initial_margin_fraction 200, and Lighter advertises 50x maximum
// leverage on both. 10000 / 200 = 50. Every other market agrees with its
// published maximum under the same divisor.
export const LIGHTER_MARGIN_FRACTION_SCALE = 10000;

// Quoted sizes and prices cross the wire as integers, scaled by the per-market
// size_decimals and price_decimals from orderBookDetails. Never assume a market
// shares another's precision: SPY uses 4 size decimals, AAPL uses 3.

// USDC is the only asset that can be deposited to a perps account, at 6
// decimals.
export const LIGHTER_COLLATERAL_SYMBOL = "USDC";
export const LIGHTER_COLLATERAL_DECIMALS = 6;

// Deposits credit an Ethereum L1 address, which is why this integration needs
// the Privy embedded EVM wallet (lib/privy/evm.ts) even though the rest of Aeras
// is Solana-only. The account itself is auto-provisioned by the first deposit,
// with no signature or contract call to create it.
export const LIGHTER_DEPOSIT_CONTRACT =
  "0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7";

// Direct deposit on Ethereum mainnet: approve, then deposit (0x8a857083).
export const LIGHTER_DEPOSIT_SELECTOR = "0x8a857083";
export const LIGHTER_WITHDRAW_SELECTOR = "0xd20191bd";

// Deposits by intent address: POST /createIntentAddress returns a per-user
// address to send USDC to, with no approve and no contract call.
//
// Solana is accepted here, which the docs do not say. They list only Arbitrum,
// Base and Avalanche. Measured against production on 2026-08-16:
//
//   - chain_id 101 returns a base58 address, while Ethereum (1), 0, -1 and
//     999999 are all rejected with "chain id not supported". So the parameter is
//     validated and Solana is genuinely in the allowlist.
//   - That address is a real initialized SPL token account for USDC
//     (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v), rent-funded at the moment
//     the endpoint is called, whose authority is a PDA of a deployed upgradeable
//     Solana program. It is infrastructure, not a placeholder.
//   - The address is derived from from_addr, so two L1 addresses get two
//     different token accounts and a deposit stays attributable.
//
// This matters more than it looks: it removes the bridge from onboarding
// entirely. An Aeras user funds their Lighter account from the same Privy Solana
// wallet they already hold xStocks in. The embedded EVM wallet is still needed
// to key the account and to sign the ChangePubKey that registers a trading key,
// but that is a personal_sign and never needs gas or a chain switch.
//
// Treat it as undocumented until a live deposit has actually credited an L2
// balance. A funded token account proves Lighter built the path, not that the
// crediting side works. The EVM chains stay in this table as the documented
// fallback if Solana is ever withdrawn.
export const LIGHTER_INTENT_CHAIN_IDS = {
  solana: 101,
  arbitrum: 42161,
  base: 8453,
  avalanche: 43114,
} as const;

export type LighterIntentChain = keyof typeof LIGHTER_INTENT_CHAIN_IDS;

// Solana, because it is the wallet the user already funds. Every other option
// requires bridging USDC off Solana first.
export const LIGHTER_DEFAULT_INTENT_CHAIN: LighterIntentChain = "solana";

// Ethereum mainnet is deliberately absent: it is rejected by createIntentAddress
// and has to use the direct deposit contract above instead.

// Solana USDC, the mint an intent token account is opened against.
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Minimums, in USDC. CCTP deposits credit in roughly 15 to 20 minutes.
export const LIGHTER_MIN_CCTP_DEPOSIT_USDC = 5;
export const LIGHTER_MIN_L1_DEPOSIT_USDC = 1;
export const LIGHTER_MIN_FAST_WITHDRAW_USDC = 4;
export const LIGHTER_MIN_SECURE_WITHDRAW_USDC = 1;

// Hard cap on bars returned by /candles, measured live 2026-08-16: a 30-day
// window at 1h resolution asks for 720 and gets 501, the most recent ones. The
// `count_back` parameter the endpoint accepts is ignored, so this is the only
// thing that bounds a response and a wider window truncates the left edge of a
// chart with no error.
export const LIGHTER_MAX_CANDLES = 501;

// API key slots 0 through 3 are reserved for Lighter's own web and mobile
// clients. Writing to one of those would fight the user's own session on
// app.lighter.xyz, so ours starts above them.
export const LIGHTER_API_KEY_INDEX = 4;

// One L1 address can own several accounts. Type 0 is the main cross-margin
// account, the only one we trade. Isolated-margin sub-accounts share the address
// and carry a different type.
export const LIGHTER_MAIN_ACCOUNT_TYPE = 0;

// Transaction type tags for sendTx. The sequencer routes on these, so a correct
// signature under the wrong tag is still rejected.
export const LIGHTER_TX_TYPE_CHANGE_PUBKEY = 8;
export const LIGHTER_TX_TYPE_CREATE_ORDER = 14;
export const LIGHTER_TX_TYPE_CANCEL_ORDER = 15;

// Response codes we branch on rather than merely report.
//
// 21100 is the ordinary state of every user before their first deposit, not a
// failure. 20558 is the geo block described on lighterSendTx.
export const LIGHTER_ACCOUNT_NOT_FOUND = 21100;
export const LIGHTER_RESTRICTED_JURISDICTION = 20558;

// Funding settles hourly. Equity markets carry base_interest_rate 0.0032 against
// 0.0100 for BTC and ETH, and the rate is expressed in percent, so a short at
// zero premium accrues roughly 0.0004% an hour, near 3.5% annualized. Sign
// depends on the premium and has recently favoured shorts on SPY, but a weekend
// gap can move it either way while the underlying is closed.
export const LIGHTER_FUNDING_INTERVAL_HOURS = 1;
