// Does every token in the curated swap registry actually route, and are its
// decimals right?
//
// A token being listed in Trustware's GET /routes/tokens proves neither. The
// registry has ~26k rows including a second "USDC" on Ethereum at 18 decimals
// priced at $11.75, and `?chain=` is ignored so the list cannot even be narrowed
// server-side. Everything in lib/trustware/swap-tokens.ts was established by the
// checks below, and this script re-runs them.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/trustware-swap-quote-check.mts
//
// Add PROXY_ORIGIN to also exercise the allowlist through our own proxy:
//
//   PROXY_ORIGIN=http://localhost:3000 npx tsx scripts/trustware-swap-quote-check.mts
//
// Read-only. /quote signs nothing, moves nothing, and creates no intent.
//
// Two findings worth keeping, both of which cost real time to track down:
//
//  1. Squid rejects an off-curve Solana pubkey with "Invalid Solana fromAddress"
//     while every other provider accepts it. Provider selection varies per
//     request, so an off-curve test address makes routes look randomly broken.
//     TEST_SOL below is on-curve. Real Privy wallets always are, so this only
//     ever bites test scripts. Note scripts/trustware-solana-route-check.mts
//     still uses an off-curve address for its UNFUNDED_SOL case.
//  2. Decimals are checked by implying the token's USD price from a quote in
//     both directions and confirming the two agree. A wrong decimals value shows
//     up here as an implied price off by orders of magnitude, which is the only
//     cheap way to catch it before it misprices a swap by 10^12.

import {
  SWAP_TOKENS,
  WSOL_MINT,
  isSamePair,
  solanaMintFor,
  swapTokensForChain,
  type SwapToken,
} from "../lib/trustware/swap-tokens";
import { quoteSwap } from "../lib/trustware/swap-quote";
import { directQuote } from "../lib/jupiter/convert";
import { isAllowedSwapPair } from "../lib/jupiter/swap-pairs";
import { USDC_MINT } from "../lib/jupiter/constants";
import { XSTOCK_BORROW_VAULTS } from "../lib/jupiter/borrow";
import {
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_SOLANA_CHAIN,
} from "../lib/trustware/constants";
import { extractEstimate } from "../lib/trustware/types";
import { toNumberOrNull, uiToAtomic } from "../lib/trustware/amounts";

// On-curve, so squid accepts it. See note 1 above.
const TEST_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TEST_EVM = "0x1111111111111111111111111111111111111111";

// Small enough to route on every pair, large enough that fixed fees do not
// swamp the implied price.
const PROBE_USD = 200;

function addressFor(token: SwapToken): string {
  return token.kind === "solana" ? TEST_SOL : TEST_EVM;
}

function apiKey(): string {
  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) throw new Error("TRUSTWARE_API_KEY is not set");
  return key;
}

interface QuoteOutcome {
  ok: boolean;
  status: number;
  fromUsd: number | null;
  toUsd: number | null;
  toAmount: string | null;
  feesUsd: number | null;
  error: string;
}

