"use client";

// Leg two of the Lighter exit: withdrawn USDC sitting at the embedded EVM
// wallet on Ethereum, coming home to the Solana wallet.
//
// Everything load-bearing here already exists and is production-tested
// elsewhere: executeEvmRoute is the engine the Monad return leg runs on, and
// the Trustware allowlist's funding-return shape (any source chain, canonical
// Solana USDC destination, the user's own Solana address) admits this request
// without a server change.
//
// The one thing Ethereum adds is gas. The embedded wallet is born with no ETH,
// and the source leg is an ERC-20 approve plus a transfer, so the leg refuses
// with a plain reason when the wallet cannot pay for it rather than failing
// inside a signature prompt. Topping up gas is offered by the caller, not done
// silently: it costs real money and the user may prefer to leave the USDC
// resting on Ethereum, which is a safe place for it to wait.

import { USDC_MINT } from "@/lib/jupiter/constants";
import {
  executeEvmRoute,
  type ConversionProgress,
  type EvmSigner,
} from "@/lib/trustware/execute";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import {
  extractEstimate,
  extractExecution,
  type TrustwareBalancesResponse,
  type TrustwareQuoteResponse,
} from "@/lib/trustware/types";
import { selectStableHoldings } from "@/lib/trustware/stables";

const ETHEREUM_CHAIN = "1";
const ETHEREUM_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

// Most the route may give up before this leg refuses, mirroring the funding
// direction's bound. USDC to USDC prices tight; a route past this is broken.
const MAX_RETURN_LOSS_BPS = 150n;

// Gas the source leg needs: an ERC-20 approve plus the router transfer. 300k
// units is roughly double a typical run, deliberately: refusing a leg that
// would have succeeded costs a retry, running out of gas mid-sequence costs a
// stuck approval.
const GAS_UNITS_RETURN_LEG = 300_000n;

// USDC the withdrawn balance shows on Ethereum for this wallet, in base units.
// Read through the Trustware balances proxy the wallet scan already uses, so
// no browser-side RPC and no new server surface.
export async function fetchEthereumUsdcAtomic(
  evmAddress: string,
): Promise<bigint> {
  const res = await fetch(
    `/api/trustware/balances?evm=${encodeURIComponent(evmAddress)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Balance scan failed (${res.status}).`);
  const body = (await res.json()) as TrustwareBalancesResponse;
  const eth = selectStableHoldings(body).find(
    (h) => h.chain === ETHEREUM_CHAIN,
  );
  return BigInt(eth?.balanceAtomic ?? "0");
}

export interface EthGasCheck {
  // Wei the wallet holds.
  balanceWei: bigint;
  // Wei the return leg needs at the current gas price, with the buffer above.
  requiredWei: bigint;
  ok: boolean;
}

// Whether the wallet can pay for the return leg, priced at the CURRENT gas
// price rather than a constant, because mainnet gas moves by an order of
// magnitude and a constant is wrong in one direction or the other within a
// week. Reads through the wallet's own provider: no chain switch is needed for
// reads, and eth_gasPrice and eth_getBalance are free.
export async function checkEthGas(evm: EvmSigner): Promise<EthGasCheck> {
  const provider = await evm.getProvider();
  const [balanceHex, priceHex] = await Promise.all([
    provider.request({
      method: "eth_getBalance",
      params: [evm.address, "latest"],
    }) as Promise<string>,
    provider.request({ method: "eth_gasPrice", params: [] }) as Promise<string>,
  ]);
  const balanceWei = BigInt(balanceHex);
  const requiredWei = BigInt(priceHex) * GAS_UNITS_RETURN_LEG;
  return { balanceWei, requiredWei, ok: balanceWei >= requiredWei };
}

// Bring Ethereum USDC home to the Solana wallet. Throws with a readable reason
// before anything is signed; after signing, executeEvmRoute's own tracking and
// receipts take over, and "failed" from Trustware means refunded at source.
export async function sendEthereumUsdcHome(args: {
  amountAtomic: bigint;
  evm: EvmSigner;
  solanaAddress: string;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
}): Promise<{ deliveredAtomic: string | null }> {
  if (args.amountAtomic <= 0n) {
    throw new Error("Nothing to bridge: the Ethereum balance is zero.");
  }

  const gas = await checkEthGas(args.evm);
  if (!gas.ok) {
    const needEth = Number(gas.requiredWei) / 1e18;
    throw new Error(
      `Your Ethereum wallet cannot pay gas for this transfer: it needs about ` +
        `${needEth.toFixed(5)} ETH and holds ${(Number(gas.balanceWei) / 1e18).toFixed(5)}. ` +
        "Top up ETH first, or leave the USDC on Ethereum; it is at your own address and safe there.",
    );
  }

  const minDelivered =
    (args.amountAtomic * (10_000n - MAX_RETURN_LOSS_BPS)) / 10_000n;

  const result = await executeEvmRoute({
    request: {
      fromChain: ETHEREUM_CHAIN,
      toChain: TRUSTWARE_SOLANA_CHAIN,
      fromToken: ETHEREUM_USDC,
      toToken: USDC_MINT,
      fromAmount: args.amountAtomic.toString(),
      fromAddress: args.evm.address,
      toAddress: args.solanaAddress,
      slippage: 0.3,
    },
    evm: args.evm,
    describe: "USDC",
    minDeliveredAtomic: minDelivered,
    onProgress: args.onProgress,
    signal: args.signal,
  });
  return { deliveredAtomic: result.deliveredAtomic };
}

