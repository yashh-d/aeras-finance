import Link from "next/link";
import type { ReactNode } from "react";

// The typographic pieces the legal pages (/terms, /privacy) share. Kept out of
// the pages so the two documents cannot drift apart in shape, and so the
// conspicuous style used for the clauses a court looks at hardest (Caps) is
// one definition.

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-12 scroll-mt-24 text-xl font-semibold tracking-tight text-neutral-900"
    >
      {children}
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 text-base font-semibold text-neutral-900">{children}</h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 leading-7 text-neutral-700">{children}</p>;
}

// Conspicuous text. Disclaimers, liability limits and the arbitration notice
// are set this way on purpose: a limitation that is not conspicuous is the
// first thing struck.
export function Caps({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 font-semibold uppercase leading-7 tracking-wide text-neutral-900">
      {children}
    </p>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-neutral-700">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function Contents({ entries }: { entries: Array<[string, string]> }) {
  return (
    <nav aria-label="Contents" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Contents
      </p>
      <ol className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {entries.map(([id, label]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="text-neutral-700 underline-offset-4 hover:underline"
            >
              {label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LegalPage({
  title,
  updated,
  brand,
  children,
}: {
  title: string;
  updated: string;
  brand: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 text-[15px]">
      <Link
        href="/"
        className="text-sm text-neutral-500 underline-offset-4 hover:underline"
      >
        ← {brand}
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-neutral-900">
        {title}
      </h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated: {updated}</p>
      {children}
    </main>
  );
}
