"use client";

// One-click borrow-funded hedge.
//
// Take a stock the user already holds, borrow against it, and short the same
// stock with the proceeds. The holding pays for its own hedge and the user adds
// no new money. They sign twice on Solana (the borrow, then the bridge) and once
// with a gasless personal_sign for Lighter's trading key. They never hold gas on
// an EVM chain and never switch networks.
//
// Five steps, each of which already existed alone. What is new here is the
// sequencing, and above all the failure handling between steps, because the
// steps are not equally reversible:
//
//   1. plan      size the hedge and pick the funding road
//   2. borrow    deposit collateral and draw USDC, one Solana transaction
//   3. fund      deliver that USDC to Lighter's deposit address
//   4. credit    wait for Lighter to actually credit it as margin
//   5. hedge     open the short
//
// Step 2 creates debt. Step 3 is the point of no return: the USDC leaves the
// wallet for an address the user cannot sign for. Everything between step 2 and
// step 5 is a state where the user is MORE exposed than when they started, not
// less: they hold the full stock position and now owe money against it, with
// nothing offsetting either. That window is the real risk in this flow and it is
// why every outcome below names exactly what exists and what does not.
//
// Nothing is retried automatically past the borrow. A failure after money has
// moved is something a user must see and choose about, not something a loop
// should hammer at a live exchange.

import BN from "bn.js";

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import type { EIP1193Provider } from "@privy-io/react-auth";

import {
  buildOperateTx,
  findExistingNftId,
  positionNftStorageKey,
  readStoredNftId,
  type XStockBorrowVault,
} from "@/lib/jupiter/borrow";
import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { awaitTokenBalance } from "@/lib/solana/await-balance";
import { getConnection } from "@/lib/solana/balances";

import { fetchLighterAccountState } from "./client";
import { buildLighterDepositTransaction } from "./deposit";
import {
  destinationShapeMatches,
  FUNDING_ROUTES,
  type FundingRoute,
} from "./borrow-funding";
import type { BorrowHedgePlanOk } from "./borrow-hedge";
import { placeHedge, type HedgeOrderOutcome } from "./order";
import type { LighterMarket } from "./types";

export type OneClickStep =
  | "borrowing"
  | "funding"
  | "crediting"
  | "hedging";

export interface OneClickProgress {
  step: OneClickStep;
  message: string;
  txHash?: string;
}

// What exists when the run ends. Each variant names the debt, the money and the
// hedge separately, because the recovery differs and guessing wrong is
// expensive: retrying a fund that already succeeded double-spends, and retrying
// a borrow that already succeeded doubles the debt.
export type OneClickOutcome =
  // Everything worked.
  | {
      kind: "hedged";
      // Absent on a resume run, where the borrow happened in an earlier run.
      borrowTx?: string;
      fundTx: string;
      order: HedgeOrderOutcome;
    }
  // Debt exists, USDC is in the user's own wallet, nothing has been bridged.
  // Safe to retry funding. Must NOT retry the borrow.
  | {
      kind: "borrowed-not-funded";
      borrowTx?: string;
      usdcInWallet: number;
      message: string;
    }
  // USDC has left for Lighter and has not been credited yet. The deposit is in
  // flight, not lost. Retrying the hedge later is correct; retrying the funding
  // would send a second deposit.
  | {
      kind: "funded-not-credited";
      borrowTx?: string;
      fundTx: string;
      message: string;
    }
  // Margin is credited at Lighter and the order did not go on. The user has a
  // funded trading account and an unhedged holding. Placing the order by hand is
  // the right move, which is why this is not retried here.
  | {
      kind: "credited-not-hedged";
      borrowTx?: string;
      fundTx: string;
      order: HedgeOrderOutcome;
      message: string;
    }
  // Nothing happened. No debt, no transfer, no order.
  | { kind: "blocked"; message: string };

export interface SolanaSigner {
  address: string;
  // Signs and submits a base64 transaction, returning the signature.
  signAndSendBase64: (base64Tx: string) => Promise<string>;
  // Signs and submits raw transaction bytes, returning the signature.
  signAndSendBytes: (tx: Uint8Array) => Promise<string>;
}

