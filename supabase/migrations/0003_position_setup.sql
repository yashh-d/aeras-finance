-- One-time account rent paid to open a position at a lending venue.
-- Run this in the Supabase SQL editor (or via the CLI) once. Idempotent.
--
-- Solana charges rent to keep an account alive, so a first position at a venue
-- allocates per-user accounts the borrower pays for: on Kamino a UserMetadata
-- account, an address lookup table and an obligation, 0.030500 SOL together; on
-- Jupiter Lend a position record, an NFT mint and its token account, 0.004446
-- SOL. Before the preflight in lib/borrow/setup-cost.ts existed, a wallet that
-- could not cover this got a raw simulation error and no explanation.
--
-- This records what was actually paid. It answers questions the chain cannot,
-- because on chain a funded setup is indistinguishable from a wallet that
-- happened to have enough SOL: how many users meet this cost at all, how many
-- had to buy SOL to clear it, and what it cost them on the day.
--
-- **Nothing here gates anything, and it must stay that way.** Whether to show
-- the setup sheet is decided by reading the accounts on chain, never by looking
-- for a row here. That is deliberate and it is the whole reason this table is
-- write-only from the app: a row asserting "this wallet already paid Kamino's
-- rent" would both authorise skipping the sheet and size a funding amount, so a
-- stale or missing one would either charge someone $3.17 they do not owe or
-- wave them into the exact failure this was built to remove. 0002 states the
-- same rule for loop basis and gives the same reason. A wrong row here misleads
-- an analyst, and no one else. Preserve that.
--
-- There is deliberately no read endpoint. Analysis happens against this table
-- directly; app code has no business asking it anything.

create table if not exists public.position_setup (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  -- The Privy embedded Solana wallet that paid. Resolved server-side from the
  -- verified access token, never accepted from the client, for the reason
  -- app/api/loops/route.ts gives: the address is public, so trusting a supplied
  -- one would let any signed-in user write rows against someone else.
  wallet_address  text not null,
  venue           text not null check (venue in ('kamino', 'jupiter')),
  -- Rent for the accounts this setup allocated, and the fee allowance quoted
  -- alongside it. Lamports, because that is the unit the chain charges in and
  -- the unit the failure that motivated this reported. SOL price moves; the
  -- lamport figure is what was actually true.
  rent_lamports   bigint not null check (rent_lamports > 0),
  fee_lamports    bigint not null default 0 check (fee_lamports >= 0),
  -- How the user covered it, in ascending order of how stuck they were:
  --   'existing_balance' they already held enough SOL
  --   'usdc_swap'        they held USDC and swapped it through Jupiter Ultra
  --   'collateral_sale'  they held no SOL and no USDC, so a sliver of the stock
  --                      they were depositing was sold for SOL instead. Free and
  --                      instant, and the only route that costs position size
  --                      rather than idle cash, which is why it is its own value
  --   'privy_funding'    they held none of the above and brought SOL in from
  --                      outside the app
  -- This split IS the "how many people hit the wall" measurement, and the third
  -- value is the one worth watching: it means a user arrived with no usable
  -- money at all and had to go and get some before they could open a position.
  funded_via      text not null
                    constraint position_setup_funded_via_check
                    check (funded_via in ('existing_balance', 'usdc_swap',
                                         'collateral_sale', 'privy_funding')),
  -- Dollar value of whatever was sold, and the swap signature. For 'usdc_swap'
  -- that is the USDC spent; for 'collateral_sale' the market value of the stock
  -- sold, which is the figure worth comparing across the two. Both null for the
  -- other routes: funding from outside settles at the provider, so there is no
  -- amount we can observe and no signature we own.
  funding_usd     numeric(20, 6) check (funding_usd is null or funding_usd > 0),
  funding_signature text,
  -- Which route they took through Privy's funding flow, for privy_funding rows.
  -- Worth separating from funded_via because 'external' and 'manual' are free
  -- and mean the user already had SOL elsewhere, while the two card providers
  -- carry a fee and a minimum that dwarfs a $3.17 setup. A population that
  -- mostly picks a card is a different problem from one that mostly transfers.
  -- Null when the user closed the flow before choosing, which can still end in
  -- a funded wallet if money was already in flight.
  funding_method  text
                    constraint position_setup_funding_method_check
                    check (funding_method is null or funding_method in
                      ('moonpay', 'coinbase-onramp', 'external', 'manual')),
  opened_at       timestamptz not null default now(),

  -- Keeps the funding shapes from drifting into nonsense: a swap that records
  -- no amount, or a balance- or card-funded row carrying swap details it cannot
  -- have.
  constraint position_setup_funding_shape check (
    (funded_via in ('usdc_swap', 'collateral_sale') and funding_usd is not null
     and funding_method is null)
    or (funded_via = 'privy_funding' and funding_usd is null
        and funding_signature is null)
    or (funded_via = 'existing_balance' and funding_usd is null
        and funding_signature is null and funding_method is null)
  )
);

-- funding_usdc became funding_usd once collateral sales started landing here:
-- the column holds dollars of whatever was sold, and only one of the two routes
-- sells USDC. Guarded so a re-run is a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'position_setup'
      and column_name = 'funding_usdc'
  ) then
    alter table public.position_setup rename column funding_usdc to funding_usd;
  end if;
end $$;

-- Re-applied on every run, so a database created from an earlier copy of this
-- file picks the new values up. `create table if not exists` above is a no-op
-- once the table exists, which means a changed constraint would otherwise never
-- land and inserts would fail against a stale check.
alter table public.position_setup
  add column if not exists funding_method text;

alter table public.position_setup
  drop constraint if exists position_setup_funded_via_check;
alter table public.position_setup
  add constraint position_setup_funded_via_check
  check (funded_via in ('existing_balance', 'usdc_swap', 'collateral_sale',
                        'privy_funding'));

alter table public.position_setup
  drop constraint if exists position_setup_funding_method_check;
alter table public.position_setup
  add constraint position_setup_funding_method_check
  check (funding_method is null or funding_method in
    ('moonpay', 'coinbase-onramp', 'external', 'manual'));

alter table public.position_setup
  drop constraint if exists position_setup_funding_shape;
alter table public.position_setup
  add constraint position_setup_funding_shape check (
    (funded_via in ('usdc_swap', 'collateral_sale') and funding_usd is not null
     and funding_method is null)
    or (funded_via = 'privy_funding' and funding_usd is null
        and funding_signature is null)
    or (funded_via = 'existing_balance' and funding_usd is null
        and funding_signature is null and funding_method is null)
  );

-- No unique index on (user_id, wallet_address, venue), and that is not an
-- oversight.
--
-- On Kamino this cost is genuinely once per wallet: the obligation and
-- UserMetadata are per user and every later position reuses them. On Jupiter
-- Lend it is once per POSITION, because each one mints its own NFT with its own
-- accounts, so a user who closes a position and opens another pays again. A
-- uniqueness constraint would be correct for one venue and would silently
-- discard real payments at the other. This is an event log, so it can describe
-- both truthfully; "has this wallet ever paid" is a query, not a row shape.
create index if not exists position_setup_user_wallet_venue_idx
  on public.position_setup (user_id, wallet_address, venue);

create index if not exists position_setup_opened_at_idx
  on public.position_setup (opened_at desc);

-- RLS on with no policies: anon/auth keys are denied entirely, matching
-- public.users and public.loop_positions. All access runs server-side with the
-- service-role key, which bypasses RLS, behind a verified Privy token.
alter table public.position_setup enable row level security;
