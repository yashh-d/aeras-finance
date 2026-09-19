"use client";

// A strategy is a list of steps, each one signature or one wait. This hook
// runs them in order, keeps the list on screen as it goes, stops at the first
// failure, and can retry from the failed step without redoing the ones that
// landed. Money moved by a finished step is on chain whether or not the next
// step runs, so "start over" is never offered: only "retry this step".
//
// Resuming: a ticket that finds a saved run rebuilds its step definitions and
// hands the saved snapshots back in. Steps saved as done stay done. A step
// saved as "running" was interrupted mid-flight (a closed tab, a crash) and
// may or may not have landed, so it is asked to reconcile against the chain
// before anything is re-sent: a buy that re-ran would buy twice.

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
  // For a resume: decide from chain state whether this step already landed
  // while the page was away. Returning true marks it done without re-running.
  // Absent means "assume it did not land", which is only safe for a step
  // that is harmless to repeat.
  reconcile?: () => Promise<boolean>;
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
  // Replace the list with a saved run and continue from its first unfinished
  // step, reconciling any step that was interrupted.
  resume: (defs: StepDef[], saved: StepView[]) => Promise<boolean>;
  // Run from the failed step onward.
  retry: () => Promise<boolean>;
  // Append steps to a finished run and run them. For the ladder, where the
  // next round is only known once the user has picked what to buy.
  extend: (defs: StepDef[]) => Promise<boolean>;
  reset: () => void;
}

function viewOf(d: StepDef): StepView {
  return { id: d.id, label: d.label, status: "pending", signatures: [] };
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

  // Runs defs[from..] and resolves true when all landed. `interrupted` names
  // the steps that need a reconcile pass first.
  const runFrom = useCallback(
    async (from: number, interrupted: Set<number> = new Set()): Promise<boolean> => {
      setRunning(true);
      try {
        for (let i = from; i < defsRef.current.length; i++) {
          const def = defsRef.current[i];
          patch(i, { status: "running", error: undefined, detail: undefined });
          try {
            if (interrupted.has(i) && def.reconcile) {
              patch(i, { detail: "Checking whether this already landed" });
              if (await def.reconcile()) {
                patch(i, { status: "done", detail: undefined });
                continue;
              }
            }
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
      setSteps(defs.map(viewOf));
      return runFrom(0);
    },
    [runFrom],
  );

  const resume = useCallback(
    async (defs: StepDef[], saved: StepView[]) => {
      defsRef.current = defs;
      const interrupted = new Set<number>();
      const views = defs.map((d, i) => {
        const s = saved[i];
        if (!s || s.id !== d.id) return viewOf(d);
        if (s.status === "done") return { ...s, error: undefined, detail: undefined };
        if (s.status === "running") interrupted.add(i);
        return { ...viewOf(d), signatures: s.signatures };
      });
      setSteps(views);
      const from = views.findIndex((v) => v.status !== "done");
      if (from < 0) return true;
      return runFrom(from, interrupted);
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
      setSteps((prev) => [...prev, ...defs.map(viewOf)]);
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
    resume,
    retry,
    extend,
    reset,
  };
}
