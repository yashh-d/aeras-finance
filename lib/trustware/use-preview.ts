"use client";

// Live conversion pricing for the deposit form.
//
// planCollateralDeposit already returns everything a user needs to decide:
// the source amount to send, the guaranteed minimum delivered, the fee in USD,
// and the end-to-end loss. It just used to run inside the submit handler, so
// none of it reached the user until after they had committed. This hook runs
// the same planner as the amount changes, debounced, so the numbers are on
// screen before the button is pressed.
//
// It prices only. It signs nothing and moves nothing. The submit path re-plans
// against a fresh quote, so this is a preview of the deal, not a binding one.

import { useEffect, useMemo, useRef, useState } from "react";

import type { XStockBorrowVault } from "@/lib/jupiter/borrow";
import type { HeldEquivalent } from "./planner";
import { planUnifiedDeposit, type UnifiedPlan } from "./unified";

// Long enough that typing an amount digit by digit does not fire a quote per
// keystroke. Each plan costs up to two Trustware round-trips per candidate
// source, so this is the difference between one quote and a dozen.
const DEBOUNCE_MS = 450;

export interface ConversionPreview {
  plan: UnifiedPlan | null;
  loading: boolean;
  // Set when the planner itself threw. A blocked plan is not an error: it is a
  // priced answer of "no", and it arrives on `plan`.
  error: string | null;
}

export function useConversionPreview(args: {
  vault: XStockBorrowVault;
  // What the user typed, in collateral units.
  requestedUi: number;
  solanaAddress: string;
  evmAddress: string | undefined;
  solanaCollateralAtomic: string;
  heldEquivalents: HeldEquivalent[];
  // False when no conversion is in play, which skips the network entirely.
  enabled: boolean;
}): ConversionPreview {
  const {
    vault,
    requestedUi,
    solanaAddress,
    evmAddress,
    solanaCollateralAtomic,
    heldEquivalents,
    enabled,
  } = args;

  // `pricedFor` is the amount this result describes. Keeping it alongside the
  // plan means a stale quote can be recognised and hidden by comparing against
  // the current input, instead of being cleared by a second state write.
  const [result, setResult] = useState<{
    plan: UnifiedPlan | null;
    error: string | null;
    pricedFor: number | null;
  }>({ plan: null, error: null, pricedFor: null });

  // The equivalents array is rebuilt on every parent render, so keying the
  // effect on it directly would refire forever. Key on its content instead.
  const heldKey = useMemo(
    () =>
      heldEquivalents
        .map((h) => `${h.source.chain}:${h.source.token}:${h.balanceAtomic}`)
        .join("|"),
    [heldEquivalents],
  );

  // Only the newest request may commit. A slow quote for "0.05" must not
  // overwrite the answer for "0.5" the user has since typed.
  const generationRef = useRef(0);

  const active = enabled && Number.isFinite(requestedUi) && requestedUi > 0;

  useEffect(() => {
    if (!active) return;
    const generation = ++generationRef.current;

    const timer = setTimeout(async () => {
      try {
        const plan = await planUnifiedDeposit({
          vault,
          requestedUi,
          solanaAddress,
          evmAddress,
          solanaCollateralAtomic,
          heldEquivalents,
        });
        if (generationRef.current !== generation) return;
        setResult({ plan, error: null, pricedFor: requestedUi });
      } catch (err) {
        console.error("[conversion preview]", err);
        if (generationRef.current !== generation) return;
        setResult({
          plan: null,
          error:
            err instanceof Error
              ? err.message
              : "Could not price the conversion.",
          pricedFor: requestedUi,
        });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // heldKey stands in for heldEquivalents; vault is stable per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    requestedUi,
    solanaAddress,
    evmAddress,
    solanaCollateralAtomic,
    heldKey,
    vault.vaultId,
  ]);

  // Derived, not stored: a result only counts while it still describes the
  // amount on screen. Anything else reads as still pricing.
  const current = active && result.pricedFor === requestedUi;
  return {
    plan: current ? result.plan : null,
    loading: active && !current,
    error: current ? result.error : null,
  };
}
