import { describe, expect, it, vi } from "vitest";

// `server.ts` opens with `import "server-only"`, which throws outside a React
// Server Component build. The module under test is pure apart from that guard
// and the fetch helpers below it, so the guard is stubbed rather than the test
// being given up on. Nothing else in the module is mocked.
vi.mock("server-only", () => ({}));

import { USDC_MINT } from "@/lib/jupiter/constants";
import {
  MONAD_CHAIN_ID,
  MONAD_NATIVE_TOKEN,
  MONAD_USDC,
} from "@/lib/morpho/constants";
import { XAUT } from "@/lib/morpho/gold-market";
import { ONDO_MARGIN_TOKENS } from "@/lib/ondo/collateral";
import { TRUSTWARE_SOLANA_CHAIN } from "./constants";
import { destinationForShape, validateTrustwareRequest } from "./server";
import type { TrustwareQuoteRequest } from "./types";

// This file is about one property: a caller cannot choose where the money
// lands. Everything here is a variation on that.
//
// The shapes themselves were already covered by the allowlist that predates
// this; what is new is that the destination is resolved from the caller's
// identity instead of their request body, and that the two exceptions have to
// ask for the exception by name.

const OWN_SOLANA = "5ZWj7a1f8tWkjBESHKgrLmXshuXxqeY9SMbmvE9NFVHy";
const OWN_EVM = "0x1111111111111111111111111111111111111111";
const ATTACKER_SOLANA = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const ATTACKER_EVM = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

const EMBEDDED = { solana: OWN_SOLANA, evm: OWN_EVM };

// TSLAx, which has a Jupiter Lend borrow vault and so is a `deposit`
// destination.
const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

function req(over: Partial<TrustwareQuoteRequest>): Partial<TrustwareQuoteRequest> {
  return {
    fromChain: "1",
    fromToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    fromAmount: "1000000",
    fromAddress: OWN_EVM,
    toChain: TRUSTWARE_SOLANA_CHAIN,
    toToken: TSLAX,
    toAddress: OWN_SOLANA,
    ...over,
  };
}

// Resolve a request the way app/api/trustware/route does, and report the
// address the upstream would actually be handed.
function deliveredTo(
  request: Partial<TrustwareQuoteRequest>,
): { address: string } | { error: string } {
  const validation = validateTrustwareRequest(request);
  if (!validation.ok) return { error: validation.error };

  const destination = destinationForShape(
    validation.shape,
    request.toChain!,
    EMBEDDED,
  );
  if ("error" in destination) return destination;
  return {
    address: "address" in destination ? destination.address : request.toAddress!,
  };
}

describe("a caller cannot name the payout address", () => {
  it("overrides an attacker's Solana address on a deposit", () => {
    expect(deliveredTo(req({ toAddress: ATTACKER_SOLANA }))).toEqual({
      address: OWN_SOLANA,
    });
  });

  it("overrides an attacker's EVM address on gold collateral", () => {
    expect(
      deliveredTo(
        req({
          toChain: "1",
          toToken: XAUT.address,
          toAddress: ATTACKER_EVM,
        }),
      ),
    ).toEqual({ address: OWN_EVM });
  });

  it("overrides an attacker's address on a Monad funding leg", () => {
    expect(
      deliveredTo(
        req({
          toChain: String(MONAD_CHAIN_ID),
          toToken: MONAD_USDC.address,
          toAddress: ATTACKER_EVM,
        }),
      ),
    ).toEqual({ address: OWN_EVM });

    // The gas top-up leg of the same flow, which delivers native MON.
    expect(
      deliveredTo(
        req({
          toChain: String(MONAD_CHAIN_ID),
          toToken: MONAD_NATIVE_TOKEN,
          toAddress: ATTACKER_EVM,
        }),
      ),
    ).toEqual({ address: OWN_EVM });
  });

  it("overrides an attacker's address on a USDC return to Solana", () => {
    expect(
      deliveredTo(req({ toToken: USDC_MINT, toAddress: ATTACKER_SOLANA })),
    ).toEqual({ address: OWN_SOLANA });
  });

  it("overrides an attacker's address on an Ondo unwind", () => {
    expect(
      deliveredTo(
        req({
          fromChain: "1",
          fromToken: ONDO_MARGIN_TOKENS.SPYon,
          toToken: TSLAX,
          toAddress: ATTACKER_SOLANA,
        }),
      ),
    ).toEqual({ address: OWN_SOLANA });
  });

  it("picks the wallet by destination chain on a swap", () => {
    // Solana USDC -> Ethereum USDT lands on the EVM wallet...
    expect(
      deliveredTo(
        req({
          fromChain: TRUSTWARE_SOLANA_CHAIN,
          fromToken: USDC_MINT,
          toChain: "1",
          toToken: "0xdac17f958d2ee523a2206206994597c13d831ec7",
          toAddress: ATTACKER_EVM,
        }),
      ),
    ).toEqual({ address: OWN_EVM });

    // ...and the reverse lands on the Solana one.
    expect(
      deliveredTo(
        req({
          fromChain: "1",
          fromToken: "0xdac17f958d2ee523a2206206994597c13d831ec7",
          toChain: TRUSTWARE_SOLANA_CHAIN,
          toToken: USDC_MINT,
          toAddress: ATTACKER_SOLANA,
        }),
      ),
    ).toEqual({ address: OWN_SOLANA });
  });

  it("refuses rather than falling back when the wallet is missing", () => {
    const validation = validateTrustwareRequest(req({}));
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    const destination = destinationForShape(validation.shape, TRUSTWARE_SOLANA_CHAIN, {
      solana: null,
      evm: OWN_EVM,
    });
    // The request body carried a perfectly valid Solana address. It is still
    // not used, because using it is the thing this prevents.
    expect(destination).toEqual({
      error: "No Solana wallet has been provisioned on this account yet.",
    });
  });
});

