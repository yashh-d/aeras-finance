"use client";

// The public demo: the Terminal with no account behind it. It exists so a
// partner evaluating the product (TradingView's charts team, first) can see
// where the charts sit without a waitlist approval and an email sign-in.
//
// Nothing here is new. It is the same TerminalPanel the signed-in Terminal
// section mounts, fed the same live price hook, with no wallet: the ticket
// already handles a wallet that is still provisioning, so the tape, strip,
// chart, catalog and rail all draw and the ticket waits. No balances are
// read, no scan runs (useWalletScan with no address is a no-op), and no
// trigger token can be minted because there is nothing to sign with.

import Link from "next/link";

import { TerminalPanel } from "@/components/TerminalPanel";
import { useJupiterPrices } from "@/lib/jupiter/use-prices";
import { useTriggerAuth } from "@/lib/jupiter/use-trigger-auth";
import { useWalletScan } from "@/lib/trustware/use-wallet-scan";

export function DemoTerminal() {
  const { prices, error: pricesError } = useJupiterPrices();
  const scan = useWalletScan(undefined);
  const auth = useTriggerAuth(null);

  return (
    <div
      className="relative flex min-h-screen flex-col text-white lg:flex-row"
      data-app-canvas
      style={{ backgroundColor: "#08090a" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(58rem 38rem at 10% -12%, rgba(41,115,255,0.10), transparent 62%), radial-gradient(46rem 34rem at 94% 6%, rgba(87,146,255,0.055), transparent 60%)",
        }}
      />

      <aside className="relative border-b border-white/[0.08] bg-white/[0.035] text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-72 lg:flex-col lg:border-b-0 lg:border-r lg:p-7 xl:w-80">
        <div className="flex items-center justify-between p-6 lg:p-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/aeras-logo-white.png"
            alt="Aeras"
            className="h-24 w-auto -ml-3"
          />
          <Link
            href="/app"
            className="text-xs text-white/60 underline-offset-2 hover:text-white hover:underline lg:hidden"
          >
            Sign in
          </Link>
        </div>

        <div className="px-6 pb-6 lg:mt-8 lg:px-0 lg:pb-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Demo
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/60">
            The Terminal, read-only. Live prices, the chart with TradingView
            candles, company data and news for every asset in the catalog.
            Trading, borrowing and hedging need a signed-in account.
          </p>
        </div>

        <div className="hidden lg:mt-auto lg:flex lg:flex-col lg:gap-2 lg:border-t lg:border-white/10 lg:pt-5">
          <Link
            href="/app"
            className="self-start text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
          >
            Sign in
          </Link>
          <Link
            href="/"
            className="self-start text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
          >
            About Aeras
          </Link>
        </div>
      </aside>

      <main className="relative flex-1 px-6 py-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl space-y-6">
          <TerminalPanel
            prices={prices}
            pricesError={pricesError}
            balances={null}
            scan={scan}
            walletAddress={null}
            auth={auth}
            onRefresh={() => {}}
          />
        </div>
      </main>
    </div>
  );
}
