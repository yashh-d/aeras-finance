"use client";

// TEMPORARY visual-check route for the margin credit states. Delete after verifying.

import { LighterMarginCard } from "@/components/LighterMarginCard";
import type { MarginSource } from "@/lib/lighter/margin-sources";
import type { useMarginFunding } from "@/lib/lighter/use-margin-funding";

type Margin = ReturnType<typeof useMarginFunding>;

const SOURCE: MarginSource = {
  id: "solana:arbitrum",
  chain: "solana-mainnet-beta",
  chainLabel: "Solana",
  token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6,
  balanceAtomic: "50000000",
  amountUsd: 50,
  destination: "arbitrum",
  signing: "solana-only",
  plannedLossBps: 25,
  etaMinutes: 5,
  minimumUsd: 5,
  usable: true,
};

function stub(credit: Margin["credit"]): Margin {
  return {
    sources: [SOURCE],
    selected: SOURCE,
    select: () => {},
    block: { kind: "ok" },
    status: {
      kind: "sent",
      sourceTx: "5xk2Qpb7yTn4mVzR8aLcW1dEfGh3JkMnPqRsTuVwXyZa",
      source: SOURCE,
      baselineUsd: 100,
      amountUsd: 25,
    },
    credit,
    totalUsd: 50,
    availableUsd: 50,
    minimumUsd: 5,
    ready: true,
    deposit: async () => {},
    reset: () => {},
  };
}

const CASES: { label: string; credit: Margin["credit"] }[] = [
  { label: "waiting", credit: { kind: "waiting" } },
  { label: "credited", credit: { kind: "credited", amountUsd: 24.94 } },
  { label: "timeout", credit: { kind: "timeout" } },
];

export default function PreviewCredit() {
  return (
    <main className="min-h-screen space-y-6 bg-aeras-hero-from p-6 text-white">
      {CASES.map((c) => (
        <div key={c.label}>
          <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-white/40">
            {c.label}
          </div>
          <LighterMarginCard
            margin={stub(c.credit)}
            needsAccount={false}
            open
            onClose={() => {}}
          />
        </div>
      ))}
    </main>
  );
}
