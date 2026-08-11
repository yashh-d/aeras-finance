-- Spend rail: one Rain scoped card per account.
--
-- Only the Rain card ID is stored. The card number and CVC are decrypted in the
-- browser that issued the card and are never sent to us or persisted anywhere.
--
-- This table is standalone by design, with no foreign key into public.users, so
-- the whole spend module can be dropped in one statement:
--   drop table public.spend_cards;

create table if not exists public.spend_cards (
  privy_did   text primary key,
  card_id     text not null,
  created_at  timestamptz not null default now()
);