async function quote(
  from: SwapToken,
  to: SwapToken,
  fromUi: string,
): Promise<QuoteOutcome> {
  const body = {
    fromChain: from.chain,
    toChain: to.chain,
    fromToken: from.address,
    toToken: to.address,
    fromAmount: uiToAtomic(fromUi, from.decimals),
    fromAddress: addressFor(from),
    toAddress: addressFor(to),
    // Solana-source routes are rejected without this.
    fromAmountUSD: PROBE_USD,
    slippage: from.kind === "solana" && to.kind === "solana" ? 0.3 : 1,
  };
  const res = await fetch(`${TRUSTWARE_API_BASE_URL}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const est = parsed ? extractEstimate(parsed) : undefined;
  return {
    ok: res.ok && Boolean(est?.toAmount),
    status: res.status,
    fromUsd: toNumberOrNull(est?.fromAmountUsd),
    toUsd: toNumberOrNull(est?.toAmountUsd),
    toAmount: est?.toAmount ?? null,
    feesUsd: toNumberOrNull(est?.totalFeesUsd),
    error: String((parsed?.["error"] as string) ?? text).slice(0, 90),
  };
}

// A reference stablecoin on the opposite side, so every token gets probed
// against something known-liquid rather than against another thin asset.
const REF_SOLANA = SWAP_TOKENS.find(
  (t) => t.chain === TRUSTWARE_SOLANA_CHAIN && t.symbol === "USDC",
)!;
const REF_ETHEREUM = SWAP_TOKENS.find(
  (t) => t.chain === "1" && t.symbol === "USDC",
)!;

function referenceFor(token: SwapToken): SwapToken {
  return token.chain === "1" ? REF_SOLANA : REF_ETHEREUM;
}

// Round-trip a token against a reference stable and imply its USD price from
// each leg. If the decimals in the registry are wrong the two disagree wildly.
async function checkToken(token: SwapToken) {
  const ref = referenceFor(token);
  const label = `${token.chainLabel}/${token.symbol}`.padEnd(22);

  // Leg 1: reference stable in, token out. Implies price from the delivered
  // amount and its reported USD value.
  const inbound = await quote(ref, token, String(PROBE_USD));
  let priceFromInbound: number | null = null;
  if (inbound.ok && inbound.toAmount && inbound.toUsd) {
    const units = Number(inbound.toAmount) / 10 ** token.decimals;
    priceFromInbound = units > 0 ? inbound.toUsd / units : null;
  }

  // Leg 2: token in, reference stable out. Sized from the price just implied,
  // so both legs move roughly the same notional.
  let priceFromOutbound: number | null = null;
  let outbound: QuoteOutcome | null = null;
  if (priceFromInbound && priceFromInbound > 0) {
    const ui = (PROBE_USD / priceFromInbound).toFixed(
      Math.min(token.decimals, 12),
    );
    outbound = await quote(token, ref, ui);
    // `fromAmountUsd` is absent on most Solana-source estimates, so fall back to
    // the delivered USD value. That understates the price by the fee, which the
    // tolerance below absorbs. It is still enough to catch a decimals error,
    // since those are wrong by whole orders of magnitude, not by percent.
    const outUsd = outbound.fromUsd ?? outbound.toUsd;
    if (outbound.ok && outUsd) {
      priceFromOutbound = outUsd / Number(ui);
    }
  }

  // Loose on purpose. This is a "did we put the decimal point in the right
  // place" check, not a price oracle.
  const agree =
    priceFromInbound && priceFromOutbound
      ? Math.abs(priceFromInbound - priceFromOutbound) /
          Math.max(priceFromInbound, priceFromOutbound) <
        0.1
      : false;

  const fmt = (n: number | null) => (n === null ? "     -" : `$${n.toFixed(2)}`);
  const verdict = !inbound.ok
    ? `IN ${inbound.status} ${inbound.error}`
    : !outbound?.ok
      ? `OUT ${outbound?.status ?? "-"} ${outbound?.error ?? ""}`
      : !priceFromOutbound
        ? "no USD figure on the outbound leg"
        : agree
          ? "ok"
          : "DECIMALS SUSPECT";

  console.log(
    `  ${label} dec=${String(token.decimals).padEnd(2)}` +
      ` in=${fmt(priceFromInbound)} out=${fmt(priceFromOutbound)}  ${verdict}`,
  );
  return { token, ok: inbound.ok && Boolean(outbound?.ok) && agree };
}

async function checkProxy(origin: string) {
  const post = async (body: unknown) => {
    const res = await fetch(`${origin}/api/trustware/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { status: res.status, error: j.error ?? "" };
  };

  const solUsdc = SWAP_TOKENS.find(
    (t) => t.chain === TRUSTWARE_SOLANA_CHAIN && t.symbol === "USDC",
  )!;
  const ethUsdt = SWAP_TOKENS.find(
    (t) => t.chain === "1" && t.symbol === "USDT",
  )!;

  const base = {
    fromChain: solUsdc.chain,
    toChain: ethUsdt.chain,
    fromToken: solUsdc.address,
    toToken: ethUsdt.address,
    fromAmount: uiToAtomic("25", solUsdc.decimals),
    fromAddress: TEST_SOL,
    toAddress: TEST_EVM,
  };

  const cases: [string, unknown, "allow" | "reject"][] = [
    ["curated pair, Solana -> Ethereum", base, "allow"],
    [
      "uncurated destination token",
      { ...base, toToken: "0x0000000000000000000000000000000000000dead" },
      "reject",
    ],
    [
      "uncurated source token",
      { ...base, fromToken: "So11111111111111111111111111111111111111112" },
      "reject",
    ],
    [
      "uncurated destination chain",
      { ...base, toChain: "137" },
      "reject",
    ],
    ["same token both sides", { ...base, toChain: solUsdc.chain, toToken: solUsdc.address }, "reject"],
    ["malformed fromAmount", { ...base, fromAmount: "1e18" }, "reject"],
    ["malformed toAddress", { ...base, toAddress: "../../etc/passwd" }, "reject"],
  ];

  for (const [label, body, expect] of cases) {
    const r = await post(body);
    const allowed = r.status !== 400;
    const pass = expect === "allow" ? allowed : !allowed;
    console.log(
      `  ${label.padEnd(36)} ${String(r.status).padEnd(4)} ${pass ? "ok" : "FAIL"}` +
        (r.error ? `  ${r.error.slice(0, 50)}` : ""),
    );
  }
}