describe("the two shapes that keep a caller-supplied address", () => {
  const ONDO_DEPOSIT = "0x2222222222222222222222222222222222222222";
  const LIGHTER_INTENT = "0x3333333333333333333333333333333333333333";
  const ARBITRUM_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

  it("passes the Ondo deposit address through when the intent asks", () => {
    expect(
      deliveredTo(
        req({
          toChain: "1",
          toToken: ONDO_MARGIN_TOKENS.SPYon,
          toAddress: ONDO_DEPOSIT,
          intent: "ondo-margin",
        }),
      ),
    ).toEqual({ address: ONDO_DEPOSIT });
  });

  it("passes the Lighter intent address through when the intent asks", () => {
    expect(
      deliveredTo(
        req({
          fromChain: TRUSTWARE_SOLANA_CHAIN,
          fromToken: USDC_MINT,
          toChain: "42161",
          toToken: ARBITRUM_USDC,
          toAddress: LIGHTER_INTENT,
          intent: "lighter-margin",
        }),
      ),
    ).toEqual({ address: LIGHTER_INTENT });
  });

  // The reason `intent` exists at all. Ethereum USDC is both an Ondo margin
  // destination and a curated swap token, so the shape cannot be inferred from
  // the pair. Inferring it wrongly is not a cosmetic mistake: reading a swap as
  // a margin deposit hands the caller back control of the destination.
  it("treats Ethereum USDC as a swap, not an Ondo deposit, without an intent", () => {
    expect(
      deliveredTo(
        req({
          fromChain: TRUSTWARE_SOLANA_CHAIN,
          fromToken: USDC_MINT,
          toChain: "1",
          toToken: ONDO_MARGIN_TOKENS.USDC,
          toAddress: ATTACKER_EVM,
        }),
      ),
    ).toEqual({ address: OWN_EVM });
  });

  it("rejects an intent the request does not fit", () => {
    // Claiming ondo-margin over a plain Solana deposit must not buy a
    // passthrough destination. It fails rather than falling through to the
    // deposit shape, so there is no path where a mismatched intent quietly
    // becomes a different shape.
    expect(
      deliveredTo(req({ toAddress: ATTACKER_SOLANA, intent: "ondo-margin" })),
    ).toEqual({ error: "that is not a valid Ondo margin deposit" });

    expect(
      deliveredTo(req({ toAddress: ATTACKER_SOLANA, intent: "lighter-margin" })),
    ).toEqual({ error: "that is not a valid Lighter margin deposit" });
  });
});

