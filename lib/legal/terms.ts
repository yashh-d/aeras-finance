// The Terms of Service, as a version and a set of facts the document and the
// acceptance record share.
//
// TERMS_VERSION is the "Last updated" date on the page and the value stamped
// on the users row when an account is created or signs in. Bump it whenever
// the text changes materially: the next sign-in re-stamps the row, which is
// the record that the user accepted the current version, not an older one.
//
// The company facts below are placeholders until counsel confirms them. They
// are constants rather than inline text so that filling them in is one edit
// and so nothing in the document can drift from the notice address.
export const TERMS_VERSION = "2026-09-22";
export const TERMS_PATH = "/terms";

// The Privacy Policy carries its own date, because it changes on a different
// schedule (a new data processor, not a new clause) and nothing is stamped on
// it: the Terms incorporate it by reference, so the Terms acceptance covers it.
export const PRIVACY_VERSION = "2026-09-22";
export const PRIVACY_PATH = "/privacy";

export const COMPANY = {
  legalName: "Aeras Labs, Inc.",
  shortName: "Aeras",
  // State of incorporation. Delaware is assumed; confirm before publishing.
  stateOfIncorporation: "Delaware",
  // Registered mailing address for legal notices. Must be a real address:
  // the arbitration clause's opt-out and pre-dispute notice depend on it.
  noticeAddress: "[REGISTERED ADDRESS]",
  legalEmail: "legal@aeras.finance",
  supportEmail: "support@aeras.finance",
  // Where the site is served from. The Terms cover this domain and every
  // subdomain of it.
  domain: "aeras.finance",
} as const;
