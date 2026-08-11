// Kamino Earn vaults (K-Vaults) as a second venue on the Earn surface.
//
// A K-Vault is not a lending reserve. It is a curator-run strategy that spreads
// one asset across Kamino Lend reserves and rebalances. Kamino lists 168 of
// them, most tiny or abandoned, so the set below is curated by hand rather than
// pulled live: an "all vaults, sorted by APY" list would put a $103 vault with
// one holder at the top.
//
// Selection rule applied on 2026-08-05: highest APY among vaults with at least
// $500k TVL and at least 50 holders. Both floors matter. TVL alone admits
// Galaxy USDT ($2.5M, 1 holder); holders alone admits nothing useful. Excluded
// by the floors: Kamino Private Credit USDC (6.89%, 48 holders, private-credit
// risk), Elemental USDS Optimizer ($180k), Keel Flagship USDS ($6), Core++ USDT
// ($103), plus vaults literally named `test t33` and `Steakhouse USDG Staging`.
//
// Every field here is pinned rather than read from the API for the same reason
// the Jupiter mints are pinned: a changed or compromised upstream must not be
// able to redirect a deposit to a vault nobody vetted.

// Verified against https://api.kamino.finance/kvaults/vaults on 2026-08-05.
export interface KaminoVaultMeta {
  // Vault account address. This is the `kvault` parameter KTX takes.
  address: string;
  // Curator's name for the vault. Shown in the UI, because "Kamino" alone would
  // imply a Kamino-native product and these are third-party strategies.
  name: string;
  // Underlying asset. Matches the corresponding EARN_ASSETS.assetMint so the two
  // venues can be joined into one row per asset.
  tokenMint: string;
  tokenDecimals: number;
  // Share token. Held in the wallet only while unstaked; deposits auto-stake
  // into the vault's farm, so this is not a reliable position source. Read
  // positions from /kvaults/users/{pubkey}/positions instead.
  sharesMint: string;
  sharesDecimals: number;
  // Vault's own floor, in token atomic units. Deposits below it fail on chain.
  minDepositAtomic: string;
}

export const KAMINO_EARN_VAULTS: readonly KaminoVaultMeta[] = [
  {
    address: "DWSXb18xZApz29vnQpgR2m6MynCT7PznaXt7Ut7M7KaP",
    name: "RWA USDC",
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenDecimals: 6,
    sharesMint: "DgHN3q3dSYAchNX7V3D4aYiTWMx8RHTgHbfPiwiqBkE9",
    sharesDecimals: 6,
    minDepositAtomic: "100000",
  },
  {
    address: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
    name: "Elemental USDG Optimizer",
    tokenMint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    tokenDecimals: 6,
    sharesMint: "muui3LMLnyPkdRtH7SYZiq7z9s5S36zh6KMqcPSnVyn",
    sharesDecimals: 6,
    minDepositAtomic: "100000",
  },
  {
    address: "A1USdsC4kypCgPw5dHAwmqDjfFKrtdVHtXLhDY9QvHQ3",
    name: "Allez USDS",
    tokenMint: "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
    tokenDecimals: 6,
    sharesMint: "28rzUevvJVLtMmtvUxdFzh3Xie9ZhvxuVoz2STuPFMi6",
    sharesDecimals: 6,
    minDepositAtomic: "100000",
  },
  {
    address: "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
    name: "SOL Balanced",
    tokenMint: "So11111111111111111111111111111111111111112",
    tokenDecimals: 9,
    sharesMint: "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK",
    sharesDecimals: 9,
    minDepositAtomic: "1000000",
  },
  {
    address: "A1USdT5BhSBpWiH4W6oZeykCDr9vq56qXVkMFhZjN48o",
    name: "Allez USDT",
    tokenMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    tokenDecimals: 6,
    sharesMint: "JCqMxoSB3KjdfpH3SaCSdWz9v4KG116GZgd3Td4KL3bW",
    sharesDecimals: 6,
    minDepositAtomic: "100000",
  },
] as const;

// Vaults the KTX proxy will build transactions for. Mirrors
// KAMINO_ALLOWED_RESERVES: a caller cannot ask us to sign into an arbitrary
// vault address.
export const KAMINO_ALLOWED_KVAULTS: ReadonlySet<string> = new Set<string>(
  KAMINO_EARN_VAULTS.map((v) => v.address),
);

export function kaminoVaultByAsset(
  tokenMint: string,
): KaminoVaultMeta | undefined {
  return KAMINO_EARN_VAULTS.find((v) => v.tokenMint === tokenMint);
}

export function kaminoVaultByAddress(
  address: string,
): KaminoVaultMeta | undefined {
  return KAMINO_EARN_VAULTS.find((v) => v.address === address);
}

// ── Live vault state ───────────────────────────────────────────────────────

export interface KaminoVaultState {
  address: string;
  tokenMint: string;
  // Decimal rate (0.0585 = 5.85%), net of the curator's fees. Kamino reports
  // farm and incentive components separately; `apy` is the total.
  apy: number;
  incentivesApy: number;
  tvlUsd: number;
  // USD value of one share. Note this is a share price, not a token price: the
  // SOL vault's shares are worth ~77 USD each because a share holds ~1.04 SOL.
  sharePriceUsd: number;
  // Underlying tokens per share, as an integer scaled by 10^RATIO_PRECISION.
  // Kept as a scaled string rather than a float because it is the multiplier on
  // a position balance, and a float would drift on large positions.
  tokensPerShareScaled: string;
  holders: number;
}

// Fixed-point precision for the tokens-per-share ratio. Kamino reports it to 19
// fractional digits; 18 is past the point where it can move an atomic unit of
// any asset we list.
export const RATIO_PRECISION = 18;

