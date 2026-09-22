import { describe, expect, it } from "vitest";

import { describeRevert, extractRevertReason } from "./revert";

const VIEM_STYLE = `Execution reverted for an unknown reason.

Estimate Gas Arguments:
  from:  0x5c021cb1DCA32113e6b845e3c1f23EBC4cA842eD
  to:    0x716930f2D5AC57Fc73EE16e52bcc6929c6E1E021
  data:  0x6a761202

Details: execution reverted
Version: viem@2.47.12`;

const VIEM_WITH_REASON = `Execution reverted with reason: ERC20: transfer amount exceeds balance.

Estimate Gas Arguments:
  from:  0x5c02
  to:    0x7169

Details: execution reverted: ERC20: transfer amount exceeds balance
Version: viem@2.47.12`;

describe("extractRevertReason", () => {
  it("reads a reason out of a viem-shaped error", () => {
    expect(extractRevertReason(new Error(VIEM_WITH_REASON))).toBe(
      "ERC20: transfer amount exceeds balance",
    );
  });

  it("never returns the viem version trailer", () => {
    expect(extractRevertReason(new Error(VIEM_STYLE))).toBeNull();
  });

  it("reads a raw node's reason and ignores empty data", () => {
    expect(extractRevertReason(new Error("execution reverted: GS026"))).toBe("GS026");
    expect(extractRevertReason(new Error('execution reverted data="0x"'))).toBeNull();
    expect(extractRevertReason(new Error("execution reverted 0x"))).toBeNull();
    expect(extractRevertReason(new Error("execution reverted"))).toBeNull();
  });
});

describe("describeRevert", () => {
  it("names the chain and the reason", () => {
    expect(describeRevert(143, new Error(VIEM_WITH_REASON))).toBe(
      "Blend's Monad step would fail: ERC20: transfer amount exceeds balance.",
    );
  });

  it("names the chain alone when there is no reason", () => {
    expect(describeRevert(143, new Error(VIEM_STYLE))).toBe(
      "Blend's Monad step would fail right now.",
    );
  });
});