// ── Gas top-up ──────────────────────────────────────────────────────────────
//
// The embedded EVM wallet is born with no ETH, and the return leg cannot run
// without it. This buys a small amount of ETH with Solana USDC, delivered by
// Trustware's solver straight to the wallet, so the user signs once on Solana
// and never needs gas to RECEIVE gas. Both sides of the pair sit in the
// curated swap registry, so the proxy admits the request without a server
// change. Same mechanism the gold market uses; sized here for one return leg
// rather than a full borrow lifecycle.

const GAS_PROBE_USDC_ATOMIC = 2_000_000n; // $2, for pricing only.
const GAS_TARGET_MULTIPLE = 2n; // buy twice today's need; gas moves.
const GAS_TOPUP_MAX_USDC = 15; // refuse a top-up that costs more than this.

export interface GasTopUpPlan {
  usdcAtomic: bigint;
  targetWei: bigint;
  ok: boolean;
  reason?: string;
}

async function routeUsdcToEth(
  fromAddress: string,
  toAddress: string,
  fromAmountAtomic: bigint,
): Promise<TrustwareQuoteResponse> {
  const res = await fetch("/api/trustware/route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromChain: TRUSTWARE_SOLANA_CHAIN,
      toChain: ETHEREUM_CHAIN,
      fromToken: USDC_MINT,
      toToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      fromAmount: fromAmountAtomic.toString(),
      fromAddress,
      toAddress,
      slippage: 0.3,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Gas route failed (${res.status}).`);
  }
  return (await res.json()) as TrustwareQuoteResponse;
}

// Price the top-up: probe $2, scale to the target, cap the cost.
export async function planGasTopUp(args: {
  evm: EvmSigner;
  solanaAddress: string;
  solanaUsdcAtomic: bigint;
}): Promise<GasTopUpPlan> {
  const gas = await checkEthGas(args.evm);
  if (gas.ok) {
    return { usdcAtomic: 0n, targetWei: 0n, ok: false, reason: "Gas is already covered." };
  }
  const targetWei = gas.requiredWei * GAS_TARGET_MULTIPLE;

  const probe = await routeUsdcToEth(
    args.solanaAddress,
    args.evm.address,
    GAS_PROBE_USDC_ATOMIC,
  );
  const probeOut = extractEstimate(probe)?.toAmountMin ?? extractEstimate(probe)?.toAmount;
  if (!probeOut || BigInt(probeOut) <= 0n) {
    throw new Error("Trustware could not price ETH right now. Try again shortly.");
  }

  // Linear scale plus 15% headroom for the price moving between probe and buy.
  const usdcAtomic =
    (GAS_PROBE_USDC_ATOMIC * targetWei * 115n) / (BigInt(probeOut) * 100n);

  if (usdcAtomic > BigInt(GAS_TOPUP_MAX_USDC) * 1_000_000n) {
    return {
      usdcAtomic,
      targetWei,
      ok: false,
      reason:
        `Ethereum gas is expensive right now: the top-up would cost about ` +
        `$${(Number(usdcAtomic) / 1e6).toFixed(2)}. The USDC is safe on Ethereum; try when gas is cheaper.`,
    };
  }
  if (usdcAtomic > args.solanaUsdcAtomic) {
    return {
      usdcAtomic,
      targetWei,
      ok: false,
      reason:
        `The top-up needs about $${(Number(usdcAtomic) / 1e6).toFixed(2)} of Solana USDC and the wallet ` +
        `holds $${(Number(args.solanaUsdcAtomic) / 1e6).toFixed(2)}.`,
    };
  }
  return { usdcAtomic, targetWei, ok: true };
}

// Execute the top-up and wait for the ETH to be spendable. One Solana
// signature; the destination leg is the solver's job.
export async function executeGasTopUp(args: {
  plan: GasTopUpPlan;
  evm: EvmSigner;
  solanaAddress: string;
  signAndSendBase64: (base64Tx: string) => Promise<string>;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  if (!args.plan.ok) throw new Error(args.plan.reason ?? "No top-up planned.");

  args.onProgress?.("Pricing the ETH top-up.");
  const route = await routeUsdcToEth(
    args.solanaAddress,
    args.evm.address,
    args.plan.usdcAtomic,
  );
  const transaction = extractExecution(route)?.transaction;
  if (!transaction?.data) {
    throw new Error(
      "Trustware priced the top-up but returned nothing to sign. Try again in a minute.",
    );
  }

  args.onProgress?.("Buying ETH for gas.");
  await args.signAndSendBase64(transaction.data);

  // Spendable means the balance clears the requirement, re-checked live rather
  // than assumed from the route's estimate.
  args.onProgress?.("Waiting for the ETH to arrive.");
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (args.signal?.aborted) return;
    const gas = await checkEthGas(args.evm).catch(() => null);
    if (gas?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(
    "The ETH purchase was sent but has not arrived yet. Give it a few minutes and refresh; nothing further was signed.",
  );
}
