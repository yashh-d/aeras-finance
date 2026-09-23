"use client";

// One gate in front of every Solana signature: price what the transaction
// needs in SOL, and if the wallet cannot pay, open the gas sheet and resume
// the same action once it can.
//
// `guard` is advisory on the read side. An estimate that cannot reach the
// chain steps aside rather than blocking a transaction that would have
// worked; the runtime's own refusal is still translated by the caller's
// catch. On the answer side it is not advisory: a wallet the estimate says is
// short does not get to sign.
//
// Written when the fee check stopped being a first-position thing and became
// every transaction's thing, so the four cards that each held their own
// `setupGate` state, re-estimate and resume closure hold one call instead.

import { useCallback, useState, type ReactNode } from "react";

import {
  GasSheet,
  type GasSheetAsset,
  type SetupFunding,
} from "@/components/GasSheet";
import { isBlocked, type SetupCost } from "@/lib/borrow/setup-cost";

export interface GasGuardArgs {
  // Prices the transaction. Called again after a funding round, because the
  // action that follows reads the same balance the estimate does and a swap's
  // own figure is not that.
  estimate: () => Promise<SetupCost>;
  // The action to run once the wallet can pay.
  resume: () => Promise<void> | void;
  // The wallet paid for gas on the way through. Carries the cost the user was
  // shown, for the setup log.
  onFunded?: (funding: SetupFunding, cost: SetupCost) => void;
  // The wallet already covered it and nothing was shown. For the setup log,
  // which records rent whether or not a sheet opened.
  onCovered?: (cost: SetupCost) => void;
}

interface Gate {
  cost: SetupCost;
  args: GasGuardArgs;
}

export function useGasGate(sheet: {
  walletAddress: string;
  walletUsdc: number;
  // The asset the transaction is moving, when it can be sold for gas.
  asset?: GasSheetAsset;
  solPriceUsd: number | null;
  signTxBase64: (base64Tx: string) => Promise<string>;
}): {
  // True when the sheet opened and the caller must stop. False means go on.
  guard: (args: GasGuardArgs) => Promise<boolean>;
  // Render this where the sheet should mount. Null when nothing is open.
  element: ReactNode;
} {
  const [gate, setGate] = useState<Gate | null>(null);

  const guard = useCallback(async (args: GasGuardArgs): Promise<boolean> => {
    let cost: SetupCost;
    try {
      cost = await args.estimate();
    } catch (err) {
      console.error("[gas estimate]", err);
      return false;
    }
    if (!isBlocked(cost)) {
      args.onCovered?.(cost);
      return false;
    }
    setGate({ cost, args });
    return true;
  }, []);

  const element = gate ? (
    <GasSheet
      {...sheet}
      cost={gate.cost}
      onCancel={() => setGate(null)}
      onFunded={async (funding) => {
        const fresh = await gate.args.estimate();
        if (isBlocked(fresh)) {
          setGate({ cost: fresh, args: gate.args });
          return;
        }
        // Logged against the cost the user was shown, not the re-price
        // above, which by now reads as covered.
        gate.args.onFunded?.(funding, gate.cost);
        setGate(null);
        await gate.args.resume();
      }}
    />
  ) : null;

  return { guard, element };
}
