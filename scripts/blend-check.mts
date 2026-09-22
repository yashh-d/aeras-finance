// Live check for the Blend earn venue: what the `aeras-earn` account type
// exposes through the frontend SDK, before any of it is wired into the app.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/blend-check.mts
//
// Needs only the publishable key (NEXT_PUBLIC_BLEND_PUBLISHABLE_KEY). It
// signs and submits nothing on chain. It is not free of side effects, though:
// every frontend endpoint, discovery and yield included, answers 401
// AUTH_NOT_SIGNED_IN without a SIWE bearer (verified 2026-09-14, contrary to
// the SDK's DiscoverModule comment), and SIWE sign-in creates an account
// record for whichever address signs. So the script signs in with a throwaway
// key and leaves one junk user row behind in the portal each run.
//
// What it prints, in order: the deposit chains and Monad's deposit tokens
// (is our Monad USDC in the catalog), the withdrawal destinations (can the
// return leg home land on Monad), the yield rows per vault, the Safe's state
// on Monad, and a 1 USDC deposit quote from Monad USDC with where Blend
// would send it (originChainId vs destinationChainId), the fees, and the
// action plan's deployType. That last field is the gas question: "direct" is
// plain transactions from the EOA, which pays gas and so needs MON;
// "multisend" is a Safe UserOp the paymaster pays for.
//
// Findings are recorded in lib/blend/constants.ts and docs/blend.md as they
// are established.

import {
  BlendSdk,
  SdkError,
  depositQuoteToActionPlan,
  type ChainYieldBreakdown,
} from "@blend-money/fe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  BLEND_ACCOUNT_TYPE_ID,
  BLEND_API_BASE_URL,
  BLEND_APP_CHAIN_ID,
  BLEND_APP_USDC,
  blendPublishableKey,
} from "../lib/blend/constants";

function pct(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(2)}%`;
}

function describeError(err: unknown): string {
  if (err instanceof SdkError) {
    const body = err.response ? ` ${JSON.stringify(err.response)}` : "";
    return `${err.message} (status ${err.status}${err.code ? `, ${err.code}` : ""})${body}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// Each section settles on its own so one failing call does not hide the
// others; the summary at the end says what did not answer.
const failures: string[] = [];
async function section<T>(label: string, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (err) {
    const msg = describeError(err);
    failures.push(`${label}: ${msg}`);
    console.log(`${label}: FAILED ${msg}`);
    console.log();
    return null;
  }
}

