"use client";

// Aeras Vault I (Blend) as a venue inside the shared Earn Vaults table, beside
// Jupiter Lend, Kamino, Morpho and Aave. Blend is not a vault but a per-user
// Safe allocated across several (lib/blend/constants.ts), so like Morpho it
// carries more than one rate for the one USDC row; unlike Morpho the user does
// not pick between them, Blend does, so the column shows the strategy's rate
// and the expanded row lists the vaults rather than offering a choice. The
// rate comes from our yield proxy, which reads Blend's server API, because
// the frontend API answers nothing before a SIWE sign-in and the table has to
// draw the column for everyone.
//
// The position is the account's balance across every chain the strategy
// holds on, read through our position proxy for addresses known to have a
// Blend account (see lib/blend/session.ts for why it is gated). Deposits run
// through lib/blend/deposit.ts: the embedded EVM wallet signs on Monad, and a
// wallet short of USDC or gas is funded from Solana first, the same way the
// Morpho venue is. Withdrawals run through lib/blend/withdraw.ts as one
// owner transaction on every chain the position sits on, each paid by the
// embedded wallet (gas bought from Solana first where it is missing), and
// land as USDC in the Monad wallet; the form shows the review first, with
// every chain's amount, fee and gas, and refuses a chain whose step would
// fail.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { formatUnits, parseUnits } from "viem";

import {
  fetchBlendPosition,
  fetchBlendYield,
  fetchNativeUsd,
  type BlendPositionPayload,
  type BlendVaultYield,
} from "@/lib/blend/client";
import { BLEND_VENUE_NAME, blendChainName } from "@/lib/blend/constants";
import {
  depositUsdcToBlend,
  type BlendDepositResult,
  type BlendTxProgress,
} from "@/lib/blend/deposit";
import { hasBlendAccount } from "@/lib/blend/session";
import {
  discardBlendWithdrawQuote,
  executeBlendWithdraw,
  quoteBlendWithdraw,
  type BlendWithdrawChain,
  type BlendWithdrawQuote,
  type BlendWithdrawResult,
} from "@/lib/blend/withdraw";
import { BASE_EXPLORER_TX_BASE } from "@/lib/base/constants";
import { ETHEREUM_EXPLORER_TX_BASE } from "@/lib/ethereum/constants";
import { MONAD_CHAIN_ID, MONAD_EXPLORER_TX_BASE } from "@/lib/morpho/constants";
import {
  maxFundableDepositAtomic,
  needsMonadGas,
  type SolanaSigner,
} from "@/lib/morpho/fund";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";

const YIELD_POLL_MS = 60_000;
const USDC_DECIMALS = 6;

export interface BlendEarn {
  // One row per vault the account type allocates to, as Blend reports them.
  vaults: BlendVaultYield[];
  // The strategy's rate, decimal (0.05 = 5%). Null until the proxy answers
  // or when Blend reports no rate yet (an account type with no deposits).
  apy: number | null;
  // Distinct chains the allocation spans, for the cell's note.
  chainIds: number[];
  // The wallet's position, once the address is known to have an account.
  position: BlendPositionPayload | null;
  // The position summed over every chain, 6-decimal USDC atomic. "0" until
  // read.
  positionAtomic: string;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  // The Solana wallet, as a signer for the Trustware funding leg.
  solanaSigner: SolanaSigner | undefined;
  error: string | null;
  refresh: () => Promise<void>;
}

// Which Earn assets Blend takes. The account type holds USDC vaults only.
export function blendAcceptsAsset(symbol: string): boolean {
  return symbol === "USDC";
}

