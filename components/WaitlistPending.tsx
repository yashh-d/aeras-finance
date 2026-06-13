"use client";

import { useState } from "react";

export type UserView = {
  status: "waitlisted" | "approved" | "rejected" | "banned";
  email: string | null;
  referralCode: string;
  position: number | null;
  approvedAt: string | null;
};

// Shown at /app to a signed-in user who is not approved. The Privy account and
// embedded wallet already exist; access is just gated on status.
export function WaitlistPending({
  user,
  onLogout,
}: {
  user: UserView;
  onLogout: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const blocked = user.status === "rejected" || user.status === "banned";
  const inviteLink =
    !blocked && user.referralCode && typeof window !== "undefined"
      ? `${window.location.origin}/?ref=${user.referralCode}`
      : null;

  async function copy() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in insecure contexts; ignore.
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-aeras-canvas px-6 py-12">
      <main className="w-full max-w-md rounded-2xl border border-aeras-border bg-white p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/aeras-logo-black.png"
          alt="Aeras"
          className="mb-6 h-10 w-auto"
        />

        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-blue">
          {blocked ? "Access" : "Waitlist"}
        </div>
        <h1 className="mt-2 font-light text-2xl tracking-tight text-aeras-900">
          {blocked ? "Access is not available" : "You are on the list"}
        </h1>

        {!blocked && user.position != null && (
          <div className="mt-4 inline-flex items-baseline gap-2 rounded-xl border border-aeras-border bg-aeras-surface px-4 py-2.5">
            <span className="font-mono text-2xl tabular-nums text-aeras-900">
              #{user.position}
            </span>
            <span className="text-sm text-aeras-300">in line</span>
          </div>
        )}

        <p className="mt-4 text-sm leading-relaxed text-aeras-300">
          {blocked ? (
            "Your account is not eligible for access right now. If you think this is a mistake, reach out and we will take another look."
          ) : (
            <>
              Aeras is opening access in batches while we add markets and lending
              venues. We will email
              {user.email ? (
                <>
                  {" "}
                  <span className="font-medium text-aeras-700">
                    {user.email}
                  </span>
                </>
              ) : (
                " you"
              )}{" "}
              when your account is ready.
            </>
          )}
        </p>

        {inviteLink && (
          <div className="mt-6 rounded-xl border border-aeras-border bg-aeras-surface p-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
              Your invite link
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-aeras-500">
                {inviteLink}
              </code>
              <button
                type="button"
                onClick={copy}
                className="rounded-lg bg-aeras-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-aeras-blue"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-aeras-300">
              Share Aeras with others who want access to tokenized asset lending.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onLogout}
          className="mt-6 text-xs text-aeras-300 underline-offset-2 hover:text-aeras-900 hover:underline"
        >
          Sign out
        </button>
      </main>
    </div>
  );
}
