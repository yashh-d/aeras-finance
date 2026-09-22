// Who may be enrolled into the Mag7X portfolio.
//
// The holdings are Coinbase-issued tokenized stocks offered under Regulation
// S, which makes them unavailable to US persons, and Bitwise's ATP terms say
// the same. Glider's API enforces none of this: the docs are explicit that
// eligibility is the integrator's to enforce. So it is enforced here, in the
// one place a portfolio is created, with two checks that are each weak alone.
//
//   1. The request's country, from the edge. Vercel stamps
//      `x-vercel-ip-country` on every request; a local dev server has no
//      header and is allowed through, which is what makes the second check
//      necessary rather than decorative.
//   2. The user's own statement that they are not a US person and not in a
//      restricted jurisdiction, sent as `attest: true` from a checkbox the
//      ticket will not submit without.
//
// A read of the strategy (its holdings, boost, history) is not gated. Nothing
// about seeing a public portfolio's composition is restricted, and the gate
// belongs on the action.
//
// The list is the US plus the jurisdictions under comprehensive US sanctions.
// It should be reconciled with Coinbase's own eligible-jurisdiction list for
// the tokens, which base.org/stocks describes but does not publish as a list.
export const BLOCKED_COUNTRIES: ReadonlySet<string> = new Set([
  "US",
  "CU",
  "IR",
  "KP",
  "SY",
]);

export type EligibilityResult =
  | { ok: true; country: string | null }
  | { ok: false; reason: string; country: string | null };

// The two-letter country the edge saw, or null when there is no edge (local
// dev, a direct server call).
export function countryFromHeaders(headers: Headers): string | null {
  const raw = headers.get("x-vercel-ip-country");
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function checkEligibility(args: {
  country: string | null;
  attested: boolean;
}): EligibilityResult {
  const { country } = args;
  if (country && BLOCKED_COUNTRIES.has(country)) {
    return {
      ok: false,
      country,
      reason:
        country === "US"
          ? "Bitwise Mag7X holds Coinbase tokenized stocks, which are not available to US persons."
          : "Bitwise Mag7X is not available in your jurisdiction.",
    };
  }
  if (!args.attested) {
    return {
      ok: false,
      country,
      reason: "Confirm that you are not a US person and not in a restricted jurisdiction.",
    };
  }
  return { ok: true, country };
}
