// Live check for the USDC-equity multiply path behind the Strategies page.
//
//   npx tsx scripts/jupiter-multiply-usdc-check.mts [walletAddress] [equityUsdc]
//
// Buy + Leverage opens a leveraged Jupiter Lend position from a wallet that
// holds only USDC: the flashloan fronts the WHOLE exposure (equity plus
// borrow), the swap turns all of it into the asset, the vault lends the
// borrowed share, and the payback draws the borrow plus the user's own USDC
// from the signer's account. That last part is the thing to prove: if the
// payback instruction did not pull from the signer, the transaction would
// fail or, worse, leave the equity unspent.
//
// For each of the four USDC vaults this builds the transaction at 2x and at
// the vault's max through the same buildMultiplyTx the page uses, counts the
// locked accounts against the 64 limit, and simulates it against mainnet with
// signature verification off. A simulation that gets past the flashloan
// payback proves the payback reads the signer's USDC. It also reads the
// flashloan fee the SDK charges, which nothing in the repo records.
//
// Nothing is signed or sent. The wallet must hold at least `equityUsdc` USDC
// and a little SOL for the simulation to get past the transfers.

import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { readFileSync } from "node:fs";

import { XSTOCK_BORROW_VAULTS } from "../lib/jupiter/borrow";
import { USDC_DECIMALS } from "../lib/jupiter/constants";
import { buildMultiplyTx, maxLeverageForVault } from "../lib/jupiter/multiply";

const WALLET = process.argv[2] ?? "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
const EQUITY_USDC = Number(process.argv[3] ?? 10);
const SLIPPAGE_BPS = 100;
const MAX_TX_ACCOUNT_LOCKS = 64;

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
  const url = env.match(/^NEXT_PUBLIC_SOLANA_RPC_URL=(.*)$/m)?.[1]?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not set");
  return url;
}

// buildMultiplyTx quotes through the app's own proxy at window.location.origin.
// There is no window here, so point fetch at Jupiter's Lite API directly, the
// same upstream the proxy forwards to.
const LITE = "https://lite-api.jup.ag/swap/v1";
const realFetch = globalThis.fetch;
(globalThis as { window?: unknown }).window = { location: { origin: "http://localhost" } };
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("http://localhost/api/jupiter/swap/quote")) {
    const u = new URL(url);
    return realFetch(`${LITE}/quote?${u.searchParams.toString()}`, init);
  }
  if (url.startsWith("http://localhost/api/jupiter/swap/instructions")) {
    return realFetch(`${LITE}/swap-instructions`, init);
  }
  return realFetch(input, init);
}) as typeof fetch;

function usdcAtomic(ui: number): BN {
  return new BN(Math.round(ui * 10 ** USDC_DECIMALS));
}

async function main() {
  const connection = new Connection(rpcUrl(), "confirmed");
  // Validates the address before any network call.
  new PublicKey(WALLET);
  console.log(`wallet ${WALLET}, equity ${EQUITY_USDC} USDC\n`);

  for (const vault of XSTOCK_BORROW_VAULTS.filter((v) => v.borrowSymbol === "USDC")) {
    const max = maxLeverageForVault(vault);
    for (const leverage of [2, Math.floor(max * 10) / 10]) {
      const label = `${vault.collateralSymbol} ${leverage.toFixed(1)}x`;
      const borrow = EQUITY_USDC * (leverage - 1);
      try {
        const { base64Tx, quote } = await buildMultiplyTx({
          vault,
          positionId: 0,
          initialCollateralAtomic: new BN(0),
          borrowUsdcAtomic: usdcAtomic(borrow),
          equityUsdcAtomic: usdcAtomic(EQUITY_USDC),
          signerAddress: WALLET,
          connection,
          slippageBps: SLIPPAGE_BPS,
        });
        check(
          `${label}: swap sized to equity + borrow`,
          quote.inAmount === usdcAtomic(EQUITY_USDC + borrow).toString(),
          `in ${quote.inAmount}, expected ${usdcAtomic(EQUITY_USDC + borrow)}`,
        );

        const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
        const locked =
          tx.message.staticAccountKeys.length +
          tx.message.addressTableLookups.reduce(
            (n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length,
            0,
          );
        check(`${label}: ${locked} accounts locked`, locked <= MAX_TX_ACCOUNT_LOCKS);

        const sim = await connection.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: "confirmed",
        });
        const logs = sim.value.logs ?? [];
        const feeLine = logs.find((l) => /fee/i.test(l) && /flash/i.test(l));
        if (sim.value.err) {
          const tail = logs.slice(-6).join("\n        ");
          check(`${label}: simulation`, false, `${JSON.stringify(sim.value.err)}\n        ${tail}`);
        } else {
          check(`${label}: simulation`, true, `${sim.value.unitsConsumed} CU`);
          if (feeLine) console.log(`        flashloan fee log: ${feeLine}`);
        }
      } catch (err) {
        check(`${label}: build`, false, err instanceof Error ? err.message : String(err));
      }
    }
  }

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  console.log(
    "Sizing: signer USDC must cover the equity. A simulation error of 0x1 (insufficient funds) on the payback means the wallet holds less USDC than the equity, not that the payback is mis-wired.",
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
