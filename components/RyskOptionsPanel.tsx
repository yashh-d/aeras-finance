"use client";

import { useState } from "react";

import { expiriesFor, optionsFor } from "@/lib/rysk/catalog";
import { RYSK_CHAIN_NAMES } from "@/lib/rysk/constants";
import {
  assignmentSummary,
  buildTicket,
  formatExpiry,
  formatPercent,
  formatUsd,
  trimNumber,
} from "@/lib/rysk/strategy";
import type { RyskOption, RyskUnderlying } from "@/lib/rysk/types";
import { useRyskChain } from "@/lib/rysk/use-chain";
import { GLASS_SURFACE } from "@/lib/ui/surface";

// Rysk V12 option selling, read only.
//
// The user is the seller on both products: a covered call locks the underlying
// and a cash-secured put locks the stable. Nothing here can open a position.
// Every selection is derived from the live ladder rather than stored, so a
// refresh that drops a strike falls back instead of pointing at a dead row.

export function RyskOptionsCard() {
  const { catalog, loading, error } = useRyskChain();

  const [isPut, setIsPut] = useState(false);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [strike, setStrike] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [collateralIndex, setCollateralIndex] = useState(0);

  const tradeable = (catalog?.underlyings ?? []).filter(
    (u) => optionsFor(u, isPut).length > 0,
  );

  const active =
    tradeable.find((u) => u.symbol === symbol) ?? tradeable[0] ?? null;

  const expiries = active ? expiriesFor(active, isPut) : [];
  const activeExpiry =
    expiry !== null && expiries.includes(expiry) ? expiry : (expiries[0] ?? null);

  const ladder = active
    ? optionsFor(active, isPut).filter((o) => o.expiry === activeExpiry)
    : [];

  // Default to the nearest strike that a maker has actually quoted, so the
  // ticket below opens on something priced rather than on an empty row.
  const selected =
    ladder.find((o) => o.strike === strike) ??
    ladder.find((o) => o.bid !== null) ??
    ladder[0] ??
    null;

  const collateral =
    selected?.collaterals[collateralIndex] ?? selected?.collaterals[0] ?? null;

  const parsedQuantity = Number(quantity);
  const ticket =
    selected && collateral
      ? buildTicket(
          selected,
          collateral,
          Number.isFinite(parsedQuantity) && parsedQuantity > 0
            ? parsedQuantity
            : 1,
        )
      : null;

  const pickSide = (put: boolean) => {
    setIsPut(put);
    setExpiry(null);
    setStrike(null);
    setCollateralIndex(0);
  };

  return (
    <div className={`space-y-4 ${GLASS_SURFACE} p-5 lg:p-6`}>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Options
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-white">
            Sell volatility on what you hold
          </div>
        </div>
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aeras-warning">
          High risk
        </span>
      </div>

      <p className="text-xs text-white/50">
        Rysk lists European options on crypto majors, not on tokenized stocks.
        Writing one locks collateral until expiry and pays a premium up front. In
        exchange you give up the upside above a call strike, or agree to buy at a
        put strike.
      </p>

      <SideTabs isPut={isPut} onPick={pickSide} />

      {error && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-warning">
          {error}
        </p>
      )}

      {loading && !catalog ? (
        <p className="text-sm text-white/50">Loading the option chain...</p>
      ) : tradeable.length === 0 ? (
        <p className="rounded-xl border border-aeras-blue/30 bg-aeras-blue/15 px-4 py-3 text-sm text-white/60">
          Rysk lists no {isPut ? "put" : "call"} strikes right now.
        </p>
      ) : (
        active &&
        activeExpiry !== null && (
          <div className="space-y-4">
            <UnderlyingTabs
              underlyings={tradeable}
              active={active}
              onPick={(u) => {
                setSymbol(u.symbol);
                setExpiry(null);
                setStrike(null);
                setCollateralIndex(0);
              }}
            />

            <ExpiryTabs
              expiries={expiries}
              active={activeExpiry}
              daysFor={(ts) =>
                optionsFor(active, isPut).find((o) => o.expiry === ts)
                  ?.daysToExpiry ?? 0
              }
              onPick={(ts) => {
                setExpiry(ts);
                setStrike(null);
                setCollateralIndex(0);
              }}
            />

            <StrikeLadder
              ladder={ladder}
              selected={selected}
              onPick={(o) => {
                setStrike(o.strike);
                setCollateralIndex(0);
              }}
            />

            {ticket && (
              <Ticket
                ticket={ticket}
                quantity={quantity}
                onQuantity={setQuantity}
                collateralIndex={selected?.collaterals.indexOf(
                  ticket.collateral,
                )}
                onCollateral={setCollateralIndex}
              />
            )}
          </div>
        )
      )}

      <p className="text-[11px] text-white/50">
        Options settle physically on Ethereum and HyperEVM, not on Solana.
        Positions cannot be closed before expiry. Premium is shown at the best
        maker bid, which is what a seller receives, and moves between refreshes.
        Indicative APY is Rysk&apos;s own model and is quoted on a basis they do
        not publish, so it does not match the yield derived from the bid. Placing
        these trades is not enabled yet, so this panel is read only.
      </p>
    </div>
  );
}

