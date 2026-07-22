# DB-RECONCILE-01 - Production schema and migration history reconciliation

## Goal

Adopt the verified local migration lineage in CRM studio's remote migration history without executing legacy SQL or changing production business data/schema.

## Current-state evidence

- `7144baa` is an ancestor of `a9454dc`; this task starts from the linked-project branch.
- Production contains the expected CRM tables, RLS flags, organization policies, enum values, constraints, triggers and indexes.
- `supabase migration list --linked` originally showed every local migration with a blank remote version; direct read-only inspection confirmed `supabase_migrations.schema_migrations` was absent.
- The three original 2026-04-27 migration filenames used the same version. They have been normalized to unique ordered versions before repair.

## Migration evidence map

| Local migration | Production evidence | Decision |
| --- | --- | --- |
| `20260222_org_ready_hardening_patch.sql` | Org-scoped dedup indexes, org/status/due index, owner FKs, `sync_activity_org_id_from_lead`, activity trigger, and `default_next_step_for_stage` exist. | Mark applied. |
| `20260427000001_ai_outreach_foundation.sql` | All seven activity enum values, `ai_generations` columns/checks/FKs/indexes/RLS policies, lead outreach fields/checks/FK/indexes exist. | Mark applied. |
| `20260427000002_data_safety_policies.sql` | Org-scoped delete policies exist for leads/activities; imports update policy exists. | Mark applied. |
| `20260427000003_import_history_cleanup_policy.sql` | Org-scoped imports delete policy exists. | Mark applied. |

## Pre-existing drift outside migration lineage

Production also contains `leads.source_import_id`, `idx_leads_source_import_id`, and `imports.reverted_at` / `imports.reverted_by`. The frontend uses these fields, but they are not represented in the local schema file or any tracked migration. They are not evidence against the four verified migrations; they are a separate manual-schema adoption gap. This task does not alter them.

## Strategy and safety controls

Use `supabase migration repair --status applied` only after the evidence above. This writes migration-history metadata only; it does not execute the migration SQL. `db push`, `db reset --linked`, schema/data changes, and old SQL replay are prohibited.

## Local reproducibility

Docker Desktop is unavailable, so a local `supabase start` / `supabase db reset` check cannot run. In addition, the repo has an unversioned `supabase/schema.sql` bootstrap and the manual import fields above are not migration-backed. This is documented technical debt; it must be resolved in a follow-up before claiming a fully reproducible from-zero database bootstrap.

## Acceptance criteria

- Every tracked migration has evidence that its effects exist in production.
- Each migration has a unique CLI version.
- Remote history matches local versions and dry-run has no pending legacy migration.
- No production schema, data, or legacy SQL is changed.

## Result

All four versions were marked applied only after evidence review. `supabase migration list` now shows matching local/remote versions, and `supabase db push --dry-run` reports `Remote database is up to date`. No production schema or business data was changed.

## Proposed commit

```text
chore(db): reconcile production migration history
```
