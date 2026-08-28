// Does Trustware route Base USDC to Solana USDC, and what does it cost?
//
// Base is listed in the wallet only because lib/trustware/base.ts can move USDC
// off it. That claim is the whole justification for the chain being offered, so
// it gets checked against the live API rather than assumed: a chain the user can
// receive on but not spend from is the trap the panel's warning copy exists to
// prevent.
//
// It also prints the fee and the guaranteed delivery across sizes, and the gas
// estimate on the source transaction. GAS_FLOOR_WEI in lib/trustware/base.ts is
// currently an estimate, not a measurement; the gas column here is what should
// replace it.
//
//   TRUSTWARE_API_KEY=... npx tsx scripts/trustware-base-check.mts
//   (or: set -a; . ./.env.local; set +a; npx tsx scripts/...)
//
// Read-only. It creates route intents, which cost nothing and move no funds,
// and it signs and submits nothing.

import { USDC_MINT } from "../lib/jupiter/constants";
import { uiToAtomic } from "../lib/trustware/amounts";
import { BASE_CHAIN_ID, BASE_USDC } from "../lib/trustware/base";
import {
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
} from "../lib/trustware/constants";

// Any valid addresses. A route quote does not check balances, which is what
// makes this runnable without funding anything.
const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "3Gk1L9tHxYVSHqCS1w5aBpKZ7fJvcWjZ4kQ9EanKPUFY";

const SIZES = ["5", "25", "100", "1000"];

function apiKey(): string {
  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) throw new Error("TRUSTWARE_API_KEY is not set");
  return key;
}

interface Outcome {
  status: number;
  provider: string;
  executable: boolean;
  approvals: number;
  toAmount: string | null;
  toAmountMin: string | null;
  feesUsd: number | null;
  gasLimit: string | null;
  error: string | null;
}

async function call(body: Record<string, unknown>): Promise<Outcome> {
  const res = await fetch(`${TRUSTWARE_API_BASE_URL}/route`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  const data = (json?.["data"] ?? json) as Record<string, unknown> | undefined;
  const route = (data?.["route"] ?? data) as
    Record<string, unknown> | undefined;
  const execution = route?.["execution"] as
    | {
        transaction?: { data?: string; gas?: string; gasLimit?: string };
        approvals?: unknown[];
      }
    | undefined;
  const estimate = route?.["estimate"] as
    | { toAmount?: string; toAmountMin?: string; totalFeesUSD?: number }
    | undefined;
  const tx = execution?.transaction;
  return {
    status: res.status,
    provider: (route?.["provider"] as string) ?? "-",
    executable: Boolean(tx?.data),
    approvals: execution?.approvals?.length ?? 0,
    toAmount: estimate?.toAmount ?? null,
    toAmountMin: estimate?.toAmountMin ?? null,
    feesUsd:
      typeof estimate?.totalFeesUSD === "number" ? estimate.totalFeesUSD : null,
    gasLimit: tx?.gas ?? tx?.gasLimit ?? null,
    error: res.ok ? null : text.slice(0, 160),
  };
}

function returnRoute(ui: string) {
  return {
    fromChain: String(BASE_CHAIN_ID),
    toChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: BASE_USDC.address,
    toToken: USDC_MINT,
    fromAmount: uiToAtomic(ui, BASE_USDC.decimals),
    fromAddress: EVM,
    toAddress: SOL,
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
  };
}

function usdc(atomic: string | null): string {
  if (!atomic) return "-";
  return (Number(atomic) / 10 ** BASE_USDC.decimals).toFixed(2);
}

function report(label: string, o: Outcome) {
  console.log(
    `  ${label.padEnd(10)} ${o.status}  provider=${o.provider.padEnd(8)}` +
      `  executable=${o.executable ? "YES" : "NO "}` +
      `  approvals=${o.approvals}` +
      `  out=${usdc(o.toAmount).padStart(9)}` +
      `  min=${usdc(o.toAmountMin).padStart(9)}` +
      `  fees=${o.feesUsd != null ? `$${o.feesUsd.toFixed(2)}` : "-"}` +
      `  gas=${o.gasLimit ?? "-"}`,
  );
  if (o.error) console.log(`             error: ${o.error}`);
}

async function main() {
  console.log(
    `\nBase USDC (${BASE_USDC.address}) -> Solana USDC, chain ${BASE_CHAIN_ID}\n`,
  );
  const outcomes: Outcome[] = [];
  for (const ui of SIZES) {
    const o = await call(returnRoute(ui));
    report(`${ui} USDC`, o);
    outcomes.push(o);
  }

  const routable = outcomes.filter((o) => o.executable);
  console.log(
    `\n${routable.length}/${outcomes.length} sizes returned a signable transaction.`,
  );
  if (routable.length === 0) {
    console.log(
      "Base is NOT routable right now. Do not offer it in the wallet until it is:\n" +
        "a chain that can be received on but not spent from strands funds.",
    );
    process.exitCode = 1;
    return;
  }
  const gas = routable.map((o) => o.gasLimit).filter(Boolean);
  if (gas.length) {
    console.log(
      `Source-transaction gas limits: ${gas.join(", ")}. ` +
        "Size GAS_FLOOR_WEI in lib/trustware/base.ts against the largest, " +
        "times a comfortable multiple of Base's gas price.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
