# Current state - OUTREACH-00R

Baseline recorded on 2026-07-22 from `codex/outreach-00r-rebaseline` (created from `main` at `23754b0`). The working tree was clean before this task.

## Product surfaces

| Area | Current implementation |
| --- | --- |
| Routes | `/today`, `/active-contacts`, `/leads`, `/imports`, `/pipeline`, `/reports`; all authenticated behind `RequireAuth`. |
| Lead workspace | `LeadDrawer` is a portal-backed, fixed-position operational panel for identity, next action, result/stage changes, notes, context, activity history, archive and safe delete. |
| Data access | Client-side Supabase wrappers live in `src/features/leads/leadsApi.ts`, `src/features/ai/aiGenerationsApi.ts`, and `src/features/reports/exportCsv.ts`. |
| Database | `organizations`, `memberships`, `leads`, `activities`, and `imports` are defined in `supabase/schema.sql`; later migrations harden org deduplication, activity org consistency, and delete/update policies. |
| Localization | `en`, `uk`, `es`, `ru` dictionaries via `src/i18n`. |
| Theme | `useThemeMode` persists light/dark state using `data-theme`; drawer-specific theme selectors exist in `src/style.css`. |

## Existing AI/outreach foundation

`20260427_ai_outreach_foundation.sql` adds `ai_generations`, several lead-level outreach snapshot fields, AI activity enum values, indexes, and org-member RLS policies. The frontend has matching handwritten types and direct client CRUD helpers, but no UI imports or routes currently use them.

This is an early lead-centric draft-history foundation, not the target OutreachOps domain. It must not be expanded casually: future work should introduce campaign-scoped tables additively and migrate UI access to server-side functions before any model invocation.

## Production migration verification

On 2026-07-22, Supabase CLI `2.108.0` was initialized and linked to production project `lyimwrbjyryojhprxdhk` (CRM studio). The database password stays only in the ignored root `.env` as `SUPABASE_DB_PASSWORD`; it is not in `config.toml`, source code, or Git.

Read-only production checks confirm that `organizations`, `memberships`, `leads`, `activities`, `imports`, and `ai_generations` exist and have RLS enabled. Their policies match the intended organization-scoped policy names in the local schema and outreach foundation migration.

The schema was created manually before CLI migration history existed. After evidence-based reconciliation, remote history now matches the four local versions exactly:

```text
20260222
20260427000001
20260427000002
20260427000003
```

`supabase db push --dry-run` reports `Remote database is up to date`; no legacy SQL was replayed. Future production schema changes must use reviewed migrations only.

The Supabase database advisors reported these existing follow-ups:

- add fixed `search_path` to `normalize_lead_fields` and `set_updated_at`;
- restrict unnecessary RPC execution of SECURITY DEFINER trigger/helper functions after confirming which calls require authenticated execution;
- enable Auth leaked-password protection;
- review indexes on owner foreign keys and the `memberships_select_own` policy initialization plan after measuring production workload.

## Engineering baseline added here

- Node pin: `.nvmrc` (`24.13.0`).
- Scripts: `typecheck`, `test:unit`, and static `verify:migrations`.
- Unit-test foundation: Vitest plus tests for the feature-flag resolver.
- CI: `.github/workflows/ci.yml` runs install, migration checks, typecheck, lint, unit tests, and build.
- Feature-flag foundation defaults all future OutreachOps controls to off; no screen reads it yet.

## Known gaps and risks

1. There are no generated Supabase database types; current domain types are handwritten.
2. The `aiGenerationsApi` permits authenticated browser clients to create/update AI generation records. This must be replaced or restricted before supervised AI jobs are introduced.
3. Existing `ai_generations` RLS has select/insert/update policies but no delete policy; this is conservative but needs an explicit retention decision.
4. The current `current_org_id()` function selects the oldest membership. This is adequate for a personal internal CRM but is not a future active-organization selector.
5. A manual import-schema drift remains outside the tracked lineage: `leads.source_import_id`, `idx_leads_source_import_id`, `imports.reverted_at`, and `imports.reverted_by` exist in production and are used by the frontend, but are absent from local schema/migrations. Do not alter them without a dedicated adoption migration decision.
6. The supplied PDF references could not be text-extracted or visually opened in this runtime because neither Poppler/Python PDF tools nor an available browser runtime is installed. The master brief remains the authoritative source for this baseline; review the original PDFs before schema implementation if they contain constraints not repeated in it.