// One number for the column from one row per vault. The yield endpoint
// carries no allocation weights, and the portal has every vault at an equal
// weight today, so the unweighted mean of the rows' overall rates is the
// strategy's expected rate. Revisit if the weights diverge: a funded account's
// balance reports the real per-chain split, which would let the position's
// own blended rate replace this.
export function blendStrategyApy(vaults: BlendVaultYield[]): number | null {
  const rates = vaults
    .map((v) => v.overall)
    .filter((r): r is number => r !== null);
  if (rates.length === 0) return null;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

// Owned by the Vaults table rather than by a Blend component, because the
// table needs the rate to draw the Blend column whether or not any row is
// expanded. Polled on the same cadence as the other venues' rates; a failure
// is quiet and the column falls back to a dash, as Kamino's does.
export function useBlendEarn(walletAddress: string | undefined): BlendEarn {
  const evm = useEmbeddedEvmWallet();
  const sendSolanaTx = useSendSolanaTxBase64();
  const [vaults, setVaults] = useState<BlendVaultYield[]>([]);
  const [position, setPosition] = useState<BlendPositionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const solanaSigner = useMemo<SolanaSigner | undefined>(
    () =>
      walletAddress
        ? { address: walletAddress, signAndSendBase64: sendSolanaTx }
        : undefined,
    [walletAddress, sendSolanaTx],
  );

  const evmAddress = evm.address;
  const refresh = useCallback(async () => {
    try {
      const payload = await fetchBlendYield();
      setVaults(payload.vaults);
      setError(null);
    } catch (err) {
      console.error("[useBlendEarn]", err);
      setError(err instanceof Error ? err.message : String(err));
    }
    // The marker is read on every refresh, not once, so the first deposit's
    // sign-in (which sets it) is followed by a position read on settle.
    if (evmAddress && hasBlendAccount(evmAddress)) {
      try {
        setPosition(await fetchBlendPosition(evmAddress));
      } catch (err) {
        // Keep the last good position through a transient read failure.
        console.error("[useBlendEarn position]", err);
      }
    }
  }, [evmAddress]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cancelled) await refresh();
    }
    load();
    const id = setInterval(load, YIELD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refresh]);

  const chainIds = [...new Set(vaults.map((v) => v.chainId))];

  return {
    vaults,
    apy: blendStrategyApy(vaults),
    chainIds,
    position,
    positionAtomic: position?.totalUsdcAtomic ?? "0",
    evm,
    solanaSigner,
    error,
    refresh,
  };
}

// ── Venue panel ─────────────────────────────────────────────────────────────

