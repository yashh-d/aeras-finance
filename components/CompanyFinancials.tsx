"use client";

// The Financials tab: ten highlight tiles, two quarterly charts, and the
// three statements as tables. Figures come from lib/company/highlights.ts
// and the parsed statements; nothing here computes, it only draws.

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { compactUsd, multiple, pct, quarterLabel } from "@/lib/company/format";
import { computeHighlights, type Highlights } from "@/lib/company/highlights";
import type { CompanyFinancials as Financials, StatementRow } from "@/lib/company/types";

type Sub = "highlights" | "income" | "balance" | "cashflow";

const SUBS: { id: Sub; label: string }[] = [
  { id: "highlights", label: "Highlights" },
  { id: "income", label: "Income statement" },
  { id: "balance", label: "Balance sheet" },
  { id: "cashflow", label: "Cash flow" },
];

export function CompanyFinancials({
  financials,
  price,
}: {
  financials: Financials;
  price: number | null;
}) {
  const [sub, setSub] = useState<Sub>("highlights");
  const highlights = computeHighlights(financials, price);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {SUBS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSub(s.id)}
            aria-pressed={sub === s.id}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium tracking-tight transition-colors ${
              sub === s.id
                ? "border-white/[0.18] bg-white/[0.12] text-white"
                : "border-white/10 bg-white/[0.04] text-white/55 hover:border-white/20 hover:text-white"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {sub === "highlights" && (
        <>
          <HighlightTiles h={highlights} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ProfitabilityChart financials={financials} />
            <EpsChart financials={financials} />
          </div>
        </>
      )}
      {sub === "income" && <Statement periods={financials.periods} rows={financials.income} />}
      {sub === "balance" && <Statement periods={financials.periods} rows={financials.balance} />}
      {sub === "cashflow" && <Statement periods={financials.periods} rows={financials.cashFlow} />}
    </div>
  );
}

function HighlightTiles({ h }: { h: Highlights }) {
  const ttm = h.quarters >= 4 ? "TTM" : `last ${h.quarters} quarters`;
  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: "Revenue", value: compactUsd(h.revenueTtm), hint: ttm },
    { label: "Net income", value: compactUsd(h.netIncomeTtm), hint: ttm },
    { label: "EBITDA", value: compactUsd(h.ebitdaTtm), hint: ttm },
    { label: "Free cash flow", value: compactUsd(h.freeCashFlowTtm), hint: ttm },
    { label: "Cash & equivalents", value: compactUsd(h.cash), hint: "latest quarter" },
    { label: "Gross margin", value: pct(h.grossMarginPct), hint: "latest quarter" },
    { label: "Net margin", value: pct(h.netMarginPct), hint: "latest quarter" },
    { label: "EPS", value: h.epsTtm == null ? "—" : `$${h.epsTtm.toFixed(2)}`, hint: "TTM" },
    { label: "P/E ratio", value: multiple(h.peRatio) },
    { label: "Forward P/E", value: multiple(h.forwardPe), hint: "next 4 quarters" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            {t.label}
          </div>
          <div className="mt-1 font-mono text-base tabular-nums text-white">{t.value}</div>
          {t.hint && <div className="text-[10px] text-white/30">{t.hint}</div>}
        </div>
      ))}
    </div>
  );
}

function rowValues(rows: readonly StatementRow[], label: string): (number | null)[] {
  return rows.find((r) => r.label === label && !r.group)?.values ?? [];
}

const AXIS = { fill: "rgba(255,255,255,0.4)", fontSize: 10 } as const;

