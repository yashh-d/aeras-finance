// A strategy as marks and arrows: what goes in, what is bought, what the
// loan creates, where it goes. Built from what the ticket reports
// (lib/strategies/ticket-flow.ts) so the figures are the ticket's own.
// Nothing here is a caption: a node is marks and, once an amount is typed,
// a number; an edge is a verb with its object ("buy NVDAx", "borrow USDC")
// and, on the borrow, the money it creates. Pure; flow.test.ts pins it.

import type { TicketFlowInputs } from "@/lib/strategies/ticket-flow";

import { assetMark, destinationMarks, USDC_MARK, type Mark } from "./exposures";

// Same formats as components/strategies/shared.tsx, local so this module
// depends on no component.
const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
const fmtPct = (d: number) => `${(d * 100).toFixed(2)}%`;

export interface FlowNode {
  kind: "node";
  key: string;
  marks: Mark[];
  // A figure under the marks, or nothing.
  value: string | null;
}

export interface FlowEdge {
  kind: "edge";
  key: string;
  verb: string;
  // A borrow: drawn dashed and green, the "new money" moment the diagram
  // exists for. `creates` carries the figure once an amount is typed.
  created: boolean;
  creates: string | null;
}

export type FlowStep = FlowNode | FlowEdge;

const node = (key: string, marks: Mark[], value: string | null): FlowNode => ({ kind: "node", key, marks, value });
const edge = (key: string, verb: string, creates: string | null = null, created = creates != null): FlowEdge => ({
  kind: "edge",
  key,
  verb,
  created,
  creates,
});
const borrow = (key: string, creates: string | null): FlowEdge => edge(key, "borrow USDC", creates, true);

function units(amountUsd: number | null, price: number | null, symbol: string): string | null {
  if (amountUsd == null) return null;
  if (price == null || price <= 0) return fmtUsd(amountUsd);
  return `${(amountUsd / price).toFixed(4)} ${symbol}`;
}

function destinationVerb(venue: string | undefined): string {
  if (venue === "glider") return "buy";
  if (venue === "shmonad") return "stake";
  if (venue === "uniswap") return "pool";
  return "deposit";
}

export function buildFlow(f: TicketFlowInputs): FlowStep[] {
  const asset = assetMark(f.xstock);
  const symbol = f.xstock.symbol;
  if (f.kind === "earn") {
    const option = f.option;
    return [
      node("in", [USDC_MARK], f.amountUsd != null ? fmtUsd(f.amountUsd) : null),
      edge("buy", `buy ${symbol}`),
      node("asset", [asset], units(f.amountUsd, f.price, symbol)),
      borrow("borrow", f.borrowUsd != null ? `+${fmtUsd(f.borrowUsd)}` : null),
      node("loan", [USDC_MARK], f.borrowUsd != null ? fmtUsd(f.borrowUsd) : null),
      edge("earn", destinationVerb(option?.venue)),
      node(
        "dest",
        option ? destinationMarks(option.venue, option.uniswapPool) : [],
        option ? fmtPct(option.apy) : null,
      ),
    ];
  }
  if (f.kind === "leverage") {
    const spend = f.amountUsd != null && f.borrowUsd != null ? f.amountUsd + f.borrowUsd : null;
    return [
      node("in", [USDC_MARK], f.amountUsd != null ? fmtUsd(f.amountUsd) : null),
      borrow("borrow", f.borrowUsd != null ? `+${fmtUsd(f.borrowUsd)}` : null),
      node("spend", [USDC_MARK], spend != null ? fmtUsd(spend) : null),
      edge("buy", `buy ${symbol}`),
      node(
        "asset",
        [asset],
        f.exposureUsd != null
          ? fmtUsd(f.exposureUsd)
          : f.amountUsd != null
            ? fmtUsd(f.amountUsd * f.leverage)
            : `${f.leverage.toFixed(1)}×`,
      ),
    ];
  }
  const r1 = f.rounds?.[0] ?? null;
  const r2 = f.rounds?.[1] ?? null;
  const nextMarks = f.nextIsGlider ? destinationMarks("glider") : f.next ? [assetMark(f.next)] : [asset];
  const nextVerb = f.nextIsGlider ? "buy" : `buy ${f.next?.symbol ?? symbol}`;
  const steps: FlowStep[] = [
    node("in", [USDC_MARK], f.amountUsd != null ? fmtUsd(f.amountUsd) : null),
    edge("buy1", `buy ${symbol}`),
    node("asset", [asset], r1 ? fmtUsd(r1.buyUsd) : null),
    borrow("borrow1", r1 && r1.borrowUsd > 0 ? `+${fmtUsd(r1.borrowUsd)}` : null),
    node("loan", [USDC_MARK], r1 && r1.borrowUsd > 0 ? fmtUsd(r1.borrowUsd) : null),
    edge("buy2", nextVerb),
    node("next", nextMarks, r2 ? fmtUsd(r2.buyUsd) : null),
  ];
  // The projection assumes every round buys the first asset; the ladder
  // only continues when the pick can be borrowed against.
  const rounds = f.rounds?.length ?? 0;
  if (rounds > 2 && f.nextHasMarket) {
    const exposure = f.rounds!.reduce((s, r) => s + r.buyUsd, 0);
    steps.push(edge("repeat", `repeat ×${rounds}`), node("total", nextMarks, fmtUsd(exposure)));
  }
  return steps;
}