describe("the allowlist still holds", () => {
  it("rejects the same token on both sides before any shape can claim it", () => {
    // Solana USDC to Solana USDC would otherwise match `return`, whose only
    // test is the destination, and reach Trustware as a real request.
    const r = validateTrustwareRequest(
      req({
        fromChain: TRUSTWARE_SOLANA_CHAIN,
        fromToken: USDC_MINT,
        toChain: TRUSTWARE_SOLANA_CHAIN,
        toToken: USDC_MINT,
        fromAddress: OWN_SOLANA,
        toAddress: OWN_SOLANA,
      }),
    );
    expect(r).toEqual({ ok: false, error: "the source and destination are the same token" });
  });

  it("rejects an uncurated pair", () => {
    expect(
      deliveredTo(
        req({
          toChain: "1",
          toToken: "0x4444444444444444444444444444444444444444",
        }),
      ),
    ).toEqual({ error: "that pair is not available to swap" });
  });

  it("rejects a non-atomic amount", () => {
    expect(deliveredTo(req({ fromAmount: "1.5" }))).toEqual({
      error: "fromAmount must be an atomic decimal string",
    });
  });

  it("rejects a malformed destination even though it will be replaced", () => {
    // toAddress is overwritten for this shape, so this assertion is about the
    // upstream contract rather than about safety: a request that cannot be
    // coherent should fail here rather than at Trustware.
    expect(deliveredTo(req({ toAddress: "not-an-address" }))).toEqual({
      error: "toAddress is not a supported address",
    });
  });
});

// ── Bitwise Mag7X on Glider, and the Base gas leg ────────────────────────────
//
// A Mag7X deposit is the third shape that delivers somewhere other than the
// user's own wallet (the Glider smart account). The validator keeps the
// caller's address only when the intent is named and both ends are the
// pinned USDC contracts; the route handler then verifies the address with
// Glider, which this file cannot exercise. The gas leg delivers native ETH
// on Base to the user's own EVM wallet and nowhere else.

const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const GLIDER_SMART_ACCOUNT = "0x3333333333333333333333333333333333333333";

describe("glider-deposit", () => {
  const deposit = (over: Partial<TrustwareQuoteRequest> = {}) =>
    req({
      fromChain: TRUSTWARE_SOLANA_CHAIN,
      fromToken: USDC_MINT,
      fromAddress: OWN_SOLANA,
      toChain: "8453",
      toToken: BASE_USDC_ADDRESS,
      toAddress: GLIDER_SMART_ACCOUNT,
      intent: "glider-deposit",
      ...over,
    });

  it("keeps the caller's smart account when the intent is named", () => {
    const v = validateTrustwareRequest(deposit());
    expect(v).toEqual({ ok: true, shape: "glider-deposit" });
    expect(destinationForShape("glider-deposit", "8453", EMBEDDED)).toEqual({ passthrough: true });
  });
  it("is not inferred without the intent", () => {
    // Without the name this is Solana USDC to Base USDC, which is a swap
    // only if both sides are curated; either way the destination becomes
    // the user's own EVM wallet, never the caller's address.
    const v = validateTrustwareRequest(deposit({ intent: undefined }));
    if (v.ok) {
      expect(v.shape).not.toBe("glider-deposit");
      expect(destinationForShape(v.shape, "8453", EMBEDDED)).toEqual({ address: OWN_EVM });
    }
  });
  it("refuses any source that is not USDC", () => {
    const v = validateTrustwareRequest(deposit({ fromToken: TSLAX }));
    expect(v.ok).toBe(false);
  });
  it("refuses any destination token but Base USDC", () => {
    expect(validateTrustwareRequest(deposit({ toToken: MONAD_USDC.address })).ok).toBe(false);
    expect(validateTrustwareRequest(deposit({ toChain: "1" })).ok).toBe(false);
  });
  it("accepts the EVM USDC sources the wallet panel scans", () => {
    const v = validateTrustwareRequest(
      deposit({ fromChain: "1", fromToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", fromAddress: OWN_EVM }),
    );
    expect(v).toEqual({ ok: true, shape: "glider-deposit" });
  });
});

describe("base-gas", () => {
  it("delivers native ETH on Base to the user's own EVM wallet, whatever address was sent", () => {
    for (const token of ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "0x0000000000000000000000000000000000000000"]) {
      const v = validateTrustwareRequest(
        req({
          fromChain: TRUSTWARE_SOLANA_CHAIN,
          fromToken: USDC_MINT,
          fromAddress: OWN_SOLANA,
          toChain: "8453",
          toToken: token,
          toAddress: ATTACKER_EVM,
        }),
      );
      expect(v).toEqual({ ok: true, shape: "base-gas" });
      expect(destinationForShape("base-gas", "8453", EMBEDDED)).toEqual({ address: OWN_EVM });
    }
  });
  it("does not let a Monad gas token through as Base gas", () => {
    const v = validateTrustwareRequest(
      req({
        fromChain: TRUSTWARE_SOLANA_CHAIN,
        fromToken: USDC_MINT,
        fromAddress: OWN_SOLANA,
        toChain: String(MONAD_CHAIN_ID),
        toToken: MONAD_NATIVE_TOKEN,
        toAddress: OWN_EVM,
      }),
    );
    expect(v).toEqual({ ok: true, shape: "funding" });
  });
});
