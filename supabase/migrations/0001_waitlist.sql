-- Aeras Finance access control: an invite-only waitlist gated behind Privy login.
-- Run this in the Supabase SQL editor (or via the CLI) once. Idempotent.
--
-- Two identities are merged by email:
--   1. A waitlist row created when an anonymous visitor submits the form
--      (status = 'waitlisted', no Privy account yet).
--   2. A Privy account created on login, which provisions an embedded Solana
--      wallet. On the first verified sync we stamp the Privy DID + wallet onto
--      the matching email row, or create a fresh one.
--
-- A user reaches the app only when an admin sets status = 'approved'.

create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  privy_did       text unique,                       -- null until the user logs in
  email           text,                              -- always stored lowercased
  name            text,
  wallet_address  text,                              -- Privy embedded Solana wallet
  status          text not null default 'waitlisted'
                    check (status in ('waitlisted', 'approved', 'rejected', 'banned')),
  invited_by      uuid references public.users(id),  -- referral graph
  referral_code   text unique not null
                    default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  reason          text,
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- Email is the merge key. Case-insensitive uniqueness so a form submit and a
-- later login on the same address resolve to one row.
create unique index if not exists users_email_unique
  on public.users (lower(email))
  where email is not null;

create index if not exists users_status_created_idx
  on public.users (status, created_at);

-- Queue position: number of still-waitlisted users created before me, +1.
-- Approved/rejected/banned users don't hold a slot. Null if not waitlisted.
create or replace function public.waitlist_position(user_email text)
returns int
language sql stable
as $$
  with me as (
    select created_at, status from public.users where lower(email) = lower(user_email)
  )
  select case
    when (select status from me) <> 'waitlisted' then null
    else (
      select count(*)::int + 1
      from public.users u, me
      where u.status = 'waitlisted' and u.created_at < me.created_at
    )
  end;
$$;

-- RLS on with no policies: anon/auth keys are denied entirely. All access runs
-- server-side with the service-role key, which bypasses RLS.
alter table public.users enable row level security;
