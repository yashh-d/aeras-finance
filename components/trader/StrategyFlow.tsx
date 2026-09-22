"use client";

// The strategy drawn: marks joined by arrows, each arrow a verb with its
// object, the borrow dashed and green with the money it creates. No
// captions; a figure under a mark only once the ticket has one. Fed from
// what the ticket reports through its presentation context, so the
// dollars are the ticket's own. See lib/trader/flow.ts.

import { AssetLogo } from "@/components/AssetLogo";
import type { TicketFlowInputs } from "@/lib/strategies/ticket-flow";
import { buildFlow, type FlowEdge, type FlowNode } from "@/lib/trader/flow";
import { INSET_PANEL } from "@/lib/ui/surface";

export function StrategyFlow({ inputs }: { inputs: TicketFlowInputs }) {
  const steps = buildFlow(inputs);
  return (
    <div className={`${INSET_PANEL} px-3 py-3`} aria-label="How the money moves">
      <div className="flex flex-wrap items-start gap-x-1 gap-y-3">
        {steps.map((s) => (s.kind === "node" ? <Node key={s.key} node={s} /> : <Edge key={s.key} edge={s} />))}
      </div>
    </div>
  );
}

function Node({ node }: { node: FlowNode }) {
  const shown = node.marks.slice(0, 4);
  const rest = node.marks.length - shown.length;
  return (
    <div className="flex min-w-[56px] flex-col items-center gap-1.5">
      <div className="flex h-9 items-center">
        {shown.length === 0 ? (
          <span className="inline-block size-9 rounded-full border border-dashed border-white/20" />
        ) : (
          shown.map((m, i) => (
            <span
              key={m.key}
              title={m.name}
              className="rounded-full ring-2 ring-[#0d0f11]"
              style={{ marginLeft: i === 0 ? 0 : -11 }}
            >
              <AssetLogo xstock={m} size={36} />
            </span>
          ))
        )}
        {rest > 0 && <span className="ml-1 font-mono text-[10px] text-white/40">+{rest}</span>}
      </div>
      {node.value && <div className="font-mono text-xs tabular-nums text-white">{node.value}</div>}
    </div>
  );
}

function Edge({ edge }: { edge: FlowEdge }) {
  return (
    <div className="flex min-w-[64px] flex-col items-center gap-1 pt-3">
      <svg
        viewBox="0 0 56 12"
        width={56}
        height={12}
        aria-hidden="true"
        className={edge.created ? "text-aeras-positive" : "text-white/30"}
      >
        <path
          d="M2 6h46"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={edge.created ? "3 3" : undefined}
        />
        <path d="M44 2l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className={`flex items-center gap-1 text-[11px] ${edge.created ? "text-aeras-positive" : "text-white/70"}`}>
        {edge.created && (
          <svg viewBox="0 0 12 12" width={11} height={11} aria-hidden="true">
            <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 3.5v5M3.5 6h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        )}
        {edge.verb}
      </div>
      {edge.creates && (
        <div className="font-mono text-xs tabular-nums text-aeras-positive">{edge.creates}</div>
      )}
    </div>
  );
}
