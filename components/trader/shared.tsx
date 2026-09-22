"use client";

// Pieces the Trader mode sections share: the section header, the card grid's
// pills and headline figure, the back link a detail view opens with, and the
// two-column detail frame. Everything here is layout; the figures and the
// forms come from the venue and strategy components Investor mode already
// draws.

import { ChevronLeft, Search } from "lucide-react";

import { GLASS_SURFACE } from "@/lib/ui/surface";

export { fmtPct, fmtSignedPct, fmtUsd } from "@/components/strategies/shared";

// Eyebrow, title, one line of copy. The same three lines every Investor
// section opens with, so the two modes read as one product.
export function TraderHeader({
  eyebrow,
  title,
  children,
  aside,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
          {eyebrow}
        </div>
        <h2 className="font-light text-2xl tracking-tight text-white">{title}</h2>
        {children && <p className="max-w-2xl text-sm text-white/45">{children}</p>}
      </div>
      {aside && <div className="flex shrink-0 items-center gap-3">{aside}</div>}
    </div>
  );
}

// A small labelled pill: a chain, a venue, a pair, a tag. Same shape as the
// category pills on Markets, one size down.
export function Pill({
  children,
  tone = "plain",
  logo,
}: {
  children: React.ReactNode;
  tone?: "plain" | "positive" | "warn" | "muted";
  logo?: string;
}) {
  const cls =
    tone === "positive"
      ? "border-aeras-positive/30 bg-aeras-positive/10 text-aeras-positive"
      : tone === "warn"
        ? "border-aeras-warning/30 bg-aeras-warning/10 text-aeras-warning"
        : tone === "muted"
          ? "border-white/[0.06] bg-white/[0.03] text-white/40"
          : "border-white/10 bg-white/[0.05] text-white/70";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${cls}`}
    >
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="size-3 rounded-full" />
      )}
      {children}
    </span>
  );
}

// The one number a card is about. Large, mono, tabular, coloured only when
// it is a gain or a loss.
export function BigFigure({
  label,
  value,
  tone = "plain",
  sub,
  align = "left",
}: {
  label: string;
  value: string;
  tone?: "plain" | "positive" | "warn" | "muted";
  sub?: React.ReactNode;
  align?: "left" | "right";
}) {
  const color =
    tone === "positive"
      ? "text-aeras-positive"
      : tone === "warn"
        ? "text-aeras-warning"
        : tone === "muted"
          ? "text-white/40"
          : "text-white";
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-3xl font-light leading-none tabular-nums ${color}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-white/45">{sub}</div>}
    </div>
  );
}

// A smaller stat beside a BigFigure.
export function SmallFigure({
  label,
  value,
  align = "right",
}: {
  label: string;
  value: string;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-white/80">{value}</div>
    </div>
  );
}

// The card itself, as a button. Selected and hover states follow AssetTile.
export function GridCard({
  onClick,
  children,
  muted,
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  // A card that has nothing to offer right now (a spread at or below zero, a
  // venue with no rate). Still on the grid, still opens, just quieter.
  muted?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${GLASS_SURFACE} flex flex-col gap-4 p-5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.08] ${
        muted ? "opacity-70 hover:opacity-100" : ""
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50 transition-colors hover:text-white"
    >
      <ChevronLeft className="size-3.5" />
      {label}
    </button>
  );
}

// Detail views split the same way: the action on the left, the position on
// the right, three fifths to two.
export function DetailColumns({
  left,
  right,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">{left}</div>
      <div className="lg:col-span-2">{right}</div>
    </div>
  );
}

export function DetailCard({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`${GLASS_SURFACE} p-5 lg:p-6 ${className ?? ""}`}>
      {title && (
        <div className="mb-4 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/40" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-white/15 bg-white/5 py-2 pl-9 pr-3 text-sm tracking-tight text-white outline-none transition-colors placeholder:text-white/30 focus:border-aeras-blue"
      />
    </div>
  );
}

// A row of choices, one active. Sort orders, filters.
export function ChoicePills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium tracking-tight transition-colors ${
            value === o.id
              ? "border-white/[0.18] bg-white/[0.12] text-white"
              : "border-white/10 bg-white/[0.04] text-white/55 hover:border-white/20 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${GLASS_SURFACE} p-8 text-center text-sm text-white/50`}>{children}</div>
  );
}

// Grid geometry shared by the three card grids, so the cards line up the
// same way on every section.
export const CARD_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";