// How long to wait for Lighter to credit a deposit before reporting it as in
// flight rather than failed.
//
// The road's own estimate plus a wide margin. Reporting "still arriving" is
// always honest here: the money is at an address Lighter controls and derives
// from the user's L1 address, so it is attributable and it is not lost. What
// would not be honest is calling it an error.
function creditTimeoutMs(route: FundingRoute): number {
  return Math.max(route.latencyMinutesEstimate * 2, 10) * 60_000;
}

const CREDIT_POLL_MS = 15_000;

export interface OneClickArgs {
  plan: BorrowHedgePlanOk;
  market: LighterMarket;
  route: FundingRoute;
  // Jupiter Lend vault to borrow from. Kamino routes are not wired here yet: its
  // borrow builder takes a different shape and the first slice deliberately
  // carries one venue rather than two half-tested ones.
  vault: XStockBorrowVault;
  // Existing position NFT, or 0 to create one in the same transaction.
  positionId: number;
  // Collateral to post, in tokens. Usually the whole holding being hedged.
  collateralAmount: string;
  solana: SolanaSigner;
  // For Lighter's trading key. A personal_sign, never a transaction, so this
  // wallet needs no gas and no chain switch.
  evmProvider: EIP1193Provider;
  l1Address: string;
  // Lighter's SOLANA deposit address, fetched from Lighter and never
  // caller-supplied. This is the terminal fallback every run must be able to
  // pay, so it is required even when a bridge road is preferred.
  solanaDepositAddress: string;
  // Fetches Lighter's deposit address for one bridge chain, from Lighter's own
  // API. Per chain, because the Base intent address is not the Arbitrum one and
  // paying one chain's address on another delivers money to an address Lighter
  // is not watching there. Absent means the bridge roads are simply skipped.
  fetchBridgeDepositAddress?: (
    chain: "arbitrum" | "base",
  ) => Promise<string>;
  onProgress?: (progress: OneClickProgress) => void;
  // Fired the instant the borrow transaction is signed, before any waiting or
  // funding. The surface uses it to register the new vault collateral
  // synchronously; inferring the same moment from progress-step labels fired
  // it ninety seconds late, after the row had already unmounted.
  onBorrowed?: () => void;
  signal?: AbortSignal;
}

