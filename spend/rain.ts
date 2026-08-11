import "server-only";

// Rain sandbox client. Every card in this module is a "scoped" card: a virtual
// Visa capped at a fixed amount, issued against the single Rain cardholder our
// team is provisioned with. Rain applies a 1.2x ceiling on top of the cap to
// absorb authorization holds, so the limit read back is higher than what we ask
// for.

const API = "https://api-dev.raincards.xyz/v1";

export const CARD_CAP_CENTS = 50_000;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env.local.`);
  return v;
}

async function rain<T>(
  path: string,
  init?: { method?: string; body?: unknown; sessionId?: string },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Api-Key": env("RAIN_API_KEY"),
      "Content-Type": "application/json",
      ...(init?.sessionId ? { sessionid: init.sessionId } : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Rain ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export type Encrypted = { iv: string; data: string };

export type Card = {
  id: string;
  status: "notActivated" | "active" | "locked" | "canceled";
  last4: string;
  expirationMonth: string;
  expirationYear: string;
  limit?: { amount: number; frequency: string };
};

export type IssuedCard = Card & {
  encryptedPan: Encrypted;
  encryptedCvc: Encrypted;
};

export type Purchase = {
  id: string;
  status: "pending" | "completed" | "declined" | "reversed";
  amount: number;
  merchantName: string;
  at: string;
};

// The session ID is generated in the browser and travels through us untouched,
// so only the browser that made it can decrypt the PAN and CVC we return.
export function issueCard(sessionId: string): Promise<IssuedCard> {
  return rain<IssuedCard>(
    `/issuing/users/${env("RAIN_USER_ID")}/cards/scoped`,
    { method: "POST", body: { amountInUSDCents: CARD_CAP_CENTS }, sessionId },
  );
}

export function getCard(cardId: string): Promise<Card> {
  return rain<Card>(`/issuing/cards/${cardId}`);
}

type SpendRow = {
  id: string;
  type: string;
  spend?: {
    amount: number;
    status: Purchase["status"];
    merchantName: string;
    authorizedAt?: string;
    postedAt?: string;
  };
};

export async function listPurchases(cardId: string): Promise<Purchase[]> {
  const rows = await rain<SpendRow[]>(
    `/issuing/transactions?cardId=${cardId}&type=spend&limit=25`,
  );
  return rows.flatMap((row) =>
    row.spend
      ? [
          {
            id: row.id,
            status: row.spend.status,
            amount: row.spend.amount,
            // Rain space-pads merchant names to the network field width.
            merchantName: row.spend.merchantName.trim(),
            at: row.spend.postedAt ?? row.spend.authorizedAt ?? "",
          },
        ]
      : [],
  );
}

type AuthorizeResult = {
  transactionId: string;
  status: "authorized" | "declined";
  declinedReason?: string;
};

// Authorize then capture, which is what a card purchase looks like once the
// merchant has settled. Rain documents `amount` as optional on settle, but the
// endpoint rejects a body without it.
export async function charge(
  cardId: string,
  amount: number,
  merchantName: string,
  merchantCategoryCode: string,
): Promise<{ declined: boolean; reason?: string }> {
  const auth = await rain<AuthorizeResult>("/simulate/transactions/authorize", {
    method: "POST",
    body: { cardId, amount, currency: "USD", merchantName, merchantCategoryCode },
  });
  if (auth.status === "declined") {
    return { declined: true, reason: auth.declinedReason };
  }
  await rain(`/simulate/transactions/${auth.transactionId}/settle`, {
    method: "POST",
    body: { amount },
  });
  return { declined: false };
}
