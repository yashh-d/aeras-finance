"use client";

// Adding margin, in one click.
//
// The user is holding USDC on Solana, or SPYx, or USDC on BNB Chain. Ondo
// credits USDC and its own tokenized equities, on Ethereum. Nothing about that
// gap is the user's problem to solve, so this card does not explain it: it
// picks the best thing they hold, fills in the amount, and offers one button.
// The source picker is there for when they want a different one, collapsed by
// default, because the common case is "use what I have".
//
// Two moments are deliberately separate. Pressing Add prices the route, and the
// plan that comes back carries the bridge fee, what actually lands, and what it
// credits after Ondo's haircut. Only then is there something to sign. Showing
// those numbers after the signature would be showing them too late, and the
// haircut in particular surprises people: $1,000 of SPYon is $900 of margin.

import { useMemo, useState } from "react";

import { FundMenu, type FundGroup } from "@/components/FundMenu";
import { assetIdentity } from "@/lib/jupiter/xstocks";
import { tokenLogoBySymbol } from "@/lib/tokens/logos";
import type { OndoMarginSource } from "@/lib/ondo/margin-sources";
import type { UseOndoMargin } from "@/lib/ondo/use-ondo-margin";

import { INSET_PANEL } from "@/lib/ui/surface";

// Chain marks for the menu's group headers, keyed by the chain label the
// source registry produces.
const CHAIN_LOGOS: Record<string, string> = {
  Solana: "/logos/solana.png",
  Ethereum: "/logos/eth.png",
  "BNB Chain": "/logos/bnb.png",
  Base: "/logos/eth.png",
};

// The mark for one source. USDC and the other stables resolve by symbol; a
// tokenized equity resolves through the xStock catalog, which is where its
// company logo lives. An Ondo token carries the "on" suffix, so it is asked
// for under its xStock name.
function sourceLogo(source: OndoMarginSource): string | undefined {
  const bySymbol = tokenLogoBySymbol(source.symbol);
  if (bySymbol) return bySymbol;
  const xstockSymbol = source.symbol.endsWith("on")
    ? `${source.symbol.slice(0, -2)}x`
    : source.symbol;
  return assetIdentity(source.token, xstockSymbol).logo;
}

const PANEL = INSET_PANEL;
const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.14em] text-white/35";

export function OndoMarginCard({ margin }: { margin: UseOndoMargin }) {
  const [selected, setSelected] = useState<OndoMarginSource | null>(null);
  const [amount, setAmount] = useState("");

  const source = selected ?? margin.best ?? null;
  const status = margin.status;

  // Grouped by chain, same shape as the wallet's Fund menu: which chain, then
  // which asset, with a mark against each so the chain is recognised before the
  // label is read. The registry already sorts USDC first and gasless sources
  // ahead of gas-paying ones, so group order follows the list rather than a
  // second opinion about ranking.
  const groups = useMemo<FundGroup[]>(() => {
    const byChain = new Map<string, OndoMarginSource[]>();
    for (const s of margin.sources) {
      const existing = byChain.get(s.chainLabel);
      if (existing) existing.push(s);
      else byChain.set(s.chainLabel, [s]);
    }
    return [...byChain.entries()].map(([chainLabel, sources]) => ({
      chain: chainLabel,
      chainLogo: CHAIN_LOGOS[chainLabel],
      options: sources.map((s) => ({
        id: s.id,
        label: s.symbol,
        hint:
          s.balanceUsd === null
            ? `becomes ${s.target.symbol}`
            : `${usd(s.balanceUsd)} · becomes ${s.target.symbol}${
                s.needsGas ? " · needs gas" : ""
              }`,
        logo: sourceLogo(s),
        onSelect: () => {
          setSelected(s);
          setAmount("");
          margin.reset();
        },
      })),
    }));
  }, [margin]);

  // Pre-filled with the whole balance. Someone adding margin is usually adding
  // what they have, and an empty field is one more thing to do before the click
  // that matters.
  const amountUi =
    amount || (source?.balanceUsd != null ? trimAmount(source, source.balanceUsd) : "");

  if (!source) {
    return (
      <div className={`${PANEL} p-4`}>
        <h3 className="text-sm font-medium text-white">Nothing to post as margin</h3>
        <p className="mt-1 text-sm text-white/45">
          Ondo takes USDC or its own tokenized equities. Buy USDC or an xStock
          and it becomes available here.
        </p>
      </div>
    );
  }

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-white">Add margin</h3>
          <p className="mt-0.5 text-[11px] text-white/35">
            {source.kind === "usdc"
              ? "Credited in full, no haircut"
              : `Posts as ${source.target.symbol}, credited at ${(100 - source.target.haircut * 100).toFixed(0)}% of mark`}
          </p>
        </div>
        {/* The wallet's Fund control, reused rather than restyled. Same
            question in the same shape: which chain, then which asset. */}
        <div className="w-40 shrink-0">
          <FundMenu label={`${source.symbol} on ${source.chainLabel}`} groups={groups} />
        </div>
      </div>

      {status.kind === "ready" ? (
        <Plan margin={margin} />
      ) : status.kind === "sent" ? (
        <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-sm text-emerald-300">
          Sent. The bridge delivers to your Ondo deposit address, and Ondo credits
          it as margin shortly after.
          <div className="mt-1 font-mono text-[11px] text-emerald-300/70">
            {status.txHash.slice(0, 16)}…
          </div>
          <button
            type="button"
            onClick={margin.reset}
            className="mt-2 text-[11px] text-emerald-300/70 underline-offset-2 hover:underline"
          >
            Add more
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center rounded-lg border border-white/10 bg-black/40 px-3 py-2 focus-within:border-white/25">
            <span className="mr-1 text-sm text-white/35">
              {source.kind === "usdc" ? "$" : ""}
            </span>
            <input
              value={amountUi}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="w-full bg-transparent font-mono text-sm tabular-nums text-white outline-none"
            />
            <span className="ml-2 shrink-0 text-[11px] text-white/35">
              {source.symbol}
            </span>
          </div>

          {status.kind === "error" && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-300">
              {status.message}
            </p>
          )}

          {/* The one way an EVM source is not like a Solana one. It is stated
              before the button rather than discovered as a failed signature:
              the embedded wallet is born with no gas, and unlike the Monad
              path there is no inbound leg to attach a top-up to. */}
          {source.needsGas && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              Funding from {source.chainLabel} is signed with your Ethereum
              wallet and pays gas there, possibly after an approval. Your Solana
              USDC needs neither.
            </p>
          )}

          {!margin.enabled && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              Depositing is switched off until one live transfer confirms Ondo
              credits a bridge-delivered deposit. Pricing works now.
            </p>
          )}

          <button
            type="button"
            onClick={() => void margin.price(source, amountUi)}
            disabled={status.kind === "pricing" || !amountUi || Number(amountUi) <= 0}
            className="mt-3 w-full rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:text-white/30"
          >
            {status.kind === "pricing"
              ? "Pricing…"
              : `Add ${amountUi || "0"} ${source.symbol} as margin`}
          </button>
        </>
      )}
    </div>
  );
}

