import { describe, expect, it } from "vitest";

import { checkEligibility, countryFromHeaders } from "./eligibility";

describe("countryFromHeaders", () => {
  it("reads Vercel's header", () => {
    expect(countryFromHeaders(new Headers({ "x-vercel-ip-country": "sg" }))).toBe("SG");
  });
  it("is null without the edge", () => {
    expect(countryFromHeaders(new Headers())).toBeNull();
    expect(countryFromHeaders(new Headers({ "x-vercel-ip-country": "??" }))).toBeNull();
  });
});

describe("checkEligibility", () => {
  it("refuses the US whatever the attestation says", () => {
    const r = checkEligibility({ country: "US", attested: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/US persons/);
  });
  it("refuses a sanctioned jurisdiction", () => {
    expect(checkEligibility({ country: "IR", attested: true }).ok).toBe(false);
  });
  it("needs the attestation even with no edge", () => {
    expect(checkEligibility({ country: null, attested: false }).ok).toBe(false);
    expect(checkEligibility({ country: null, attested: true }).ok).toBe(true);
  });
  it("allows an eligible country with the attestation", () => {
    expect(checkEligibility({ country: "SG", attested: true })).toEqual({ ok: true, country: "SG" });
  });
});
