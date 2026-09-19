-- Strategy run bookkeeping: the steps a Strategies-page run has landed and the
-- inputs it was sized from. Run this in the Supabase SQL editor once. Idempotent.
--
-- A strategy is several signed transactions. The chain records each one but
-- not that they belong together, so a refresh between signatures used to lose
-- the run: the user came back to a wallet holding an asset and a loan with no
-- way to tell which step was next. This row is what lets the page resume, and
-- afterwards what lets the Positions view say "borrowed to buy X" instead of
-- showing a plain borrow.
--
-- Display and resume only. Every leg re-reads the wallet and the position on
-- chain before it acts, so a wrong row can mislabel its owner's own position
-- or offer a resume that fails its reconciliation, and nothing more. Keep it
-- that way: if a stored amount ever feeds a transaction unchecked, this table
-- becomes trust-sensitive.

create table if not exists public.strategy_runs (
  -- Client-generated, so a run can be written before its first step lands.
  id              uuid primary key,
  user_id         uuid not null references public.users(id) on delete cascade,
  -- The Privy embedded Solana wallet the run belongs to. Resolved server-side
  -- from the verified access token, never accepted from the client.
  wallet_address  text not null,
  strategy        text not null check (strategy in ('earn', 'leverage', 'ladder')),
  -- The asset the run started with.
  mint            text not null,
  status          text not null check (status in ('running', 'done')),
  -- Step snapshots and the strategy's own inputs and intermediate results.
  -- Shape is owned by lib/strategies/runs-client.ts.
  state           jsonb not null,
  opened_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists strategy_runs_user_wallet_idx
  on public.strategy_runs (user_id, wallet_address);

-- RLS on with no policies: anon/auth keys are denied entirely, matching
-- public.users. All access runs server-side with the service-role key, which
-- bypasses RLS, behind a verified Privy token.
alter table public.strategy_runs enable row level security;
