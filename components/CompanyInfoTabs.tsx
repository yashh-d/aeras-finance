"use client";

// The About, Dividends, Insider and Filings tabs of the asset detail. Each is
// a small read of one Nasdaq section, drawn as text or a table.

import { compactCount, pct } from "@/lib/company/format";
import type {
  CompanyDividends,
  CompanyFiling,
  CompanyProfile,
  InsiderTrade,
} from "@/lib/company/types";

export function AboutTab({ profile }: { profile: CompanyProfile }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-white/75">{profile.description || "No description on file."}</p>
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        {[
          ["Sector", profile.sector],
          ["Industry", profile.industry],
          ["Region", profile.region],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">{k}</dt>
            <dd className="mt-0.5 text-white">{v ?? "—"}</dd>
          </div>
        ))}
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">Website</dt>
          <dd className="mt-0.5">
            {profile.website ? (
              <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-aeras-blue-medium hover:underline">
                {profile.website.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function DividendsTab({ dividends }: { dividends: CompanyDividends }) {
  const tiles: [string, string][] = [
    ["Yield", pct(dividends.yieldPct, 2)],
    ["Annual dividend", dividends.annual == null ? "—" : `$${dividends.annual.toFixed(2)}`],
    ["Ex-dividend date", dividends.exDate ?? "—"],
    ["Payment date", dividends.payDate ?? "—"],
    ["Payout ratio", pct(dividends.payoutRatioPct, 1)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2.5">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">{k}</div>
            <div className="mt-1 font-mono text-sm tabular-nums text-white">{v}</div>
          </div>
        ))}
      </div>
      {dividends.history.length === 0 ? (
        <p className="text-sm text-white/40">No dividend history on file.</p>
      ) : (
        <Table
          head={["Ex-date", "Type", "Amount", "Declared", "Record", "Paid"]}
          rows={dividends.history.slice(0, 12).map((d) => [
            d.exDate,
            d.type,
            d.amount == null ? "—" : `$${d.amount.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`,
            d.declared ?? "—",
            d.record ?? "—",
            d.paid ?? "—",
          ])}
        />
      )}
    </div>
  );
}

export function InsiderTab({ trades }: { trades: InsiderTrade[] }) {
  if (trades.length === 0) return <p className="text-sm text-white/40">No insider transactions on file.</p>;
  return (
    <Table
      head={["Insider", "Relation", "Date", "Transaction", "Shares", "Price", "Held after"]}
      rows={trades.map((t) => [
        t.insider,
        t.relation,
        t.date,
        t.type,
        compactCount(t.shares),
        t.price == null ? "—" : `$${t.price.toFixed(2)}`,
        compactCount(t.held),
      ])}
    />
  );
}

export function FilingsTab({ filings }: { filings: CompanyFiling[] }) {
  if (filings.length === 0) return <p className="text-sm text-white/40">No filings on file.</p>;
  return (
    <div className="divide-y divide-white/[0.06]">
      {filings.map((f, i) => (
        <a
          key={`${f.form}-${f.filed}-${i}`}
          href={f.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 text-xs transition-colors hover:bg-white/[0.04]"
        >
          <span className="w-14 shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-center font-mono text-[11px] text-white">
            {f.form}
          </span>
          <span className="min-w-0 flex-1 truncate text-white/75">
            {f.reportingOwner ?? "Company filing"}
            {f.period ? ` · period ${f.period}` : ""}
          </span>
          <span className="shrink-0 font-mono tabular-nums text-white/50">{f.filed}</span>
        </a>
      ))}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-xs">
        <thead>
          <tr className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            {head.map((h, i) => (
              <th key={h} className={`py-2 font-medium ${i === 0 ? "text-left" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`py-1.5 ${j === 0 ? "pr-3 text-left text-white/80" : "text-right font-mono tabular-nums text-white"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
