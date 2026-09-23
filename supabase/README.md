# Migrations

Run these **by hand in the Supabase SQL editor**. Every file is written to be
idempotent, so re-running one is safe and is how a changed constraint lands.

## Do not `supabase db push`

The Supabase project is shared with another application. Its migration history
table holds seven migrations belonging to that app and none of ours:

```
20260426120000_create_ledger_submissions      20260519130000_tighten_rls_for_production
20260427120000_ledger_rls_for_anon_key        20260520120000_create_content_drafts
20260428120000_ledger_public_text             20260522184530_ventura_waitlist
20260519120000_add_title_and_content_type
```

None of those are Aeras. Our own tables (`users`, `loop_positions`,
`position_setup`) were created by pasting these files into the SQL editor, which
does not write to the history table, so local and remote have zero overlap.

`supabase db push` therefore refuses with "Remote migration versions not found in
local migrations directory" and suggests:

```
supabase migration repair --status reverted 20260426120000 ...
```

**Do not run that.** It rewrites the history of the other application's
migrations in a database Aeras shares. `--include-all` hits the same wall and is
not a way around it.

## Applying one file with the CLI, if you must

Only needed if the SQL editor is unavailable. It leaves this repo untouched:

1. `supabase link --project-ref <ref>` (the CLI's stored login is enough; no
   database password is required)
2. In a scratch directory, `supabase migration fetch --linked` to pull the
   remote history into `supabase/migrations/` there
3. Copy the one file in under a timestamped name that sorts after the existing
   entries, e.g. `20260905120000_position_setup.sql`
4. `supabase db push --linked --dry-run --workdir <scratch>` and confirm it lists
   only your file
5. Drop `--dry-run`

This adds one row to the shared history table, which is accurate rather than
harmful. `0003_position_setup.sql` was applied this way on 2026-09-05, and
`0003_strategy_runs.sql` on 2026-09-22 (as `20260922120000_strategy_runs.sql`).
The link needed no database password either time, and the dry run listed only
the one new file, which is the check that the other application's seven
migrations are not about to be touched. Do not skip it.

## Which files are applied

The history table does not say, because the early ones were pasted into the
SQL editor. Ask the database instead: a `GET {SUPABASE_URL}/rest/v1/<table>
?limit=0` with the service-role key answers 200 when the table exists and 404
when it does not. As of 2026-09-22 `users`, `loop_positions`,
`position_setup`, `strategy_runs` and `uniswap_positions` all answer 200, so
every file in this directory is applied.

## Watch the dollar quoting

`0003` shipped briefly with `do $` instead of `do $$` and failed on the first
push. The cause was a `String.replace()` whose replacement contained `$$`, which
JavaScript treats as an escape for a single `$`. If you edit these files with a
script rather than by hand, use a replacer function, and read the diff before
pushing: the CLI runs each migration in a transaction, so the failure rolled back
cleanly, but it was only caught because the migration was actually run.
