import { describe, expect, it } from "vitest";

import {
  MULTISEND_ADDRESS,
  encodeExecTransaction,
  encodeMultiSendBatch,
  encodeOwnerBatch,
  multiSendCalldata,
  preValidatedSignature,
} from "./safe";

const OWNER = "0x5c021cb1DCA32113e6b845e3c1f23EBC4cA842eD" as const;
const TARGET = "0x75c221976049D760F9CA56412fBa2C94B2f88Cd4" as const;

describe("pre-validated signature", () => {
  it("is r = the owner, s = 0, v = 1, in 65 bytes", () => {
    const sig = preValidatedSignature(OWNER);
    expect(sig).toBe(
      "0x" +
        "0000000000000000000000005c021cb1dca32113e6b845e3c1f23ebc4ca842ed" +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "01",
    );
    expect((sig.length - 2) / 2).toBe(65);
  });
});

describe("MultiSend batch", () => {
  it("packs operation, to, value, length and data with no padding", () => {
    // One delegatecall of 4 bytes and one call of 0 bytes, hand-packed.
    const batch = encodeMultiSendBatch([
      { to: TARGET, value: 0n, data: "0xf9a9cfde", operation: 1 },
      { to: OWNER, value: 7n, data: "0x", operation: 0 },
    ]);
    expect(batch).toBe(
      "0x" +
        "01" +
        "75c221976049d760f9ca56412fba2c94b2f88cd4" +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000000000000004" +
        "f9a9cfde" +
        "00" +
        "5c021cb1dca32113e6b845e3c1f23ebc4ca842ed" +
        "0000000000000000000000000000000000000000000000000000000000000007" +
        "0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("wraps the batch in multiSend(bytes) aimed at the canonical MultiSend", () => {
    const { to, data } = multiSendCalldata([
      { to: TARGET, value: 0n, data: "0xf9a9cfde", operation: 1 },
    ]);
    expect(to).toBe(MULTISEND_ADDRESS);
    // multiSend(bytes) selector.
    expect(data.slice(0, 10)).toBe("0x8d80ff0a");
  });
});

describe("execTransaction", () => {
  it("uses the execTransaction selector with every gas field zero", () => {
    const data = encodeExecTransaction({
      to: MULTISEND_ADDRESS,
      value: 0n,
      data: "0x8d80ff0a",
      operation: 1,
      signatures: preValidatedSignature(OWNER),
    });
    expect(data.slice(0, 10)).toBe("0x6a761202");
    const words = data.slice(10).match(/.{64}/g) ?? [];
    // to, value, data offset, operation, safeTxGas, baseGas, gasPrice,
    // gasToken, refundReceiver, signatures offset.
    expect(words[0]).toBe("00000000000000000000000038869bf66a61cf6bdb996a6ae40d5853fd43b526");
    expect(words[1]).toBe("0".repeat(64));
    expect(words[3]).toBe("0".repeat(63) + "1");
    for (const i of [4, 5, 6, 7, 8]) expect(words[i]).toBe("0".repeat(64));
  });

  it("an owner batch is one execTransaction delegatecalling MultiSend", () => {
    const data = encodeOwnerBatch(OWNER, [
      { to: TARGET, value: 0n, data: "0xf9a9cfde", operation: 1 },
    ]);
    expect(data.slice(0, 10)).toBe("0x6a761202");
    expect(data.toLowerCase()).toContain(MULTISEND_ADDRESS.slice(2).toLowerCase());
    expect(data.toLowerCase()).toContain(OWNER.slice(2).toLowerCase());
  });
});
