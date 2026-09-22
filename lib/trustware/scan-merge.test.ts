import { describe, expect, it } from "vitest";

import {
  carryUnreadableChains,
  describeUnreadableChains,
  type ScanRows,
} from "./scan-merge";

// Only the fields the merge reads are filled in; the rest are cast.
const eth = (balanceAtomic: string) =>
  ({
    chain: "1",
    chainLabel: "Ethereum",
    symbol: "ETH",
    decimals: 18,
    balanceAtomic,
    priceId: "ethereum",
  }) as ScanRows["native"][number];
const base = (balanceAtomic: string) =>
  ({ ...eth(balanceAtomic), chain: "8453", chainLabel: "Base" }) as ScanRows["native"][number];
const usdc = (chain: string, balanceAtomic: string) =>
  ({ chain, symbol: "USDC", decimals: 6, balanceAtomic }) as unknown as ScanRows["stables"][number];
const held = (chain: string, balanceAtomic: string) =>
  ({ source: { chain, symbol: "TSLAon" }, balanceAtomic }) as unknown as ScanRows["held"][number];
const ondo = (balanceAtomic: string) =>
  ({ symbol: "GLDon", contractAddress: "0x1", decimals: 18, balanceAtomic }) as ScanRows["ondo"][number];

const rows = (partial: Partial<ScanRows>): ScanRows => ({
  held: [],
  unreadableChains: [],
  native: [],
  stables: [],
  ondo: [],
  gold: [],
  ...partial,
});

describe("carryUnreadableChains", () => {
  it("keeps the previous rows for exactly the chain the new scan lost", () => {
    const previous = rows({
      native: [eth("10"), base("5")],
      stables: [usdc("1", "9900000"), usdc("8453", "100")],
      ondo: [ondo("7")],
      held: [held("solana-mainnet-beta", "3")],
    });
    const next = rows({
      unreadableChains: [{ chain: "1", error: "alchemy failed: indexer unavailable" }],
      native: [base("6")],
      stables: [usdc("8453", "200")],
      held: [held("solana-mainnet-beta", "4")],
    });
    const merged = carryUnreadableChains(previous, next);
    expect(merged.native).toEqual([base("6"), eth("10")]);
    expect(merged.stables).toEqual([usdc("8453", "200"), usdc("1", "9900000")]);
    expect(merged.ondo).toEqual([ondo("7")]);
    // Solana was read: the new figure wins even though it changed.
    expect(merged.held).toEqual([held("solana-mainnet-beta", "4")]);
    expect(merged.unreadableChains).toEqual(next.unreadableChains);
  });

  it("takes an emptied chain from the new scan when that chain was read", () => {
    const previous = rows({ native: [eth("10")], stables: [usdc("1", "9900000")] });
    const next = rows({ native: [], stables: [] });
    expect(carryUnreadableChains(previous, next)).toEqual(next);
  });

  it("returns the new scan untouched when there is nothing previous", () => {
    const next = rows({ unreadableChains: [{ chain: "1", error: "x" }] });
    expect(carryUnreadableChains(null, next)).toBe(next);
  });

  it("reads the route's whole-request label as every EVM chain", () => {
    const previous = rows({
      native: [eth("10"), base("5")],
      held: [held("56", "2"), held("solana-mainnet-beta", "3")],
    });
    const next = rows({
      unreadableChains: [{ chain: "evm", error: "Trustware /balances 502" }],
      held: [held("solana-mainnet-beta", "3")],
    });
    const merged = carryUnreadableChains(previous, next);
    expect(merged.native).toEqual([eth("10"), base("5")]);
    expect(merged.held).toEqual([held("solana-mainnet-beta", "3"), held("56", "2")]);
  });
});

describe("describeUnreadableChains", () => {
  it("names the chain", () => {
    expect(describeUnreadableChains([{ chain: "1" }])).toMatch(/^Could not read your balances on Ethereum just now\./);
  });

  it("lists several without repeating one", () => {
    expect(
      describeUnreadableChains([{ chain: "1" }, { chain: "8453" }, { chain: "1" }]),
    ).toMatch(/on Ethereum and Base just now/);
  });

  it("is null with nothing unreadable", () => {
    expect(describeUnreadableChains([])).toBeNull();
  });
});