export async function runOneClickHedge(
  args: OneClickArgs,
): Promise<OneClickOutcome> {
  const { plan, market, vault, solana } = args;
  const report = (step: OneClickStep, message: string, txHash?: string) =>
    args.onProgress?.({ step, message, txHash });

  // Guards first, while nothing has happened and aborting is free. The Solana
  // road is the terminal fallback every run must be able to pay, so its address
  // is checked before any debt exists rather than discovered broken after.
  if (
    !destinationShapeMatches(
      FUNDING_ROUTES.find((r) => r.id === "solana-cctp")!,
      args.solanaDepositAddress,
    )
  ) {
    return {
      kind: "blocked",
      message:
        "Lighter's Solana deposit address has the wrong shape. Funding is " +
        "paused rather than borrowing against a road that cannot be paid.",
    };
  }

  // ── 2. Borrow ─────────────────────────────────────────────────────────────
  //
  // Collateral in and debt out in a single operate call, so a user who is
  // interrupted mid-flow never ends up with posted collateral and no loan.

  report("borrowing", `Depositing ${plan.xstockSymbol} and drawing USDC.`);

  const connection = getConnection();
  const usdcBefore = await readUsdcAtomic(solana.address);

  let borrowTx: string;
  try {
    // The stored position NFT first, then the on-chain scan. Passing 0 when a
    // position already exists on this vault asks the program to mint a second
    // one, which is exactly the wrong thing on a vault that is one position per
    // wallet, and the scan catches a stored binding lost to a cleared browser.
    const storedId =
      args.positionId ||
      readStoredNftId(solana.address, vault.vaultId) ||
      (await findExistingNftId(solana.address, vault, connection)) ||
      0;

    // Reserve a 1-unit cushion on the collateral, mirroring the Borrow panel.
    // The program scales 8-dec collateral to 9-dec internally and converts back
    // when wiring the TransferChecked, so depositing a wallet's entire balance
    // can ask for 1 atomic unit more than it holds and fail simulation by a
    // hair. A hedge posts the whole holding by design, so without this the flow
    // fails for everyone who is not holding dust above their position.
    const colRaw = toAtomic(args.collateralAmount, vault.collateralDecimals);
    const colAtomic = colRaw.gtn(1) ? colRaw.subn(1) : colRaw;

    const built = await buildOperateTx({
      vaultId: vault.vaultId,
      positionId: storedId,
      collateralDeltaAtomic: colAtomic,
      debtDeltaAtomic: toAtomic(String(plan.borrowedUsd), vault.borrowDecimals),
      signerAddress: solana.address,
      connection,
    });

    // Persist the position binding BEFORE broadcasting. The id is known at
    // build time, a binding for a transaction that never lands is harmless
    // (the position simply reads empty), and everything that later needs to
    // SEE the position reads this stored id: the vault-collateral hook that
    // keeps the hedge row alive, the resume card, and the next run's lookup.
    // Persisting after confirmation left a window where a landed borrow was
    // invisible to the entire UI.
    const boundId = built.nftId ?? storedId;
    if (boundId) {
      try {
        localStorage.setItem(
          positionNftStorageKey(solana.address, vault.vaultId),
          String(boundId),
        );
      } catch {
        // Storage can be unavailable (private mode). The scan-based recovery
        // in the Borrow tab still finds the position later.
      }
    }

    try {
      borrowTx = await solana.signAndSendBase64(built.base64Tx);
    } catch (err) {
      // A throw here is ambiguous: a rejected signature means nothing moved,
      // but a confirmation failure can arrive after the transaction was
      // broadcast. Saying "nothing happened" for the second case told a user
      // with a live position that they had none, so the message sends them to
      // look rather than asserting either way.
      return {
        kind: "blocked",
        message:
          `The borrow did not confirm: ${readableError(err)} ` +
          "Check the Borrow tab before trying again. If a position shows " +
          "there, the borrow landed and running this again would borrow twice.",
      };
    }

    // The borrow is signed. Tell the surface immediately, before any waiting:
    // the wallet poll can zero the holding within seconds, and the row must
    // already know the collateral moved to the vault or it unmounts the very
    // component running this flow.
    args.onBorrowed?.();
  } catch (err) {
    // Building failed. Nothing was signed, nothing moved.
    return { kind: "blocked", message: readableError(err) };
  }

  report("borrowing", "Waiting for the borrowed USDC to land.", borrowTx);

  // The borrow is confirmed by the balance, not by the signature. A landed
  // transaction whose proceeds are not readable yet would otherwise size a
  // transfer the wallet cannot cover.
  const target = usdcBefore + toAtomicBigInt(plan.borrowedUsd, USDC_DECIMALS);
  // programId matters here and its omission was a production bug: USDC is
  // classic SPL, and awaitTokenBalance's default derives the Token-2022
  // associated account, which does not exist for USDC. Every poll threw, the
  // wait ran its full 90 seconds on every single run, and the flow blamed RPC
  // congestion. The 60-second balance poll always landed inside that window,
  // unmounted the row, and the run carried on invisibly, which is how deposits
  // kept completing with no UI to show for them.
  const afterBorrow = await awaitTokenBalance({
    mint: USDC_MINT,
    owner: solana.address,
    atLeastAtomic: target.toString(),
    programId: TOKEN_PROGRAM_ID,
    timeoutMs: 90_000,
    signal: args.signal,
  }).catch(() => null);

  if (afterBorrow == null || BigInt(afterBorrow) < target) {
    // The read could not confirm the proceeds, which is not the same as the
    // proceeds not existing. A rate-limited RPC returns 429s for every read in
    // this window, and an earlier version of this flow treated that as failure
    // and stopped, leaving a user whose borrow HAD landed holding open debt
    // for no reason. Proceed: if the USDC genuinely is not there, the transfer
    // itself fails at simulation before anything moves, which lands in the
    // same borrowed-not-funded state, but only when it is actually true.
    report(
      "funding",
      "The balance read could not confirm the borrow (RPC congestion). " +
        "Continuing; the transfer verifies the funds itself.",
    );
  }

  // ── 3 through 5 ───────────────────────────────────────────────────────────

  return runFundAndHedge({
    plan,
    market,
    route: args.route,
    hedgeQuantity: args.collateralAmount,
    solana,
    evmProvider: args.evmProvider,
    l1Address: args.l1Address,
    solanaDepositAddress: args.solanaDepositAddress,
    fetchBridgeDepositAddress: args.fetchBridgeDepositAddress,
    borrowTx,
    onProgress: args.onProgress,
    signal: args.signal,
  });
}

