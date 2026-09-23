// Live check for the borrow-limit inputs and the arithmetic over them.
//
//   npx tsx scripts/borrow-limit-check.mts
//   npx tsx scripts/borrow-limit-check.mts <solana-wallet-address>
//
// Read-only. It signs nothing and broadcasts nothing.
//
// Two jobs.
//
// First, drift. Both venues publish their own risk parameters, and both are
// also snapshotted in our registries (lib/kamino/reserves.ts
// maxLtvSnapshot/liquidationThreshold, lib/jupiter/borrow.ts
// collateralFactor/liquidationThreshold). The snapshots are the fallback for a
// market that has not been read yet; nothing should size a borrow against them.
// This prints live against snapshot and fails on any difference, so a parameter
// change at either venue is something we find here rather than in a user's
// failed transaction. Every value matched on 2026-09-22.
//
// Second, the arithmetic. lib/borrow/limit.ts is unit tested against figures
// worked by hand; this runs it against whatever the venues are publishing right
// now, and, given a wallet, against that wallet's real Kamino obligation, where
// Kamino's own reported LTV is an independent answer to compare with.
//
// What it established on 2026-09-22:
//   - Kamino's /reserves/metrics carries maxLtv per reserve. The proxy at
//     app/api/kamino/reserves/metrics was dropping the field, which is why the
//     cards were sizing borrows from a July snapshot.
//   - Jupiter's /borrow/vaults carries collateralFactor, liquidationThreshold,
//     minimumBorrowing, and SEPARATE oraclePriceOperate and
//     oraclePriceLiquidate. Borrows and withdrawals are marked at operate.
//     Every xStock vault had the two equal, which is exactly what makes
//     reading the wrong one survive review.
//   - Jupiter's minimumBorrowing was ~$1.02 on the xStock vaults. A draw below
//     it reverts.

import {
  atomicToNumber,
  availableToBorrowAtomic,
  borrowLimitAtomic,
  ltvBpsFromDecimal,
  ltvBpsFromPerMille,
  parseScaled,
  priceFromDecimal,
  priceFromJupiterOracle,
  type CollateralInput,
} from "../lib/borrow/limit.ts";
import {
  KAMINO_USDC_BORROW,
  KAMINO_XSTOCKS_MARKET,
  KAMINO_XSTOCK_COLLATERALS,
} from "../lib/kamino/reserves.ts";
import { XSTOCK_BORROW_VAULTS } from "../lib/jupiter/borrow.ts";

const KAMINO_METRICS = `https://api.kamino.finance/kamino-market/${KAMINO_XSTOCKS_MARKET}/reserves/metrics`;
const KAMINO_OBLIGATIONS = (wallet: string) =>
  `https://api.kamino.finance/v2/users/${wallet}/markets/${KAMINO_XSTOCKS_MARKET}/obligations`;
const JUPITER_VAULTS = "https://lite-api.jup.ag/lend/v1/borrow/vaults";

const UA = { "user-agent": "aeras-finance/0.1" };

