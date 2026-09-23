"use client";

// The EVM twin of lib/gas/use-gas-gate.tsx: one call in front of a signature
// on Monad, Ethereum, Base or Robinhood Chain. `guard` plans; if the wallet
// is short it opens the sheet, buys the gas from Solana USDC when the user
// asks, re-plans, and resumes the same action.

import { useCallback, useState, type ReactNode } from "react";

import { EvmGasSheet } from "@/components/EvmGasSheet";
import {
  fundEvmGas,
  type EvmGasShortfall,
  type EvmSigner,
  type SolanaSigner,
} from "@/lib/gas/evm";

export interface EvmGasGuardArgs {
  // Prices the transaction's gas; null when the wallet covers it. Called
  // again after funding, with the balance the caller has just re-read.
  plan: () => Promise<EvmGasShortfall | null>;
  resume: () => Promise<void> | void;
}

interface Gate {
  shortfall: EvmGasShortfall;
  args: EvmGasGuardArgs;
}

export function useEvmGasGate(signers: {
  evm: EvmSigner | null;
  solana: SolanaSigner | undefined;
}): {
  // True when the sheet opened and the caller must stop.
  guard: (args: EvmGasGuardArgs) => Promise<boolean>;
  element: ReactNode;
} {
  const [gate, setGate] = useState<Gate | null>(null);

  const guard = useCallback(async (args: EvmGasGuardArgs): Promise<boolean> => {
    let shortfall: EvmGasShortfall | null;
    try {
      shortfall = await args.plan();
    } catch (err) {
      // Advisory on the read side, like the Solana gate: the venue's own
      // guard still refuses if this was the reason.
      console.error("[evm gas plan]", err);
      return false;
    }
    if (!shortfall) return false;
    setGate({ shortfall, args });
    return true;
  }, []);

  // Re-plan after a funding round or a manual send. Resumes when covered;
  // otherwise leaves the sheet up with the fresh figure.
  const settle = useCallback(async (g: Gate) => {
    const fresh = await g.args.plan();
    if (fresh) {
      setGate({ shortfall: fresh, args: g.args });
      return;
    }
    setGate(null);
    await g.args.resume();
  }, []);

  const element = gate ? (
    <EvmGasSheet
      shortfall={gate.shortfall}
      onCancel={() => setGate(null)}
      onUse={async (report) => {
        if (!signers.evm) throw new Error("No embedded EVM wallet available.");
        if (!signers.solana) throw new Error("No Solana wallet is available to buy gas from.");
        await fundEvmGas({
          shortfall: gate.shortfall,
          evm: signers.evm,
          solana: signers.solana,
          report,
        });
        await settle(gate);
      }}
      onCheckAgain={() => settle(gate)}
    />
  ) : null;

  return { guard, element };
}
