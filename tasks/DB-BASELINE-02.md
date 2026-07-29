# DB-BASELINE-02 - Capture Production Import Schema Drift

## Task goal

Capture import-history fields that already exist in production but were missing from the repository schema and migration lineage:

- `leads.source_import_id`
- `imports.reverted_at`
- `imports.reverted_by`

This is a forward baseline migration only. It does not change CRM product behavior, rewrite production data, or introduce OutreachOps tables.

## Current-state evidence

Branch: `codex/db-baseline-02-import-drift`, created from accepted `codex/db-reconcile-01`.

Read-only production metadata from linked project `lyimwrbjyryojhprxdhk` confirmed:

| Field | Production table | Type | Nullable | Default | FK | Index |
| --- | --- | --- | --- | --- | --- | --- |
| `source_import_id` | `public.leads` | `uuid` | yes | none | none | `idx_leads_source_import_id` |
| `reverted_at` | `public.imports` | `timestamptz` | yes | none | none | none |
| `reverted_by` | `public.imports` | `uuid` | yes | none | none | none |

RLS remains table-level and organization-scoped:

- `leads_select_org`, `leads_insert_org`, `leads_update_org`, `leads_delete_org`
- `imports_select_org`, `imports_insert_org`, `imports_update_org`, `imports_delete_org`

Grants are unchanged from the existing tables; RLS remains the access boundary for browser clients.

Frontend usage is in `src/app/pages/imports/ImportsPage.tsx`:

- imports are created before lead insert so new leads can store `source_import_id`;
- undo uses `leads.source_import_id = importId` and falls back to `source_file` for legacy imports;
- undo marks `imports.reverted_at`;
- clear-record checks `source_import_id` before deleting an import record.

`reverted_by` exists in production but is not currently written by the UI.

## File plan

- Add `supabase/migrations/20260722000001_capture_import_schema_drift.sql`.
- Update `supabase/schema.sql` so the repository reference schema includes the adopted fields.
- Update `scripts/verify-migrations.mjs` to require this adoption migration.
- Add this task record and accepted checkpoint.
- Update `docs/current-state.md` and `docs/decisions/0003-supabase-migration-baseline.md`.

Generated Supabase types are not stored in this repository yet; the client is currently untyped.

## Implementation plan

1. Add nullable columns using `ADD COLUMN IF NOT EXISTS`.
2. Recreate the production index with `CREATE INDEX IF NOT EXISTS`.
3. Do not add FK constraints because production has none and import cleanup relies on application checks instead of database referential behavior.
4. Do not add or modify RLS policies because existing org-scoped table policies already cover the fields.
5. Dry-run against linked production before applying.
6. Apply the migration only after dry-run confirms there are no unexpected operations.
7. Re-run migration list and dry-run to confirm remote is up to date.

## Risks

- Adding an FK for `source_import_id` would change import cleanup behavior; intentionally not added.
- `reverted_by` is not currently used by the frontend; it is captured only because production already contains it.
- Docker Desktop is unavailable in this environment, so local `supabase db reset` remains a documented verification debt.

## Acceptance criteria

- The three import drift fields are represented by a forward migration and `supabase/schema.sql`.
- Old migration files remain unchanged.
- Production data is not rewritten.
- Production schema changes are limited to an idempotent no-op for already-present objects.
- Remote migration history includes the new version.
- `supabase db push --dry-run` reports the remote database is up to date after apply.
- Standard gates pass.

## Tests

Required:

```powershell
npm run verify:migrations
npm run typecheck
npm run lint
npm run test
npm run build
git diff --check
supabase migration list
supabase db push --dry-run
```

Production apply:

```powershell
supabase db push
supabase migration list
supabase db push --dry-run
```

Manual smoke:

- Review `ImportsPage` queries for the adopted fields.
- No UI surfaces changed, so light/dark and authenticated visual smoke are not required for this database-only task.

## Commit message

```text
chore(db): capture production import schema drift
```

## Documentation update

- `docs/current-state.md`
- `docs/decisions/0003-supabase-migration-baseline.md`
- `docs/accepted-checkpoints/DB-BASELINE-02.md`
