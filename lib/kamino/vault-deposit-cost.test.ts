import { describe, expect, it } from "vitest";

import type { KtxInstruction } from "./kvaults";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  FARMS_INITIALIZE_USER_DISCRIMINATOR,
  KAMINO_FARMS_PROGRAM_ADDRESS,
  kvaultAllocations,
} from "./vault-deposit-cost";

const WALLET = "KUMtRazMP7vwvc2kthnGZ9Cq6ZsGRiYC97snMYepNx9";
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const KVAULT = "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd";

const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");

function ataCreate(ata: string, mint: string): KtxInstruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    data: "AQ==",
    accounts: [
      { address: WALLET, role: "WRITABLE_SIGNER" },
      { address: ata, role: "WRITABLE" },
      { address: WALLET, role: "READONLY" },
      { address: mint, role: "READONLY" },
      { address: SYSTEM, role: "READONLY" },
      { address: TOKEN, role: "READONLY" },
    ],
  };
}

function initializeUser(userState: string, farmState: string): KtxInstruction {
  return {
    programAddress: KAMINO_FARMS_PROGRAM_ADDRESS,
    data: b64(FARMS_INITIALIZE_USER_DISCRIMINATOR),
    accounts: [
      { address: WALLET, role: "READONLY_SIGNER" },
      { address: WALLET, role: "WRITABLE_SIGNER" },
      { address: WALLET, role: "READONLY" },
      { address: WALLET, role: "READONLY" },
      { address: userState, role: "WRITABLE" },
      { address: farmState, role: "WRITABLE" },
      { address: SYSTEM, role: "READONLY" },
      { address: "SysvarRent111111111111111111111111111111111", role: "READONLY" },
    ],
  };
}

// The stake instruction that follows initialize_user. Same program, a
// different discriminator, and it allocates nothing.
function stake(userState: string, farmState: string): KtxInstruction {
  return {
    programAddress: KAMINO_FARMS_PROGRAM_ADDRESS,
    data: b64("ceb0ca12c8d1b36c"),
    accounts: [
      { address: WALLET, role: "READONLY_SIGNER" },
      { address: userState, role: "WRITABLE" },
      { address: farmState, role: "WRITABLE" },
      { address: "232RETZLCkPninSdSDcVPmzpX5vD541xnnC2nbNuqDsw", role: "WRITABLE" },
      { address: "9XHXTnrDdHiwEnJMGwrrKyEmbvNFodRy5V2B6YibzK1k", role: "WRITABLE" },
      { address: "DgHN3q3dSYAchNX7V3D4aYiTWMx8RHTgHbfPiwiqBkE9", role: "READONLY" },
      { address: KAMINO_FARMS_PROGRAM_ADDRESS, role: "READONLY" },
      { address: TOKEN, role: "READONLY" },
    ],
  };
}

function kvaultDeposit(): KtxInstruction {
  return {
    programAddress: KVAULT,
    data: b64("f223c68952e1f2b6"),
    accounts: Array.from({ length: 27 }, () => ({
      address: WALLET,
      role: "READONLY",
    })),
  };
}

describe("kvaultAllocations", () => {
  // KTX deposit-instructions for the RWA USDC vault, fresh wallet, 2026-09-21.
  it("reads the share account and the farm user state off a USDC deposit", () => {
    const allocations = kvaultAllocations([
      ataCreate(
        "9XHXTnrDdHiwEnJMGwrrKyEmbvNFodRy5V2B6YibzK1k",
        "DgHN3q3dSYAchNX7V3D4aYiTWMx8RHTgHbfPiwiqBkE9",
      ),
      kvaultDeposit(),
      initializeUser(
        "5kiAZBy7aqC7qy1wikqjxKWBXs2F6gP1wJBfPKPSzAHq",
        "ArwyAHmnFmbKbUxC2fnK5VUEpspHrnoFtJ22bvEyriKk",
      ),
      stake(
        "5kiAZBy7aqC7qy1wikqjxKWBXs2F6gP1wJBfPKPSzAHq",
        "ArwyAHmnFmbKbUxC2fnK5VUEpspHrnoFtJ22bvEyriKk",
      ),
    ]);
    expect(allocations).toEqual([
      {
        kind: "token_account",
        address: "9XHXTnrDdHiwEnJMGwrrKyEmbvNFodRy5V2B6YibzK1k",
        mint: "DgHN3q3dSYAchNX7V3D4aYiTWMx8RHTgHbfPiwiqBkE9",
        tokenProgram: TOKEN,
      },
      {
        kind: "farm_user_state",
        address: "5kiAZBy7aqC7qy1wikqjxKWBXs2F6gP1wJBfPKPSzAHq",
      },
    ]);
  });

  // The SOL Balanced vault wraps first: wSOL create, System transfer, sync.
  it("counts the wrapped-SOL account and ignores the transfer and sync", () => {
    const allocations = kvaultAllocations([
      ataCreate(
        "GmJPLhA3VsG2m5TckCJhe1nFA4zECQeY8cZTfEhvUtog",
        "So11111111111111111111111111111111111111112",
      ),
      {
        programAddress: SYSTEM,
        data: b64("0200000000ca9a3b00000000"),
        accounts: [
          { address: WALLET, role: "WRITABLE_SIGNER" },
          { address: "GmJPLhA3VsG2m5TckCJhe1nFA4zECQeY8cZTfEhvUtog", role: "WRITABLE" },
        ],
      },
      {
        programAddress: TOKEN,
        data: "EQ==",
        accounts: [
          { address: "GmJPLhA3VsG2m5TckCJhe1nFA4zECQeY8cZTfEhvUtog", role: "WRITABLE" },
        ],
      },
      ataCreate(
        "4Ax9mQCvv5it325jBxYeunyk8eMHfwC8sDBmyuhgDrYK",
        "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK",
      ),
      kvaultDeposit(),
      initializeUser(
        "HyLF4cafrH86rz3F1DBE53t5kNZt8WvCGoGSzW7mTdXs",
        "HdoYSQ8pzKMKHARtY6Uu682rcMxqkV2151vKsB1d7PeW",
      ),
    ]);
    expect(allocations.map((a) => a.kind)).toEqual([
      "token_account",
      "token_account",
      "farm_user_state",
    ]);
    expect(allocations[0]).toMatchObject({
      mint: "So11111111111111111111111111111111111111112",
    });
  });

  it("prices nothing for a wallet the farm already knows", () => {
    // KTX omits initialize_user for a returning wallet; the ATA create stays
    // (idempotent) and the existence check upstream decides whether it costs.
    const allocations = kvaultAllocations([
      ataCreate(
        "9XHXTnrDdHiwEnJMGwrrKyEmbvNFodRy5V2B6YibzK1k",
        "DgHN3q3dSYAchNX7V3D4aYiTWMx8RHTgHbfPiwiqBkE9",
      ),
      kvaultDeposit(),
      stake(
        "5kiAZBy7aqC7qy1wikqjxKWBXs2F6gP1wJBfPKPSzAHq",
        "ArwyAHmnFmbKbUxC2fnK5VUEpspHrnoFtJ22bvEyriKk",
      ),
    ]);
    expect(allocations.map((a) => a.kind)).toEqual(["token_account"]);
  });

  it("does not mistake a farms instruction with the wrong shape for an init", () => {
    const wrongShape = initializeUser("a", "b");
    wrongShape.accounts = wrongShape.accounts.slice(0, 7);
    expect(kvaultAllocations([wrongShape])).toEqual([]);
  });
});
