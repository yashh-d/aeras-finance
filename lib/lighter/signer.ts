"use client";

import { LIGHTER_API_KEY_INDEX, LIGHTER_CHAIN_ID } from "./constants";

// Every Lighter transaction is signed client-side with a Schnorr signature over
// ECgFp5, the quintic extension of the Goldilocks field, hashed with Poseidon2.
// That is not secp256k1 and not ed25519, and no JS library implements it, so
// reimplementing the scheme in TypeScript is not a realistic option. Lighter
// ships the signer as Go, and the Go compiles to WebAssembly, so that is what we
// run.
//
// public/lighter/main.wasm is built from elliottech/lighter-go at commit
// cef81af, web-wasm package, with:
//
//   GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o main.wasm .
//
// It is compiled from source rather than copied from the upstream release
// because this binary signs financial transactions. Our build came out within
// 0.3% of the upstream prebuilt artifact and identical in size once compressed,
// which is the expected difference between two Go patch releases.
//
// public/lighter/wasm_exec.js is the runtime shim from the same Go toolchain
// that compiled the module (1.26.3). These two files are a matched pair. A
// wasm_exec.js from a different Go version fails at instantiation or, worse,
// corrupts values crossing the boundary, so replace them together or not at all.
//
// 7.7MB raw, 2.0MB brotli. Loaded lazily so it never touches the landing page or
// the lending flow, only the first hedge.

const WASM_URL = "/lighter/main.wasm";
const WASM_EXEC_URL = "/lighter/wasm_exec.js";

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

declare global {
  interface Window {
    Go?: new () => GoRuntime;
  }
}

// Every Go export is curried. Calling _signCreateOrder(...) does not sign
// anything, it validates the arguments and returns a function; calling that
// function returns the Promise. Missing the second call yields a function where
// a signature was expected, with no error thrown.
type GoExport = (...args: unknown[]) => () => Promise<unknown>;

let booting: Promise<void> | null = null;

function loadWasmExec(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = WASM_EXEC_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load wasm_exec.js"));
    document.head.appendChild(script);
  });
}

