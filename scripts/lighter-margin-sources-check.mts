// Live check for Lighter margin funding from any wallet: can Trustware route
// each USDC balance the app can see to Lighter's Arbitrum intent address, and
// does the route come back in the shape lib/lighter/margin-fund.ts executes?
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/lighter-margin-sources-check.mts
//
// Read-only. It creates route intents, which cost nothing and move no funds,
// and it signs and submits nothing.
//
// THE DESTINATION ADDRESS MATTERS AND THIS IS THE WHOLE REASON THE SCRIPT
// EXISTS. Trustware screens placeholder-looking destinations somewhere upstream
// and answers a screened one with a bare Cloudflare 502, not a JSON error. A
// run using 0x8b31... or 0x1111... reports every EVM destination as dead and
// looks exactly like a platform outage; it cost an afternoon once already, and
// borrow-funding.ts carries the same warning about 0x2222...2222. So this
// script fetches a REAL Lighter intent address from Lighter and routes to that.
// Never substitute a made-up address here.
//
// SIZE THE SOURCE IN ITS OWN DECIMALS. BNB Chain's USDC is 18, not 6. A first
// run of this script sized every chain at 6 and reported BNB unroutable, which
// was really a request for 0.00000002 USDC. The same mistake in the loss
// calculation reads an 18-decimal source as a 99.99% loss. Both are fixed here
// and both are why `decimals` is threaded through rather than assumed.
//
// What this verified when the any-wallet margin path was built (2026-08-31),
// to a real Arbitrum intent address, signable at every size shown:
//
//   source      $5      $20     $100    $1000
//   Solana      63 bps  25 bps  25 bps  25 bps
//   Base        25      37      37      41
//   Ethereum     2      40      40      40
//   BNB Chain    2      39      39      39
//
// Two things to read off it. The spread is not flat in size: the $5 column is
// dominated by a fixed fee, and the 2 bps entries are the estimate omitting a
// guaranteed minimum rather than a genuinely free route, so do not quote them.
// And signability moves: an earlier run had the Solana road unsignable at $100
// and $1000 because relay outbid LI.FI, then signable at every size twenty
// minutes later. That is the auction borrow-funding.ts documents, not a fault,
// and it is why margin-fund.ts asks at pay time instead of holding a ceiling.

import { USDC_MINT } from "../lib/jupiter/constants";
import { LIGHTER_INTENT_CHAIN_IDS } from "../lib/lighter/constants";
// The app's own implementation, not a hand-rolled call. createIntentAddress
// takes from_addr/amount/is_external_deposit, and getting those wrong answers
// "invalid param" rather than failing loudly.
import { lighterIntentAddress } from "../lib/lighter/server";
import {
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_SOLANA_CHAIN,
} from "../lib/trustware/constants";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
} from "../lib/trustware/types";

const KEY = process.env.TRUSTWARE_API_KEY;
if (!KEY) throw new Error("TRUSTWARE_API_KEY is not set");

// Any real, existing address. Funding does not change route outcomes
// (established by scripts/trustware-solana-route-check.mts), but a REAL one is
// required: see the warning at the top of this file.
const SOL_ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
// An L1 address with a Lighter account, used only to derive a real intent
// address to route at.
const L1_ADDR = "0xc5A4c813DC0d1C9E93bd9b53DBA2DC710b76502C";

const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

const SOURCES = [
  { label: "Solana", chain: TRUSTWARE_SOLANA_CHAIN, token: USDC_MINT, decimals: 6, from: SOL_ADDR },
  { label: "Base", chain: "8453", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, from: EVM_ADDR },
  { label: "Ethereum", chain: "1", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, from: EVM_ADDR },
  { label: "BNB Chain", chain: "56", token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, from: EVM_ADDR },
] as const;

const SIZES_USD = [5, 20, 100, 1000];

async function route(
  req: TrustwareQuoteRequest,
  fromDecimals: number,
): Promise<{
  ok: boolean;
  signable: boolean;
  lossBps: string;
  note: string;
}> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${TRUSTWARE_API_BASE_URL}/route`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY! },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(60_000),
    });
    text = await res.text();
  } catch (err) {
    // A single upstream timeout should not abandon the rest of the table.
    return {
      ok: false,
      signable: false,
      lossBps: "-",
      note: `request failed: ${err instanceof Error ? err.name : String(err)}`,
    };
  }
  let parsed: TrustwareQuoteResponse;
  try {
    parsed = JSON.parse(text) as TrustwareQuoteResponse;
  } catch {
    // A screened destination lands here. If this fires for every EVM chain,
    // check the destination address before concluding anything is down.
    return { ok: false, signable: false, lossBps: "-", note: `non-JSON ${res.status}` };
  }
  const estimate = extractEstimate(parsed);
  const transaction = extractExecution(parsed)?.transaction;
  const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount;
  // Rebased to the destination's 6 decimals before comparing. Comparing raw
  // atomic amounts across differing decimals reads BNB Chain's 18-decimal USDC
  // as a 99.99% loss, which is how this bug was found.
  const scale = 10n ** BigInt(Math.abs(fromDecimals - 6));
  const from =
    fromDecimals > 6
      ? BigInt(req.fromAmount) / scale
      : BigInt(req.fromAmount) * scale;
  const lossBps =
    guaranteed && from > 0n
      ? String(((from - BigInt(guaranteed)) * 10_000n) / from)
      : "-";
  return {
    ok: Boolean(extractIntentId(parsed)),
    signable: Boolean(transaction?.data),
    lossBps,
    note: parsed.error ? String(parsed.error).slice(0, 60) : "",
  };
}

const intent = await lighterIntentAddress(L1_ADDR, "arbitrum");
console.log(`Lighter Arbitrum intent address: ${intent}`);
if (!/^0x[0-9a-fA-F]{40}$/.test(intent)) {
  throw new Error("Intent address is not EVM-shaped; refusing to route.");
}
console.log("");
console.log("source      size     intent  signable  loss    note");

for (const source of SOURCES) {
  for (const usd of SIZES_USD) {
    // Built in BigInt, not via Number. 1000 * 1e18 exceeds MAX_SAFE_INTEGER and
    // silently loses precision, which would quietly mis-size every BNB row.
    const fromAmount = String(
      BigInt(Math.round(usd * 100)) * 10n ** BigInt(source.decimals - 2),
    );
    const result = await route(
      {
        fromChain: source.chain,
        toChain: String(LIGHTER_INTENT_CHAIN_IDS.arbitrum),
        fromToken: source.token,
        toToken: ARB_USDC,
        fromAmount,
        fromAddress: source.from,
        toAddress: intent,
        slippage: 0.3,
      },
      source.decimals,
    );
    console.log(
      `${source.label.padEnd(11)} $${String(usd).padEnd(7)} ` +
        `${(result.ok ? "yes" : "no").padEnd(7)} ` +
        `${(result.signable ? "yes" : "NO").padEnd(9)} ` +
        `${result.lossBps.padEnd(7)} ${result.note}`,
    );
    await new Promise((r) => setTimeout(r, 1200));
  }
}
