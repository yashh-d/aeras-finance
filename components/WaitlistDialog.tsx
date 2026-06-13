"use client";

import { useEffect, useId, useState } from "react";
import { isValidEmail, USE_CASES } from "@/lib/waitlist";

type WaitlistDialogProps = {
  onClose: () => void;
  // When the user reached the waitlist by logging in, we already have their
  // verified email and wallet. The email is prefilled and locked.
  lockedEmail?: string;
  walletAddress?: string;
};

type Step = "form" | "done";

// Mounted only while the waitlist is open (parent gates on `waitlistOpen`), so
// each open starts from a fresh form with no reset bookkeeping.
export function WaitlistDialog({
  onClose,
  lockedEmail,
  walletAddress,
}: WaitlistDialogProps) {
  const [email, setEmail] = useState(lockedEmail ?? "");
  const [name, setName] = useState("");
  const [useCase, setUseCase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [alreadyJoined, setAlreadyJoined] = useState(false);

  const formId = useId();

  // Lock body scroll and wire Escape-to-close for the dialog's lifetime.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const effectiveEmail = lockedEmail ?? email;
  const canSubmit = isValidEmail(effectiveEmail) && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const referral =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("ref") || undefined
          : undefined;
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: effectiveEmail,
          name: name || undefined,
          reason: useCase || undefined,
          referral,
          walletAddress: walletAddress || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        alreadyJoined?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setAlreadyJoined(Boolean(data.alreadyJoined));
      setStep("done");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="wl-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="wl-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
      >
        <button
          type="button"
          className="wl-close"
          aria-label="Close"
          onClick={onClose}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {step === "form" ? (
          <form onSubmit={handleSubmit}>
            <span className="wl-eyebrow">Early access</span>
            <h2 id={`${formId}-title`} className="wl-title">
              Request access to Aeras
            </h2>
            <p className="wl-sub">
              Aeras is opening to a limited group while we add markets and
              lending venues. Tell us where to reach you and we will send an
              invite when your account is ready.
            </p>

            <div className="wl-field">
              <label className="wl-label" htmlFor={`${formId}-email`}>
                Email
              </label>
              <input
                id={`${formId}-email`}
                className="wl-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@email.com"
                value={effectiveEmail}
                readOnly={Boolean(lockedEmail)}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {lockedEmail && (
                <span className="wl-hint">
                  Verified from your sign in. We will use this to send your
                  invite.
                </span>
              )}
            </div>

            <div className="wl-field">
              <label className="wl-label" htmlFor={`${formId}-name`}>
                Name <span className="wl-optional">optional</span>
              </label>
              <input
                id={`${formId}-name`}
                className="wl-input"
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="wl-field">
              <label className="wl-label" htmlFor={`${formId}-use`}>
                What do you want to do first?{" "}
                <span className="wl-optional">optional</span>
              </label>
              <select
                id={`${formId}-use`}
                className="wl-select"
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
              >
                <option value="">Select one</option>
                {USE_CASES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            {error && <div className="wl-error">{error}</div>}

            <button
              type="submit"
              className="lbtn lbtn-primary wl-submit"
              disabled={!canSubmit}
            >
              {submitting ? "Submitting..." : "Request access"}
            </button>

            <p className="wl-fine">
              We use your email to send your invite and occasional product
              updates. You can opt out any time.
            </p>
          </form>
        ) : (
          <div className="wl-success">
            <div className="wl-success-ic" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h2 id={`${formId}-title`} className="wl-title">
              {alreadyJoined ? "You are already on the list" : "You are on the list"}
            </h2>
            <p className="wl-sub">
              {alreadyJoined ? (
                <>
                  We already have <strong>{effectiveEmail}</strong> on file. You
                  are in line and will hear from us when access opens.
                </>
              ) : (
                <>
                  Your request is in. We review access in batches and will email{" "}
                  <strong>{effectiveEmail}</strong> when your account is ready.
                </>
              )}
            </p>

            <div className="wl-next">
              <div className="wl-next-title">What you get when approved</div>
              <ul>
                <li>Hold tokenized stocks and treasuries in one account.</li>
                <li>Borrow USDC against them without selling.</li>
                <li>Earn yield on assets that would otherwise sit idle.</li>
              </ul>
            </div>

            <button
              type="button"
              className="lbtn lbtn-primary wl-submit"
              onClick={onClose}
            >
              Back to site
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
