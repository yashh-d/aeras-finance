// Live check for the first-position rent preflight, both venues.
//
//   npx tsx scripts/kamino-first-position-check.mts [walletAddress]
//
// The preflight decides whether to interrupt a borrow and ask the user for
// ~$3.17 of SOL. Every way it can be wrong is quiet:
//
//   A changed klend seed derives an address that does not exist, so every user
//   reads as "already set up" and walks back into the raw simulation error this
//   was built to remove. Nothing throws; the modal just stops appearing.
//
//   A changed account size prices the wrong rent, so the sheet asks for too
//   little and the borrow fails after the user has paid to fix it.
//
// So this asserts both against mainnet rather than against an IDL. It re-derives
// a live obligation from the owner and market stored inside that obligation, and
// re-derives its owner's UserMetadata, and requires both to hit real accounts of
// the expected size.
//
// It also pins the number that started all of this: rent for a 56-byte address
// lookup table must equal the 1,165,272 lamports the production failure quoted
// in "insufficient lamports 990000, need 1165272".

import { Connection, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

import {
  kaminoUserMetadataPda,
  kaminoVanillaObligationPda,
  KLEND_PROGRAM_ID,
} from "../lib/kamino/first-position";
import { KAMINO_XSTOCKS_MARKET } from "../lib/kamino/reserves";

// A reserve in the xStocks Market. Recent activity on it is how we find real
// users to derive against, so no address needs hardcoding beyond this one.
const TSLAX_RESERVE = "5iTiczqgUegqA3PpoNpotizMbY9n1sRWr3oL6igKvWuf";

// The lamport figure quoted by the transaction that motivated this whole path.
const PRODUCTION_LOOKUP_TABLE_RENT = 1_165_272;
const LOOKUP_TABLE_SIZE = 56;
const USER_METADATA_SIZE = 1032;
const OBLIGATION_SIZE = 3344;

// Jupiter Lend, measured in vault 77.
const JUP_POSITION_SIZE = 71;
const JUP_NFT_MINT_SIZE = 82;
const JUP_NFT_TOKEN_SIZE = 165;

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

// Walk recent activity on a reserve back to an obligation account we can test
// the derivation against. Beats hardcoding one, which would rot the first time
// that user closed their position.
async function findLiveObligation(
  connection: Connection,
): Promise<PublicKey | null> {
  const sigs = await connection.getSignaturesForAddress(
    new PublicKey(TSLAX_RESERVE),
    { limit: 15 },
  );
  for (const sig of sigs.slice(0, 8)) {
    const tx = await connection.getTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;
    const keys = [
      ...tx.transaction.message.getAccountKeys().staticAccountKeys,
      ...(tx.meta?.loadedAddresses?.writable ?? []),
      ...(tx.meta?.loadedAddresses?.readonly ?? []),
    ];
    const infos = await connection.getMultipleAccountsInfo(keys);
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      if (
        info &&
        info.owner.equals(KLEND_PROGRAM_ID) &&
        info.data.length === OBLIGATION_SIZE
      ) {
        return keys[i];
      }
    }
  }
  return null;
}

async function main() {
  const connection = new Connection(rpcUrl(), "confirmed");

  console.log("\nRent, priced live (sizes are constants, lamports never are)");
  const sizes = [
    ["Kamino lookup table", LOOKUP_TABLE_SIZE],
    ["Kamino UserMetadata", USER_METADATA_SIZE],
    ["Kamino Obligation", OBLIGATION_SIZE],
    ["Jupiter position", JUP_POSITION_SIZE],
    ["Jupiter NFT mint", JUP_NFT_MINT_SIZE],
    ["Jupiter NFT token account", JUP_NFT_TOKEN_SIZE],
  ] as const;
  const rents = new Map<number, number>();
  for (const [label, size] of sizes) {
    const rent = await connection.getMinimumBalanceForRentExemption(size);
    rents.set(size, rent);
    console.log(
      `       ${label.padEnd(26)} ${String(size).padStart(5)} B  ${String(rent).padStart(10)} lamports  ${sol(rent)} SOL`,
    );
  }

  const kaminoTotal =
    rents.get(LOOKUP_TABLE_SIZE)! +
    rents.get(USER_METADATA_SIZE)! +
    rents.get(OBLIGATION_SIZE)!;
  const jupiterTotal =
    rents.get(JUP_POSITION_SIZE)! +
    rents.get(JUP_NFT_MINT_SIZE)! +
    rents.get(JUP_NFT_TOKEN_SIZE)!;
  console.log(`\n       Kamino first position   ${sol(kaminoTotal)} SOL`);
  console.log(`       Jupiter first position  ${sol(jupiterTotal)} SOL`);

  console.log("\nAssertions");
  check(
    "lookup table rent still matches the production failure",
    rents.get(LOOKUP_TABLE_SIZE) === PRODUCTION_LOOKUP_TABLE_RENT,
    `got ${rents.get(LOOKUP_TABLE_SIZE)}, failure quoted ${PRODUCTION_LOOKUP_TABLE_RENT}`,
  );

  const obligation = await findLiveObligation(connection);
  if (!obligation) {
    check("found a live obligation to derive against", false, "none in recent activity");
  } else {
    const info = await connection.getAccountInfo(obligation);
    check(
      "obligation account is the expected size",
      info?.data.length === OBLIGATION_SIZE,
      `${obligation.toBase58()} is ${info?.data.length} B, expected ${OBLIGATION_SIZE}`,
    );

    // Layout: 8 discriminator, 8 tag, 16 last_update, 32 lending_market, 32 owner.
    const data = info!.data;
    const market = new PublicKey(data.subarray(32, 64));
    const owner = new PublicKey(data.subarray(64, 96));

    check(
      "obligation belongs to the xStocks Market",
      market.toBase58() === KAMINO_XSTOCKS_MARKET,
      market.toBase58(),
    );

    const derived = kaminoVanillaObligationPda(owner, market);
    check(
      "vanilla obligation PDA re-derives from its own owner and market",
      derived.equals(obligation),
      `derived ${derived.toBase58()}, actual ${obligation.toBase58()}`,
    );

    const metadata = kaminoUserMetadataPda(owner);
    const metaInfo = await connection.getAccountInfo(metadata);
    check(
      "UserMetadata PDA hits a live klend account",
      metaInfo != null && metaInfo.owner.equals(KLEND_PROGRAM_ID),
      metadata.toBase58(),
    );
    check(
      "UserMetadata is the expected size",
      metaInfo?.data.length === USER_METADATA_SIZE,
      `${metaInfo?.data.length} B, expected ${USER_METADATA_SIZE}`,
    );
  }

  // A wallet with no Kamino history must derive addresses that do NOT exist,
  // which is the branch that actually shows the sheet. A derivation bug that
  // returned an existing account would silently disable the whole feature.
  const fresh = PublicKey.unique();
  const freshInfos = await connection.getMultipleAccountsInfo([
    kaminoUserMetadataPda(fresh),
    kaminoVanillaObligationPda(fresh),
  ]);
  check(
    "an unused wallet derives to accounts that do not exist",
    freshInfos.every((i) => i == null),
    "a fresh wallet must read as needing setup",
  );

  console.log(
    failures === 0
      ? "\nAll checks passed.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
