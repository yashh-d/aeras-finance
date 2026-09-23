-- Terms of Service acceptance, recorded on the users row.
--
-- terms_version is the TERMS_VERSION constant in lib/legal/terms.ts at the
-- moment the user accepted (by submitting the access form or signing in past
-- the Privy modal's consent line). terms_accepted_at is when. Both are
-- re-stamped on the next sign-in after the version changes, so the row always
-- says which text the user most recently agreed to, which is the record a
-- clickwrap defence rests on.
--
-- Run by hand in the Supabase SQL editor, like every migration here. Until it
-- has run, lib/users.ts stamps nothing and sign-in is unaffected: the stamp
-- is a separate best-effort update after the upsert, precisely so a missing
-- column cannot 500 every login.
alter table public.users
  add column if not exists terms_version     text,
  add column if not exists terms_accepted_at timestamptz;