let failures = 0;
function fail(message: string) {
  failures += 1;
  console.error(`  FAIL  ${message}`);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

// ── Kamino ─────────────────────────────────────────────────────────────────

interface KaminoMetric {
  reserve: string;
  liquidityToken?: string;
  maxLtv?: string;
}

async function checkKamino(): Promise<Map<string, string>> {
  console.log("\nKamino xStocks Market — live maxLtv vs registry snapshot");
  const raw = await getJson<KaminoMetric[]>(KAMINO_METRICS);
  const byReserve = new Map(raw.map((r) => [r.reserve, r]));
  const live = new Map<string, string>();

  for (const c of KAMINO_XSTOCK_COLLATERALS) {
    const metric = byReserve.get(c.reserve);
    if (!metric) {
      fail(`${c.symbol}: reserve missing from the metrics payload`);
      continue;
    }
    if (metric.maxLtv == null) {
      fail(`${c.symbol}: payload carries no maxLtv`);
      continue;
    }
    live.set(c.reserve, metric.maxLtv);
    const liveBps = ltvBpsFromDecimal(metric.maxLtv);
    const snapshotBps = ltvBpsFromDecimal(String(c.maxLtvSnapshot));
    const mark = liveBps === snapshotBps ? "ok" : "DRIFT";
    console.log(
      `  ${c.symbol.padEnd(8)} live ${metric.maxLtv.padEnd(6)} snapshot ${String(
        c.maxLtvSnapshot,
      ).padEnd(6)} ${mark}`,
    );
    if (liveBps !== snapshotBps) {
      fail(
        `${c.symbol}: maxLtv drifted (live ${metric.maxLtv}, snapshot ${c.maxLtvSnapshot}). ` +
          `Update lib/kamino/reserves.ts.`,
      );
    }
  }
  return live;
}

// ── Jupiter ────────────────────────────────────────────────────────────────

interface JupiterVault {
  id: number;
  oraclePrice: string;
  oraclePriceOperate?: string;
  oraclePriceLiquidate?: string;
  collateralFactor?: string;
  liquidationThreshold?: string;
  minimumBorrowing?: string;
  borrowable?: string;
}

async function checkJupiter(): Promise<void> {
  console.log("\nJupiter Lend — live risk parameters vs registry snapshot");
  const raw = await getJson<JupiterVault[]>(JUPITER_VAULTS);
  const byId = new Map(raw.map((v) => [v.id, v]));

  for (const vault of XSTOCK_BORROW_VAULTS) {
    const v = byId.get(vault.vaultId);
    if (!v) {
      fail(`${vault.collateralSymbol}: vault ${vault.vaultId} missing upstream`);
      continue;
    }
    if (v.collateralFactor == null || v.liquidationThreshold == null) {
      fail(`${vault.collateralSymbol}: payload carries no risk parameters`);
      continue;
    }
    const cf = Number(v.collateralFactor);
    const lt = Number(v.liquidationThreshold);
    const drift =
      cf !== vault.collateralFactor || lt !== vault.liquidationThreshold;
    const operate = v.oraclePriceOperate ?? v.oraclePrice;
    const liquidate = v.oraclePriceLiquidate ?? v.oraclePrice;
    const split = operate !== liquidate ? "  operate != liquidate" : "";
    const minBorrow = v.minimumBorrowing
      ? atomicToNumber(BigInt(v.minimumBorrowing), vault.borrowDecimals)
      : 0;
    console.log(
      `  ${vault.collateralSymbol.padEnd(8)} CF ${String(cf).padEnd(4)}(${String(
        vault.collateralFactor,
      ).padEnd(4)}) LT ${String(lt).padEnd(4)}(${String(
        vault.liquidationThreshold,
      ).padEnd(4)}) min $${minBorrow.toFixed(2)} ${
        drift ? "DRIFT" : "ok"
      }${split}`,
    );
    if (drift) {
      fail(
        `${vault.collateralSymbol}: risk parameters drifted (live CF ${cf} LT ${lt}, ` +
          `registry CF ${vault.collateralFactor} LT ${vault.liquidationThreshold}). ` +
          `Update lib/jupiter/borrow.ts.`,
      );
    }

    // The arithmetic, against this vault's live mark: one whole token of
    // collateral, nothing owed.
    const pool: CollateralInput = {
      atomic: parseScaled("1", vault.collateralDecimals),
      decimals: vault.collateralDecimals,
      priceScaled: priceFromJupiterOracle(operate),
      ltvBps: ltvBpsFromPerMille(cf),
    };
    const limit = borrowLimitAtomic(pool, vault.borrowDecimals);
    // Independent check in floating point. It is allowed to disagree in the
    // last atomic unit, because limit.ts floors and this does not.
    const expected =
      (Number(operate) / 1e15) * (cf / 1000) * 10 ** vault.borrowDecimals;
    const deltaAtomic = Math.abs(Number(limit) - expected);
    if (deltaAtomic > 1) {
      fail(
        `${vault.collateralSymbol}: limit.ts says ${limit} atomic for 1 token, ` +
          `float says ${expected.toFixed(0)}`,
      );
    }
    console.log(
      `           1 ${vault.collateralSymbol} supports $${atomicToNumber(
        limit,
        vault.borrowDecimals,
      ).toFixed(vault.borrowDecimals)}`,
    );
  }
}

// ── A real obligation, when a wallet is given ──────────────────────────────

interface Obligation {
  obligationAddress?: string;
  loanToValue?: string;
  liquidationLtv?: string;
  totalDepositUsd?: string;
  totalBorrowUsd?: string;
  deposits?: { reserve: string; depositedAmount: string }[];
}

async function checkObligation(
  wallet: string,
  liveLtv: Map<string, string>,
): Promise<void> {
  console.log(`\nKamino obligation for ${wallet}`);
  const obligations = await getJson<Obligation[]>(KAMINO_OBLIGATIONS(wallet));
  const open = obligations.filter((o) => (o.deposits?.length ?? 0) > 0);
  if (open.length === 0) {
    console.log("  no open obligation in this market — nothing to compare");
    return;
  }

  for (const o of open) {
    const deposit = o.deposits?.find((d) =>
      KAMINO_XSTOCK_COLLATERALS.some((c) => c.reserve === d.reserve),
    );
    if (!deposit) {
      console.log("  obligation holds no curated collateral — skipping");
      continue;
    }
    const collateral = KAMINO_XSTOCK_COLLATERALS.find(
      (c) => c.reserve === deposit.reserve,
    )!;
    const maxLtv = liveLtv.get(collateral.reserve);
    if (maxLtv == null) {
      fail(`${collateral.symbol}: no live maxLtv to size against`);
      continue;
    }

    const collateralUi = atomicToNumber(
      BigInt(deposit.depositedAmount),
      collateral.decimals,
    );
    const depositUsd = Number(o.totalDepositUsd ?? 0);
    const borrowUsd = Number(o.totalBorrowUsd ?? 0);
    // The obligation reports USD totals, so this is the venue's own mark.
    const priceUsd = collateralUi > 0 ? depositUsd / collateralUi : 0;

    const borrowDecimals = KAMINO_USDC_BORROW.decimals;
    const available = availableToBorrowAtomic({
      pools: [
        {
          atomic: BigInt(deposit.depositedAmount),
          decimals: collateral.decimals,
          priceScaled: priceFromDecimal(priceUsd.toFixed(15)),
          ltvBps: ltvBpsFromDecimal(maxLtv),
        },
      ],
      borrowDecimals,
      debtAtomic: parseScaled(borrowUsd.toFixed(borrowDecimals), borrowDecimals),
    });

    console.log(`  collateral      ${collateralUi} ${collateral.symbol}`);
    console.log(`  posted value    $${depositUsd.toFixed(2)}`);
    console.log(`  owed            $${borrowUsd.toFixed(2)}`);
    console.log(`  max LTV (live)  ${maxLtv}`);
    console.log(
      `  borrow limit    $${(depositUsd * Number(maxLtv)).toFixed(2)}`,
    );
    console.log(
      `  still drawable  $${atomicToNumber(available, borrowDecimals).toFixed(2)}`,
    );

    // Kamino reports the position's own LTV. Ours must agree with it, which is
    // the check that matters: it is the venue's answer, not ours.
    if (o.loanToValue != null && depositUsd > 0) {
      const theirs = Number(o.loanToValue) * 100;
      const ours = (borrowUsd / depositUsd) * 100;
      const delta = Math.abs(theirs - ours);
      console.log(
        `  LTV  ours ${ours.toFixed(4)}%  Kamino ${theirs.toFixed(4)}%  delta ${delta.toFixed(6)}pp`,
      );
      // A hundredth of a percentage point. Anything larger is a real
      // disagreement about the position rather than rounding in the payload.
      if (delta > 0.01) {
        fail(
          `LTV disagrees with Kamino by ${delta.toFixed(4)} percentage points`,
        );
      }
    }

    // The double count, checked against this position: counting the posted
    // collateral a second time is exactly what the card was doing.
    const doubled = availableToBorrowAtomic({
      pools: [
        {
          atomic: BigInt(deposit.depositedAmount) * 2n,
          decimals: collateral.decimals,
          priceScaled: priceFromDecimal(priceUsd.toFixed(15)),
          ltvBps: ltvBpsFromDecimal(maxLtv),
        },
      ],
      borrowDecimals,
      debtAtomic: parseScaled(borrowUsd.toFixed(borrowDecimals), borrowDecimals),
    });
    console.log(
      `  (what the double count would have offered: $${atomicToNumber(
        doubled,
        borrowDecimals,
      ).toFixed(2)})`,
    );
  }
}

async function main() {
  const wallet = process.argv[2];
  const liveLtv = await checkKamino();
  await checkJupiter();
  if (wallet) {
    await checkObligation(wallet, liveLtv);
  } else {
    console.log(
      "\n(pass a Solana wallet address to also check a live obligation)",
    );
  }

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
