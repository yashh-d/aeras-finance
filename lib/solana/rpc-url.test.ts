import { describe, expect, it } from "vitest";

import { describeRpc, resolveSolanaRpcUrl } from "./rpc-url";

const ALCHEMY = "https://solana-mainnet.g.alchemy.com/v2/alch_key";

describe("resolveSolanaRpcUrl", () => {
  it("returns null when nothing is set", () => {
    expect(resolveSolanaRpcUrl({})).toBeNull();
    expect(resolveSolanaRpcUrl({ NEXT_PUBLIC_SOLANA_RPC_URL: "  " })).toBeNull();
  });

  it("falls back to NEXT_PUBLIC_SOLANA_RPC_URL when no Helius variable exists", () => {
    expect(resolveSolanaRpcUrl({ NEXT_PUBLIC_SOLANA_RPC_URL: ALCHEMY })).toEqual({
      url: ALCHEMY,
      source: "NEXT_PUBLIC_SOLANA_RPC_URL",
    });
  });

  it("prefers a Helius key over the generic RPC URL, whatever the key is named", () => {
    for (const name of [
      "HELIUS_API_KEY",
      "NEXT_PUBLIC_HELIUS_API_KEY",
      "HELIUS_KEY",
      "helius_api_key",
    ]) {
      const r = resolveSolanaRpcUrl({
        NEXT_PUBLIC_SOLANA_RPC_URL: ALCHEMY,
        [name]: "abc-123",
      });
      expect(r, name).toEqual({
        url: "https://mainnet.helius-rpc.com/?api-key=abc-123",
        source: name,
      });
    }
  });

  it("uses a Helius URL as-is and adds a scheme when one is missing", () => {
    expect(
      resolveSolanaRpcUrl({
        NEXT_PUBLIC_SOLANA_RPC_URL: ALCHEMY,
        HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=k",
      })?.url,
    ).toBe("https://mainnet.helius-rpc.com/?api-key=k");
    expect(
      resolveSolanaRpcUrl({ HELIUS_URL: "mainnet.helius-rpc.com/?api-key=k" })?.url,
    ).toBe("https://mainnet.helius-rpc.com/?api-key=k");
    expect(
      resolveSolanaRpcUrl({ HELIUS_WS: "wss://mainnet.helius-rpc.com/?api-key=k" })?.url,
    ).toBe("https://mainnet.helius-rpc.com/?api-key=k");
  });

  it("ranks a full URL over a bare key, and a public name over a private one", () => {
    expect(
      resolveSolanaRpcUrl({
        HELIUS_API_KEY: "bare",
        NEXT_PUBLIC_HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=full",
      })?.source,
    ).toBe("NEXT_PUBLIC_HELIUS_RPC_URL");
    expect(
      resolveSolanaRpcUrl({
        HELIUS_API_KEY: "private",
        NEXT_PUBLIC_HELIUS_API_KEY: "public",
      })?.source,
    ).toBe("NEXT_PUBLIC_HELIUS_API_KEY");
  });

  it("ignores empty Helius values", () => {
    expect(
      resolveSolanaRpcUrl({ HELIUS_API_KEY: "", NEXT_PUBLIC_SOLANA_RPC_URL: ALCHEMY })?.source,
    ).toBe("NEXT_PUBLIC_SOLANA_RPC_URL");
  });

  it("describes the host without the key", () => {
    const line = describeRpc({
      url: "https://mainnet.helius-rpc.com/?api-key=secret",
      source: "HELIUS_API_KEY",
    });
    expect(line).toBe("Solana RPC: mainnet.helius-rpc.com (from HELIUS_API_KEY)");
    expect(line).not.toContain("secret");
  });
});
