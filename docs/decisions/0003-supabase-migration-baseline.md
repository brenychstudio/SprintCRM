# ADR 0003: Adopt verified production migrations without replaying SQL

**Status:** Accepted on 2026-07-22.

## Context

CRM studio's production schema was created manually before this repository adopted Supabase CLI migrations. The production tables and policies exist, but remote migration history was absent. Three local migrations also shared version `20260427`, which cannot provide a one-to-one history record.

## Decision

Preserve the existing local migration lineage. Rename the three same-day files to unique ordered versions:

```text
20260427000001_ai_outreach_foundation.sql
20260427000002_data_safety_policies.sql
20260427000003_import_history_cleanup_policy.sql
```

After read-only production evidence confirmed every effect, `supabase migration repair --status applied` recorded these local versions on 2026-07-22:

```text
20260222
20260427000001
20260427000002
20260427000003
```

Repair updated migration metadata only; it did not execute SQL. `supabase db push --dry-run` then reported that the remote database is up to date.

## Consequences

- Do not replay old migration SQL or run `db push` during reconciliation.
- Future production schema changes are migrations only; direct Dashboard/Table Editor schema changes are forbidden.
- Only one operator may run a migration write at a time, from a clean linked worktree after review and a dry run.
- Manual import fields that predate this lineage remain documented drift and require a later bootstrap/adoption decision.
