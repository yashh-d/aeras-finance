"use client";

// Funding Lighter margin, in the app.
//
// The original version printed Lighter's deposit address and asked the user to
// send USDC to it by hand. The next one moved the Solana balance for them but
// told them to bridge anything else themselves, which was the same chore in a
// smaller box: "move it to your Solana wallet" is itself a bridge, so it paid a
// spread and then made the user start the deposit over.
//
// Now every USDC balance is a source. The card's job is to say what each road
// costs and how long it takes, because that is the only thing the user is
// actually choosing between: Solana is cheapest and needs no gas, Base is a few
// bps more, Ethereum is last because its mainnet gas outweighs the spread at
// these sizes. See lib/lighter/margin-sources.ts for the measurements.

import { useMemo, useState } from "react";

import { FundMenu, type FundGroup } from "@/components/FundMenu";
import type { MarginSource } from "@/lib/lighter/margin-sources";
import type { useMarginFunding } from "@/lib/lighter/use-margin-funding";
import { INSET_PANEL } from "@/lib/ui/surface";

const CHAIN_LOGOS: Record<string, string> = {
  Solana: "/logos/solana.png",
  Ethereum: "/logos/eth.png",
  "BNB Chain": "/logos/bnb.png",
  Base: "/logos/eth.png",
};

const USDC_LOGO = "/logos/usdc.png";

