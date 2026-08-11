// Fixed-point helpers over decimal strings.
//
// Every Trustware amount crosses the wire as an atomic decimal string, and the
// two sides of a conversion do not share a scale: EVM Ondo/xStock tokens are 18
// decimals, Solana xStocks are 8. Routing that through a JS float loses the low
// digits and produces deposits that fail on-chain for one atomic unit, which is
// the same class of bug lib/solana/balances.ts already guards against. So all of
// this is BigInt only.

function assertDecimalString(value: string): void {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) {
    throw new Error(`Not a decimal amount: "${value}"`);
  }
}

// "1.25" at 8 decimals -> "125000000". Extra precision beyond `decimals` is
// truncated, never rounded up, so we can never ask for more than the user has.
export function uiToAtomic(ui: string | number, decimals: number): string {
  const raw = typeof ui === "number" ? ui.toFixed(decimals) : ui.trim();
  assertDecimalString(raw);
  const [whole, frac = ""] = raw.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+/, "");
  return combined === "" ? "0" : combined;
}

// "125000000" at 8 decimals -> "1.25". Trailing zeros trimmed.
export function atomicToUi(atomic: string, decimals: number): string {
  assertDecimalString(atomic);
  if (decimals === 0) return atomic;
  const padded = atomic.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, "");
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

// Move an atomic amount between scales, e.g. an 8-decimal xStock amount
// expressed in the 18-decimal units of its EVM equivalent. Truncates when
// scaling down.
export function rescaleAtomic(
  atomic: string,
  fromDecimals: number,
  toDecimals: number,
): string {
  assertDecimalString(atomic);
  const value = BigInt(atomic);
  if (toDecimals === fromDecimals) return value.toString();
  if (toDecimals > fromDecimals) {
    return (value * 10n ** BigInt(toDecimals - fromDecimals)).toString();
  }
  return (value / 10n ** BigInt(fromDecimals - toDecimals)).toString();
}

// Multiply by (10000 + bps) / 10000. Used to add headroom on top of a quoted
// rate so the delivered amount still clears the shortfall if the rate drifts
// between the quote and the execution.
export function addBps(atomic: string, bps: number): string {
  assertDecimalString(atomic);
  return ((BigInt(atomic) * BigInt(10_000 + bps)) / 10_000n).toString();
}

// Coerce a Trustware USD field (sometimes number, sometimes string) to a number.
export function toNumberOrNull(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
