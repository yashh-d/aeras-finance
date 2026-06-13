// Shared waitlist helpers used by the API routes and the client dialog.

// Pragmatic email check. The server is the source of truth; this just blocks
// obvious junk before a round trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed || null;
}

export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}

// Reasons a user might want access, surfaced as a dropdown. Kept short and
// plain. Values are stored verbatim in waitlist.use_case.
export const USE_CASES = [
  "Borrow against my tokenized assets",
  "Earn yield on tokenized stocks",
  "Hold tokenized stocks and treasuries",
  "Building or integrating with Aeras",
  "Just exploring",
] as const;

export type UseCase = (typeof USE_CASES)[number];
