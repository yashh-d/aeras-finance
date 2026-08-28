"use client";

// The Ondo collateral catalog on its own, for surfaces that need to name and
// price an Ondo token without caring about markets, positions or a session.
//
// `usePerps` already fetches this, but it also pulls the account snapshot and
// is gated on being signed in. The wallet panel needs neither: a withdrawn
// SPCXon is the user's own ERC-20 and has to be visible and movable whether or
// not Ondo will still talk to them. This is the read-only half.
//
// `/api/ondo/markets` is unauthenticated, so this works with no session.

import { useCallback, useEffect, useState } from "react";

import { fetchOndoCatalog } from "./client";
import type { OndoCollateral } from "./collateral";

export interface UseOndoCollateral {
  collateral: OndoCollateral[];
  loading: boolean;
  error: string | null;
}

export function useOndoCollateral(enabled = true): UseOndoCollateral {
  const [collateral, setCollateral] = useState<OndoCollateral[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const catalog = await fetchOndoCatalog();
      setCollateral(catalog.creditable);
      setError(null);
      setLoaded(true);
    } catch (err) {
      // Never fatal. The wallet panel can still show the balance from the
      // scan; what it loses without this is the label and the mark price.
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(true);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { collateral, loading: enabled && !loaded && error === null, error };
}
