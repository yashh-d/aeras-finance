import { describe, expect, it, vi } from "vitest";

// The `lp` shape in lib/trustware/server.ts: the funding legs and the
// on-chain swap of a liquidity position. What this pins is the boundary,
// not the happy path: a listed token on a listed chain is admitted and
// delivered to the user's own EVM wallet, an unlisted token is not, and a
// same-chain swap is admitted only between listed tokens.

vi.mock("server-only", () => ({}));

import { USDC_MINT } from "@/lib/jupiter/constants";
import { MONAD_CHAIN_ID } from "@/lib/morpho/constants";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_USDG } from "@/lib/robinhood/constants";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import { destinationForShape, validateTrustwareRequest } from "@/lib/trustware/server";
import type { TrustwareQuoteRequest } from "@/lib/trustware/types";

import { uniswapPoolById } from "./pools";

const SOLANA = "5ZWj7a1f8tWkjBESHKgrLmXshuXxqeY9SMbmvE9NFVHy";
const EVM = "0x1111111111111111111111111111111111111111";
const ATTACKER = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const UNLISTED = "0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18"; // "Artificial Inu"

function fromSolana(toChain: number, toToken: string): Partial<TrustwareQuoteRequest> {
  return {
    fromChain: TRUSTWARE_SOLANA_CHAIN,
    toChain: String(toChain),
    fromToken: USDC_MINT,
    toToken,
    fromAmount: "25000000",
    fromAddress: SOLANA,
    toAddress: ATTACKER,
  };
}

function sameChain(chain: number, fromToken: string, toToken: string): Partial<TrustwareQuoteRequest> {
  return {
    fromChain: String(chain),
    toChain: String(chain),
    fromToken,
    toToken,
    fromAmount: "12000000",
    fromAddress: EVM,
    toAddress: ATTACKER,
  };
}

describe("the lp shape", () => {
  it("admits USDG on Robinhood Chain from Solana USDC and delivers to the own EVM wallet", () => {
    const v = validateTrustwareRequest(fromSolana(ROBINHOOD_CHAIN_ID, ROBINHOOD_USDG.address));
    expect(v).toEqual({ ok: true, shape: "lp" });
    const d = destinationForShape("lp", String(ROBINHOOD_CHAIN_ID), { solana: SOLANA, evm: EVM });
    expect(d).toEqual({ address: EVM });
  });

  it("admits both spellings of the native asset for the gas leg", () => {
    for (const s of ["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]) {
      expect(validateTrustwareRequest(fromSolana(ROBINHOOD_CHAIN_ID, s))).toEqual({ ok: true, shape: "lp" });
    }
  });

  it("admits every token of every listed pool on its own chain", () => {
    const nvda = uniswapPoolById(ROBINHOOD_CHAIN_ID, "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3")!;
    for (const t of [nvda.token0, nvda.token1]) {
      expect(validateTrustwareRequest(fromSolana(nvda.chainId, t.address)).ok).toBe(true);
    }
    const cbbtc = uniswapPoolById(MONAD_CHAIN_ID, "0x7fc6232a9ec6cc4e9434640dcde5ee08ccae3b07de3247bf788fc9e2051b449e")!;
    expect(validateTrustwareRequest(fromSolana(MONAD_CHAIN_ID, cbbtc.token1.address)).ok).toBe(true);
  });

  it("refuses an unlisted token on a listed chain", () => {
    const v = validateTrustwareRequest(fromSolana(ROBINHOOD_CHAIN_ID, UNLISTED));
    expect(v.ok).toBe(false);
  });

  it("admits the same-chain stock swap between two listed tokens", () => {
    expect(validateTrustwareRequest(sameChain(ROBINHOOD_CHAIN_ID, ROBINHOOD_USDG.address, NVDA))).toEqual({ ok: true, shape: "lp" });
    expect(validateTrustwareRequest(sameChain(ROBINHOOD_CHAIN_ID, NVDA, ROBINHOOD_USDG.address))).toEqual({ ok: true, shape: "lp" });
  });

  it("refuses a same-chain swap whose source is not a listed token", () => {
    const v = validateTrustwareRequest(sameChain(ROBINHOOD_CHAIN_ID, UNLISTED, ROBINHOOD_USDG.address));
    expect(v.ok).toBe(false);
  });

  it("leaves the Monad funding shape as it was", () => {
    // Monad USDC from Solana was `funding` before this shape existed and
    // still is: the Morpho and Blend deposits depend on the name.
    const v = validateTrustwareRequest(fromSolana(MONAD_CHAIN_ID, "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"));
    expect(v).toEqual({ ok: true, shape: "funding" });
  });
});
