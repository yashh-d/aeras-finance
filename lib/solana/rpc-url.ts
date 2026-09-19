// Which Solana RPC the app talks to, resolved once at build time.
//
// The whole client reads `process.env.NEXT_PUBLIC_SOLANA_RPC_URL` (the
// Privy provider and the shared Connection in balances.ts). next.config.ts
// sets that variable from this resolver, so a Helius credential in the
// environment wins over whatever NEXT_PUBLIC_SOLANA_RPC_URL says. This exists
// because the two were both present on a machine and the app kept using the
// Alchemy URL, which throttles getProgramAccounts hard enough that the
// positions card 429'd on every poll. Helius is what CLAUDE.md asks for.
//
// The resolver is deliberately loose about the variable's name: any key
// containing HELIUS counts, so HELIUS_API_KEY, NEXT_PUBLIC_HELIUS_RPC_URL and
// HELIUS_URL all work without a rename. A value that looks like a URL is used
// as-is (a missing scheme gets https://); anything else is treated as an API
// key and placed on Helius's mainnet endpoint. When several Helius keys are
// set, a full URL beats a bare key, and a public (NEXT_PUBLIC_) name beats a
// private one, since the public one is what the author expected the browser
// to see.
//
// Pure and side-effect free so it can be unit tested. Do not read
// process.env in here; the caller passes it in.

export const HELIUS_MAINNET_RPC = "https://mainnet.helius-rpc.com/";

export type ResolvedRpc = {
  url: string;
  // Which environment variable the URL came from, for the startup log.
  source: string;
};

type Env = Record<string, string | undefined>;

function isHeliusKey(name: string): boolean {
  return /HELIUS/i.test(name);
}

function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|wss?:\/\/)/i.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(value);
}

function rank(name: string, value: string): number {
  let score = 0;
  if (looksLikeUrl(value)) score += 2;
  if (name.startsWith("NEXT_PUBLIC_")) score += 1;
  return score;
}

function toUrl(value: string): string {
  const v = value.trim();
  if (/^wss?:\/\//i.test(v)) return v.replace(/^ws/i, "http");
  if (/^https?:\/\//i.test(v)) return v;
  if (looksLikeUrl(v)) return `https://${v}`;
  // A bare API key.
  return `${HELIUS_MAINNET_RPC}?api-key=${encodeURIComponent(v)}`;
}

export function resolveSolanaRpcUrl(env: Env): ResolvedRpc | null {
  const helius = Object.entries(env)
    .filter((e): e is [string, string] => {
      const [name, value] = e;
      return isHeliusKey(name) && typeof value === "string" && value.trim() !== "";
    })
    .sort((a, b) => rank(b[0], b[1]) - rank(a[0], a[1]) || a[0].localeCompare(b[0]));
  if (helius.length > 0) {
    const [name, value] = helius[0];
    return { url: toUrl(value), source: name };
  }

  for (const name of ["NEXT_PUBLIC_SOLANA_RPC_URL", "SOLANA_RPC_URL"]) {
    const value = env[name];
    if (typeof value === "string" && value.trim() !== "") {
      return { url: value.trim(), source: name };
    }
  }
  return null;
}

// Hostname only, so a startup log line never prints the key.
export function describeRpc(resolved: ResolvedRpc): string {
  let host = resolved.url;
  try {
    host = new URL(resolved.url).host;
  } catch {}
  return `Solana RPC: ${host} (from ${resolved.source})`;
}