function SideTabs({
  isPut,
  onPick,
}: {
  isPut: boolean;
  onPick: (isPut: boolean) => void;
}) {
  const options = [
    {
      put: false,
      label: "Covered call",
      hint: "Lock the asset, cap the upside",
    },
    {
      put: true,
      label: "Cash-secured put",
      hint: "Lock stables, agree to buy lower",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onPick(o.put)}
          className={`rounded-xl border px-3 py-2 text-left transition-colors ${
            isPut === o.put
              ? "border-aeras-blue bg-aeras-blue/10"
              : "border-white/10 bg-white/5 hover:border-white/20"
          }`}
        >
          <div className="text-sm font-medium tracking-tight text-white">
            {o.label}
          </div>
          <div className="mt-0.5 text-[11px] text-white/50">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}

function UnderlyingTabs({
  underlyings,
  active,
  onPick,
}: {
  underlyings: RyskUnderlying[];
  active: RyskUnderlying;
  onPick: (u: RyskUnderlying) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {underlyings.map((u) => (
        <button
          key={u.symbol}
          type="button"
          onClick={() => onPick(u)}
          className={`rounded-xl border px-3 py-2 text-left transition-colors ${
            u.symbol === active.symbol
              ? "border-aeras-blue bg-aeras-blue/10"
              : "border-white/10 bg-white/5 hover:border-white/20"
          }`}
        >
          <div className="text-[11px] font-medium text-white">{u.symbol}</div>
          <div className="font-mono text-[11px] tabular-nums text-white/50">
            {formatUsd(u.indexPrice)}
          </div>
        </button>
      ))}
    </div>
  );
}

function ExpiryTabs({
  expiries,
  active,
  daysFor,
  onPick,
}: {
  expiries: number[];
  active: number;
  daysFor: (ts: number) => number;
  onPick: (ts: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {expiries.map((ts) => {
        const days = daysFor(ts);
        return (
          <button
            key={ts}
            type="button"
            onClick={() => onPick(ts)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
              ts === active
                ? "border-aeras-blue bg-aeras-blue/10 text-white"
                : "border-white/10 bg-white/5 text-white/60 hover:border-white/20"
            }`}
          >
            {formatExpiry(ts).split(",")[0]}
            <span className="ml-1.5 tabular-nums text-white/40">
              {days < 1 ? "<1d" : `${Math.round(days)}d`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StrikeLadder({
  ladder,
  selected,
  onPick,
}: {
  ladder: RyskOption[];
  selected: RyskOption | null;
  onPick: (o: RyskOption) => void;
}) {
  return (
    <div className="divide-y divide-white/10">
      <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        <div className="col-span-3">Strike</div>
        <div className="col-span-2 text-right">Delta</div>
        <div className="col-span-3 text-right">Premium</div>
        <div className="col-span-4 text-right">Indicative APY</div>
      </div>

      {ladder.map((o) => {
        const isSelected = selected?.strike === o.strike;
        const away = (o.strike - o.indexPrice) / o.indexPrice;
        return (
          <button
            key={`${o.strike}-${o.expiry}`}
            type="button"
            onClick={() => onPick(o)}
            className={`grid w-full grid-cols-12 items-center gap-2 py-2 text-left transition-colors ${
              isSelected ? "bg-aeras-blue/10" : "hover:bg-white/5"
            }`}
          >
            <div className="col-span-3">
              <div className="font-mono text-sm tabular-nums text-white">
                {formatUsd(o.strike)}
              </div>
              <div className="font-mono text-[10px] tabular-nums text-white/40">
                {away >= 0 ? "+" : ""}
                {formatPercent(away, 1)}
              </div>
            </div>
            <div className="col-span-2 text-right font-mono text-xs tabular-nums text-white/60">
              {o.delta.toFixed(2)}
            </div>
            <div className="col-span-3 text-right font-mono text-sm tabular-nums text-white">
              {o.bid === null ? (
                <span className="text-white/30">No quote</span>
              ) : (
                formatUsd(o.bid)
              )}
            </div>
            <div className="col-span-4 text-right font-mono text-sm tabular-nums text-aeras-blue">
              {o.indicativeApy.toFixed(2)}%
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Ticket({
  ticket,
  quantity,
  onQuantity,
  collateralIndex,
  onCollateral,
}: {
  ticket: ReturnType<typeof buildTicket>;
  quantity: string;
  onQuantity: (v: string) => void;
  collateralIndex: number | undefined;
  onCollateral: (i: number) => void;
}) {
  const { option, collateral } = ticket;
  const outcome = assignmentSummary(ticket);
  const chain = RYSK_CHAIN_NAMES[collateral.chainId] ?? `Chain ${collateral.chainId}`;

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-white/50">
          Sell {option.underlying} {formatUsd(option.strike)}{" "}
          {option.isPut ? "put" : "call"}
        </div>
        <label className="flex items-center gap-2">
          <span className="text-[11px] text-white/50">Contracts</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={quantity}
            onChange={(e) => onQuantity(e.target.value)}
            className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-right font-mono text-sm tabular-nums text-white outline-none focus:border-aeras-blue"
          />
        </label>
      </div>

      {option.collaterals.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {option.collaterals.map((c, i) => (
            <button
              key={`${c.chainId}-${c.collateralAsset}`}
              type="button"
              onClick={() => onCollateral(i)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                i === collateralIndex
                  ? "border-aeras-blue bg-aeras-blue/10 text-white"
                  : "border-white/10 bg-white/5 text-white/60 hover:border-white/20"
              }`}
            >
              {c.collateralSymbol}
              <span className="ml-1.5 text-white/40">
                {RYSK_CHAIN_NAMES[c.chainId] ?? c.chainId}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat
          label="You lock"
          value={`${trimNumber(ticket.collateralAmount)} ${collateral.collateralSymbol}`}
          sub={chain}
        />
        <Stat
          label="You receive"
          value={
            ticket.premiumUsd === null ? "No quote" : formatUsd(ticket.premiumUsd)
          }
          sub={ticket.premiumUsd === null ? undefined : collateral.collateralSymbol}
        />
        <Stat
          label="Yield to expiry"
          value={
            ticket.periodYield === null ? "—" : formatPercent(ticket.periodYield)
          }
          sub={
            ticket.annualizedYield === null
              ? undefined
              : `${formatPercent(ticket.annualizedYield)} annualized from bid`
          }
        />
        <Stat
          label={option.isPut ? "Effective entry" : "Effective sale"}
          value={
            ticket.effectivePrice === null
              ? "—"
              : formatUsd(ticket.effectivePrice)
          }
          sub="if assigned"
        />
      </div>

      <div className="space-y-1 border-t border-white/10 pt-3 text-[11px] text-white/60">
        {ticket.premiumUsd === null && (
          <p className="text-white/40">
            No maker is quoting this strike right now, so the premium is unknown.
            Rysk prices by request, and the indicative APY above is their model
            rather than an offer.
          </p>
        )}
        <p>{outcome.ifAssigned}</p>
        <p>{outcome.ifNotAssigned}</p>
        <p className="text-white/40">
          Collateral is locked until {formatExpiry(option.expiry)} UTC.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-white">
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[10px] tabular-nums text-white/40">
          {sub}
        </div>
      )}
    </div>
  );
}
