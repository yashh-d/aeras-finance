// Validation spike: can Trustware route a same-underlying tokenized stock on an
// EVM chain into the canonical Solana xStock, and at what effective slippage?
//
// This is a read-only quote. It signs nothing and moves nothing. It exists to
// answer one question before we build any UI: is "convert with almost no
// slippage" actually true for these RWA routes, or does the generic
// source->USD->bridge->buy path lose too much?
//
// Run: node scripts/trustware-quote-spike.mjs
// Requires TRUSTWARE_API_KEY in .env.local (server-only key).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const path = join(__dirname, "..", ".env.local");
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnvLocal();
const API_KEY = env.TRUSTWARE_API_KEY;
if (!API_KEY) {
  console.error("TRUSTWARE_API_KEY missing from .env.local");
  process.exit(1);
}

// Canonical Solana xStock destination (matches lib/jupiter/borrow.ts vault 77).
const TSLAX_SOLANA = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

// Placeholder addresses. A quote is screened for AML/OFAC but does not require
// ownership, so these stand in for a real EVM source wallet and Solana recipient.
const EVM_ADDR = "0xeb212fe20f26243ec4d4df2dd49c8aa9fa75a201";
const SOL_ADDR = "So11111111111111111111111111111111111111112";

// Sources to compare: the real same-underlying token the user cited, plus a
// liquid generic proxy as a control.
const CASES = [
  {
    label: "Ondo Tesla (Ethereum) -> TSLAx (Solana)  [same-underlying]",
    fromChain: "1",
    fromToken: "0xf6b1117ec07684d3958cad8beb1b302bfd21103f", // TSLAon, 18 dec
    fromDecimals: 18,
    // ~10 TSLAon
    fromAmount: (10n * 10n ** 18n).toString(),
  },
  {
    label: "USDC (Base) -> TSLAx (Solana)  [generic control]",
    fromChain: "8453",
    fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC, 6 dec
    fromDecimals: 6,
    // ~3000 USDC (roughly 10 TSLA of notional)
    fromAmount: (3000n * 10n ** 6n).toString(),
  },
];

async function quote(c) {
  const payload = {
    fromChain: c.fromChain,
    toChain: "solana-mainnet-beta",
    fromToken: c.fromToken,
    toToken: TSLAX_SOLANA,
    fromAmount: c.fromAmount,
    fromAddress: EVM_ADDR,
    toAddress: SOL_ADDR,
    slippage: 1,
  };
  const res = await fetch("https://api.trustware.io/api/v1/routes/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

const TSLAX_DECIMALS = 8;

function fmt(atomic, decimals) {
  if (atomic == null) return "n/a";
  const s = BigInt(atomic).toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

for (const c of CASES) {
  console.log("\n=== " + c.label + " ===");
  try {
    const { status, body } = await quote(c);
    if (status !== 200) {
      console.log(`  HTTP ${status}:`, JSON.stringify(body).slice(0, 400));
      continue;
    }
    const est = body.estimate ?? body.data?.estimate ?? {};
    const toAmount = est.toAmount;
    const toAmountMin = est.toAmountMin;
    console.log("  out TSLAx:      ", fmt(toAmount, TSLAX_DECIMALS));
    console.log("  out min TSLAx:  ", fmt(toAmountMin, TSLAX_DECIMALS));
    console.log("  out USD:        ", est.toAmountUsd ?? "n/a");
    console.log("  fromAmount USD: ", est.fromAmountUsd ?? body.fromAmountUsd ?? "n/a");
    console.log("  total fees USD: ", est.totalFeesUsd ?? "n/a");
    // Effective slippage vs USD-in, if both USD figures are present.
    const inUsd = Number(est.fromAmountUsd ?? body.fromAmountUsd);
    const outUsd = Number(est.toAmountUsd);
    if (inUsd && outUsd) {
      const lossPct = ((inUsd - outUsd) / inUsd) * 100;
      console.log(`  effective loss: ${lossPct.toFixed(3)}%  (in $${inUsd} -> out $${outUsd})`);
    }
    if (Array.isArray(est.fees)) {
      for (const f of est.fees) {
        console.log(`    fee: ${f.type ?? "?"}  $${f.amountUsd ?? f.usd ?? "?"}`);
      }
    }
  } catch (err) {
    console.log("  ERROR:", err.message);
  }
}
console.log("");
