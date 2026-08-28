-- Leveraged loop bookkeeping: the one fact about a loop that is not on chain.
-- Run this in the Supabase SQL editor (or via the CLI) once. Idempotent.
--
-- Jupiter Lend's position account carries collateral, debt and liquidation
-- status and nothing else. There is no entry price and no average cost, so a
-- position's P&L cannot be derived from chain state alone: what the user put in
-- has to be recorded when they put it in, or it is gone.
--
-- This also records that a vault's position is leverage-managed at all. The
-- borrow and loop surfaces share one position NFT per vault, so without this
-- flag a loop opened on one device reads as a plain borrow on every other one.
-- Both facts previously lived in localStorage and died with it.
--
-- Nothing here authorises anything. These values are display-only: they size no
-- transaction and gate no action, which is why a wrong row misleads its own
-- owner and no one else. That property is worth preserving — if a basis ever
-- feeds an amount that gets signed, this table stops being bookkeeping and
-- becomes trust-sensitive.

create table if not exists public.loop_positions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  -- The Privy embedded Solana wallet the position belongs to. Resolved
  -- server-side from the verified access token, never accepted from the client.
  wallet_address  text not null,
  vault_id        integer not null,
  -- Equity contributed at open, in USD. Null when the loop is known to be
  -- leverage-managed but its basis was never recorded: a row migrated up from a
  -- legacy localStorage flag, or a position opened before this existed. Callers
  -- must render no P&L in that case rather than inventing one.
  basis_usd       numeric(20, 6) check (basis_usd is null or basis_usd > 0),
  opened_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One record per wallet per vault, which is what the position NFT is.
create unique index if not exists loop_positions_user_wallet_vault_unique
  on public.loop_positions (user_id, wallet_address, vault_id);

create index if not exists loop_positions_user_idx
  on public.loop_positions (user_id);

-- RLS on with no policies: anon/auth keys are denied entirely, matching
-- public.users. All access runs server-side with the service-role key, which
-- bypasses RLS, behind a verified Privy token.
alter table public.loop_positions enable row level security;
