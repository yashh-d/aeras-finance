import { describe, expect, it } from "vitest";

import { parseMarkPriceMessage, subscribeFrame } from "./mark-stream";

const M = "SPY-USD.P";

describe("subscribeFrame", () => {
  it("names the channel and the markets", () => {
    expect(JSON.parse(subscribeFrame([M]))).toEqual({
      op: "subscribe",
      channel: "markPricesPerps",
      markets: [M],
    });
  });
});

describe("parseMarkPriceMessage", () => {
  it("reads a list of market rows", () => {
    const frame = { channel: "markPricesPerps", data: [{ market: "QQQ-USD.P", markPrice: "1" }, { market: M, markPrice: "612.4" }] };
    expect(parseMarkPriceMessage(JSON.stringify(frame), M)).toBe(612.4);
  });

  it("reads a map keyed by market, with a scalar or an object", () => {
    expect(parseMarkPriceMessage({ data: { [M]: "612.4" } }, M)).toBe(612.4);
    expect(parseMarkPriceMessage({ data: { [M]: { markPrice: 612.4 } } }, M)).toBe(612.4);
  });

  it("reads a symbol-keyed row nested under a result envelope", () => {
    expect(parseMarkPriceMessage({ result: { rows: [{ symbol: M, price: "612.4" }] } }, M)).toBe(612.4);
  });

  it("ignores other markets, pongs, and junk", () => {
    expect(parseMarkPriceMessage({ data: [{ market: "QQQ-USD.P", markPrice: "1" }] }, M)).toBeNull();
    expect(parseMarkPriceMessage({ op: "pong" }, M)).toBeNull();
    expect(parseMarkPriceMessage("not json", M)).toBeNull();
    expect(parseMarkPriceMessage({ data: { [M]: "0" } }, M)).toBeNull();
  });
});
