"use client";

// A strategy is a list of steps, each one signature or one wait. This hook
// runs them in order, keeps the list on screen as it goes, stops at the first
// failure, and can retry from the failed step without redoing the ones that
// landed. Money moved by a finished step is on chain whether or not the next
// step runs, so "start over" is never offered: only "retry this step".
//
// State is in memory. A refresh mid-run loses the list but not the money, and
// every leg re-reads the wallet before it acts, so the user can finish by hand
// from the Borrow and Earn tabs. Persisting runs is the next slice.

import { useCallback, useRef, useState } from "react";

import { readableStrategyError } from "./execute";

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface StepView {
  id: string;
  label: string;
  status: StepStatus;
  // Live sub-status while running ("Borrowing USDC on Kamino").
  detail?: string;
  signatures: string[];
  error?: string;
}

export interface StepDef {
  id: string;
  label: string;
  // Runs the step. May report progress and must return the signatures it
  // produced, which the list links to Solscan.
  run: (report: (detail: string) => void) => Promise<{ signatures: string[] }>;
}

export interface StrategyRun {
  steps: StepView[];
  running: boolean;
  // True once every step in the current list is done.
  finished: boolean;
  // Index of the failed step, or null.
  failedAt: number | null;
  // Replace the list and run it from the top.
  start: (defs: StepDef[]) => Promise<boolean>;
  // Run from the failed step onward.
  retry: () => Promise<boolean>;
  // Append steps to a finished run and run them. For the ladder, where the
  // next round is only known once the user has picked what to buy.
  extend: (defs: StepDef[]) => Promise<boolean>;
  reset: () => void;
}

export function useStrategyRun(): StrategyRun {
  const [steps, setSteps] = useState<StepView[]>([]);
  const [running, setRunning] = useState(false);
  const defsRef = useRef<StepDef[]>([]);

  const patch = useCallback((index: number, next: Partial<StepView>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...next } : s)),
    );
  }, []);

  // Runs defs[from..] and resolves true when all landed.
  const runFrom = useCallback(
    async (from: number): Promise<boolean> => {
      setRunning(true);
      try {
        for (let i = from; i < defsRef.current.length; i++) {
          const def = defsRef.current[i];
          patch(i, { status: "running", error: undefined, detail: undefined });
          try {
            const { signatures } = await def.run((detail) =>
              patch(i, { detail }),
            );
            patch(i, { status: "done", signatures, detail: undefined });
          } catch (err) {
            console.error(`[strategy step ${def.id}]`, err);
            patch(i, {
              status: "failed",
              error: readableStrategyError(err),
              detail: undefined,
            });
            return false;
          }
        }
        return true;
      } finally {
        setRunning(false);
      }
    },
    [patch],
  );

  const start = useCallback(
    async (defs: StepDef[]) => {
      defsRef.current = defs;
      setSteps(
        defs.map((d) => ({
          id: d.id,
          label: d.label,
          status: "pending",
          signatures: [],
        })),
      );
      return runFrom(0);
    },
    [runFrom],
  );

  const failedAt = steps.findIndex((s) => s.status === "failed");

  const retry = useCallback(async () => {
    if (failedAt < 0) return false;
    return runFrom(failedAt);
  }, [failedAt, runFrom]);

  const extend = useCallback(
    async (defs: StepDef[]) => {
      const from = defsRef.current.length;
      defsRef.current = [...defsRef.current, ...defs];
      setSteps((prev) => [
        ...prev,
        ...defs.map((d) => ({
          id: d.id,
          label: d.label,
          status: "pending" as const,
          signatures: [],
        })),
      ]);
      return runFrom(from);
    },
    [runFrom],
  );

  const reset = useCallback(() => {
    defsRef.current = [];
    setSteps([]);
  }, []);

  return {
    steps,
    running,
    finished: steps.length > 0 && steps.every((s) => s.status === "done"),
    failedAt: failedAt < 0 ? null : failedAt,
    start,
    retry,
    extend,
    reset,
  };
}