async function main() {
  const publishableKey = blendPublishableKey();
  console.log(`account type   ${BLEND_ACCOUNT_TYPE_ID}`);
  console.log(`api            ${BLEND_API_BASE_URL}`);
  console.log(`app chain      ${BLEND_APP_CHAIN_ID} (Monad), USDC ${BLEND_APP_USDC.address}`);
  console.log();

  // A throwaway signer for the SIWE bearer. An empty paymaster registry is
  // enough because nothing here executes.
  const account = privateKeyToAccount(generatePrivateKey());
  const sdk = new BlendSdk({
    publishableKey,
    baseUrl: BLEND_API_BASE_URL,
    signMessage: (message) => account.signMessage({ message }),
    paymaster: {},
  });

  // ── Sign-in (creates an account row for the throwaway address) ──────────

  console.log(`signing in as throwaway ${account.address} on chain ${BLEND_APP_CHAIN_ID}`);
  const session = await sdk.signIn({
    address: account.address,
    chainId: BLEND_APP_CHAIN_ID,
  });
  console.log(`  accountId      ${session.accountId}`);
  console.log(`  safeAddress    ${session.safeAddress}`);
  console.log(`  chainsDeployed ${JSON.stringify(session.chainsDeployed)}`);
  console.log(`  expiresAt      ${session.expiresAt}`);
  console.log();

  // ── Discovery ───────────────────────────────────────────────────────────

  await section("deposit chains", async () => {
    const chains = await sdk.discover.depositChains();
    console.log(`deposit chains (${chains.length})`);
    for (const c of chains) {
      const mark = c.chainId === BLEND_APP_CHAIN_ID ? "  <- app chain" : "";
      console.log(`  ${String(c.chainId).padEnd(7)} ${c.displayName} (${c.name})${mark}`);
    }
    if (!chains.some((c) => c.chainId === BLEND_APP_CHAIN_ID)) {
      console.log("  !! Monad is not a deposit chain for this account type");
    }
    console.log();
  });

  await section("deposit tokens", async () => {
    // Signed in, this endpoint filters to the signer's own holdings, and an
    // empty `eoa` override to get the featured catalog instead is rejected
    // (400, "Invalid address format"). A throwaway holds nothing, so an
    // empty list here proves nothing either way; whether our Monad USDC is
    // accepted is what the deposit quote below tests.
    const tokens = await sdk.discover.depositTokens(BLEND_APP_CHAIN_ID);
    console.log(
      `deposit tokens on ${BLEND_APP_CHAIN_ID} held by the throwaway (${tokens.length}${tokens.length === 0 ? ", expected: it holds nothing" : ""})`,
    );
    for (const t of tokens) {
      const usdc =
        t.address.toLowerCase() === BLEND_APP_USDC.address.toLowerCase()
          ? "  <- our USDC"
          : "";
      console.log(
        `  ${t.symbol.padEnd(8)} ${t.address} dec=${t.decimals} price=${JSON.stringify(t.price)}${usdc}`,
      );
    }
    console.log();
  });

  await section("withdraw destinations", async () => {
    const destinations = await sdk.discover.withdrawDestinations();
    console.log(`withdraw destinations (${destinations.length})`);
    for (const d of destinations) {
      const mark = d.chainId === BLEND_APP_CHAIN_ID ? "  <- app chain" : "";
      console.log(`  ${String(d.chainId).padEnd(7)} ${d.name.padEnd(16)} loan token ${d.loanTokenAddress}${mark}`);
    }
    if (!destinations.some((d) => d.chainId === BLEND_APP_CHAIN_ID)) {
      console.log("  !! Monad is not a withdrawal destination; the return leg home would need another chain");
    }
    console.log();
  });

  // ── Yield ───────────────────────────────────────────────────────────────

  await section("yield", async () => {
    const y = await sdk.discover.yield();
    console.log(`yield for ${y.accountTypeId} (${y.yieldBreakdown.length} vault rows)`);
    printYield(y.yieldBreakdown);
    console.log();
  });

  // ── Safe ────────────────────────────────────────────────────────────────

  await section("safe", async () => {
    const safe = await sdk.account.safe.resolve(BLEND_APP_CHAIN_ID);
    console.log(`safe on ${BLEND_APP_CHAIN_ID}: ${JSON.stringify(safe)}`);
    console.log();
  });

  // ── Deposit quote (off-chain; the throwaway holds nothing) ──────────────

  await section("deposit quote", async () => {
    const amount = String(10n ** BigInt(BLEND_APP_USDC.decimals)); // 1 USDC
    const quote = await sdk.quoteDeposit({
      chainId: BLEND_APP_CHAIN_ID,
      tokenAddress: BLEND_APP_USDC.address,
      amount,
      forceReset: true,
    });
    console.log("deposit quote, 1 USDC from Monad");
    console.log(`  intentId           ${quote.intentId}`);
    console.log(`  originChainId      ${quote.originChainId}`);
    console.log(`  destinationChainId ${quote.destinationChainId}${quote.destinationChainId === quote.originChainId ? "  (stays on Monad)" : "  (BRIDGED)"}`);
    console.log(`  input              ${quote.input.amount} ${quote.input.symbol} ($${quote.input.amountUsd})`);
    console.log(`  output             ${quote.output.amount} ${quote.output.symbol} ($${quote.output.amountUsd})`);
    console.log(`  fees               $${quote.fees.totalUsd}`);
    console.log(`  estimatedSeconds   ${quote.estimatedSeconds}`);
    const ttlSeconds = Math.round((new Date(quote.expiresAt).getTime() - Date.now()) / 1000);
    console.log(`  expiresAt          ${quote.expiresAt} (in ${ttlSeconds}s)`);

    // The action plan is what execute() would submit. Its deployType is the
    // gas answer and the steps say what the EOA would sign. The quoted
    // session carries the plan; when it only carries the raw payload, the
    // SDK's own converter builds it.
    const raw = await sdk.sessions.get(quote.intentId);
    const plan =
      "actionPlan" in raw && raw.actionPlan
        ? raw.actionPlan
        : "payload" in raw && raw.payload && raw.type === "DEPOSIT"
          ? depositQuoteToActionPlan(raw.payload, account.address)
          : null;
    if (!plan) {
      console.log("  action plan        session carries no plan or payload");
    } else {
      console.log(`  action plan        deployType=${plan.deployType} chainId=${plan.chainId}`);
      console.log(`    approvals ${plan.requiredApprovals.length}, txns ${plan.requiredTxns.length}`);
      for (const t of [...plan.requiredApprovals, ...plan.requiredTxns]) {
        console.log(`    account=${t.account} to=${t.to} value=${t.value} delegate=${t.isDelegateCall ?? false} data=${t.data.slice(0, 10)}…`);
        // A direct deposit was one ERC-20 transfer(to, amount) on 2026-09-21.
        // Decode its recipient: the Safe's counterfactual address is where a
        // deposit is meant to land, so anything else is worth a look.
        if (t.data.startsWith("0xa9059cbb") && t.data.length >= 74) {
          const to = `0x${t.data.slice(34, 74)}`;
          const isSafe = to.toLowerCase() === session.safeAddress.toLowerCase();
          console.log(`    transfer to ${to}${isSafe ? "  (the Safe)" : "  !! not the Safe"}`);
        }
      }
    }
    await sdk.sessions.cancel(quote.intentId);
    console.log("  session cancelled");
    console.log();
  });

  // ── Withdraw quote (the throwaway holds nothing; the error shape is the
  // record) ───────────────────────────────────────────────────────────────

  await section("withdraw quote", async () => {
    const quote = await sdk.quoteWithdraw({
      destinationChainId: BLEND_APP_CHAIN_ID,
      amount: "0",
      isMaxWithdraw: true,
      forceReset: true,
    });
    console.log("withdraw quote, everything to Monad");
    console.log(`  intentId           ${quote.intentId}`);
    console.log(`  destinationChainId ${quote.destinationChainId}`);
    console.log(`  totalAmount        ${quote.totalAmount}`);
    console.log(`  totalFeesUsd       $${quote.totalFeesUsd}`);
    console.log(`  sourceChainIds     ${JSON.stringify(quote.sourceChainIds)}`);
    console.log(`  estimatedSeconds   ${quote.estimatedSeconds}`);
    await sdk.sessions.cancel(quote.intentId);
    console.log("  session cancelled");
    console.log();
  });

  await sdk.signOut();
  console.log("signed out. The throwaway account row remains in the portal's user list.");
  // An empty account cannot quote a withdrawal; that failure is expected and
  // its message is the record, so it does not fail the run.
  const unexpected = failures.filter((f) => !f.startsWith("withdraw quote:"));
  if (unexpected.length > 0) {
    console.log();
    console.log(`${unexpected.length} section(s) failed:`);
    for (const f of unexpected) console.log(`  ${f}`);
    process.exit(1);
  }
}

function printYield(rows: ChainYieldBreakdown[]) {
  for (const r of rows) {
    console.log(
      `  chain ${String(r.chainId).padEnd(7)} vault ${r.vaultAddress}`,
    );
    console.log(
      `    base ${pct(r.breakdown.base)}  positions [${r.breakdown.positions.map(pct).join(", ")}]`,
    );
    console.log(
      `    overall ${pct(r.summary.theoreticalOverall)}  boosted ${pct(r.summary.theoreticalBoosted)}  inVault ${pct(r.summary.pctInVault)}  deployed ${pct(r.summary.pctDeployed)}`,
    );
    console.log(
      `    held ${r.heldAssets.map((a) => `${a.symbol}@${a.chainId}`).join(", ") || "—"}`,
    );
  }
}

main().catch((err) => {
  console.error(describeError(err));
  process.exit(1);
});
