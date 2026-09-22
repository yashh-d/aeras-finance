// Converting a JS number to an atomic amount.
//
// This is the number-in path. The string-in path is `uiToAtomic` in
// lib/trustware/amounts.ts, which asserts a plain decimal string and is what
// anything already holding an exact amount should use. Use this only where the
// amount genuinely is a float: a typed figure divided by a price, a balance
// read back as `uiAmount`.
//
// It exists because three modules had their own copy of the same conversion and
// the same defect. `Number.prototype.toString` switches to exponential notation
// below 1e-6 and at or above 1e21, so splitting its output on "." only works in
// the middle of the range. Outside it the pieces are nonsense: 4.4e-7 at eight
// decimals produced the atomic string "44e-70000", which threw
// "Cannot convert 44e-70000 to a BigInt" during render and took the page down.
// A dollar amount divided by a price lands there easily — $0.00014 of a $318
// stock is 4.4e-7.

// "4.4e-7" -> "0.00000044", "1e+21" -> "1000000000000000000000". A number whose
// own toString is already plain comes back untouched.
export function toPlainDecimalString(value: number): string {
  const raw = String(value);
  if (!/e/i.test(raw)) return raw;

  const [mantissa, exponent] = raw.split(/e/i);
  const exp = Number(exponent);
  const negative = mantissa.startsWith("-");
  const [intPart, fracPart = ""] = (
    negative ? mantissa.slice(1) : mantissa
  ).split(".");
  const digits = intPart + fracPart;
  // Where the point lands once the exponent is applied, counted from the left
  // of the digit run.
  const pointAt = intPart.length + exp;

  let plain: string;
  if (pointAt <= 0) {
    plain = `0.${"0".repeat(-pointAt)}${digits}`;
  } else if (pointAt >= digits.length) {
    plain = digits + "0".repeat(pointAt - digits.length);
  } else {
    plain = `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  }
  return negative ? `-${plain}` : plain;
}

// A UI amount in atomic base units, as a decimal string. Precision beyond
// `decimals` is truncated, never rounded up, so a conversion can never ask for
// more than the balance it came from.
export function numberToAtomicString(amount: number, decimals: number): string {
  const [whole, frac = ""] = toPlainDecimalString(amount).split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return `${whole}${fracPadded}`.replace(/^0+/, "") || "0";
}
