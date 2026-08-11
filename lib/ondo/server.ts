import { ONDO_API_BASE_URL } from "./constants";
import type {
  OndoContract,
  OndoEnvelope,
  OndoMarketsResult,
} from "./types";

// Server-side calls to Ondo Perps. Everything the browser needs goes through an
// API route rather than direct, matching the Trustware proxies: it keeps the
// builder code and any future API key server-only, and it sidesteps the CORS
// allowlisting the integration guide describes, since server-to-server requests
// carry no browser origin.
//
// The reads below need no authentication, which is why the market catalog and
// hedge sizing can be built and verified before Ondo issues a builder code.

// Ondo returns 403 to requests without a browser-like User-Agent.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function ondoGet<T>(path: string, baseUrl = ONDO_API_BASE_URL): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Ondo Perps ${path} failed: ${response.status}`);
  }

  const body = (await response.json()) as OndoEnvelope<T>;
  if (!body.success || body.result === undefined) {
    throw new Error(
      `Ondo Perps ${path} rejected: ${body.error ?? body.error_code ?? "unknown error"}`,
    );
  }
  return body.result;
}

// Static config: increments, leverage brackets, position caps, and the
// tokenConfig that says which assets are valid collateral on which chains.
//
// `baseUrl` exists so the verification script can read both environments in one
// run and diff them. App code should leave it alone: reading a catalog from an
// environment other than the one orders go to is how a hedge gets sized against
// the wrong market.
export function ondoMarkets(baseUrl?: string): Promise<OndoMarketsResult> {
  return ondoGet<OndoMarketsResult>("/v1/markets", baseUrl);
}

// Live tickers: prices, isClosed, funding. Disjoint from the static config.
export function ondoContracts(baseUrl?: string): Promise<OndoContract[]> {
  return ondoGet<OndoContract[]>("/v1/perps/contracts", baseUrl);
}
