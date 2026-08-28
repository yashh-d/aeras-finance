// Server-only Ethereum reads for the Morpho Blue gold market.
//
// Kept to plain JSON-RPC POSTs rather than a viem public client, matching
// app/api/morpho/position/route.ts: these are reads, and standing up an
// app-owned EVM provider is a bigger commitment than the job needs.
//
// Two things this module is careful about, both of which produce a
// wrong-but-plausible number if skipped:
//
//   1. Interest is accrued forward before any debt is priced. `market(id)`
//      returns totals as of the last write that touched the market, so debt
//      read straight off them is understated by however much interest has
//      accrued since. See accrueInterest in ./gold-math.ts.
//   2. Accrual uses the latest BLOCK's timestamp, not the server's clock. The
//      contract compounds against block.timestamp, and borrowing the wall clock
//      instead would drift from what an on-chain check computes.

import "server-only";

import {
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
} from "viem";

import {
  MORPHO_BLUE_ABI,
  MORPHO_IRM_ABI,
  MORPHO_ORACLE_ABI,
} from "./gold-abi";
import {
  ETHEREUM_RPC_URL,
  MORPHO_BLUE,
  marketParamsTuple,
  type MorphoBlueMarket,
} from "./gold-market";
import {
  accrueInterest,
  type MarketState,
  type RawPosition,
} from "./gold-math";

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

interface RpcCall {
  method: string;
  params: unknown[];
}

// One batched JSON-RPC round trip. Public endpoints rate-limit per request
// rather than per payload, and a full position read is eight calls, so batching
// is the difference between one request and eight.
async function rpcBatch(calls: RpcCall[]): Promise<Hex[]> {
  const res = await fetch(ETHEREUM_RPC_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      calls.map((c, i) => ({ jsonrpc: "2.0", id: i, ...c })),
    ),
  });
  if (!res.ok) throw new Error(`Ethereum RPC ${res.status}`);
  const json = (await res.json()) as
    | { id: number; result?: Hex; error?: { message: string } }[]
    | { error?: { message: string } };
  if (!Array.isArray(json)) {
    throw new Error(json.error?.message ?? "Ethereum RPC: unexpected response");
  }
  // Batch responses are not required to come back in request order.
  const byId = new Map(json.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const entry = byId.get(i);
    if (!entry) throw new Error(`Ethereum RPC: no response for call ${i}`);
    if (entry.error) throw new Error(entry.error.message);
    if (!entry.result) throw new Error(`Ethereum RPC: empty result for call ${i}`);
    return entry.result;
  });
}

function call(to: string, data: Hex): RpcCall {
  return { method: "eth_call", params: [{ to, data }, "latest"] };
}

export interface GoldMarketRead {
  // Totals brought forward to the latest block.
  state: MarketState;
  // Totals as stored, before accrual. Kept because the IRM has to be asked
  // about the pre-accrual market, and because the check script compares them.
  rawState: MarketState;
  // Per-second borrow rate, WAD-scaled.
  borrowRatePerSecond: bigint;
  // Collateral price, scaled by ORACLE_PRICE_SCALE.
  oraclePrice: bigint;
  // Latest block timestamp, unix seconds.
  blockTimestamp: bigint;
}

function decodeMarket(data: Hex): MarketState {
  const [
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets,
    totalBorrowShares,
    lastUpdate,
    fee,
  ] = decodeFunctionResult({
    abi: MORPHO_BLUE_ABI,
    functionName: "market",
    data,
  });
  return {
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets,
    totalBorrowShares,
    lastUpdate,
    fee,
  };
}

// Market-level state: totals, rate and oracle price. No address involved.
export async function readGoldMarket(
  market: MorphoBlueMarket,
): Promise<GoldMarketRead> {
  const id = market.id as Hex;

  // The IRM needs the market struct as an argument, so this is two sequential
  // round trips rather than one: read the market, then price its rate.
  const [marketHex, oracleHex, blockHex] = await rpcBatch([
    call(
      MORPHO_BLUE,
      encodeFunctionData({
        abi: MORPHO_BLUE_ABI,
        functionName: "market",
        args: [id],
      }),
    ),
    call(
      market.oracle,
      encodeFunctionData({ abi: MORPHO_ORACLE_ABI, functionName: "price" }),
    ),
    { method: "eth_getBlockByNumber", params: ["latest", false] },
  ]);

  const rawState = decodeMarket(marketHex);
  const oraclePrice = decodeFunctionResult({
    abi: MORPHO_ORACLE_ABI,
    functionName: "price",
    data: oracleHex,
  });
  // eth_getBlockByNumber returns an object, not a hex word, so it sidesteps the
  // Hex typing the other two use.
  const blockTimestamp = BigInt(
    (blockHex as unknown as { timestamp: string }).timestamp,
  );

  const [rateHex] = await rpcBatch([
    call(
      market.irm,
      encodeFunctionData({
        abi: MORPHO_IRM_ABI,
        functionName: "borrowRateView",
        args: [marketParamsTuple(market), rawState],
      }),
    ),
  ]);
  const borrowRatePerSecond = decodeFunctionResult({
    abi: MORPHO_IRM_ABI,
    functionName: "borrowRateView",
    data: rateHex,
  });

  return {
    rawState,
    state: accrueInterest(rawState, borrowRatePerSecond, blockTimestamp),
    borrowRatePerSecond,
    oraclePrice,
    blockTimestamp,
  };
}

export interface GoldWalletRead {
  position: RawPosition;
  // Wallet balances on Ethereum, atomic.
  collateralBalanceAtomic: bigint;
  loanBalanceAtomic: bigint;
  // Native ETH, wei. Every action on this market spends it.
  ethBalanceAtomic: bigint;
}

// A borrower's position plus the wallet balances the forms need.
export async function readGoldWallet(
  market: MorphoBlueMarket,
  address: string,
): Promise<GoldWalletRead> {
  const owner = address as `0x${string}`;
  const balanceOf = (token: string) =>
    call(
      token,
      encodeFunctionData({
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),
    );

  const [positionHex, collateralHex, loanHex, ethHex] = await rpcBatch([
    call(
      MORPHO_BLUE,
      encodeFunctionData({
        abi: MORPHO_BLUE_ABI,
        functionName: "position",
        args: [market.id as Hex, owner],
      }),
    ),
    balanceOf(market.collateralToken.address),
    balanceOf(market.loanToken.address),
    { method: "eth_getBalance", params: [owner, "latest"] },
  ]);

  const [supplyShares, borrowShares, collateral] = decodeFunctionResult({
    abi: MORPHO_BLUE_ABI,
    functionName: "position",
    data: positionHex,
  });

  const decodeBalance = (data: Hex) =>
    decodeFunctionResult({
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      data,
    });

  return {
    position: { supplyShares, borrowShares, collateral },
    collateralBalanceAtomic: decodeBalance(collateralHex),
    loanBalanceAtomic: decodeBalance(loanHex),
    ethBalanceAtomic: BigInt(ethHex),
  };
}

// Current gas price, wei. The gold funding planner sizes its ETH top-up from
// this rather than from a constant, because Ethereum gas moves by an order of
// magnitude within a week and a hardcoded top-up would be either wasteful or
// useless depending on when it was written.
export async function readGasPrice(): Promise<bigint> {
  const [hex] = await rpcBatch([{ method: "eth_gasPrice", params: [] }]);
  return BigInt(hex);
}
