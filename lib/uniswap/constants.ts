// Uniswap liquidity pools as an Earn venue: the endpoints, the per-chain
// contract addresses, and the venue's own tunables. The pools themselves are
// in ./pools.ts. See docs/uniswap-lp-plan.md.
//
// Contract addresses are from the Uniswap developer docs' deployment pages
// (developers.uniswap.org/docs/protocols/v4/deployments and the per-chain v3
// pages), read 2026-09-21, and every v4 pool id in the registry recomputes
// from the key `PositionManager.poolKeys` returns, which is how the check
// script proves the PositionManager address is the one the pools were
// minted through.

// Uniswap's Liquidity Provisioning API. Every endpoint is a POST under /lp
// and takes the key as `x-api-key`; the key is server-only and never reaches
// the browser (app/api/uniswap/lp is the proxy). Free on the Uniswap Developer
// Platform. The endpoints' chain list is unpublished; scripts/uniswap-check.mts
// section 5 is what says which chains the configured key serves.
export const UNISWAP_LP_API_BASE_URL = "https://liquidity.api.uniswap.org";

// Uniswap's interface GraphQL, the source of TVL and volume. Keyless, but it
// needs the app's own Origin header and refuses introspection; undocumented,
// so it is treated like the Nasdaq site API the Terminal uses: a circuit, a
// cache, a fallback (GeckoTerminal) and a stale-serve path.
export const UNISWAP_GRAPHQL_URL = "https://interface.gateway.uniswap.org/v1/graphql";
export const UNISWAP_GRAPHQL_ORIGIN = "https://app.uniswap.org";

// GeckoTerminal's keyless pool endpoint, the fallback for TVL and 24h volume.
// Lists both `robinhood` and `monad` as networks and serves v4 pools by pool
// id. About 30 requests a minute.
export const GECKOTERMINAL_API_BASE_URL = "https://api.geckoterminal.com/api/v2";

// Canonical Permit2, the same address on every chain here.
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export type UniswapChainId = 1 | 143 | 4663 | 8453;
export type UniswapProtocol = "V3" | "V4";

export interface UniswapChainContracts {
  v3PositionManager: string;
  v4PoolManager: string;
  v4PositionManager: string;
  v4StateView: string;
}

export const UNISWAP_CONTRACTS: Readonly<Record<UniswapChainId, UniswapChainContracts>> = {
  1: {
    v3PositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    v4PoolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    v4PositionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
    v4StateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  },
  143: {
    v3PositionManager: "0x7197e214c0b767cfb76fb734ab638e2c192f4e53",
    v4PoolManager: "0x188d586ddcf52439676ca21a244753fa19f9ea8e",
    v4PositionManager: "0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016",
    v4StateView: "0x77395f3b2e73ae90843717371294fa97cc419d64",
  },
  4663: {
    v3PositionManager: "0x73991a25c818bf1f1128deaab1492d45638de0d3",
    v4PoolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
    v4PositionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
    v4StateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  },
  8453: {
    v3PositionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    v4PoolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b",
    v4PositionManager: "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
    v4StateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
  },
};

// The band a new position takes around the current price, as a fraction of
// the price in basis points: 1000 is P/1.1 to P*1.1. One constant on
// purpose (docs/uniswap-lp-plan.md D3); a pool may override it on its
// registry entry, and none does.
export const BAND_BPS = 1000;

// Tick bounds of the protocol. A band is clamped inside them.
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

// Deposit sizing, in Solana USDC atomic (6 decimals). Below the minimum the
// legs' fixed fees (about $0.07 to $0.16 each, two or three of them) are a
// meaningful share; below the warn line the card says so.
export const MIN_DEPOSIT_USDC_ATOMIC = 10_000_000n;
export const DEPOSIT_FEE_WARN_USDC_ATOMIC = 50_000_000n;

// When sizing the mint, the independent side is offered at the wallet's
// holding less this margin, so the LP API's computed dependent amount and
// the deadline-bound calldata cannot ask for a wei more than is there.
export const MINT_MARGIN_BPS = 50;

// Slippage the LP API encodes into a mint or a decrease, in percent.
export const LP_SLIPPAGE_PERCENT = 0.5;

// Metrics caching: TVL and volume move slowly against how often the card
// polls, and the sources are rate-limited.
export const POOLS_CACHE_TTL_MS = 60_000;
export const POOLS_STALE_GRACE_MS = 30 * 60_000;
