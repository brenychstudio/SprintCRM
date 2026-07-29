# DB-BASELINE-02 Accepted Checkpoint

Status: accepted for handoff.

Date: 2026-07-22
Branch: `codex/db-baseline-02-import-drift`
Recommended commit: `chore(db): capture production import schema drift`

## Result

Production import schema drift was captured in a forward migration:

```text
20260722000001_capture_import_schema_drift.sql
```

The migration mirrors production exactly for the adopted fields:

- `leads.source_import_id uuid null`
- `imports.reverted_at timestamptz null`
- `imports.reverted_by uuid null`
- `idx_leads_source_import_id` on `public.leads(source_import_id)`

No FK was added because production has no FK for these fields. No RLS policy or grant changes were added because table-level organization policies already cover access.

## Production safety

The migration uses `ADD COLUMN IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. On the linked production database, it should be a controlled no-op for schema objects already present.

Production data must not be updated or backfilled by this task.

## Verification

Final command results:

```text
npm run verify:migrations - pass
npm run typecheck - pass
npm run lint - pass
npm run test - pass, 2 tests
npm run build - pass, existing Vite chunk-size warning
git diff --check - pass
supabase migration list - pass, local and remote both include 20260722000001
supabase db push --dry-run - pass before apply, only 20260722000001 pending
supabase db push - pass, existing production columns/index skipped via IF NOT EXISTS
supabase migration list - pass after apply
supabase db push --dry-run - pass, remote database is up to date
```

The production apply emitted expected notices for already-existing objects:

- `leads.source_import_id` already exists
- `imports.reverted_at` already exists
- `imports.reverted_by` already exists
- `idx_leads_source_import_id` already exists

No production data was rewritten.

## Remaining debt

Docker Desktop is unavailable in this environment, so local `supabase db reset` remains open verification debt before staging or public deployment.

Generated Supabase types are not stored in the repository yet. OUTREACH-01R should introduce generated database types before the new campaign domain starts relying on typed contracts.
