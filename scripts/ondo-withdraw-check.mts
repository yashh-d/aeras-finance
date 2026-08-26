// Ondo Perps withdrawal-path verification.
//
//   npx tsx scripts/ondo-withdraw-check.mts
//
// Runs against production with a burner keypair generated here and discarded at
// exit. The burner holds nothing, so the withdrawal it attempts is rejected.
// That rejection is the point, and the same trick ondo-execution-check.mts uses
// for orders: a named refusal proves Ondo's validator accepted the payload
// shape, the network value and the destination and got as far as checking the
// balance. A schema error would come back as a different code.
//
// Nothing is signed with a real wallet and no funds can move. The one call this
// deliberately does NOT make with a real signature is the address-book
// completion: registering a payout address is exactly the action that should
// never happen from a script.
//
// The three facts this exists to keep honest, all of which cost real money if
// they drift:
//
//   1. Every asset Ondo credits is Ethereum-only, so every withdrawal lands on
//      Ethereum. If a Solana network ever appears in the token config, the
//      "bridge home" leg stops being necessary and this check should fail so
//      someone notices.
//   2. The address-book SIWE challenge accepts EVM chain ids only. If Ondo adds
//      a Solana value, the same applies.
//   3. Ondo answers a named business error for a withdrawal it cannot fund,
//      which is what proves the payload shape and network parsed.
//
// **This script creates an account. Do not loop it.**
//
// Ondo began answering `forbidden_country` on `get_challenge` after three runs
// in quick succession on 2026-08-26, and it had not cleared 20 minutes later.
// It refuses any address, new or already registered, and it reaches the app as
// well as this script, because the SIWE call is proxied server-side and carries
// the machine's IP: local sign-in stops working entirely. Unauthenticated reads
// keep working, so sections 1 and 5 below still pass while everything after
// section 2 cannot run.
//
// If this script dies at section 2, that is the likely cause and it is not a
// regression in the code under test.

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { creditableCollateral } from "../lib/ondo/collateral";
import { ONDO_API_BASE_URL, ONDO_ENV } from "../lib/ondo/constants";
import { buildCatalog, collateralAssets } from "../lib/ondo/markets";
import { liveCollateralHealth } from "../lib/ondo/risk";
import {
  OndoApiError,
  ondoAccount,
  ondoAddressBook,
  ondoAddressBookChallenge,
  ondoBalance,
  ondoCompleteChallenge,
  ondoContracts,
  ondoDeposits,
  ondoGetChallenge,
  ondoMarkets,
  ondoPositions,
  ondoWithdraw,
  ondoWithdrawalLimits,
  ondoWithdrawals,
} from "../lib/ondo/server";
import type { OndoBalance, OndoPosition } from "../lib/ondo/types";
import {
  ONDO_ADDRESS_BOOK_CHAIN_ID,
  ONDO_WITHDRAWAL_NETWORK,
  buildWithdrawalView,
  describeWithdrawalError,
  ledgerQuantities,
  planWithdrawal,
  trimPrecision,
  withdrawableTokens,
} from "../lib/ondo/withdraw";

let failures = 0;
let skipped = 0;

// A zeroed margin account, so every pure-logic section below can run without a
// session. Each case overrides only the fields it is about, which also makes
// what each one actually depends on visible at the call site.
const BASE_BALANCE: OndoBalance = {
  walletBalance: "0",
  realizedPnl: "0",
  unrealizedPnl: "0",
  marginBalance: "0",
  usedMargin: "0",
  availableMargin: "0",
  withdrawableMargin: "0",
  maintenanceMarginRequirement: "0",
  totalMaintenanceMargin: "0",
  marginRatio: "0",
  leverage: "0",
  underLiquidation: false,
  totalFundingPayments: "0",
  totalTradingFees: "0",
  totalPnL: "0",
};

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  pass  ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

function skip(label: string, why: string) {
  skipped += 1;
  console.log(`  SKIP  ${label}  (${why})`);
}

