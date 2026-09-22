// Live check for the Earn tab's first-deposit rent preflight, both venues.
//
//   npx tsx scripts/earn-deposit-cost-check.mts
//
// The preflight decides whether to interrupt a vault deposit and offer to buy
// the SOL its account rent needs. Every way it can be wrong is quiet: a moved
// farms discriminator or account index prices a first Kamino deposit as free,
// a share mint that changes token program sizes the wrong account, and the
// user walks back into the raw simulation error this exists to remove.
//
// So this asserts against mainnet and against live KTX output rather than
// against an IDL:
//
//   Kamino  For every curated vault, KTX's deposit instructions for a fresh
//           wallet contain exactly one initialize_user whose discriminator is
//           sha256("global:initialize_user")[..8], and the scanner reads the
//           share account and the user state off them. A live user state in
//           that vault's farm is found and required to be FARM_USER_STATE_SIZE.
//   Jupiter Every share mint lives under the same token program as its asset,
//           which is what the Lend SDK assumes when it derives the share ATA,
//           and the Token-2022 pair (USDG) sizes above 165 bytes.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { rentFor } from "../lib/borrow/setup-cost";
import { EARN_ASSETS } from "../lib/jupiter/earn";
import { KAMINO_EARN_VAULTS, type KtxInstruction } from "../lib/kamino/kvaults";
import {
  FARM_USER_STATE_SIZE,
  FARMS_INITIALIZE_USER_DISCRIMINATOR,
  KAMINO_FARMS_PROGRAM_ADDRESS,
  kvaultAllocations,
} from "../lib/kamino/vault-deposit-cost";
import { associatedTokenAccountSize } from "../lib/solana/token-account-rent";

const KTX_BASE = "https://api.kamino.finance/ktx/kvault";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` -- ${detail}` : ""}`);
}

function rpcUrl(): string {
  if (process.env.NEXT_PUBLIC_SOLANA_RPC_URL) {
    return process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  }
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const url = env
    .match(/^NEXT_PUBLIC_SOLANA_RPC_URL=(.*)$/m)?.[1]
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!url) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not set");
  return url;
}

const sol = (n: number) => (n / 1e9).toFixed(6);
const conn = new Connection(rpcUrl(), "confirmed");

// A wallet nobody has used, so KTX includes every allocation a first deposit
// needs. The amount is one whole token; KTX takes human-readable units.
const FRESH = Keypair.generate().publicKey.toBase58();

async function ktxDeposit(vault: string): Promise<KtxInstruction[]> {
  const res = await fetch(`${KTX_BASE}/deposit-instructions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "aeras-finance/0.1",
    },
    body: JSON.stringify({ wallet: FRESH, kvault: vault, amount: "1" }),
  });
  const payload = (await res.json()) as { instructions?: KtxInstruction[] };
  if (!res.ok || !payload.instructions) {
    throw new Error(`KTX deposit-instructions ${vault} -> ${res.status}`);
  }
  return payload.instructions;
}

// Walk recent activity on a farm back to a user-state account owned by the
// farms program, so the size is read off a real one rather than an IDL.
async function findLiveUserState(farmState: string): Promise<number | null> {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(farmState), {
    limit: 8,
  });
  for (const sig of sigs) {
    const tx = await conn.getTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;
    const keys = tx.transaction.message.getAccountKeys({
      accountKeysFromLookups: tx.meta?.loadedAddresses,
    });
    const candidates = keys.staticAccountKeys.filter(
      (k) => k.toBase58() !== farmState,
    );
    const infos = await conn.getMultipleAccountsInfo(candidates, {
      dataSlice: { offset: 0, length: 0 },
    });
    for (let i = 0; i < candidates.length; i++) {
      const info = infos[i];
      if (info && info.owner.toBase58() === KAMINO_FARMS_PROGRAM_ADDRESS) {
        // web3.js reports `space` only on some responses; fall back to a full
        // read when it is absent.
        const full = await conn.getAccountInfo(candidates[i]);
        return full?.data.length ?? null;
      }
    }
  }
  return null;
}

console.log(`fresh wallet: ${FRESH}\n`);

const expectedDiscriminator = createHash("sha256")
  .update("global:initialize_user")
  .digest()
  .subarray(0, 8)
  .toString("hex");
check(
  "initialize_user discriminator is sha256(global:initialize_user)[..8]",
  expectedDiscriminator === FARMS_INITIALIZE_USER_DISCRIMINATOR,
  expectedDiscriminator,
);

console.log("\nKamino K-Vaults");
for (const vault of KAMINO_EARN_VAULTS) {
  const instructions = await ktxDeposit(vault.address);
  const inits = instructions.filter(
    (ix) =>
      ix.programAddress === KAMINO_FARMS_PROGRAM_ADDRESS &&
      Buffer.from(ix.data ?? "", "base64")
        .subarray(0, 8)
        .toString("hex") === FARMS_INITIALIZE_USER_DISCRIMINATOR,
  );
  check(
    `${vault.name}: one initialize_user for a fresh wallet`,
    inits.length === 1,
    `${inits.length}`,
  );

  const allocations = kvaultAllocations(instructions);
  const shareAccount = allocations.find(
    (a) => a.kind === "token_account" && a.mint === vault.sharesMint,
  );
  const userState = allocations.find((a) => a.kind === "farm_user_state");
  check(`${vault.name}: scanner finds the share account`, !!shareAccount);
  check(`${vault.name}: scanner finds the farm user state`, !!userState);

  if (inits.length === 1 && userState) {
    const named = inits[0].accounts[4]?.address;
    check(
      `${vault.name}: user state is initialize_user's fifth account`,
      named === userState.address,
      userState.address,
    );
    const farmState = inits[0].accounts[5]?.address;
    const size = farmState ? await findLiveUserState(farmState) : null;
    check(
      `${vault.name}: a live user state in the farm is ${FARM_USER_STATE_SIZE} bytes`,
      size === FARM_USER_STATE_SIZE,
      size == null ? "none found in recent activity" : `${size}`,
    );
  }
}

console.log("\nJupiter Lend");
for (const asset of EARN_ASSETS) {
  const [assetInfo, shareInfo] = await conn.getMultipleAccountsInfo(
    [new PublicKey(asset.assetMint), new PublicKey(asset.jlTokenMint)],
    { dataSlice: { offset: 0, length: 0 } },
  );
  const same =
    assetInfo != null &&
    shareInfo != null &&
    assetInfo.owner.equals(shareInfo.owner);
  check(
    `${asset.symbol}: share mint and asset mint share a token program`,
    same,
    `${assetInfo?.owner.toBase58()} / ${shareInfo?.owner.toBase58()}`,
  );
  if (!shareInfo) continue;
  const size = await associatedTokenAccountSize(
    conn,
    new PublicKey(asset.jlTokenMint),
    shareInfo.owner,
  );
  const token2022 = shareInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
  check(
    `${asset.symbol}: share account sized ${size} bytes (${token2022 ? "Token-2022" : "classic"})`,
    token2022 ? size > 165 : size === 165,
  );
  if (!shareInfo.owner.equals(TOKEN_PROGRAM_ID) && !token2022) {
    check(`${asset.symbol}: share mint owner is a token program`, false);
  }
}

console.log("\nRent today");
for (const size of [0, 165, FARM_USER_STATE_SIZE]) {
  console.log(`  ${String(size).padStart(4)} bytes  ${sol(await rentFor(conn, size))} SOL`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