async function main() {
  console.log(
    `\n1. Every curated token, priced from both directions (${SWAP_TOKENS.length} tokens)`,
  );
  const results = [];
  for (const token of SWAP_TOKENS) {
    results.push(await checkToken(token));
  }

  console.log("\n2. The stated use case, end to end");
  const solUsdc = swapTokensForChain(TRUSTWARE_SOLANA_CHAIN).find(
    (t) => t.symbol === "USDC",
  )!;
  const ethUsdt = swapTokensForChain("1").find((t) => t.symbol === "USDT")!;
  const r = await quote(solUsdc, ethUsdt, "25");
  console.log(
    `  Solana USDC -> Ethereum USDT   ${r.ok ? "ok" : `FAIL ${r.status} ${r.error}`}` +
      (r.ok ? `  in=$${r.fromUsd} out=$${r.toUsd} fees=$${r.feesUsd}` : ""),
  );

  console.log("\n3. Solana -> Solana, which Jupiter prices rather than Trustware");
  const solTokens = swapTokensForChain(TRUSTWARE_SOLANA_CHAIN);
  for (const to of solTokens) {
    if (to.symbol === "USDC") continue;
    try {
      const q = await quoteSwap({
        from: solUsdc,
        to,
        amountUi: "25",
        fromAddress: TEST_SOL,
        toAddress: TEST_SOL,
        jupiterTransport: directQuote,
      });
      const impact =
        q.priceImpactFraction === null
          ? "impact=n/a"
          : `impact=${(q.priceImpactFraction * 100).toFixed(3)}%`;
      console.log(
        `  USDC -> ${to.symbol.padEnd(5)} ${q.engine.padEnd(9)} out=${q.toAmountUi.padEnd(14)}` +
          ` min=${q.toAmountMinUi.padEnd(14)} ${impact}`,
      );
    } catch (err) {
      console.log(
        `  USDC -> ${to.symbol.padEnd(5)} FAIL ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("\n4. The Jupiter proxy allowlist covers those pairs");
  for (const a of solTokens) {
    for (const b of solTokens) {
      if (a === b) continue;
      const allowed = isAllowedSwapPair(solanaMintFor(a), solanaMintFor(b));
      if (!allowed) console.log(`  ${a.symbol} -> ${b.symbol}  REJECTED`);
    }
  }
  // The pairs the proxy served before the swap surface existed must still pass.
  const regressions = [
    ["USDC -> TSLAx (looping)", USDC_MINT, XSTOCK_BORROW_VAULTS[0].collateralMint],
    ["TSLAx -> USDC (unwind)", XSTOCK_BORROW_VAULTS[0].collateralMint, USDC_MINT],
  ] as const;
  for (const [label, a, b] of regressions) {
    console.log(`  ${label.padEnd(26)} ${isAllowedSwapPair(a, b) ? "ok" : "REGRESSED"}`);
  }
  console.log(
    `  an arbitrary mint pair is still rejected: ${
      isAllowedSwapPair("Deadbeef1111111111111111111111111111111111", WSOL_MINT)
        ? "NO, OPEN RELAY"
        : "ok"
    }`,
  );

  console.log("\n5. Pair classification (which path each pair would take)");
  let evmOnly = 0;
  let viaSolana = 0;
  for (const a of SWAP_TOKENS) {
    for (const b of SWAP_TOKENS) {
      if (isSamePair(a, b)) continue;
      if (a.kind === "evm" && b.kind === "evm") evmOnly++;
      else viaSolana++;
    }
  }
  console.log(`  ${evmOnly} pairs are EVM-only (widget-eligible)`);
  console.log(`  ${viaSolana} pairs touch Solana (our REST panel)`);

  const origin = process.env.PROXY_ORIGIN;
  if (origin) {
    console.log(`\n6. Proxy allowlist at ${origin}`);
    await checkProxy(origin);
  } else {
    console.log(
      "\n6. Proxy allowlist skipped. Set PROXY_ORIGIN=http://localhost:3000 to run it.",
    );
  }

  const failed = results.filter((x) => !x.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} tokens verified.` +
      (failed.length
        ? ` Failing: ${failed.map((f) => `${f.token.chainLabel}/${f.token.symbol}`).join(", ")}`
        : ""),
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
