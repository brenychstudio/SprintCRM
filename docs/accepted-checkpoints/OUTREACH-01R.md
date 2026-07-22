# OUTREACH-01R Accepted Checkpoint

Status: accepted.

Date: 2026-07-22

Branch: `codex/outreach-01r-minimal-campaign-domain`
Recommended commit: `feat(outreach): add minimal campaign domain`

## Delivered domain

- `campaigns` and `campaign_members`
- immutable `research_snapshots`
- `message_templates` and immutable `template_versions`
- versioned `outbound_messages`
- `suppression_entries` with active normalized lookup uniqueness
- append-only `audit_events`

Production migrations:

```text
20260722000002_outreach_campaign_domain.sql
20260722000003_outreach_campaign_rls.sql
```

## Production evidence

Production apply created only the two new migrations. Catalog verification confirmed all eight tables, RLS enabled on all eight, expected policy counts, composite organization foreign keys, outbound/audit immutability triggers, and `uidx_suppression_entries_active_subject`.

## Verification

```text
npm run verify:migrations - pass (7 migration files; duplicate-version and domain guard checks)
npm run typecheck - pass
npm run lint - pass
npm run test - pass (2 tests)
npm run build - pass (existing Vite chunk-size warning only)
git diff --check - pass
supabase migration list - pass; local and remote match through 20260722000003
supabase db push --dry-run - pass; Remote database is up to date
```

Linked production catalog checks confirmed:

- all eight new tables exist and have RLS enabled;
- policy counts are 4 for mutable tables and 2 for versioned/audit tables;
- composite organization foreign keys are present for campaign/member, research, template, outbound-message, lead, and AI-generation relationships;
- the active normalized suppression unique index exists;
- audit append-only and outbound-content immutability triggers exist.

## Remaining verification debt

Docker Desktop is unavailable in this environment. Local `supabase db reset` and behavioral RLS integration coverage remain required before staging, private beta, public SaaS, or any complex destructive migration.