function fmtPct(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(2)}%`;
}

function fmtUsdc(atomic: string | bigint): string {
  return Number(formatUnits(BigInt(atomic), USDC_DECIMALS)).toLocaleString(
    undefined,
    { maximumFractionDigits: 2 },
  );
}

// What the expanded row shows once Aeras Vault I is the selected venue: the
// vaults the strategy spreads across, with the position's share of each once
// there is one, then the form.
export function BlendVenuePanel({
  earn,
  mode,
  monadUsdcAtomic,
  monBalanceAtomic,
  solanaUsdcAtomic,
  onSettled,
}: {
  earn: BlendEarn;
  mode: "deposit" | "withdraw";
  // The embedded wallet's Monad balances, from the Morpho hook that already
  // polls them: the deposit spends from the same wallet.
  monadUsdcAtomic: string;
  monBalanceAtomic: string;
  // Solana USDC available to fund a shortfall, 6-decimal atomic.
  solanaUsdcAtomic: string;
  onSettled: () => Promise<void>;
}) {
  const held = new Map(
    (earn.position?.perChain ?? []).map((c) => [c.chainId, c]),
  );
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {earn.vaults.map((v) => {
          const p = held.get(v.chainId);
          return (
            <div
              key={`${v.chainId}-${v.vaultAddress}`}
              className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-white">
                  {blendChainName(v.chainId)}
                </div>
                <div className="truncate text-[11px] text-white/50">
                  {v.heldAssets.length > 0
                    ? v.heldAssets.map((a) => a.symbol).join(", ")
                    : "USDC vault"}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm tabular-nums text-white">
                  {fmtPct(v.overall)}
                </div>
                <div className="font-mono text-[10px] tabular-nums text-white/50">
                  {p && BigInt(p.underlyingAtomic) > 0n
                    ? `${fmtUsdc(p.underlyingAtomic)} deposited`
                    : v.pctDeployed !== null
                      ? `${Math.round(v.pctDeployed * 100)}% deployed`
                      : "—"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {mode === "deposit" ? (
        <BlendDepositForm
          earn={earn}
          monadUsdcAtomic={monadUsdcAtomic}
          monBalanceAtomic={monBalanceAtomic}
          solanaUsdcAtomic={solanaUsdcAtomic}
          onSettled={onSettled}
        />
      ) : (
        <BlendWithdrawForm
          earn={earn}
          solanaUsdcAtomic={solanaUsdcAtomic}
          onSettled={onSettled}
        />
      )}
    </div>
  );
}

// ── deposit form ────────────────────────────────────────────────────────────

type FormState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "done"; result: BlendDepositResult; amountAtomic: bigint }
  | { kind: "error"; message: string };

function BlendDepositForm({
  earn,
  monadUsdcAtomic,
  monBalanceAtomic,
  solanaUsdcAtomic,
  onSettled,
}: {
  earn: BlendEarn;
  monadUsdcAtomic: string;
  monBalanceAtomic: string;
  solanaUsdcAtomic: string;
  onSettled: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const { evm, solanaSigner } = earn;

  // Deposits can draw on the Solana balance through the Trustware funding
  // leg, so the ceiling is not just what already sits on Monad.
  const maxAtomic = maxFundableDepositAtomic(
    monadUsdcAtomic,
    solanaSigner ? solanaUsdcAtomic : "0",
    monBalanceAtomic,
  );
  const maxUi = Number(formatUnits(BigInt(maxAtomic), USDC_DECIMALS));
  const amountAtomic = parseUsdc(input);
  const overLimit = amountAtomic > BigInt(maxAtomic);
  const busy = state.kind === "busy";
  const disabled = busy || amountAtomic <= 0n || overLimit || !evm.ready;

  const onProgress = (p: BlendTxProgress) =>
    setState({ kind: "busy", message: p.message });

  async function handleSubmit() {
    if (!evm.address) {
      setState({ kind: "error", message: "No embedded EVM wallet available." });
      return;
    }
    setState({ kind: "busy", message: "Preparing…" });
    try {
      const result = await depositUsdcToBlend({
        amountAtomic,
        monadUsdcAtomic,
        solanaUsdcAtomic,
        monBalanceAtomic,
        evm: {
          address: evm.address,
          switchChain: evm.switchChain,
          getProvider: evm.getProvider,
        },
        solana: solanaSigner,
        onProgress,
      });
      setState({ kind: "done", result, amountAtomic });
      setInput("");
      await onSettled();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Deposit USDC
          </label>
          <span className="font-mono text-[11px] text-white/50">
            {maxUi.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            available
            <button
              type="button"
              onClick={() => {
                setInput(formatUnits(BigInt(maxAtomic), USDC_DECIMALS));
                if (state.kind !== "idle") setState({ kind: "idle" });
              }}
              className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
            >
              Max
            </button>
          </span>
        </div>

        <AmountControl
          input={input}
          maxAtomic={maxAtomic}
          onChange={(v) => {
            setInput(v);
            if (state.kind !== "idle") setState({ kind: "idle" });
          }}
        />
      </div>

      {amountAtomic > 0n && !overLimit && needsMonadGas(monBalanceAtomic) && (
        <p className="text-[11px] text-white/60">
          A one-time 0.50 USDC from your Solana wallet buys MON to pay Monad
          gas. Bridging takes a few minutes.
        </p>
      )}
      {!evm.ready && (
        <p className="text-[11px] text-aeras-warning">
          An embedded EVM wallet is required. It is provisioned on login; try
          reconnecting if this persists.
        </p>
      )}
      {overLimit && (
        <p className="text-[11px] text-aeras-negative">
          Amount is above the wallet balance limit.
        </p>
      )}
      {state.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {state.message}
        </p>
      )}
      {state.kind === "done" && <DoneCard state={state} />}

      <button
        type="button"
        disabled={disabled}
        onClick={handleSubmit}
        className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? state.message : `Deposit into ${BLEND_VENUE_NAME}`}
      </button>

      <p className="text-[11px] text-white/50">
        {BLEND_VENUE_NAME} is an account on Blend: a Safe only your wallet can
        sign for, allocated across {earn.vaults.length} USDC{" "}
        {earn.vaults.length === 1 ? "vault" : "vaults"} on{" "}
        {earn.chainIds.map(blendChainName).join(", ")} and rebalanced by Blend.
        Deposits leave from your Monad wallet; the first one signs you in.
      </p>
    </div>
  );
}

function parseUsdc(input: string): bigint {
  try {
    return input ? parseUnits(input, USDC_DECIMALS) : 0n;
  } catch {
    return 0n;
  }
}

// The amount field both forms share: a slider over the ceiling whenever there
// is one, a plain input otherwise (which is disabled by the ceiling anyway).
function AmountControl({
  input,
  maxAtomic,
  onChange,
}: {
  input: string;
  maxAtomic: string;
  onChange: (value: string) => void;
}) {
  const maxUi = Number(formatUnits(BigInt(maxAtomic), USDC_DECIMALS));
  if (maxUi > 0) {
    return (
      <div className="space-y-2 rounded-lg border border-white/15 bg-white/5 px-3 py-3">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-lg tabular-nums text-white">
            {input || "0"} <span className="text-xs text-white/50">USDC</span>
          </span>
          <span className="font-mono text-[11px] text-white/50">
            {`${Math.round(((Number(input) || 0) / maxUi) * 100)}%`}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={maxUi}
          step={Math.max(maxUi / 100, 1e-6)}
          value={Math.min(Number(input) || 0, maxUi)}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange(
              v >= maxUi ? formatUnits(BigInt(maxAtomic), USDC_DECIMALS) : String(v),
            );
          }}
          style={
            {
              "--range-progress": Math.min(
                1,
                Math.max(0, (Number(input) || 0) / maxUi),
              ),
            } as CSSProperties
          }
          className="aeras-range"
        />
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        value={input}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
        USDC
      </span>
    </div>
  );
}

// ── withdraw form ───────────────────────────────────────────────────────────

type WithdrawState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "reviewing"; quoted: BlendWithdrawQuote }
  | { kind: "done"; result: BlendWithdrawResult }
  | { kind: "error"; message: string };

// Two steps, because a withdrawal touches every chain the position sits on
// and the wallet pays each chain's gas. Review quotes it and simulates each
// chain's transaction where it runs, so the card can show, per chain, the
// amount, the bridge fee, the gas the wallet will pay and whether gas has to
// be bought first, and can refuse a chain whose step would fail. Confirm
// buys the missing gas from Solana, sends one owner transaction per chain,
// and sweeps what the bridges deliver into the wallet. Funds arrive as USDC
// in the Monad wallet; the wallet panel moves them to Solana.
function BlendWithdrawForm({
  earn,
  solanaUsdcAtomic,
  onSettled,
}: {
  earn: BlendEarn;
  // Solana USDC available to buy gas with, 6-decimal atomic.
  solanaUsdcAtomic: string;
  onSettled: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<WithdrawState>({ kind: "idle" });
  const { evm, solanaSigner } = earn;

  const positionAtomic = earn.positionAtomic;
  const positionUi = Number(formatUnits(BigInt(positionAtomic), USDC_DECIMALS));
  const amountAtomic = parseUsdc(input);
  const overLimit = amountAtomic > BigInt(positionAtomic);
  // A full exit redeems every share on every chain rather than a converted
  // amount, so no dust is left behind.
  const withdrawAll = amountAtomic > 0n && amountAtomic >= BigInt(positionAtomic);
  const busy = state.kind === "busy";
  const reviewing = state.kind === "reviewing";
  const disabled = busy || reviewing || amountAtomic <= 0n || overLimit || !evm.ready;

  const onProgress = (p: BlendTxProgress) =>
    setState({ kind: "busy", message: p.message });

  function signer() {
    if (!evm.address) throw new Error("No embedded EVM wallet available.");
    return {
      address: evm.address,
      switchChain: evm.switchChain,
      getProvider: evm.getProvider,
    };
  }

  // `override` is the review's own suggestion (the most that can be
  // withdrawn right now); it replaces the typed amount.
  async function handleReview(override?: bigint) {
    const amount = override ?? amountAtomic;
    const all = override === undefined ? withdrawAll : amount >= BigInt(positionAtomic);
    if (override !== undefined) setInput(formatUnits(override, USDC_DECIMALS));
    setState({ kind: "busy", message: "Preparing…" });
    try {
      const nativeUsd = await fetchNativeUsd();
      const quoted = await quoteBlendWithdraw({
        amountAtomic: amount,
        withdrawAll: all,
        evm: signer(),
        nativeUsd,
        onProgress,
      });
      setState({ kind: "reviewing", quoted });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleConfirm() {
    if (state.kind !== "reviewing") return;
    const { quoted } = state;
    setState({ kind: "busy", message: "Preparing…" });
    try {
      const result = await executeBlendWithdraw({
        quoted,
        evm: signer(),
        solana: solanaSigner,
        solanaUsdcAtomic,
        onProgress,
      });
      setState({ kind: "done", result });
      setInput("");
      await onSettled();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleBack() {
    if (state.kind !== "reviewing") return;
    const { quoted } = state;
    setState({ kind: "idle" });
    await discardBlendWithdrawQuote(quoted);
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Withdraw USDC
          </label>
          <span className="font-mono text-[11px] text-white/50">
            {positionUi.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            deposited
            <button
              type="button"
              onClick={() => {
                setInput(formatUnits(BigInt(positionAtomic), USDC_DECIMALS));
                if (state.kind !== "idle") setState({ kind: "idle" });
              }}
              className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
            >
              Max
            </button>
          </span>
        </div>
        <AmountControl
          input={input}
          maxAtomic={positionAtomic}
          onChange={(v) => {
            setInput(v);
            if (state.kind !== "idle") setState({ kind: "idle" });
          }}
        />
      </div>

      {!evm.ready && (
        <p className="text-[11px] text-aeras-warning">
          An embedded EVM wallet is required. It is provisioned on login; try
          reconnecting if this persists.
        </p>
      )}
      {overLimit && (
        <p className="text-[11px] text-aeras-negative">
          Amount is above the deposited limit.
        </p>
      )}
      {state.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {state.message}
        </p>
      )}
      {state.kind === "reviewing" && (
        <ReviewCard
          quoted={state.quoted}
          position={earn.position}
          onReviewAmount={(atomic) => void handleReview(atomic)}
        />
      )}
      {state.kind === "done" && <WithdrawDoneCard result={state.result} />}

      {state.kind === "reviewing" && state.quoted.blocked !== null ? (
        <button
          type="button"
          onClick={handleBack}
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white"
        >
          Back
        </button>
      ) : state.kind === "reviewing" ? (
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium"
          >
            Confirm withdrawal
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => void handleReview()}
          className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? state.message : "Review withdrawal"}
        </button>
      )}

      <p className="text-[11px] text-white/50">
        A withdrawal moves USDC out of the vaults on every chain it sits on and
        delivers it to your Monad wallet as USDC. Your wallet pays the gas on
        each chain; where it holds none, a little is bought from your Solana
        USDC first. Bridging from Ethereum or Base adds a fee. Everything is
        shown before you confirm.
      </p>
    </div>
  );
}

function fmtNative(wei: bigint, chainId: number): string {
  const unit = chainId === MONAD_CHAIN_ID ? "MON" : "ETH";
  const n = Number(wei) / 1e18;
  return `${n < 0.0001 ? "<0.0001" : n.toFixed(4)} ${unit}`;
}

function fmtUsdSmall(usd: number): string {
  return `$${usd < 0.01 ? "<0.01" : usd.toFixed(2)}`;
}

function ReviewChainRow({
  chain,
  amountAtomic,
}: {
  chain: BlendWithdrawChain;
  // What leaves this chain, resolved by the caller when the quote said
  // "everything here".
  amountAtomic: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <div className="min-w-0">
        <div className="text-white">
          {blendChainName(chain.chainId)}
          {amountAtomic !== null && (
            <>
              {" · "}
              <span className="font-mono tabular-nums">{fmtUsdc(amountAtomic)}</span> USDC
            </>
          )}
        </div>
        {chain.revert ? (
          <div className="text-aeras-negative">{chain.revert}</div>
        ) : (
          <div className="text-white/60">
            gas{" "}
            <span className="font-mono tabular-nums">
              {fmtNative(chain.costWei, chain.chainId)}
              {chain.gasCostUsd !== null && ` (${fmtUsdSmall(chain.gasCostUsd)})`}
            </span>
            {chain.feesUsd !== null && chain.feesUsd > 0 && (
              <>
                {" · "}bridge fee{" "}
                <span className="font-mono tabular-nums">{fmtUsdSmall(chain.feesUsd)}</span>
              </>
            )}
            {chain.needsTopUp && (
              <span className="text-aeras-warning">
                {" · "}your wallet holds {fmtNative(chain.balanceWei, chain.chainId)}; gas is
                bought from Solana first
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewCard({
  quoted,
  position,
  onReviewAmount,
}: {
  quoted: BlendWithdrawQuote;
  position: BlendPositionPayload | null;
  onReviewAmount: (atomic: bigint) => void;
}) {
  const minutes = Math.max(1, Math.round(quoted.estimatedSeconds / 60));
  const held = new Map((position?.perChain ?? []).map((c) => [c.chainId, c.underlyingAtomic]));
  const blocked = quoted.blocked !== null;
  const ceiling = quoted.withdrawableNowAtomic;
  return (
    <div
      className={`space-y-2 rounded-lg border px-3 py-2 text-xs ${
        blocked ? "border-aeras-warning/40 bg-aeras-warning/10" : "border-aeras-blue/40 bg-aeras-blue/10"
      }`}
    >
      <div className="font-medium text-white">
        {blocked ? "Cannot withdraw " : quoted.request.withdrawAll ? "Withdraw everything, " : "Withdraw "}
        <span className="font-mono tabular-nums">{fmtUsdc(quoted.amountAtomic)}</span>{" "}
        USDC{blocked ? " right now" : " to Monad"}
      </div>
      {blocked && (
        <div className="space-y-1.5 text-[11px] text-white/80">
          {ceiling !== null && ceiling > 0n ? (
            <>
              <p>
                Blend draws from its Monad vault first, and that vault can only
                redeem about{" "}
                <span className="font-mono tabular-nums text-white">{fmtUsdc(ceiling)}</span>{" "}
                USDC at the moment. The rest becomes withdrawable as the
                vault&apos;s idle USDC refills, which changes hour to hour.
                Nothing was signed.
              </p>
              <button
                type="button"
                onClick={() => onReviewAmount(ceiling)}
                className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-white/15"
              >
                Review {fmtUsdc(ceiling)} USDC instead
              </button>
            </>
          ) : ceiling === 0n ? (
            <p>
              Blend draws from its Monad vault first, and that vault cannot
              redeem anything at the moment. Try again later. Nothing was
              signed.
            </p>
          ) : (
            <p>
              A smaller amount may work; a full withdrawal needs Blend&apos;s
              Monad vault to hold enough idle USDC, which changes hour to hour.
              Nothing was signed.
            </p>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        {quoted.chains.map((c) => (
          <ReviewChainRow
            key={c.chainId}
            chain={c}
            amountAtomic={c.amountAtomic ?? held.get(c.chainId) ?? null}
          />
        ))}
      </div>
      <div className="text-[10px] text-white/50">
        {quoted.feesUsd !== null && quoted.feesUsd > 0 && (
          <>Bridge fees {fmtUsdSmall(quoted.feesUsd)} in total. </>
        )}
        {quoted.estimatedSeconds > 0 && <>About {minutes} min. </>}
        Quote valid until{" "}
        {quoted.expiresAt.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
        .
      </div>
    </div>
  );
}

function WithdrawDoneCard({ result }: { result: BlendWithdrawResult }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
      <div className="font-medium text-aeras-positive">Withdrawal settled</div>
      <div className="text-white/70">
        {fmtUsdc(result.amountAtomic)} USDC is in your Monad wallet. The wallet
        panel can move it to Solana.
        {BigInt(result.sweptAtomic) > 0n && (
          <> {fmtUsdc(result.sweptAtomic)} of it was moved from your account to the wallet.</>
        )}
      </div>
      {result.txHashes.map((t) => (
        <TxLink key={`${t.chainId}-${t.hash}`} hash={t.hash} chainId={t.chainId} />
      ))}
      {result.sweepTxHash && (
        <TxLink hash={result.sweepTxHash} chainId={MONAD_CHAIN_ID} />
      )}
    </div>
  );
}

function DoneCard({
  state,
}: {
  state: Extract<FormState, { kind: "done" }>;
}) {
  const { result, amountAtomic } = state;
  const destination = blendChainName(result.destinationChainId);
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
      <div className="font-medium text-aeras-positive">Deposit settled</div>
      <div className="text-white/70">
        {fmtUsdc(amountAtomic)} USDC{" "}
        {result.destinationChainId === result.originChainId
          ? `on ${destination}`
          : `sent to ${destination}`}
        {result.feesUsd !== null && (
          <>
            , fees{" "}
            <span className="font-mono tabular-nums">
              ${result.feesUsd < 0.01 ? "<0.01" : result.feesUsd.toFixed(2)}
            </span>
          </>
        )}
      </div>
      {result.txHashes.map((t) => (
        <TxLink key={t.hash} hash={t.hash} chainId={t.chainId} />
      ))}
    </div>
  );
}

function TxLink({ hash, chainId }: { hash: string; chainId: number }) {
  const cls = "block break-all font-mono text-[10px] text-white/50";
  const explorer =
    chainId === MONAD_CHAIN_ID
      ? MONAD_EXPLORER_TX_BASE
      : chainId === 1
        ? ETHEREUM_EXPLORER_TX_BASE
        : chainId === 8453
          ? BASE_EXPLORER_TX_BASE
          : null;
  if (!explorer) {
    return (
      <span className={cls}>
        {blendChainName(chainId)} {hash}
      </span>
    );
  }
  return (
    <a
      href={`${explorer}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`${cls} hover:text-white`}
    >
      {blendChainName(chainId)} {hash}
    </a>
  );
}
