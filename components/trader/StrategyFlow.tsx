"use client";

// The strategy drawn: marks joined by arrows, the borrow edge dashed with
// the money it creates in green. Fed from what the ticket reports through
// its presentation context, so the dollars are the ticket's own and update
// as the amount is typed. See lib/trader/flow.ts.

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
    <div className="flex min-w-[72px] flex-col items-center gap-1 text-center">
      <div className="flex h-8 items-center">
        {shown.length === 0 ? (
          <span className="inline-block size-8 rounded-full border border-dashed border-white/20" />
        ) : (
          shown.map((m, i) => (
            <span
              key={m.key}
              title={m.name}
              className="rounded-full ring-2 ring-[#0d0f11]"
              style={{ marginLeft: i === 0 ? 0 : -10 }}
            >
              <AssetLogo xstock={m} size={32} />
            </span>
          ))
        )}
        {rest > 0 && <span className="ml-1 font-mono text-[10px] text-white/40">+{rest}</span>}
      </div>
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">{node.label}</div>
      <div className="font-mono text-xs tabular-nums text-white">{node.value ?? "—"}</div>
      {node.sub && <div className="max-w-[9rem] text-[10px] leading-tight text-white/40">{node.sub}</div>}
    </div>
  );
}

function Edge({ edge }: { edge: FlowEdge }) {
  const creates = edge.creates != null;
  return (
    <div className="flex min-w-[56px] flex-col items-center gap-0.5 pt-2.5">
      <svg viewBox="0 0 48 12" width={48} height={12} aria-hidden="true" className={creates ? "text-aeras-positive" : "text-white/30"}>
        <path
          d="M2 6h38"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={creates ? "3 3" : undefined}
        />
        <path d="M36 2l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="text-[10px] uppercase tracking-[0.08em] text-white/45">{edge.verb}</div>
      {creates && (
        <div className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-aeras-positive">
          <svg viewBox="0 0 12 12" width={11} height={11} aria-hidden="true">
            <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 3.5v5M3.5 6h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {edge.creates}
        </div>
      )}
    </div>
  );
}
