import "server-only";

import { getSupabaseAdmin, UNIQUE_VIOLATION } from "@/lib/supabase/server";

// One Rain card per account, keyed by Privy DID. Only the card ID is stored:
// the PAN and CVC exist in the issuing browser and nowhere else.

// Throws rather than reporting "no card" if the read fails, so a database
// outage can never look like an account that needs a second card issued.
export async function getCardId(privyDid: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("spend_cards")
    .select("card_id")
    .eq("privy_did", privyDid)
    .maybeSingle();
  if (error) throw error;
  return data?.card_id ?? null;
}

// Returns the winner's card ID, which is the existing one if two tabs raced to
// issue. The loser's card is abandoned rather than shown, so an account can
// never end up with two cards it believes in.
export async function claimCard(
  privyDid: string,
  cardId: string,
): Promise<string> {
  const { error } = await getSupabaseAdmin()
    .from("spend_cards")
    .insert({ privy_did: privyDid, card_id: cardId });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return (await getCardId(privyDid)) ?? cardId;
    }
    throw error;
  }
  return cardId;
}