export function LighterMarginCard({
  margin,
  needsAccount,
  open,
  onClose,
}: {
  margin: ReturnType<typeof useMarginFunding>;
  // No Lighter account exists yet, which only a deposit creates. The form is
  // forced open in that state, because there is nothing else the user can do on
  // this surface until it is done.
  needsAccount: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const { sources, selected, block, status } = margin;

  // One group per wallet, each row carrying what that road costs. Every row is
  // selectable now; the hint is what differs, because the choice is a price and
  // a wait rather than possible-versus-impossible.
  const groups = useMemo<FundGroup[]>(() => {
    const byChain = new Map<string, MarginSource[]>();
    for (const source of sources) {
      byChain.set(source.chainLabel, [
        ...(byChain.get(source.chainLabel) ?? []),
        source,
      ]);
    }
    return [...byChain.entries()].map(([chainLabel, list]) => ({
      chain: chainLabel,
      chainLogo: CHAIN_LOGOS[chainLabel],
      options: list.map((source) => ({
        id: source.id,
        label: source.destination === "solana-cctp" ? "USDC · slow, free" : "USDC",
        hint: `${usd(source.amountUsd)} · ${routeCost(source, true)}`,
        logo: USDC_LOGO,
        disabled: !source.usable,
        onSelect: () => {
          margin.select(source.id);
          setAmount(String(Math.floor(source.amountUsd * 100) / 100));
        },
      })),
    }));
  }, [sources, margin]);

  const showForm = needsAccount || open;

  const entered = Number(amount);
  const overBalance = entered > margin.availableUsd;
  const underMinimum = entered > 0 && entered < margin.minimumUsd;
  const canSubmit =
    margin.ready &&
    status.kind !== "sending" &&
    entered > 0 &&
    !overBalance &&
    !underMinimum &&
    block.kind === "ok";

  if (!showForm) return null;

  return (
    <div className={`${INSET_PANEL} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-white">
            {needsAccount ? "Fund your Lighter margin" : "Add margin"}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-white/45">
            Positions are margined with USDC held on Lighter, which is separate
            from the USDC in your wallet. This moves it for you from whichever
            wallet you pick.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {groups.length > 0 && (
            <div className="w-44">
              <FundMenu label={selected?.chainLabel ?? "USDC"} groups={groups} />
            </div>
          )}
          {!needsAccount && (
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-white/35 transition-colors hover:text-white/70"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {status.kind === "sent" ? (
        <div className="mt-3">
          {/* Three different things to say, and they are not interchangeable.
              Waiting is the normal case and has to name a number so the wait
              feels bounded. Credited is the only one that means the margin is
              spendable. A timeout means we stopped watching, NOT that the money
              is gone, and saying anything that sounds like failure would send
              someone to pay the same margin twice. */}
          {margin.credit.kind === "credited" ? (
            <Notice tone="success">
              Lighter credited {usd(margin.credit.amountUsd)}. Your margin is
              ready to trade with.
            </Notice>
          ) : margin.credit.kind === "timeout" ? (
            <Notice tone="info">
              Still not showing on Lighter. The transfer is on chain under{" "}
              <span className="font-mono">{status.sourceTx.slice(0, 10)}…</span>{" "}
              and bridges do run late, so this is a delay rather than a loss. Do
              not send it again. Press Refresh in a few minutes.
            </Notice>
          ) : (
            <Notice tone="info">
              USDC sent from {status.source.chainLabel}. Reference{" "}
              <span className="font-mono">{status.sourceTx.slice(0, 10)}…</span>
              . Waiting for Lighter to credit it, usually under{" "}
              {status.source.etaMinutes} minutes. This updates on its own.
            </Notice>
          )}
          <button
            type="button"
            // Clears the amount here rather than in an effect watching the
            // status. Reopening the form is the event that should empty it, and
            // an effect doing the same work is a second render for something
            // already known at the click.
            onClick={() => {
              margin.reset();
              setAmount("");
            }}
            className="mt-2 text-xs text-white/40 transition-colors hover:text-white/70"
          >
            Send more
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[180px] flex-1 items-center rounded-lg border border-white/10 bg-black/40 px-3 py-2 focus-within:border-white/25">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0.00"
                className="w-full bg-transparent font-mono text-base tabular-nums text-white outline-none placeholder:text-white/20"
              />
              <span className="ml-2 text-xs text-white/35">USDC</span>
            </div>
            {([0.25, 0.5, 1] as const).map((fraction) => (
              <button
                key={fraction}
                type="button"
                onClick={() =>
                  setAmount(
                    String(
                      Math.floor(margin.availableUsd * fraction * 100) / 100,
                    ),
                  )
                }
                disabled={margin.availableUsd <= 0}
                className="rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white disabled:opacity-30"
              >
                {fraction === 1 ? "Max" : `${fraction * 100}%`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void margin.deposit(amount)}
              disabled={!canSubmit}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {status.kind === "sending" ? "Sending…" : "Deposit"}
            </button>
          </div>

          <div className="mt-2 text-[11px] text-white/35">
            {status.kind === "sending" && status.progress
              ? status.progress.message
              : overBalance
                ? `That is more than the ${usd(margin.availableUsd)} USDC on ${selected?.chainLabel}.`
                : underMinimum
                  ? `Lighter's minimum on this route is ${usd(margin.minimumUsd)}.`
                  : selected
                    ? `${usd(margin.availableUsd)} USDC on ${selected.chainLabel} · ${routeCost(selected)}.`
                    : "No USDC found in your wallets."}
          </div>

          {status.kind === "error" && (
            <div className="mt-3">
              <Notice tone="error">
                {status.message}
                {status.signed && (
                  <>
                    {" "}
                    A transaction was already submitted, so do not retry until
                    you have checked whether it landed.
                  </>
                )}
              </Notice>
            </div>
          )}

          {block.kind === "needs-gas" && (
            <div className="mt-3">
              <Notice tone="info">
                Your USDC is on {block.chainLabel}, and moving it needs a little{" "}
                {block.gasToken} there for the network fee. Fund{" "}
                {block.gasToken} on {block.chainLabel}, or deposit from another
                wallet.
              </Notice>
            </div>
          )}

          {block.kind === "below-minimum" && (
            <div className="mt-3">
              <Notice tone="info">
                Lighter&apos;s minimum deposit is {usd(block.minimumUsd)} and
                your largest USDC balance is {usd(block.bestUsd)}.
              </Notice>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// What a road costs the user, in the terms they are choosing between: a spread,
// a wait, and whether they need gas. The spread is a planning figure; the real
// one comes from the route at signing time, bounded by MAX_MARGIN_LOSS_BPS.
//
// Two lengths because the two places have very different room. The menu row is
// a 17rem dropdown that ellipsises anything longer, and "needs ETH for gas" was
// being cut to "needs E…", which reads as a broken string rather than a terser
// one. The line under the amount field has the full width of the card.
function routeCost(source: MarginSource, compact = false): string {
  const fee =
    source.plannedLossBps === 0
      ? "no fee"
      : `${(source.plannedLossBps / 100).toFixed(2)}%`;
  if (compact) {
    const gas = source.signing === "evm-approve-and-send" ? " · +gas" : "";
    return `${fee} · ~${source.etaMinutes}m${gas}`;
  }
  const gas =
    source.signing === "evm-approve-and-send"
      ? `, needs ${source.gasToken} for gas`
      : "";
  return `about ${fee}, ~${source.etaMinutes} min${gas}`;
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "info" | "success";
  children: React.ReactNode;
}) {
  const style =
    tone === "error"
      ? "border-red-500/25 bg-red-500/10 text-red-300"
      : tone === "success"
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
        : "border-white/15 bg-white/[0.06] text-white/70";

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${style}`}>
      {children}
    </div>
  );
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}
