// Browser half of the loop bookkeeping store. Pairs with lib/loops.ts.
//
// The server is the source of truth. localStorage stays on as a first-paint
// hint so a loop that is already known does not flicker through "plain borrow"
// on every load, and as the migration source for loops opened before this
// table existed. Where the two disagree, the server wins.

export interface LoopRecord {
  managed: boolean;
  // Equity contributed at open, in USD. Null when the loop is known but its
  // basis is not, in which case callers must show no P&L rather than invent one.
  basisUsd: number | null;
}

export const EMPTY_LOOP_RECORD: LoopRecord = { managed: false, basisUsd: null };

export function loopStorageKey(walletAddress: string, vaultId: number): string {
  return `aeras:loop:${walletAddress}:${vaultId}`;
}

// Synchronous read for the first paint. Loops opened before basis tracking
// wrote a bare "1": still managed, nothing to measure against.
export function readCachedLoopRecord(key: string): LoopRecord {
  if (typeof window === "undefined") return EMPTY_LOOP_RECORD;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return EMPTY_LOOP_RECORD;
  }
  if (!raw) return EMPTY_LOOP_RECORD;
  if (raw === "1") return { managed: true, basisUsd: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    const basis = (parsed as { basisUsd?: unknown })?.basisUsd;
    return {
      managed: true,
      basisUsd: typeof basis === "number" && basis > 0 ? basis : null,
    };
  } catch {
    // Present but unreadable: keep the loop label, drop the basis. Under-
    // labelling a loop is the more damaging of the two possible errors.
    return { managed: true, basisUsd: null };
  }
}

export function writeCachedLoopRecord(key: string, record: LoopRecord): void {
  try {
    if (!record.managed) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ v: 1, basisUsd: record.basisUsd }));
  } catch {}
}

type Token = () => Promise<string | null>;

async function call(
  getAccessToken: Token,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch("/api/loops", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string })?.error ?? `Request failed (${res.status}).`,
    );
  }
  return data;
}

export async function fetchLoopRecord(
  getAccessToken: Token,
  vaultId: number,
): Promise<LoopRecord> {
  const data = (await call(getAccessToken, "GET")) as {
    records?: { vaultId: number; basisUsd: number | null }[];
  };
  const hit = (data.records ?? []).find((r) => r.vaultId === vaultId);
  return hit ? { managed: true, basisUsd: hit.basisUsd } : EMPTY_LOOP_RECORD;
}

// "add" for a loop that was just opened: the basis accumulates, because a
// second loop into the same vault adds to what the position cost. "seed" for
// carrying a pre-Supabase local record up, which must not inflate a basis the
// server already has.
export type BasisMode = "add" | "seed";

export async function saveLoopRecord(
  getAccessToken: Token,
  vaultId: number,
  basisUsd: number | null,
  mode: BasisMode,
): Promise<LoopRecord> {
  const data = (await call(getAccessToken, "POST", {
    vaultId,
    basisUsd,
    mode,
  })) as {
    record?: { basisUsd: number | null } | null;
  };
  return data.record
    ? { managed: true, basisUsd: data.record.basisUsd }
    : { managed: true, basisUsd };
}

export async function clearLoopRecord(
  getAccessToken: Token,
  vaultId: number,
): Promise<void> {
  await call(getAccessToken, "DELETE", { vaultId });
}
