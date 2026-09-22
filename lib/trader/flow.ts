// A strategy as a line of marks and arrows: what goes in, what is bought,
// what the loan creates, where it goes. Built from what the ticket reports
// (lib/strategies/ticket-flow.ts) so the figures are the ticket's own, and
// structural (no dollars) until an amount is typed. Pure; flow.test.ts
// pins the arithmetic and the shape.

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
  label: string;
  value: string | null;
  sub?: string | null;
}

export interface FlowEdge {
  kind: "edge";
  key: string;
  verb: string;
  // Set on a borrow: the money it creates, drawn as a dashed arrow with the
  // figure in green. That is the "new funds" moment the diagram exists for.
  creates?: string | null;
}

export type FlowStep = FlowNode | FlowEdge;

const node = (key: string, marks: Mark[], label: string, value: string | null, sub?: string | null): FlowNode => ({
  kind: "node",
  key,
  marks,
  label,
  value,
  sub: sub ?? null,
});
const edge = (key: string, verb: string, creates?: string | null): FlowEdge => ({ kind: "edge", key, verb, creates: creates ?? null });

function units(amountUsd: number | null, price: number | null, symbol: string): string | null {
  if (amountUsd == null) return null;
  if (price == null || price <= 0) return fmtUsd(amountUsd);
  return `${(amountUsd / price).toFixed(4)} ${symbol}`;
}

function destinationLabel(option: { venue: string } | null): string {
  switch (option?.venue) {
    case "glider":
      return "Mag 7 basket";
    case "shmonad":
      return "shMON";
    case "morpho":
    case "jupiter":
    case "kamino":
      return "USDC vault";
    default:
      return "Yield";
  }
}

function destinationVerb(venue: string | undefined): string {
  if (venue === "glider") return "buy";
  if (venue === "shmonad") return "stake";
  return "deposit";
}

export function buildFlow(f: TicketFlowInputs): FlowStep[] {
  const asset = assetMark(f.xstock);
  if (f.kind === "earn") {
    const pct = `${Math.round(f.ratio * 100)}%`;
    const option = f.option;
    return [
      node("in", [USDC_MARK], "You put in", f.amountUsd != null ? fmtUsd(f.amountUsd) : "USDC"),
      edge("buy", "buy"),
      node("asset", [asset], f.xstock.symbol, units(f.amountUsd, f.price, f.xstock.symbol), "held as collateral"),
      edge("borrow", "borrow", f.borrowUsd != null ? `+${fmtUsd(f.borrowUsd)}` : `+${pct} of its value`),
      node("loan", [USDC_MARK], "New USDC", f.borrowUsd != null ? fmtUsd(f.borrowUsd) : "the loan"),
      edge("earn", destinationVerb(option?.venue)),
      node(
        "dest",
        option ? destinationMarks(option.venue) : [],
        destinationLabel(option),
        option ? fmtPct(option.apy) : null,
        option?.monDenominated ? "in MON terms" : null,
      ),
    ];
  }
  if (f.kind === "leverage") {
    const more = `${Math.round((f.leverage - 1) * 100)}%`;
    const spend = f.amountUsd != null && f.borrowUsd != null ? f.amountUsd + f.borrowUsd : null;
    return [
      node("in", [USDC_MARK], "You put in", f.amountUsd != null ? fmtUsd(f.amountUsd) : "USDC"),
      edge("borrow", "borrow", f.borrowUsd != null ? `+${fmtUsd(f.borrowUsd)}` : `+${more} more`),
      node("spend", [USDC_MARK], "To spend", spend != null ? fmtUsd(spend) : `${f.leverage.toFixed(1)}× your USDC`),
      edge("buy", "buy"),
      node(
        "asset",
        [asset],
        `${f.leverage.toFixed(1)}× ${f.xstock.symbol}`,
        f.exposureUsd != null
          ? fmtUsd(f.exposureUsd)
          : f.amountUsd != null
            ? fmtUsd(f.amountUsd * f.leverage)
            : null,
        f.exposureUi != null ? `${f.exposureUi.toFixed(4)} ${f.xstock.symbol}, collateral for the loan` : "collateral for the loan",
      ),
    ];
  }
  const pct = `${Math.round(f.ratio * 100)}%`;
  const r1 = f.rounds?.[0] ?? null;
  const r2 = f.rounds?.[1] ?? null;
  const nextMarks = f.nextIsGlider ? destinationMarks("glider") : f.next ? [assetMark(f.next)] : [asset];
  const nextLabel = f.nextIsGlider ? "Mag 7 basket" : (f.next?.symbol ?? f.xstock.symbol);
  const steps: FlowStep[] = [
    node("in", [USDC_MARK], "You put in", f.amountUsd != null ? fmtUsd(f.amountUsd) : "USDC"),
    edge("buy1", "buy"),
    node("asset", [asset], f.xstock.symbol, r1 ? fmtUsd(r1.buyUsd) : null, "held as collateral"),
    edge("borrow1", "borrow", r1 && r1.borrowUsd > 0 ? `+${fmtUsd(r1.borrowUsd)}` : `+${pct} of its value`),
    node("loan", [USDC_MARK], "New USDC", r1 && r1.borrowUsd > 0 ? fmtUsd(r1.borrowUsd) : "the loan"),
    edge("buy2", "buy"),
    node("next", nextMarks, nextLabel, r2 ? fmtUsd(r2.buyUsd) : null, f.nextIsGlider ? "not collateral" : null),
  ];
  // The projection assumes every round buys the first asset; the ladder
  // only continues when the pick can be borrowed against.
  const rounds = f.rounds?.length ?? 0;
  if (rounds > 2 && f.nextHasMarket) {
    const last = f.rounds![rounds - 1];
    const exposure = f.rounds!.reduce((s, r) => s + r.buyUsd, 0);
    steps.push(
      edge("repeat", "repeat", null),
      node("total", nextMarks, `${rounds} rounds`, fmtUsd(exposure), `${fmtUsd(last.buyUsd)} in the last`),
    );
  }
  return steps;
}
