-- Uniswap liquidity positions the app opened for a user. Run this in the
-- Supabase SQL editor once. Idempotent.
--
-- A Uniswap v4 position is an NFT the PositionManager does not enumerate by
-- owner, so without a row here a position the app minted is invisible to the
-- app (never to the chain). Every row is derived server-side from the mint's
-- receipt (app/api/uniswap/positions, POST): the chain's position manager
-- emitted a Transfer from the zero address to the identity's embedded EVM
-- wallet, and the token id, pool and ticks are read from the chain, never
-- from the browser. v3 positions are also discovered by enumeration on every
-- read, so their rows are a record of when and how they were opened.
--
-- Display only. Every action re-reads the position on chain before it acts,
-- and the LP API is what builds calldata, so a wrong row can mislabel its
-- owner's own position and nothing more. Keep it that way.

create table if not exists public.uniswap_positions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  -- The Privy embedded EVM wallet that holds the NFT. Resolved server-side
  -- from the verified access token, never accepted from the client.
  wallet_address  text not null,
  chain_id        integer not null,
  protocol        text not null check (protocol in ('V3', 'V4')),
  -- uint256, as text: the position manager's token id.
  token_id        text not null,
  -- The registry pool: the pool address on v3, the 32-byte pool id on v4,
  -- lowercased.
  pool_id         text not null,
  tick_lower      integer not null,
  tick_upper      integer not null,
  -- The mint transaction, when the row came from a receipt.
  tx_hash         text,
  opened_at       timestamptz not null default now(),
  -- Set when a read finds the position empty or no longer held.
  closed_at       timestamptz,
  unique (chain_id, protocol, token_id)
);

create index if not exists uniswap_positions_user_wallet_idx
  on public.uniswap_positions (user_id, wallet_address);

-- RLS on with no policies: anon/auth keys are denied entirely, matching
-- public.users. All access runs server-side with the service-role key, which
-- bypasses RLS, behind a verified Privy token.
alter table public.uniswap_positions enable row level security;