// What the route actually delivers, before anything is signed.
function Plan({ margin }: { margin: UseOndoMargin }) {
  const status = margin.status;
  if (status.kind !== "ready" && status.kind !== "working") return null;

  const plan = status.kind === "ready" ? status.plan : null;

  if (!plan) {
    return (
      <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/40 p-3 text-sm text-white/70">
        {status.kind === "working" ? status.message : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/[0.07] bg-black/40 p-3">
      <div className="space-y-1 text-[11px]">
        <Line
          label={`${plan.collateral.symbol} delivered`}
          value={`${trim(plan.deliveredTokens)}${
            plan.deliveredValueUsd === null ? "" : ` (${usd(plan.deliveredValueUsd)})`
          }`}
        />
        {plan.bridgeFeesUsd !== null && (
          <Line label="Bridge fee" value={usd(plan.bridgeFeesUsd)} />
        )}
        {plan.lossBps !== null && (
          <Line label="Conversion cost" value={`${(plan.lossBps / 100).toFixed(2)}%`} />
        )}
        <Line
          label="Credited as margin"
          value={
            plan.creditedMarginUsd === null
              ? "known once it lands"
              : usd(plan.creditedMarginUsd)
          }
        />
      </div>

      {plan.valueUnverified && (
        <p className="text-[11px] leading-relaxed text-white/45">
          Ondo has no market to mark {plan.collateral.symbol} against, so what it
          credits is only known after it is deposited.
        </p>
      )}

      {plan.collateralUndocumented && (
        <p className="text-[11px] leading-relaxed text-amber-400/80">
          Ondo lists {plan.collateral.symbol} as a deposit asset but has not
          published its haircut or cap. The credited figure above assumes the
          standard 10 percent.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={margin.reset}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void margin.confirm()}
          disabled={!margin.enabled || plan.executionDisabled}
          className="rounded-lg bg-emerald-500/90 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {margin.enabled ? "Confirm" : "Deposits disabled"}
        </button>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-white/35">{label}</span>
      <span className="font-mono tabular-nums text-white/70">{value}</span>
    </div>
  );
}

// A USDC amount is dollars; an equity amount is tokens. The field takes whatever
// the source is denominated in, so the default has to match.
function trimAmount(source: OndoMarginSource, balanceUsd: number): string {
  if (source.kind === "usdc") return balanceUsd.toFixed(2);
  const tokens = Number(source.balanceAtomic) / 10 ** source.decimals;
  return trim(tokens.toFixed(Math.min(source.decimals, 8)));
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function trim(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export { LABEL as ONDO_MARGIN_LABEL };
