"use client";

// Spend surface. One Rain-issued Visa per account, capped at a fixed amount.
//
// The card number is readable exactly once, at issuance, because Rain returns
// the encrypted PAN only in the create response and has no endpoint to read it
// back. We decrypt it in this component and keep it in React state, so it is
// gone on the next render from a fresh load. Every later visit shows the last
// four and the purchases.

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { createSession, decrypt } from "@/spend/session";

type Card = {
  id: string;
  status: string;
  last4: string;
  expirationMonth: string;
  expirationYear: string;
};

type Purchase = {
  id: string;
  status: "pending" | "completed" | "declined" | "reversed";
  amount: number;
  merchantName: string;
  at: string;
};

type Secrets = { pan: string; cvc: string };

type View =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "card"; card: Card; purchases: Purchase[]; capCents: number }
  | { kind: "error"; message: string };

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function SpendPanel() {
  const { getAccessToken } = usePrivy();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const call = useCallback(
    async (path: string, body?: unknown) => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
      return data;
    },
    [getAccessToken],
  );

  const load = useCallback(async () => {
    try {
      const data = await call("/api/spend/card");
      setView(
        data.card
          ? {
              kind: "card",
              card: data.card,
              purchases: data.purchases ?? [],
              capCents: data.capCents,
            }
          : { kind: "none" },
      );
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not load your card.",
      });
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleIssue() {
    setIssuing(true);
    setNotice(null);
    try {
      const { secretKey, sessionId } = await createSession();
      const data = await call("/api/spend/card", { sessionId });
      const card = data.card;
      setSecrets({
        pan: await decrypt(card.encryptedPan, secretKey),
        cvc: await decrypt(card.encryptedCvc, secretKey),
      });
      setView({ kind: "card", card, purchases: [], capCents: data.capCents });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not issue a card.");
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          Spend
        </div>
        <h2 className="font-light text-2xl tracking-tight text-aeras-900">
          Your card
        </h2>
        <p className="text-sm text-aeras-300">
          A virtual Visa issued to this account through Rain. Use it anywhere
          Visa is accepted. Running on the Rain sandbox, so no real money moves.
        </p>
      </div>

      {view.kind === "loading" && (
        <p className="text-sm text-aeras-300">Loading your card...</p>
      )}

      {view.kind === "error" && (
        <p className="text-sm text-aeras-negative">{view.message}</p>
      )}

      {view.kind === "none" && (
        <div className="space-y-4 rounded-2xl border border-aeras-border bg-white p-5 lg:p-6">
          <div className="space-y-1">
            <div className="text-sm font-medium tracking-tight text-aeras-900">
              No card on this account yet
            </div>
            <p className="text-sm text-aeras-300">
              Issuing takes a second. The card number is shown once, at
              issuance, and is decrypted in this browser. Aeras never receives
              it.
            </p>
          </div>
          {notice && <p className="text-xs text-aeras-negative">{notice}</p>}
          <button
            type="button"
            onClick={handleIssue}
            disabled={issuing}
            className="w-full rounded-xl bg-aeras-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {issuing ? "Issuing..." : "Get a card"}
          </button>
        </div>
      )}

      {view.kind === "card" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-1">
            <CardFace card={view.card} secrets={secrets} />
            <Summary
              capCents={view.capCents}
              purchases={view.purchases}
              status={view.card.status}
            />
          </div>
          <div className="space-y-6 lg:col-span-2">
            <TestPurchase onDone={load} call={call} />
            <Purchases purchases={view.purchases} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card face ──────────────────────────────────────────────────────────────

function CardFace({ card, secrets }: { card: Card; secrets: Secrets | null }) {
  const [copied, setCopied] = useState(false);
  const expiry = `${card.expirationMonth.padStart(2, "0")}/${card.expirationYear.slice(-2)}`;

  async function copy() {
    if (!secrets) return;
    await navigator.clipboard.writeText(secrets.pan);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="aspect-[1.586] w-full rounded-2xl border border-white/10 bg-gradient-to-br from-aeras-hero-from to-aeras-hero-to p-5 text-white">
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-start justify-between">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aeras-logo-white.png" alt="Aeras" className="h-10 w-auto -ml-1.5" />
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">
              Virtual
            </span>
          </div>

          <div className="space-y-3">
            <div className="font-mono text-base tracking-[0.14em] tabular-nums">
              {secrets
                ? secrets.pan.replace(/(.{4})/g, "$1 ").trim()
                : `•••• •••• •••• ${card.last4}`}
            </div>
            <div className="flex items-end gap-6 text-[11px]">
              <div>
                <div className="text-[9px] uppercase tracking-[0.14em] text-white/40">
                  Expires
                </div>
                <div className="mt-0.5 font-mono tabular-nums text-white/80">
                  {expiry}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.14em] text-white/40">
                  CVC
                </div>
                <div className="mt-0.5 font-mono tabular-nums text-white/80">
                  {secrets ? secrets.cvc : "•••"}
                </div>
              </div>
              <div className="ml-auto text-lg font-semibold italic tracking-tight text-white/70">
                VISA
              </div>
            </div>
          </div>
        </div>
      </div>

      {secrets && (
        <div className="space-y-2 rounded-xl border border-aeras-border bg-aeras-blue-wash p-3">
          <p className="text-xs leading-relaxed text-aeras-700">
            Save these details now. Rain returns the number only at issuance, so
            this is the only time it can be shown. Reloading this page hides it
            for good.
          </p>
          <button
            type="button"
            onClick={copy}
            className="rounded-lg border border-aeras-border bg-white px-3 py-1.5 text-xs font-medium text-aeras-900 transition-colors hover:bg-aeras-surface"
          >
            {copied ? "Copied" : "Copy card number"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Summary ────────────────────────────────────────────────────────────────

function Summary({
  capCents,
  purchases,
  status,
}: {
  capCents: number;
  purchases: Purchase[];
  status: string;
}) {
  const spent = purchases
    .filter((p) => p.status === "completed" || p.status === "pending")
    .reduce((sum, p) => sum + p.amount, 0);
  const available = Math.max(capCents - spent, 0);

  return (
    <div className="space-y-3 rounded-2xl border border-aeras-border bg-white p-5">
      <Row label="Available" value={usd(available)} strong />
      <Row label="Spent" value={usd(spent)} />
      <Row label="Limit" value={usd(capCents)} />
      <Row label="Status" value={status === "active" ? "Active" : status} />
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-aeras-300">{label}</span>
      <span
        className={`font-mono tabular-nums text-aeras-900 ${strong ? "text-lg" : "text-xs"}`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Test purchase ──────────────────────────────────────────────────────────

function TestPurchase({
  call,
  onDone,
}: {
  call: (path: string, body?: unknown) => Promise<{ declined?: boolean; reason?: string }>;
  onDone: () => Promise<void>;
}) {
  const [merchant, setMerchant] = useState("Blue Bottle Coffee");
  const [amount, setAmount] = useState("25.99");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cents = Math.round(Number(amount) * 100);
  const valid = merchant.trim().length > 0 && Number.isFinite(cents) && cents > 0;

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await call("/api/spend/purchase", {
        amount: cents,
        merchantName: merchant.trim(),
      });
      setMessage(
        result.declined
          ? `Declined: ${result.reason ?? "no reason given"}`
          : null,
      );
      await onDone();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "The purchase failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-aeras-border bg-white p-5">
      <div className="space-y-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          Test purchase
        </div>
        <p className="text-xs text-aeras-300">
          Sandbox has no live merchants, so this runs the same authorization and
          settlement a real terminal would.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="Merchant"
          className="block w-full rounded-lg border border-aeras-border bg-white px-3 py-2 text-xs text-aeras-900 placeholder:text-aeras-300 focus:border-aeras-blue focus:outline-none"
        />
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="block w-full rounded-lg border border-aeras-border bg-white px-3 py-2 font-mono text-xs tabular-nums text-aeras-900 focus:border-aeras-blue focus:outline-none sm:w-28"
        />
        <button
          type="button"
          onClick={run}
          disabled={!valid || busy}
          className="rounded-lg bg-aeras-blue px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
        >
          {busy ? "Running..." : "Charge card"}
        </button>
      </div>
      {message && <p className="text-xs text-aeras-negative">{message}</p>}
    </div>
  );
}

// ── Purchases ──────────────────────────────────────────────────────────────

function Purchases({ purchases }: { purchases: Purchase[] }) {
  return (
    <div className="rounded-2xl border border-aeras-border bg-white p-5">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
        Purchases
      </div>
      {purchases.length === 0 ? (
        <p className="mt-3 text-xs text-aeras-300">Nothing on this card yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-aeras-border">
          {purchases.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-aeras-900">
                  {p.merchantName}
                </div>
                <div className="text-[11px] text-aeras-300">
                  {p.at ? new Date(p.at).toLocaleString() : "—"}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-[10px] uppercase tracking-wider ${
                    p.status === "declined"
                      ? "text-aeras-negative"
                      : p.status === "pending"
                        ? "text-aeras-warning"
                        : "text-aeras-300"
                  }`}
                >
                  {p.status}
                </span>
                <span className="font-mono text-xs tabular-nums text-aeras-900">
                  {usd(p.amount)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
