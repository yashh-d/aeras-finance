"use client";

// One-click repay from the account headline. Both venues accept a partial
// repayment, so this is an amount picker rather than a close button: a partial
// repay brings the debt down and leaves the collateral deposited, available to
// draw against again without a second deposit. Taking the amount to the full
// debt closes the position outright: the collateral comes back to the wallet
// in the same flow, atomically on Jupiter, and as a second transaction on
// Kamino, which has no combined repay-and-withdraw.
//
// The repay funds itself across chains: when the Solana wallet is short, the
// gap is converted from the user's Monad USDC through Trustware
// (lib/morpho/fund.ts's return leg) before the repay transaction runs, the
// same way an earn deposit funds itself in the other direction.

import { useState } from "react";

import { useFundWallet } from "@privy-io/react-auth/solana";

import { SOLSCAN_TX_BASE } from "@/lib/jupiter/constants";
import {
  buildOperateTx,
  getMaxSentinels,
  toAtomicBN,
} from "@/lib/jupiter/borrow";
import {
  buildKaminoPartialRepayTx,
  buildKaminoRepayTx,
  buildKaminoWithdrawTx,
} from "@/lib/kamino/positions";
import { fundRepayUsdc, repayFundingSources } from "@/lib/borrow/fund-repay";
import { useMonadBalances } from "@/lib/morpho/use-monad-balances";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64, useSignSolanaTxBase64 } from "@/lib/privy/sign";
import { getConnection } from "@/lib/solana/balances";
import { SolanaSendError, sendAndConfirm } from "@/lib/solana/send-confirm";
import type { OpenBorrowPosition } from "@/lib/borrow/use-borrow-summary";

type RepayState =
  | { kind: "idle" }
  | { kind: "submitting"; message?: string }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string };

export function RepayPanel({
  positions,
  walletUsdc,
  solanaUsdcAtomic,
  sol,
  solPriceUsd,
  walletAddress,
  onSettled,
  onClose,
}: {
  positions: OpenBorrowPosition[];
  walletUsdc: number;
  // Exact atomic USDC balance, so the cross-chain shortfall is sized against
  // the real figure rather than a display float.
  solanaUsdcAtomic: string;
  // SOL balance and price: spare SOL swaps into USDC as a repay source.
  sol: number;
  solPriceUsd: number | null;
  walletAddress: string;
  onSettled: () => Promise<void> | void;
  onClose: () => void;
}) {
  // With a single open position there is nothing to choose, so the picker is
  // skipped and the amount step is what opens.
  const [picked, setPicked] = useState<OpenBorrowPosition | null>(
    positions.length === 1 ? positions[0] : null,
  );
  // Prefer the freshly-read copy so the debt figure tracks a partial repay, but
  // fall back to the picked one. A repay that clears the debt drops the
  // position from the summary, and unmounting the form at that moment would
  // take the confirmation with it.
  const selected =
    positions.find((p) => p.key === picked?.key) ?? picked ?? null;

  if (!selected) {
    return (
      <PanelShell title="Repay a loan" onClose={onClose}>
        {positions.length === 0 ? (
          <p className="text-xs text-white/50">
            You have no outstanding loans to repay.
          </p>
        ) : (
        <div className="space-y-2">
          {positions.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPicked(p)}
              className="flex w-full items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left transition-colors hover:border-white/25 hover:bg-white/10"
            >
              <span>
                <span className="block text-sm font-medium tracking-tight text-white">
                  {p.collateralSymbol}
                </span>
                <span className="block text-[11px] text-white/50">
                  {p.venueLabel}
                </span>
              </span>
              <span className="font-mono text-sm tabular-nums text-white">
                {p.debtUi.toFixed(2)} {p.debtSymbol}
              </span>
            </button>
          ))}
        </div>
        )}
      </PanelShell>
    );
  }

  return (
    <RepayForm
      key={selected.key}
      position={selected}
      walletUsdc={walletUsdc}
      solanaUsdcAtomic={solanaUsdcAtomic}
      sol={sol}
      solPriceUsd={solPriceUsd}
      walletAddress={walletAddress}
      onSettled={onSettled}
      onClose={onClose}
      onBack={positions.length > 1 ? () => setPicked(null) : undefined}
    />
  );
}

