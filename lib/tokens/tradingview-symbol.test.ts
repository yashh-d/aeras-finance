import { describe, expect, it } from "vitest";

import { hintFromOndoTags, tradingViewSymbol } from "./tradingview-symbol";

describe("tradingViewSymbol", () => {
  it("resolves listed names with their exchange", () => {
    expect(tradingViewSymbol("TSLA")).toBe("NASDAQ:TSLA");
    expect(tradingViewSymbol("SPY")).toBe("AMEX:SPY");
    expect(tradingViewSymbol("XAU")).toBe("OANDA:XAUUSD");
    expect(tradingViewSymbol("US500")).toBe("SP:SPX");
  });

  it("is case-insensitive on the ticker", () => {
    expect(tradingViewSymbol("tsla")).toBe("NASDAQ:TSLA");
  });

  it("points unknown names at the Binance perpetual", () => {
    expect(tradingViewSymbol("BTC")).toBe("BINANCE:BTCUSDT.P");
    expect(tradingViewSymbol("HYPE", "crypto")).toBe("BINANCE:HYPEUSDT.P");
  });

  it("passes an unknown listed name through bare", () => {
    expect(tradingViewSymbol("CBRS", "listed")).toBe("CBRS");
  });

  it("returns null for names with no public underlying", () => {
    expect(tradingViewSymbol("SPCX")).toBeNull();
    expect(tradingViewSymbol("SPACEX", "crypto")).toBeNull();
  });
});

describe("hintFromOndoTags", () => {
  it("treats only the Crypto tag as crypto", () => {
    expect(hintFromOndoTags(["Crypto"])).toBe("crypto");
    expect(hintFromOndoTags(["Stock"])).toBe("listed");
    expect(hintFromOndoTags(["Index"])).toBe("listed");
    expect(hintFromOndoTags([])).toBe("listed");
  });
});
