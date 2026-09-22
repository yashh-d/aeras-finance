// Turning a failed simulation into a sentence.
//
// The error a provider throws for a reverted eth_estimateGas comes in more
// than one shape. A raw JSON-RPC node says `execution reverted: <reason>` on
// one line, with the reason absent or `0x` when the contract gave none.
// Privy's provider wraps the same thing in a viem error, which is several
// lines: a headline, a `reason:` or `Details:` line, the request arguments,
// and a `Version: viem@x.y.z` trailer. The first version of this grabbed the
// last line of that and showed "Version: viem@2.47.12" as the reason on the
// review card (2026-09-22). The reason is looked for by name now, and
// anything that is not a sentence a person could act on falls back to the
// chain's name alone.

import { blendChainName } from "./constants";

const REASON_PATTERNS: readonly RegExp[] = [
  /reverted with (?:the following )?reason:\s*([^\n]+)/i,
  /reverted with custom error\s*'?([^'\n]+)'?/i,
  /\breason:\s*([^\n]+)/i,
  /execution reverted:?\s*([^\n]+)/i,
  /\bdetails:\s*([^\n]+)/i,
];

function isUsable(reason: string): boolean {
  const r = reason.trim().replace(/^["'`]|["'`.]+$/g, "");
  if (r.length === 0 || r.length > 160) return false;
  if (/^0x[0-9a-f]*$/i.test(r)) return false;
  if (/^(execution reverted|reverted|revert)$/i.test(r)) return false;
  if (/^version:|viem@|request arguments|^contract call/i.test(r)) return false;
  // viem's headline for a revert with no data, and a raw node's echo of it.
  if (/^(for|with) an unknown reason/i.test(r)) return false;
  if (/^data=/i.test(r)) return false;
  return true;
}

// The reason a contract gave, cleaned, or null when it gave none worth
// showing.
export function extractRevertReason(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  for (const pattern of REASON_PATTERNS) {
    const m = pattern.exec(raw);
    if (!m) continue;
    const candidate = m[1].trim().replace(/^["'`]|["'`.]+$/g, "");
    if (isUsable(candidate)) return candidate;
  }
  return null;
}

export function describeRevert(chainId: number, err: unknown): string {
  const name = blendChainName(chainId);
  const reason = extractRevertReason(err);
  return reason
    ? `Blend's ${name} step would fail: ${reason}.`
    : `Blend's ${name} step would fail right now.`;
}