function ProfitabilityChart({ financials }: { financials: Financials }) {
  const revenue = rowValues(financials.income, "Total Revenue");
  const income = rowValues(financials.income, "Net Income");
  // Oldest first, since a bar chart reads left to right in time.
  const data = financials.periods
    .map((p, i) => ({ quarter: quarterLabel(p), revenue: revenue[i], income: income[i] }))
    .reverse();
  return (
    <ChartCard title="Profitability" legend={[["Revenue", "#2973ff"], ["Net income", "#119b62"]]}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barGap={2} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="quarter" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => compactUsd(v)} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="revenue" name="Revenue" fill="#2973ff" radius={[3, 3, 0, 0]} />
          <Bar dataKey="income" name="Net income" fill="#119b62" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function EpsChart({ financials }: { financials: Financials }) {
  // Reported quarters oldest first, then up to two quarters of consensus.
  const reported = [...financials.epsActual].reverse().map((q) => ({
    quarter: q.quarter,
    estimate: q.consensus,
    actual: q.eps,
    verdict:
      q.eps != null && q.consensus != null
        ? q.eps >= q.consensus
          ? `Beat +$${(q.eps - q.consensus).toFixed(2)}`
          : `Miss -$${(q.consensus - q.eps).toFixed(2)}`
        : null,
  }));
  const ahead = financials.epsForecast.slice(0, 2).map((q) => ({
    quarter: q.quarter,
    estimate: q.consensus,
    actual: null,
    verdict: null,
  }));
  const data = [...reported, ...ahead];
  return (
    <ChartCard title="Earnings per share" legend={[["Estimated", "rgba(255,255,255,0.28)"], ["Actual", "#5792ff"]]}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barGap={2} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="quarter" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
          <Tooltip content={<EpsTip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="estimate" name="Estimated" fill="rgba(255,255,255,0.28)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="actual" name="Actual" fill="#5792ff" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/45">
        {reported
          .filter((q) => q.verdict)
          .map((q) => (
            <span key={q.quarter} className="font-mono tabular-nums">
              {q.quarter}:{" "}
              <span className={q.verdict!.startsWith("Beat") ? "text-aeras-positive" : "text-aeras-negative"}>
                {q.verdict}
              </span>
            </span>
          ))}
      </div>
    </ChartCard>
  );
}

function ChartCard({
  title,
  legend,
  children,
}: {
  title: string;
  legend: [string, string][];
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium tracking-tight text-white">{title}</div>
        <div className="flex gap-3 text-[10px] text-white/45">
          {legend.map(([name, color]) => (
            <span key={name} className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-sm" style={{ background: color }} />
              {name}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

interface TipPayload {
  name?: string;
  value?: number | null;
  color?: string;
}

function MoneyTip({ active, payload, label }: { active?: boolean; payload?: TipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-aeras-hero-from px-3 py-2 text-xs">
      <div className="text-white/50">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="mt-0.5 flex justify-between gap-4">
          <span className="text-white/70">{p.name}</span>
          <span className="font-mono tabular-nums text-white">{compactUsd(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function EpsTip({ active, payload, label }: { active?: boolean; payload?: TipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-aeras-hero-from px-3 py-2 text-xs">
      <div className="text-white/50">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="mt-0.5 flex justify-between gap-4">
          <span className="text-white/70">{p.name}</span>
          <span className="font-mono tabular-nums text-white">
            {p.value == null ? "—" : `$${p.value.toFixed(2)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function Statement({ periods, rows }: { periods: string[]; rows: StatementRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-xs">
        <thead>
          <tr className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            <th className="py-2 text-left font-medium">Quarter ending</th>
            {periods.map((p) => (
              <th key={p} className="py-2 text-right font-medium">
                {quarterLabel(p)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {rows.map((r) =>
            r.group ? (
              <tr key={r.label}>
                <td colSpan={periods.length + 1} className="pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
                  {r.label}
                </td>
              </tr>
            ) : (
              <tr key={r.label}>
                <td className="py-1.5 pr-3 text-white/70">{r.label}</td>
                {r.values.map((v, i) => (
                  <td key={i} className="py-1.5 text-right font-mono tabular-nums text-white">
                    {v == null ? "—" : compactUsd(v)}
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
      <p className="mt-3 text-[10px] text-white/30">Nasdaq, quarterly, in US dollars.</p>
    </div>
  );
}
