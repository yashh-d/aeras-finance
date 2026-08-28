"use client";

// Adding margin to an Ondo account from whatever the user holds.
//
// One click, from the user's side: pick a source, press the button, approve one
// signature in the Privy Solana wallet. Everything between (provisioning the
// deposit address, pricing the route, checking it is not lossy, broadcasting,
// tracking settlement) happens without them handling an address or a chain.
//
// That is the whole design goal, and it is why the bridge is pointed straight
// at Ondo's deposit address rather than at the user's own EVM wallet. Delivering
// to their wallet would mean a second transfer on Ethereum mainnet from a wallet
// holding zero ETH, so it would need a gas top-up leg, a chain switch and a
// second signature. See lib/ondo/fund.ts for what that costs instead.

import { useCallback, useMemo, useState } from "react";

import { useEmbeddedSolanaWallet } from "@/lib/privy/solana";

import { useSendSolanaTxBase64 } from "@/lib/privy/sign";

import { uiToAtomic } from "@/lib/trustware/amounts";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import type { AccountBalances } from "@/lib/solana/balances";

import type { OndoCollateral } from "./collateral";
import {
  executeOndoFunding,
  planOndoFunding,
  ONDO_FUNDING_ENABLED,
  type OndoFundingPlan,
  type OndoFundingProgress,
} from "./fund";
import {
  bestMarginSource,
  marginSources,
  readyMarginUsd,
  type OndoMarginSource,
} from "./margin-sources";

export type MarginStatus =
  | { kind: "idle" }
  | { kind: "pricing" }
  // Priced and waiting on the user. The plan is shown before anything is
  // signed, because the fees and the haircut are the parts worth seeing first.
  | { kind: "ready"; plan: OndoFundingPlan }
  | { kind: "working"; message: string }
  // Bridged and delivered. Ondo credits it as margin separately, which is why
  // this is not called "done": the margin may not have moved yet.
  | { kind: "sent"; txHash: string }
  | { kind: "error"; message: string };

export interface UseOndoMargin {
  sources: OndoMarginSource[];
  // The one to offer by default: largest signable holding, USDC preferred.
  best: OndoMarginSource | undefined;
  // Value postable without touching anything off Solana.
  readyUsd: number;
  status: MarginStatus;
  // False while the funding path is switched off pending a live test deposit.
  enabled: boolean;
  price: (source: OndoMarginSource, amountUi: string) => Promise<void>;
  confirm: () => Promise<void>;
  reset: () => void;
}

export function useOndoMargin(params: {
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  scan: WalletScan;
  collateral: OndoCollateral[];
  // Called once the bridge reports delivery, so the surface can re-read the
  // margin balance rather than waiting for its own poll.
  onDelivered?: () => void;
}): UseOndoMargin {
  const { balances, prices, scan, collateral } = params;

  // The same base64 signer every Trustware conversion in the app goes through.
  // A Trustware Solana route arrives as a base64 payload rather than a built
  // transaction, so the generic send path is the right one here.
  const sendSolanaTx = useSendSolanaTxBase64();
  const { wallet: solanaWallet } = useEmbeddedSolanaWallet();
  const [status, setStatus] = useState<MarginStatus>({ kind: "idle" });

  const priceUsdByMint = useMemo(() => {
    const map: Record<string, number | undefined> = {};
    for (const x of XSTOCKS) map[x.mint] = prices?.[x.mint]?.usdPrice;
    return map;
  }, [prices]);

  const sources = useMemo(
    () =>
      marginSources({
        solanaUsdcAtomic: balances?.usdcAtomic ?? "0",
        xstocksAtomic: balances?.xstocksAtomic ?? {},
        priceUsdByMint,
        stables: scan.stables,
        held: scan.held,
        collateral,
      }),
    [balances, priceUsdByMint, scan.stables, scan.held, collateral],
  );

  // Pricing is separate from committing on purpose. The plan carries the bridge
  // fee, the delivered amount and what it credits after the haircut, and none
  // of those are knowable before Trustware quotes the route. Showing them after
  // the signature would be showing them too late.
  const price = useCallback(
    async (source: OndoMarginSource, amountUi: string) => {
      if (!solanaWallet?.address) {
        setStatus({ kind: "error", message: "No Solana wallet available to sign." });
        return;
      }
      if (!source.executable) {
        setStatus({
          kind: "error",
          message: `Funding from ${source.chainLabel} needs an on-chain approval Aeras does not sign yet. Move it to Solana, or use a Solana holding.`,
        });
        return;
      }

      setStatus({ kind: "pricing" });
      try {
        const amountAtomic = uiToAtomic(amountUi, source.decimals);
        if (BigInt(amountAtomic) <= 0n) {
          setStatus({ kind: "error", message: "Enter an amount above zero." });
          return;
        }

        const plan = await planOndoFunding({
          collateral: source.target,
          source: {
            chain: source.chain,
            token: source.token,
            decimals: source.decimals,
            symbol: source.symbol,
            amountAtomic,
            // The caller's own valuation, which the loss guard needs: Trustware
            // returned a null fromAmountUsd on every route measured.
            amountUsd:
              source.balanceUsd === null
                ? null
                : (source.balanceUsd * Number(amountAtomic)) /
                  Number(source.balanceAtomic),
            ownerAddress: solanaWallet.address,
          },
        });

        if (plan.kind === "blocked") {
          setStatus({ kind: "error", message: plan.reason });
          return;
        }
        // This surface prices a deposit the user types an amount into, so a
        // cost past the soft bound is shown as the reason rather than silently
        // accepted. The one-click path is where it becomes a confirm step.
        if (plan.kind === "needs-confirmation") {
          setStatus({ kind: "error", message: plan.reason });
          return;
        }
        setStatus({ kind: "ready", plan });
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [solanaWallet],
  );

  const confirm = useCallback(async () => {
    if (status.kind !== "ready" || !solanaWallet) return;

    setStatus({ kind: "working", message: "Preparing the deposit." });
    try {
      const { txHash } = await executeOndoFunding({
        plan: status.plan,
        solana: {
          address: solanaWallet.address,
          signAndSendBase64: sendSolanaTx,
        },
        onProgress: (progress: OndoFundingProgress) => {
          setStatus({ kind: "working", message: describe(progress) });
        },
      });

      setStatus({ kind: "sent", txHash });
      params.onDelivered?.();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [status, solanaWallet, sendSolanaTx, params]);

  return {
    sources,
    best: useMemo(() => bestMarginSource(sources), [sources]),
    readyUsd: useMemo(() => readyMarginUsd(sources), [sources]),
    status,
    enabled: ONDO_FUNDING_ENABLED,
    price,
    confirm,
    reset: useCallback(() => setStatus({ kind: "idle" }), []),
  };
}

function describe(progress: OndoFundingProgress): string {
  switch (progress.step) {
    case "routing":
      return "Building the route.";
    case "signing":
      return "Approve the transfer in your wallet.";
    case "broadcast":
      return "Sent. Waiting for the bridge to deliver.";
    case "settling":
      return "Bridging to Ethereum. This usually takes a few minutes.";
    case "delivered":
      return "Delivered to your Ondo deposit address.";
  }
}