function note(label: string, value: string) {
  console.log(`        ${label}: ${value}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  console.log(`Ondo Perps withdrawal check  (${ONDO_ENV} -> ${ONDO_API_BASE_URL})`);

  // ---------------------------------------------------------------------------
  // Unauthenticated and pure-logic sections run FIRST, on purpose.
  //
  // Ondo can refuse `get_challenge` at the IP level with `forbidden_country`
  // (see the header), and when it does, everything needing a session dies. The
  // assertions that actually guard the two ways this module can silently hand a
  // user the wrong balance do not need a session, so they must not be downstream
  // of one. Ordering is a feature here, not tidiness.
  // ---------------------------------------------------------------------------

  section("1. Withdrawals land on Ethereum, and only Ethereum");

  const markets = await ondoMarkets();
  const contracts = await ondoContracts();
  const collateral = creditableCollateral(
    collateralAssets(markets),
    buildCatalog(markets, contracts),
  );

  check("the token config carries collateral", collateral.length > 0, `${collateral.length} assets`);

  // The premise of the whole exit design. Assets come back on the chain they
  // went out on, and nothing Ondo credits has a Solana path, so a withdrawal
  // cannot deliver to the user's Solana wallet however much we would like it to.
  const networksBySymbol = new Map(
    markets.tokenConfig.map((t) => [t.id, Object.keys(t.networks)]),
  );
  const withSolana = [...networksBySymbol.entries()].filter(([, n]) =>
    n.includes("solana"),
  );
  check(
    "no collateral asset has a Solana network",
    withSolana.length === 0,
    withSolana.length > 0
      ? `${withSolana.map(([s]) => s).join(", ")} now list Solana: the bridge-home leg may be unnecessary`
      : "every asset is Ethereum-only, so the exit lands on Ethereum",
  );
  check(
    "our withdrawal network matches the token config",
    [...networksBySymbol.values()].every((n) => n.includes(ONDO_WITHDRAWAL_NETWORK)),
    ONDO_WITHDRAWAL_NETWORK,
  );

  section("2. Deposits say `confirmed`; withdrawals say `complete`");

  // The two endpoints use different status vocabularies and share no success
  // word. Filtering deposit history on "complete" drops every row, and since
  // held quantity is reconstructed from that history, the result is a user with
  // collateral being told they have nothing to withdraw. Silent and total.
  const confirmedOnly = ledgerQuantities(
    [{ coin: "SPYon", size: "1.0", status: "confirmed" }],
    [],
  );
  check(
    "a `confirmed` deposit counts",
    confirmedOnly.get("SPYon") === 1,
    "Ondo's deposit enum is pending | confirmed, with no `complete`",
  );

  const ledger = ledgerQuantities(
    [
      { coin: "SPCXon", size: "0.2", status: "confirmed" },
      { coin: "SPCXon", size: "0.5", status: "pending" },
      { coin: "SPYon", size: "1.0", status: "confirmed" },
    ],
    [
      {
        coin: "SPCXon",
        size: "0.05",
        status: "pending",
        address: "0x0",
        withdrawal_id: "w1",
        txid: "",
        customer_withdrawal_id: "c1",
        time: "",
      },
      {
        coin: "SPYon",
        size: "0.4",
        status: "cancelled",
        address: "0x0",
        withdrawal_id: "w2",
        txid: "",
        customer_withdrawal_id: "c2",
        time: "",
      },
    ],
  );
  check(
    "a pending deposit does not count as balance",
    Math.abs((ledger.get("SPCXon") ?? 0) - 0.15) < 1e-9,
    `0.2 confirmed - 0.05 pending withdrawal = ${ledger.get("SPCXon")}`,
  );
  check(
    "a pending withdrawal is deducted, a cancelled one is not",
    Math.abs((ledger.get("SPYon") ?? 0) - 1.0) < 1e-9,
    `cancelled withdrawal released: ${ledger.get("SPYon")}`,
  );

  section("3. The haircut does not reduce what you own");

  // The single most valuable assertion here. Ondo's published formula is
  // `min(Margin Balance - Used Margin, Wallet Balance)`, and `walletBalance` is
  // the USDC balance, so an account holding only tokenized collateral has a
  // withdrawableMargin of zero. Reading that as a token cap would tell a user
  // with no positions and no debt that they can withdraw nothing, which is the
  // exact opposite of what Ondo's docs say happens.
  const spcx = collateral.find((c) => c.symbol === "SPCXon");
  const usdc = collateral.find((c) => c.symbol === "USDC");

  if (spcx && usdc) {
    const clean = withdrawableTokens({
      symbol: "SPCXon",
      heldTokens: 0.136373,
      collateral: spcx,
      balance: BASE_BALANCE,
      positions: [],
    });
    check(
      "with no positions and no debt, the full token balance is withdrawable",
      Math.abs(clean.quantity - 0.136373) < 1e-12,
      `withdrawableMargin 0 but ${clean.quantity} SPCXon offered`,
    );

    // With a position open the margin cap does bind, converted at the
    // post-haircut price exactly as Ondo documents.
    const mark = Number(spcx.markPriceUsd);
    const capped = withdrawableTokens({
      symbol: "SPCXon",
      heldTokens: 0.136373,
      collateral: spcx,
      balance: { ...BASE_BALANCE, withdrawableMargin: String(mark * 0.9 * 0.05) },
      positions: [
        { market: "SPCX-USD.P", direction: "short", netQuantity: "0.1" } as OndoPosition,
      ],
    });
    check(
      "an open position caps the withdrawal at the post-haircut token amount",
      Math.abs(capped.quantity - 0.05) < 1e-6 && capped.limitedBy === "margin",
      `${capped.quantity.toFixed(6)} SPCXon, limited by ${capped.limitedBy}`,
    );

    // USDC debt is the other binding case, and it reads differently: a negative
    // USDC balance blocks USDC withdrawals outright.
    const inDebt = withdrawableTokens({
      symbol: "USDC",
      heldTokens: 100,
      collateral: usdc,
      balance: { ...BASE_BALANCE, withdrawableMargin: "50", walletBalance: "-20" },
      positions: [],
    });
    check(
      "USDC debt blocks a USDC withdrawal",
      inDebt.quantity === 0 && inDebt.limitedBy === "debt",
    );
  } else {
    check("SPCXon and USDC are still listed as collateral", false, "missing from the token config");
  }

  section("4. An assumed haircut never caps a real balance");

  // The regression this exists to prevent, using real live numbers: 0.136373
  // SPCXon marking near $138 credited $14.13 of margin, which is a haircut of
  // about 25%, not the 10% lib/ondo/collateral.ts assumes for an asset Ondo has
  // not published one for.
  //
  // Dividing the credited value by the ASSUMED haircut derives 0.1137 SPCXon.
  // If that figure were allowed to cap the ledger, the card would offer 0.1137
  // and silently withhold 17% of the balance. It must not.
  {
    const balance: OndoBalance = {
      ...BASE_BALANCE,
      marginBalance: "14.13",
    };
    const spcxView = buildWithdrawalView({
      ownAddress: "0x0000000000000000000000000000000000000001",
      collateral,
      deposits: [{ coin: "SPCXon", size: "0.136373", status: "confirmed" }],
      withdrawals: [],
      positions: [],
      balance,
      health: liveCollateralHealth(balance),
      addressBook: ["0x0000000000000000000000000000000000000001"],
      cooldownPeriodSecs: 0,
      withdrawalFeeUsd: 1,
      limits: null,
    });

    const h = spcxView.holdings.find((x) => x.symbol === "SPCXon");
    check("the SPCXon holding is built", h !== undefined);
    if (h) {
      check(
        "an inferred haircut is not trusted as a cap",
        !h.marginQuantityTrusted && !h.haircutDocumented,
        "SPCXon's haircut is assumed, not published",
      );
      check(
        "the full ledger balance survives the cross-check",
        Math.abs(h.quantity - 0.136373) < 1e-9,
        `${h.quantity} offered, not the ${h.marginQuantity?.toFixed(6)} the assumed haircut derives`,
      );
      check(
        "the withdrawable amount is the full balance",
        Math.abs(h.withdrawableQuantity - 0.136373) < 1e-9,
      );
      check(
        "the real haircut is measured and reported",
        h.impliedHaircut !== null && h.impliedHaircut > 0.15,
        h.impliedHaircut === null
          ? "not computed"
          : `Ondo haircuts SPCXon ${(h.impliedHaircut * 100).toFixed(1)}%, Aeras assumes ${(h.assumedHaircut * 100).toFixed(0)}%`,
      );
    }

    // The counterpart: where the haircut IS published, the derived figure is
    // sound and must cap, because that is what catches auto-exchange having
    // sold collateral with no ledger record.
    const spyBalance: OndoBalance = { ...BASE_BALANCE, marginBalance: "45" };
    const spyView = buildWithdrawalView({
      ownAddress: "0x0000000000000000000000000000000000000001",
      collateral,
      deposits: [{ coin: "SPYon", size: "1.0", status: "confirmed" }],
      withdrawals: [],
      positions: [],
      balance: spyBalance,
      health: liveCollateralHealth(spyBalance),
      addressBook: [],
      cooldownPeriodSecs: 0,
      withdrawalFeeUsd: 1,
      limits: null,
    });
    const spyHolding = spyView.holdings.find((x) => x.symbol === "SPYon");
    check(
      "a documented haircut IS trusted, so auto-exchange shrinkage is caught",
      spyHolding !== undefined &&
        spyHolding.marginQuantityTrusted &&
        spyHolding.quantity < 1.0,
      spyHolding
        ? `$45 of credited margin implies ${spyHolding.quantity.toFixed(4)} SPYon, below the 1.0 the ledger claims`
        : "SPYon holding missing",
    );
  }

  section("5. Precision");

  check(
    "an amount is trimmed down, never rounded up",
    trimPrecision("0.1363739999999", 6) === "0.136373",
    trimPrecision("0.1363739999999", 6),
  );
  check("a short amount is left alone", trimPrecision("0.5", 18) === "0.5");

  check(
    "an unregistered address is refused before anything is sent",
    (() => {
      const v = buildWithdrawalView({
        ownAddress: "0x0000000000000000000000000000000000000001",
        collateral,
        deposits: [{ coin: "SPCXon", size: "0.1", status: "confirmed" }],
        withdrawals: [],
        positions: [],
        balance: BASE_BALANCE,
        health: liveCollateralHealth(BASE_BALANCE),
        addressBook: [],
        cooldownPeriodSecs: 0,
        withdrawalFeeUsd: 1,
        limits: null,
      });
      return (
        !v.ownAddressRegistered &&
        planWithdrawal({ view: v, symbol: "SPCXon", amount: "0.01", customerWithdrawalId: "x" })
          .kind === "blocked"
      );
    })(),
  );

  // ---------------------------------------------------------------------------
  // Everything below needs a session. Ondo can refuse to issue one at the IP
  // level, so a failure here is reported as a skip rather than taking the run
  // down: the sections above are the ones that guard the logic, and they have
  // already run.
  // ---------------------------------------------------------------------------

  section("6. Live session, address book and a real refusal");

  const burner = privateKeyToAccount(generatePrivateKey());
  note("burner address", burner.address);

  let token: string;
  try {
    const challenge = await ondoGetChallenge(burner.address);
    const signature = await burner.signMessage({ message: challenge.message });
    token = (await ondoCompleteChallenge(challenge.id, signature)).token;
    check("a burner gets a session with no invite code", Boolean(token));

    const book = await ondoAddressBook(token);
    check(
      "a fresh account has an empty address book",
      (book.addressBook ?? []).length === 0,
      "so registration really is a precondition, not a formality",
    );

    // The challenge is minted but never completed. Completing it would register
    // a real payout address on a real account, which a check script has no
    // business doing even for a burner.
    const bookChallenge = await ondoAddressBookChallenge(token, {
      walletAddress: burner.address,
      chainId: ONDO_ADDRESS_BOOK_CHAIN_ID,
      withdrawalAddress: burner.address,
    });
    check(
      "the address-book challenge is issued and is a distinct flow from login",
      Boolean(bookChallenge.message) && bookChallenge.id !== challenge.id,
    );
    check(
      "the challenge message names the address being authorised",
      bookChallenge.message.toLowerCase().includes(burner.address.toLowerCase()),
      "so a user can read what they are signing",
    );

    // The other half of "the exit lands on Ethereum". Even if a Solana deposit
    // path appeared, this enum would have to change too.
    let solanaChainRejected = false;
    try {
      await ondoAddressBookChallenge(token, {
        walletAddress: burner.address,
        chainId: "solana-mainnet-beta",
        withdrawalAddress: burner.address,
      });
    } catch (err) {
      solanaChainRejected = err instanceof OndoApiError;
    }
    check(
      "the address-book challenge refuses a non-EVM chain id",
      solanaChainRejected,
      "Ondo's enum is 1 | 43114",
    );

    const account = await ondoAccount(token);
    note("withdrawal fee (USD)", account.withdrawalFeeUSD);
    note(
      "address cooldown",
      account.cooldownPeriodSecs === undefined
        ? "field absent"
        : `${account.cooldownPeriodSecs}s`,
    );
    check(
      "the account exposes a withdrawal fee",
      account.withdrawalFeeUSD !== undefined,
      "surfaced on the confirm step rather than discovered after",
    );

    const limits = await ondoWithdrawalLimits(token).catch(() => null);
    check(
      "withdrawal limits are readable",
      limits !== null,
      limits ? `${limits.currentWithdrawalsUsd} of ${limits.withdrawalLimitUsd}` : "unavailable",
    );

    // No per-asset balance endpoint exists anywhere in the API. If one ever
    // appears, the reconstruction in lib/ondo/withdraw.ts should be deleted in
    // favour of it.
    const deposits = await ondoDeposits(token).catch(() => []);
    const withdrawals = await ondoWithdrawals(token).catch(() => []);
    await ondoBalance(token);
    await ondoPositions(token);
    check(
      "the burner's ledgers are empty",
      deposits.length === 0 && withdrawals.length === 0,
    );

    // Ondo's own refusal, which is the one that matters. A named code proves
    // the payload shape, the network and the address all parsed.
    let code: string | undefined;
    let message = "";
    try {
      await ondoWithdraw(token, {
        customer_withdrawal_id: `aeras-check-${burner.address.slice(2, 10)}`,
        symbol: "SPCXon",
        network: ONDO_WITHDRAWAL_NETWORK,
        amount: "0.001",
        address: burner.address,
      });
    } catch (err) {
      if (err instanceof OndoApiError) {
        code = err.code;
        message = err.message;
      }
    }
    note("Ondo's refusal code", code ?? "none");
    check(
      "Ondo rejects a withdrawal rather than accepting one it cannot fund",
      code !== undefined,
      message.slice(0, 90),
    );
    // Measured 2026-08-26: the answer is `withdrawal_exceeds_chain_deposits`,
    // which is NOT in Ondo's published error enum. Two things follow. The set
    // of codes we map is open, not closed, so describeWithdrawalError must
    // always fall through to something. And the deposit check runs BEFORE the
    // address book check, so `withdrawal_address_not_found` is only reachable
    // on an account that has actually deposited.
    check(
      "the refusal is a named business error, not a schema error",
      code === "withdrawal_exceeds_chain_deposits" ||
        code === "withdrawal_address_not_found" ||
        code === "bad_withdrawal_address" ||
        code === "withdrawal_error_insufficient_balance" ||
        code === "insufficient_funds",
      `${code}: the payload shape, network and address all parsed`,
    );
    check(
      "we turn that code into something a user can act on",
      describeWithdrawalError(code, "raw") !== "raw",
      describeWithdrawalError(code, "raw").slice(0, 70),
    );
  } catch (err) {
    const code = err instanceof OndoApiError ? err.code : undefined;
    if (code === "forbidden_country") {
      skip(
        "the whole live-session section",
        "Ondo is refusing get_challenge from this IP. Not a code regression: see the header. Local Ondo sign-in is down too.",
      );
    } else {
      failures += 1;
      console.log(`  FAIL  live-session section threw  (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  const parts = [
    failures === 0 ? "All checks passed." : `${failures} check${failures === 1 ? "" : "s"} failed.`,
    skipped > 0 ? `${skipped} section${skipped === 1 ? "" : "s"} skipped.` : "",
  ].filter(Boolean);
  console.log(`\n${parts.join(" ")}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
