"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

// A borderless amount entry. The figure is the largest thing on the ticket and
// its unit sits immediately beside it, so the control reads as a number being
// written rather than as a form field. The full-width bordered box it replaces
// carried no information and took the same weight as the price above it.
//
// The input is sized to its own text by an invisible copy underneath it.
// `field-sizing: content` does this natively but is Chromium-only, and the
// unit has to sit next to the digits, not pinned to a far right edge.
export function AmountField({
  value,
  onChange,
  unit,
  prefix,
  placeholder = "0",
  ariaLabel,
  id,
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  // Sits after the number. A plain label for a fixed unit, or a control when
  // the unit is the user's choice.
  unit: ReactNode;
  // Rendered before the number, e.g. a currency sign.
  prefix?: string;
  placeholder?: string;
  ariaLabel: string;
  id?: string;
  // Take the caret on mount. For a ticket the user opened in order to type an
  // amount, so the first keystroke lands in the right place.
  autoFocus?: boolean;
}) {
  const generatedId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = value === "" ? placeholder : value;

  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;
    // preventScroll because the ticket is already on screen; letting the
    // browser scroll to it moves the page out from under the user.
    el.focus({ preventScroll: true });
    // Selected, not appended to: a seeded default should vanish on the first
    // keystroke rather than turn 5.10 into 5.1020.
    el.select();
  }, [autoFocus]);

  return (
    <div className="flex items-baseline gap-2">
      {prefix && (
        <span className="text-3xl font-medium leading-tight tabular-nums text-white/30">
          {prefix}
        </span>
      )}
      <span className="relative inline-block">
        {/* Sizes the input. Must share every metric-affecting class with it. */}
        <span
          aria-hidden
          className="invisible block whitespace-pre text-3xl font-medium leading-tight tabular-nums"
        >
          {shown}
        </span>
        <input
          ref={inputRef}
          id={id ?? generatedId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={ariaLabel}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(sanitizeDecimal(e.target.value))}
          className="absolute inset-0 w-full bg-transparent text-3xl font-medium leading-tight tabular-nums text-white outline-none placeholder:text-white/25"
        />
      </span>
      {unit}
    </div>
  );
}

// Holds the field to a single decimal number. `type="number"` would enforce
// this, but it also draws a spinner, and at this size its arrows compete with
// the figure itself.
export function sanitizeDecimal(raw: string) {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const [head, ...rest] = cleaned.split(".");
  return rest.length ? `${head}.${rest.join("")}` : cleaned;
}