async function instantiate(go: GoRuntime): Promise<WebAssembly.Instance> {
  const response = await fetch(WASM_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Lighter signer: ${response.status}`);
  }

  // instantiateStreaming rejects unless the response is served as
  // application/wasm, which is a server config detail we do not control in every
  // environment. Buffering is slower but always works.
  try {
    return (await WebAssembly.instantiateStreaming(response.clone(), go.importObject))
      .instance;
  } catch {
    const bytes = await response.arrayBuffer();
    return (await WebAssembly.instantiate(bytes, go.importObject)).instance;
  }
}

async function boot(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("The Lighter signer runs in the browser only");
  }

  if (!window.Go) {
    await loadWasmExec();
  }
  if (!window.Go) {
    throw new Error("wasm_exec.js loaded without defining Go");
  }

  const go = new window.Go();
  const instance = await instantiate(go);

  // Go's main registers the exports and then blocks forever on a channel so the
  // module stays resident. Awaiting run() would hang here.
  void go.run(instance);

  // Registration happens synchronously inside run(), but only up to the point
  // where main blocks, so poll rather than assume the ordering.
  for (let i = 0; i < 100; i++) {
    if (typeof (globalThis as Record<string, unknown>)._createClient === "function") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Lighter signer started but registered no exports");
}

// Safe to call repeatedly. Callers do not need to await this explicitly, since
// every wrapper below does.
export function loadLighterSigner(): Promise<void> {
  if (!booting) {
    booting = boot().catch((error: unknown) => {
      // Clear the cache so a transient network failure does not poison every
      // later attempt for the lifetime of the page.
      booting = null;
      throw error;
    });
  }
  return booting;
}

async function goCall<T>(name: string, args: unknown[]): Promise<T> {
  await loadLighterSigner();

  const fn = (globalThis as Record<string, unknown>)[name];
  if (typeof fn !== "function") {
    throw new Error(`Lighter signer is missing ${name}`);
  }

  const result = await (fn as GoExport)(...args)();

  // Go reports failure by resolving with { error }, never by rejecting. Without
  // this check a failed signature reads as a successful one with undefined
  // fields.
  if (result && typeof result === "object" && "error" in result) {
    throw new Error(String((result as { error: unknown }).error));
  }
  return result as T;
}

export const LIGHTER_ORDER_TYPE = {
  limit: 0,
  market: 1,
  stopLoss: 2,
  stopLossLimit: 3,
  takeProfit: 4,
  takeProfitLimit: 5,
} as const;

export const LIGHTER_TIME_IN_FORCE = {
  immediateOrCancel: 0,
  goodTillTime: 1,
  postOnly: 2,
} as const;

export const LIGHTER_MARGIN_MODE = {
  cross: 0,
  isolated: 1,
} as const;

// Zero is the "unset" sentinel for both fields, which is why a market order
// passes 0 for each rather than omitting them.
const NIL_ORDER_EXPIRY = 0;
const NIL_TRIGGER_PRICE = "0";

export const LIGHTER_SIDE = { long: 0, short: 1 } as const;

export interface LighterSignerSession {
  // 40-byte hex. This is the trading key the account must be told about via a
  // ChangePubKey before any order it signs will be accepted.
  publicKey: string;
  privateKey: string;
  // Plain text, shown to the user by their wallet, which they sign with
  // personal_sign to authorize the key. Reads "Register Lighter Account" and
  // lists the pubkey, nonce, account index and api key index.
  registerMessage: string;
}

export interface LighterSignedTx {
  txHash: string;
  // A JSON string, not an object, with PascalCase fields. Post it to the
  // sequencer as-is rather than reserializing, since re-encoding can reorder
  // fields and invalidate the signature.
  txInfo: string;
}

interface CreateClientResponse {
  success: boolean;
  pubKeySuccess: boolean;
  pk: string;
  prv: string;
  body: string;
}

// Derives the trading key from a seed and registers it in the module's client
// table under accountIndex. Everything else here requires this to have run first
// for that account, including after a page reload, since the table lives in the
// WASM instance and not in storage.
//
// The seed is hex of at least 32 bytes, hashed into a scalar. An Ethereum
// personal_sign signature is 65 bytes, so it can be handed straight to this as a
// seed. That is what makes deterministic key derivation work: the same signature
// always reproduces the same trading key, so nothing sensitive needs storing in
// the browser.
export async function createSignerClient(params: {
  seed: string;
  accountIndex: number;
  nonce: number;
  apiKeyIndex?: number;
}): Promise<LighterSignerSession> {
  const response = await goCall<CreateClientResponse>("_createClient", [
    params.seed,
    LIGHTER_CHAIN_ID,
    params.accountIndex,
    params.nonce,
    params.apiKeyIndex ?? LIGHTER_API_KEY_INDEX,
  ]);

  if (!response.success || !response.pubKeySuccess) {
    throw new Error("Lighter signer could not derive a key from that seed");
  }

  return {
    publicKey: response.pk,
    privateKey: response.prv,
    registerMessage: response.body,
  };
}

// Registers the derived trading key against the account. signedMessage is the
// personal_sign output over the session's registerMessage.
export function signChangePubKey(params: {
  accountIndex: number;
  signedMessage: string;
  nonce: number;
  apiKeyIndex?: number;
}): Promise<LighterSignedTx> {
  return goCall<LighterSignedTx>("_signChangePubKey", [
    params.accountIndex,
    params.signedMessage,
    params.nonce,
    params.apiKeyIndex ?? LIGHTER_API_KEY_INDEX,
  ]);
}

// baseAmount and price are wire integers already scaled by the market's
// size_decimals and price_decimals, so they are passed as strings. Use
// toWireInteger in sizing.ts to produce them, and never reuse one market's
// decimals for another.
export function signCreateOrder(params: {
  accountIndex: number;
  marketIndex: number;
  clientOrderIndex: number;
  baseAmount: string;
  price: string;
  isAsk: number;
  orderType: number;
  timeInForce: number;
  reduceOnly: number;
  triggerPrice?: string;
  orderExpiry?: number;
  nonce: number;
}): Promise<LighterSignedTx> {
  return goCall<LighterSignedTx>("_signCreateOrder", [
    params.accountIndex,
    params.marketIndex,
    params.clientOrderIndex,
    params.baseAmount,
    params.price,
    params.isAsk,
    params.orderType,
    params.timeInForce,
    params.reduceOnly,
    params.triggerPrice ?? NIL_TRIGGER_PRICE,
    params.orderExpiry ?? NIL_ORDER_EXPIRY,
    params.nonce,
  ]);
}

// A hedge is a market sell. Lighter validates market orders strictly: the time
// in force has to be immediate-or-cancel and both expiry and trigger price have
// to be unset, and any other combination is rejected by the sequencer after the
// signature is already spent. This wrapper is the only way we place one, so that
// combination cannot be got wrong at a call site.
//
// price is still required on a market order. It is the slippage bound, not a
// limit: see slippageBoundPrice in sizing.ts, which places it below the mark for
// a sell so the order fills but not at an arbitrary price.
export function signMarketOrder(params: {
  accountIndex: number;
  marketIndex: number;
  clientOrderIndex: number;
  baseAmount: string;
  slippageBoundPrice: string;
  isAsk: number;
  reduceOnly?: number;
  nonce: number;
}): Promise<LighterSignedTx> {
  return signCreateOrder({
    accountIndex: params.accountIndex,
    marketIndex: params.marketIndex,
    clientOrderIndex: params.clientOrderIndex,
    baseAmount: params.baseAmount,
    price: params.slippageBoundPrice,
    isAsk: params.isAsk,
    orderType: LIGHTER_ORDER_TYPE.market,
    timeInForce: LIGHTER_TIME_IN_FORCE.immediateOrCancel,
    reduceOnly: params.reduceOnly ?? 0,
    triggerPrice: NIL_TRIGGER_PRICE,
    orderExpiry: NIL_ORDER_EXPIRY,
    nonce: params.nonce,
  });
}

export function signCancelOrder(params: {
  accountIndex: number;
  marketIndex: number;
  orderIndex: string;
  nonce: number;
}): Promise<LighterSignedTx> {
  return goCall<LighterSignedTx>("_signCancelOrder", [
    params.accountIndex,
    params.marketIndex,
    params.orderIndex,
    params.nonce,
  ]);
}

// initialMarginFraction uses the same 10000 = 100% scale as orderBookDetails, so
// 500 is 20x. Pass it through marginForLeverage in risk.ts rather than computing
// it inline, since that clamps to the market's own maximum.
export function signUpdateLeverage(params: {
  accountIndex: number;
  marketIndex: number;
  initialMarginFraction: number;
  marginMode: number;
  nonce: number;
}): Promise<LighterSignedTx> {
  return goCall<LighterSignedTx>("_signUpdateLeverage", [
    params.accountIndex,
    params.marketIndex,
    params.initialMarginFraction,
    params.marginMode,
    params.nonce,
  ]);
}

export function signWithdraw(params: {
  accountIndex: number;
  assetIndex: number;
  routeType: number;
  assetAmount: string;
  nonce: number;
}): Promise<LighterSignedTx> {
  return goCall<LighterSignedTx>("_signWithdraw", [
    params.accountIndex,
    params.assetIndex,
    params.routeType,
    params.assetAmount,
    params.nonce,
  ]);
}

export interface LighterAuthToken {
  token: string;
  deadline: number;
  accountIndex: number;
  apiKeyIndex: number;
  signature: string;
}

// Bearer token for authenticated reads such as account state and open orders.
// The deadline is one hour out and is baked into the signature, so cache the
// token but re-issue it well before then rather than per request.
export function createAuthToken(params: {
  accountIndex: number;
  apiKeyIndex?: number;
}): Promise<LighterAuthToken> {
  return goCall<LighterAuthToken>("_createAuthToken", [
    params.accountIndex,
    params.apiKeyIndex ?? LIGHTER_API_KEY_INDEX,
  ]);
}
