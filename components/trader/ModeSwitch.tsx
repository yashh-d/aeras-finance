"use client";

// Investor or Trader. Two segments, one active, under the logo in the sidebar.
// The choice is remembered per browser (lib/ui/use-app-mode.ts).

import type { AppMode } from "@/lib/ui/use-app-mode";

const MODES: readonly { id: AppMode; label: string; hint: string }[] = [
  { id: "investor", label: "Investor", hint: "Every market, venue and ticket" },
  { id: "trader", label: "Trader", hint: "Earn, Buy + Earn and plays as cards" },
];

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: AppMode;
  onChange: (next: AppMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="App mode"
      className="grid grid-cols-2 gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5"
    >
      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={active}
            title={m.hint}
            onClick={() => onChange(m.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium tracking-tight transition-colors ${
              active
                ? "bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "text-white/50 hover:bg-white/5 hover:text-white"
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