// The legs of the flow that run AFTER money has been borrowed: deliver USDC to
// Lighter, wait for the credit, open the short. Split out and exported because
// it is also the RESUME path: a run that borrowed and then stalled (an RPC
// outage, a closed tab, a bridge refusal in an older version of this code)
// leaves collateral in the vault and the borrowed USDC in the wallet, and the
// way out is these steps and only these steps. Re-running the whole flow from
// the top would borrow a second time.
export interface FundAndHedgeArgs {
  plan: BorrowHedgePlanOk;
  market: LighterMarket;
  route: FundingRoute;
  // Tokens of exposure the short offsets. On a fresh run this is the collateral
  // just posted; on a resume it is the collateral already sitting in the vault.
  hedgeQuantity: string;
  solana: SolanaSigner;
  evmProvider: EIP1193Provider;
  l1Address: string;
  solanaDepositAddress: string;
  fetchBridgeDepositAddress?: (chain: "arbitrum" | "base") => Promise<string>;
  // The borrow transaction of the run being resumed, when known. Reporting only.
  borrowTx?: string;
  onProgress?: (progress: OneClickProgress) => void;
  signal?: AbortSignal;
}

export async function runFundAndHedge(
  args: FundAndHedgeArgs,
): Promise<OneClickOutcome> {
  const { plan, market, solana, borrowTx } = args;
  const report = (step: OneClickStep, message: string, txHash?: string) =>
    args.onProgress?.({ step, message, txHash });

  // ── 3. Fund ───────────────────────────────────────────────────────────────
  //
  // Point of no return, and the step that must not be able to strand the user.
  //
  // Whether a bridge road can be signed is a live price auction that moves
  // minute to minute, so it is asked at PAY TIME, once, and the transaction
  // that answer validates is the one that gets signed. The first version of
  // this flow asked before the borrow and again here; the auction flipped in
  // between, the second ask came back unsignable, and a live user was left
  // holding open debt with no hedge. Each bridge road is tried with its own
  // chain's deposit address, a refusal costs nothing, and the Solana road is
  // the floor: slower, but a plain SPL transfer that has no auction to lose.

  let road = args.route;
  let fundTx: string | undefined;
  let bridgeSigned = false;

  try {
    if (road.deliversOn !== "solana" && args.fetchBridgeDepositAddress) {
      const { prepareSolanaBridge, finishSolanaBridge } = await import(
        "./borrow-bridge"
      );
      const bridges = [
        road,
        ...FUNDING_ROUTES.filter(
          (r) =>
            r.probeBeforeUse && r.id !== road.id && r.deliversOn !== "solana",
        ),
      ];

      for (const candidate of bridges) {
        if (candidate.deliversOn === "solana") continue;
        report("funding", `Asking ${candidate.label} for a route.`);
        let prepared;
        try {
          // Each candidate pays its own chain's address, freshly fetched.
          // Reusing another chain's intent address here would deliver real
          // money to an address Lighter is not watching on that chain.
          const address = await args.fetchBridgeDepositAddress(
            candidate.deliversOn,
          );
          prepared = await prepareSolanaBridge({
            route: candidate,
            amountUsdc: plan.marginUsd,
            fromAddress: solana.address,
            toAddress: address,
            signal: args.signal,
          });
        } catch (err) {
          // Nothing signed, nothing lost. The next road gets its chance.
          console.info(`[one-click] ${candidate.label} declined:`, err);
          continue;
        }

        report("funding", `Sending margin to Lighter via ${candidate.label}.`);
        // From here a throw means a transaction reached the signer, and its
        // fate is unknown until checked. It must surface, never fall through
        // to another road, which could pay the same margin twice.
        bridgeSigned = true;
        fundTx = await finishSolanaBridge({
          prepared,
          signAndSendBase64: solana.signAndSendBase64,
          signal: args.signal,
        });
        road = candidate;
        break;
      }
    }

    if (fundTx == null) {
      // Every bridge declined before signing, or none was offered. The Solana
      // road always accepts; it is only slower.
      const cctp = FUNDING_ROUTES.find((r) => r.id === "solana-cctp")!;
      if (road.deliversOn !== "solana") {
        report(
          "funding",
          `No bridge will take this transfer right now. Using ${cctp.label}, ` +
            `which takes about ${cctp.latencyMinutesEstimate} minutes.`,
        );
      } else {
        report("funding", `Sending margin to Lighter via ${cctp.label}.`);
      }
      road = cctp;
      const built = await buildLighterDepositTransaction({
        sender: solana.address,
        intentAddress: args.solanaDepositAddress,
        amountUsdc: String(plan.marginUsd),
      });
      bridgeSigned = true;
      fundTx = await solana.signAndSendBytes(built.transaction);
    }
  } catch (err) {
    return {
      kind: "borrowed-not-funded",
      borrowTx,
      usdcInWallet: Number(await readUsdcAtomic(solana.address)) / 1e6,
      message: bridgeSigned
        ? `The transfer was signed and its result is unclear: ${readableError(err)} ` +
          "Check your USDC balance before doing anything else. If it left the wallet, " +
          "the deposit is on its way and must not be sent again."
        : `The borrow succeeded and the transfer did not: ${readableError(err)} ` +
          "The USDC is in your wallet and the debt is open. Retrying sends the same " +
          "USDC again, which is safe. Do not borrow a second time.",
    };
  }

  // ── 4. Credit ─────────────────────────────────────────────────────────────

  report("crediting", "Waiting for Lighter to credit the margin.", fundTx);

  const credited = await awaitLighterCredit({
    l1Address: args.l1Address,
    atLeastUsd: plan.marginUsd * 0.9,
    timeoutMs: creditTimeoutMs(road),
    signal: args.signal,
  });

  if (!credited) {
    return {
      kind: "funded-not-credited",
      borrowTx,
      fundTx,
      message:
        `The deposit is on its way and has not been credited yet. ${road.label} ` +
        `usually takes about ${road.latencyMinutesEstimate} minutes. Your holding is ` +
        "not hedged until it lands, and the short can be opened from the hedge tab once it is. " +
        "Do not send the deposit again.",
    };
  }

  // ── 5. Hedge ──────────────────────────────────────────────────────────────

  report("hedging", `Opening the ${market.symbol} short.`);

  const order = await placeHedge({
    provider: args.evmProvider,
    l1Address: args.l1Address,
    market,
    quantity: args.hedgeQuantity,
    tokenPriceUsd: String(plan.exposureUsd / Number(args.hedgeQuantity)),
    hedgeRatio: plan.coverage,
  }).catch((err): HedgeOrderOutcome => ({
    kind: "not-ready",
    reason: readableError(err),
  }));

  if (order.kind !== "submitted") {
    return {
      kind: "credited-not-hedged",
      borrowTx,
      fundTx,
      order,
      message:
        "Your margin is funded at Lighter and the short did not open. " +
        "The holding is unhedged and the debt is live. Open the short from the hedge tab.",
    };
  }

  return { kind: "hedged", borrowTx, fundTx, order };
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function readUsdcAtomic(owner: string): Promise<bigint> {
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const { PublicKey } = await import("@solana/web3.js");
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    new PublicKey(owner),
  );
  const balance = await getConnection()
    .getTokenAccountBalance(ata)
    .catch(() => null);
  return BigInt(balance?.value.amount ?? "0");
}

function toAtomic(amount: string, decimals: number): BN {
  return new BN(toAtomicBigInt(Number(amount), decimals).toString());
}

// Floors rather than rounds. A borrow rounded up is a borrow the collateral may
// not support, and a collateral amount rounded up is one the wallet may not hold.
function toAtomicBigInt(amount: number, decimals: number): bigint {
  return BigInt(Math.floor(amount * 10 ** decimals));
}

// Poll Lighter until the account shows the margin, or give up and let the caller
// report it as in flight.
async function awaitLighterCredit(args: {
  l1Address: string;
  atLeastUsd: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() < deadline) {
    if (args.signal?.aborted) return false;
    const state = await fetchLighterAccountState(args.l1Address).catch(
      () => null,
    );
    const collateral = Number(state?.detail?.collateralUsd ?? 0);
    if (collateral >= args.atLeastUsd) return true;
    await sleep(CREDIT_POLL_MS, args.signal);
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function readableError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // RPC and SDK errors are not user-facing text. Surface something a person can
  // act on and keep the raw string in the console for us.
  console.error("[one-click hedge]", err);
  return message.length > 200 ? "The transaction could not be completed." : message;
}