function RepayForm({
  position,
  walletUsdc,
  solanaUsdcAtomic,
  sol,
  solPriceUsd,
  walletAddress,
  onSettled,
  onClose,
  onBack,
}: {
  position: OpenBorrowPosition;
  walletUsdc: number;
  solanaUsdcAtomic: string;
  sol: number;
  solPriceUsd: number | null;
  walletAddress: string;
  onSettled: () => Promise<void> | void;
  onClose: () => void;
  onBack: (() => void) | undefined;
}) {
  const signTxBase64 = useSignSolanaTxBase64();
  // Sign-and-broadcast, for the funding legs (SOL swap, Trustware receipt).
  const sendSolanaTx = useSendSolanaTxBase64();
  const evm = useEmbeddedEvmWallet();
  const monad = useMonadBalances(evm.address);
  // Privy's Solana funding flow, offered inline when even both wallets cannot
  // cover the debt. Refreshing on exit lets the ceiling grow to whatever
  // arrived without closing the panel.
  const { fundWallet } = useFundWallet({
    onUserExited: () => {
      void onSettled();
    },
  });
  const [fundError, setFundError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  // Set when the user takes the amount all the way to the debt. A full payoff
  // cannot name an exact number, since interest accrues every slot, so each
  // venue gets its own max path instead of the typed figure.
  const [payoffAll, setPayoffAll] = useState(false);
  const [state, setState] = useState<RepayState>({ kind: "idle" });

  const amount = Number(input) || 0;
  const debtUi = position.debtUi;
  // Everything a repay can draw on: Solana USDC directly, spare SOL swapped,
  // and Monad USDC bridged home. Sources read as zero until their balance
  // lands, so the ceiling can only grow, never overpromise.
  const monadUsdcAtomic = monad.balances?.usdcAtomic ?? "0";
  const sources = repayFundingSources({
    solanaUsdc: walletUsdc,
    sol,
    solPriceUsd,
    monadUsdcAtomic,
  });
  const combinedUsdc = sources.total;
  const maxRepayable = Math.min(debtUi, combinedUsdc);
  const overWallet = amount > combinedUsdc + 1e-9;
  const overDebt = amount > debtUi + 1e-9;
  // The part the Solana USDC cannot cover, funded on submit. Monad
  // contributes first (it holds the bulk), SOL swaps for the remainder —
  // mirroring lib/borrow/fund-repay.ts so the copy matches what runs.
  const shortfallUi = Math.max(0, amount - walletUsdc);
  const fromMonadUi = Math.min(shortfallUi, sources.fromMonad);
  const fromSolUi = Math.max(0, shortfallUi - fromMonadUi);
  const needsFunding = shortfallUi > 1e-9 && !overWallet;
  const submitting = state.kind === "submitting";
  const disabled = submitting || amount <= 0 || overWallet || overDebt;
  // A full payoff has to cover interest accrued between this read and the
  // signature, so it needs a little more in the wallet than the figure shown.
  const shortForPayoff = payoffAll && combinedUsdc < debtUi * 1.001;

  function reset() {
    if (state.kind !== "idle") setState({ kind: "idle" });
  }

  function setAmount(next: number, atMax: boolean) {
    setInput(next > 0 ? next.toFixed(2) : "");
    setPayoffAll(atMax);
    reset();
  }

  async function handleSubmit() {
    setState({ kind: "submitting" });
    try {
      // Bring the Solana wallet up to the repay amount first when part of it
      // sits on Monad. A full payoff targets a small margin over the shown
      // debt so the interest accrued while the bridge settles is covered.
      const walletAtLeastAtomic = BigInt(
        Math.ceil((payoffAll ? debtUi * 1.002 : amount) * 1e6),
      );
      if (walletAtLeastAtomic > BigInt(solanaUsdcAtomic || "0")) {
        await fundRepayUsdc({
          walletAtLeastAtomic,
          solanaUsdcAtomic,
          sol,
          solPriceUsd,
          monadUsdcAtomic,
          monBalanceAtomic: monad.balances?.monAtomic ?? "0",
          evm: evm.address
            ? {
                address: evm.address,
                switchChain: evm.switchChain,
                getProvider: evm.getProvider,
              }
            : undefined,
          solana: { address: walletAddress, signAndSendBase64: sendSolanaTx },
          onProgress: (p) =>
            setState({ kind: "submitting", message: p.message }),
        });
      }

      setState({ kind: "submitting", message: "Signing and submitting…" });
      const connection = getConnection();
      let base64Tx: string;

      if (position.ref.venue === "jupiter") {
        const { vault, nftId } = position.ref;
        // Negative debt delta repays. The sentinel clears the balance exactly,
        // including interest accrued in the meantime. A full payoff also passes
        // the withdraw sentinel, so the collateral returns to the wallet in the
        // same transaction instead of staying deposited with no loan behind it.
        const sentinels = payoffAll ? await getMaxSentinels() : null;
        ({ base64Tx } = await buildOperateTx({
          vaultId: vault.vaultId,
          positionId: nftId,
          collateralDeltaAtomic: sentinels
            ? sentinels.maxWithdraw
            : toAtomicBN(0, vault.collateralDecimals),
          debtDeltaAtomic: sentinels
            ? sentinels.maxRepay
            : toAtomicBN(amount, vault.borrowDecimals).neg(),
          signerAddress: walletAddress,
          connection,
        }));
      } else if (payoffAll) {
        // Kamino has no atomic repay-and-withdraw, so a full payoff is two
        // transactions: clear the debt, then pull the collateral once nothing
        // is owed against it. The withdraw is built only after the repay
        // settles; built earlier it would fail simulation on the open debt.
        const repayTx = await buildKaminoRepayTx(walletAddress, debtUi);
        const signedRepay = await signTxBase64(repayTx);
        await sendAndConfirm(connection, base64ToBytes(signedRepay));

        setState({
          kind: "submitting",
          message: `Withdrawing ${position.collateralSymbol}…`,
        });
        let sig: string;
        try {
          const withdrawTx = await buildKaminoWithdrawTx(
            walletAddress,
            position.ref.position,
          );
          const signedWithdraw = await signTxBase64(withdrawTx);
          sig = await sendAndConfirm(connection, base64ToBytes(signedWithdraw));
        } catch (err) {
          // The debt is cleared but the collateral is still deposited. Say
          // exactly that: the generic "repay failed" would read as if the
          // payment itself bounced.
          console.error("[repay withdraw]", err);
          setState({
            kind: "error",
            message:
              `The loan is repaid, but withdrawing your ${position.collateralSymbol} did not go ` +
              `through, so it is still deposited. Withdraw it from the ` +
              `${position.collateralSymbol} market.`,
          });
          await onSettled();
          return;
        }
        setState({ kind: "done", signature: sig });
        await onSettled();
        return;
      } else {
        base64Tx = await buildKaminoPartialRepayTx(walletAddress, amount);
      }

      const signed = await signTxBase64(base64Tx);
      const sig = await sendAndConfirm(connection, base64ToBytes(signed));
      // A full payoff closed the position. Clear any leftover loop tag so it
      // cannot influence a future close, mirroring the market card's close.
      if (payoffAll && position.ref.venue === "jupiter") {
        try {
          localStorage.removeItem(
            `aeras:loop:${walletAddress}:${position.ref.vault.vaultId}`,
          );
        } catch {}
      }
      setState({ kind: "done", signature: sig });
      await onSettled();
    } catch (err) {
      console.error("[repay]", err);
      setState({ kind: "error", message: readableError(err) });
    }
  }

  return (
    <PanelShell
      title={`Repay ${position.collateralSymbol}`}
      subtitle={`${position.venueLabel} · ${debtUi.toFixed(2)} ${position.debtSymbol} owed`}
      onClose={onClose}
      onBack={onBack}
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
              Repay amount
            </label>
            <span className="font-mono text-[11px] text-white/50">
              {walletUsdc.toFixed(2)} {position.debtSymbol} in wallet
              {combinedUsdc - walletUsdc > 0.01 &&
                ` + ${(combinedUsdc - walletUsdc).toFixed(2)} convertible`}
              {maxRepayable > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(maxRepayable, maxRepayable >= debtUi)}
                  className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
                >
                  Max
                </button>
              )}
            </span>
          </div>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setPayoffAll(Number(e.target.value) >= debtUi);
                reset();
              }}
              className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
              {position.debtSymbol}
            </span>
          </div>
        </div>

        {maxRepayable > 0 && (
          <div>
            <input
              type="range"
              min={0}
              max={maxRepayable}
              step={Math.max(maxRepayable / 100, 0.01)}
              value={Math.min(amount, maxRepayable)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setAmount(v, v >= maxRepayable && maxRepayable >= debtUi);
              }}
              className="w-full accent-aeras-blue"
            />
            <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-white/50">
              <span>0</span>
              <span>
                Max {maxRepayable.toFixed(2)} {position.debtSymbol}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs">
          <div className="flex justify-between">
            <span className="text-white/50">Debt after repay</span>
            <span className="font-mono tabular-nums text-white">
              {payoffAll
                ? `0.00 ${position.debtSymbol}`
                : `${Math.max(0, debtUi - amount).toFixed(2)} ${position.debtSymbol}`}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Collateral</span>
            <span className="font-mono tabular-nums text-white">
              {position.collateralUi.toFixed(4)} {position.collateralSymbol}
            </span>
          </div>
          <p className="text-[11px] text-white/50">
            {payoffAll
              ? `Repaying in full closes the position and returns your ${position.collateralSymbol} to your wallet.` +
                (position.ref.venue === "kamino"
                  ? " Kamino needs two signatures for this: the repay, then the withdrawal."
                  : "")
              : `Your collateral stays deposited and can be borrowed against again. Withdraw it from the ${position.collateralSymbol} market when you want it back in your wallet.`}
          </p>
        </div>

        {needsFunding && (
          <p className="text-[11px] text-white/60">
            {fromMonadUi > 0.01 &&
              `${fromMonadUi.toFixed(2)} ${position.debtSymbol} of this comes from your Monad wallet through Trustware`}
            {fromMonadUi > 0.01 && fromSolUi > 0.01 && " and "}
            {fromSolUi > 0.01 &&
              `${fromSolUi.toFixed(2)} ${position.debtSymbol} comes from swapping SOL`}
            {" before the repay."}
            {fromMonadUi > 0.01
              ? " Bridging takes a few minutes."
              : " The swap settles in seconds."}
          </p>
        )}

        {combinedUsdc < debtUi && (
          <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
            <p className="text-[11px] text-white/50">
              Your wallets hold {combinedUsdc.toFixed(2)} of the{" "}
              {debtUi.toFixed(2)} {position.debtSymbol} owed. Add USDC to your
              Solana wallet to repay in full, or repay what you can now.
            </p>
            <button
              type="button"
              onClick={async () => {
                setFundError(null);
                try {
                  await fundWallet({
                    address: walletAddress,
                    options: { asset: "USDC" },
                  });
                } catch (err) {
                  setFundError(err instanceof Error ? err.message : String(err));
                }
              }}
              className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15"
            >
              Add USDC
            </button>
            {fundError && (
              <p className="text-[11px] text-white/60">
                Funding unavailable. {fundError}
              </p>
            )}
          </div>
        )}

        {shortForPayoff && (
          <p className="text-[11px] text-aeras-warning">
            A full payoff also covers interest accrued while it settles. Leave a
            small {position.debtSymbol} margin above {debtUi.toFixed(2)} or repay
            slightly less.
          </p>
        )}

        {overWallet && (
          <p className="text-[11px] text-aeras-negative">
            More than your wallets hold across Solana and Monad.
          </p>
        )}
        {overDebt && (
          <p className="text-[11px] text-aeras-negative">
            More than this position owes.
          </p>
        )}

        {state.kind === "error" && (
          <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
            {state.message}
          </p>
        )}
        {state.kind === "done" && (
          <a
            href={`${SOLSCAN_TX_BASE}${state.signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
          >
            <div className="font-medium text-aeras-positive">
              {payoffAll
                ? `Loan repaid and ${position.collateralSymbol} withdrawn`
                : "Repay confirmed"}
            </div>
            <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
              {state.signature}
            </div>
          </a>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={handleSubmit}
          className="w-full rounded-xl bg-aeras-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? (state.message ?? "Signing and submitting…")
            : payoffAll || amount > 0
              ? "Repay"
              : "Enter an amount"}
        </button>
      </div>
    </PanelShell>
  );
}

function PanelShell({
  title,
  subtitle,
  onClose,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-xl space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium tracking-tight text-white">
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-[11px] text-white/50">{subtitle}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-[11px] text-white/50 underline-offset-2 hover:text-white hover:underline"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close repay"
            className="text-[11px] text-white/50 underline-offset-2 hover:text-white hover:underline"
          >
            Close
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readableError(err: unknown): string {
  // sendAndConfirm already decided what happened and phrased it.
  if (
    err instanceof SolanaSendError &&
    (err.kind === "expired" || err.kind === "unknown")
  ) {
    return err.message;
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (/insufficient funds|0x1\b/i.test(raw)) {
    return "Not enough USDC to cover this repayment plus fees.";
  }
  if (/blockhash not found|block height exceeded/i.test(raw)) {
    return "The transaction expired before it landed. Try again.";
  }
  if (/User rejected|declined|denied/i.test(raw)) {
    return "Signature request was declined.";
  }
  return `Repay failed: ${raw}`;
}