// ── Exact decimal <-> atomic conversion ────────────────────────────────────
//
// These exist because the KTX API takes human-readable amounts, not atomic
// units: posting `amount: "1"` against a 6-decimal vault produces an on-chain
// arg of 1000000. Verified by decoding the returned instruction data on
// 2026-08-05. Everything above the proxy stays in atomic BigInt units, and the
// conversion happens once, at the boundary, without a float in the path.

// Parse a decimal string into an integer scaled by 10^precision. Truncates
// beyond `precision` rather than rounding, so a derived amount can never exceed
// the value it came from.
export function decimalToScaled(value: string, precision: number): string {
  const trimmed = value.trim();
  if (!/^-?\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    return "0";
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", frac = ""] = unsigned.split(".");
  const fracPadded = (frac + "0".repeat(precision)).slice(0, precision);
  const magnitude =
    BigInt(whole || "0") * 10n ** BigInt(precision) + BigInt(fracPadded || "0");
  return (negative ? -magnitude : magnitude).toString();
}

// Atomic units -> the exact decimal string KTX expects. No trailing zeros, no
// exponent notation, no precision loss.
export function atomicToDecimalString(
  atomic: string,
  decimals: number,
): string {
  const negative = atomic.startsWith("-");
  const digits = negative ? atomic.slice(1) : atomic;
  if (!/^\d+$/.test(digits)) return "0";
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac =
    decimals > 0 ? padded.slice(padded.length - decimals).replace(/0+$/, "") : "";
  const body = frac ? `${whole}.${frac}` : whole;
  return negative && body !== "0" ? `-${body}` : body;
}

// Rescale an atomic amount between two decimal precisions. Truncates when
// scaling down.
function rescale(atomic: bigint, from: number, to: number): bigint {
  if (to === from) return atomic;
  return to > from
    ? atomic * 10n ** BigInt(to - from)
    : atomic / 10n ** BigInt(from - to);
}

// ── Position math ──────────────────────────────────────────────────────────

// Underlying token value of a share balance, in token atomic units.
export function sharesToTokensAtomic(
  sharesAtomic: string,
  state: KaminoVaultState | undefined,
  meta: KaminoVaultMeta,
): string {
  if (!state || sharesAtomic === "0") return "0";
  const tokensAtShareScale =
    (BigInt(sharesAtomic) * BigInt(state.tokensPerShareScaled)) /
    10n ** BigInt(RATIO_PRECISION);
  return rescale(
    tokensAtShareScale,
    meta.sharesDecimals,
    meta.tokenDecimals,
  ).toString();
}

// Shares needed to withdraw a given amount of the underlying.
//
// KTX's withdraw amount is denominated in SHARES, not tokens: posting
// `amount: "1"` emits withdraw(1000000) against a 6-decimal vault whose share
// price is 1.026, so it pulls 1 share worth 1.026 tokens, not 1 token. The UI
// asks the user for tokens, so this conversion is mandatory. Verified by
// decoding instruction data on 2026-08-05.
//
// Rounds down, which is the safe direction: the user receives marginally less
// than they typed rather than more than they hold.
export function tokensToSharesAtomic(
  tokensAtomic: string,
  state: KaminoVaultState | undefined,
  meta: KaminoVaultMeta,
): string {
  if (!state || tokensAtomic === "0") return "0";
  const ratio = BigInt(state.tokensPerShareScaled);
  if (ratio <= 0n) return "0";
  const tokensAtShareScale = rescale(
    BigInt(tokensAtomic),
    meta.tokenDecimals,
    meta.sharesDecimals,
  );
  return (
    (tokensAtShareScale * 10n ** BigInt(RATIO_PRECISION)) /
    ratio
  ).toString();
}

// ── Client fetchers ────────────────────────────────────────────────────────

export interface KaminoPosition {
  vaultAddress: string;
  // Share balance in atomic units, staked and unstaked combined. Deposits
  // auto-stake into the vault's farm, so a wallet's share-token account reads
  // zero even with a live position. This total is the only correct source.
  totalSharesAtomic: string;
}

export async function fetchKaminoVaultsViaProxy(): Promise<KaminoVaultState[]> {
  const res = await fetch("/api/kamino/kvaults/metrics", { cache: "no-store" });
  if (!res.ok) throw new Error(`Kamino vault metrics failed: ${res.status}`);
  const payload = (await res.json()) as { vaults?: KaminoVaultState[] };
  return payload.vaults ?? [];
}

export async function fetchKaminoPositionsViaProxy(
  walletAddress: string,
): Promise<Map<string, KaminoPosition>> {
  const res = await fetch(
    `/api/kamino/kvaults/positions?wallet=${encodeURIComponent(walletAddress)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Kamino positions failed: ${res.status}`);
  const payload = (await res.json()) as { positions?: KaminoPosition[] };
  return new Map(
    (payload.positions ?? []).map((p) => [p.vaultAddress, p]),
  );
}

export type KaminoVaultAction = "deposit" | "withdraw";

// Build an unsigned base64 transaction. `amountAtomic` is in token atomic units
// for a deposit and SHARE atomic units for a withdrawal, matching what the
// underlying instruction takes.
export async function buildKaminoVaultTx({
  action,
  walletAddress,
  vault,
  amountAtomic,
}: {
  action: KaminoVaultAction;
  walletAddress: string;
  vault: KaminoVaultMeta;
  amountAtomic: string;
}): Promise<string> {
  const res = await fetch("/api/kamino/kvaults/ktx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      wallet: walletAddress,
      vault: vault.address,
      amount: amountAtomic,
    }),
  });
  const payload = (await res.json()) as {
    transaction?: string;
    error?: string;
  };
  if (!res.ok || !payload.transaction) {
    throw new Error(payload.error ?? `Kamino ${action} failed (${res.status})`);
  }
  return payload.transaction;
}
