# OUTREACH-01R - Minimal Campaign Domain

## Task goal

Create the additive, organization-isolated database foundation for campaign-based OutreachOps:

```text
Campaign -> Campaign members -> Research versions -> Message versions
         -> Templates -> Suppression -> Technical audit
```

This is a schema-only task. It excludes Campaign UI, AI calls, Edge Functions, Gmail, queues, replies, follow-ups, and sending.

## Current-state evidence

Branch: `codex/outreach-01r-minimal-campaign-domain`, created from accepted `codex/db-baseline-02-import-drift`.

At task start, local and linked production migration histories matched through `20260722000001`, and `supabase db push --dry-run` reported the remote database was up to date.

Existing schema conventions are:

- `text + CHECK` for evolving workflow values;
- `public.current_org_id()` defaults and `public.is_org_member(organization_id)` RLS;
- `auth.users` foreign keys for actor attribution;
- `activities` as the canonical CRM timeline.

## File plan

- Add `20260722000002_outreach_campaign_domain.sql` for tables, constraints, indexes, and immutable-write guards.
- Add `20260722000003_outreach_campaign_rls.sql` for RLS and organization-scoped policies.
- Update `supabase/schema.sql` and `scripts/verify-migrations.mjs`.
- Store generated public-schema types at `src/lib/supabase/database.types.ts`.
- Add the ADR and accepted checkpoint; update state and target architecture documentation.

## Design decisions

1. Campaign-specific workflow state remains in `campaign_members`; `leads` stays the core contact entity.
2. Research, template content, and outbound messages use monotonically positive versions.
3. Composite foreign keys include `organization_id`. Redundant unique pairs on `leads(id, org_id)` and `ai_generations(id, org_id)` make cross-org references impossible at the database level.
4. Research/template records have no authenticated update policy. Outbound message content has a database trigger that requires a new version for a substantive rewrite.
5. `audit_events` is separate from `activities`, has no authenticated update/delete policy, and has a trigger rejecting all mutation.
6. Workflow statuses use named `CHECK` constraints, matching the current schema instead of introducing premature PostgreSQL enums.

## Risks

- `ON DELETE RESTRICT` protects future campaign history once a lead is a campaign member. Current CRM records are unaffected because no legacy lead is linked by this task.
- Docker Desktop remains unavailable. Local `supabase db reset` and behavioral RLS integration coverage are deferred verification debt before staging, private beta, public SaaS, or destructive migrations.
- Generated database types are now stored, but this task intentionally does not refactor the existing handwritten client access layer.

## Acceptance criteria

- Eight new organization-scoped tables exist with RLS.
- Composite foreign keys prevent cross-organization entity references.
- Membership and versions have parent-scoped uniqueness.
- Suppression has active normalized case-insensitive uniqueness.
- Audit is append-only at database level.
- Current CRM UI, feature-flag defaults, and business workflow are unchanged.
- Linked migration history is synchronized and final dry-run is clean.

## Required verification

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

Database catalog verification also checks all eight tables, RLS, policy counts, composite FK definitions, immutability triggers, and the suppression lookup index.

No UI changes are made, so visual light/dark smoke is not applicable.

## Commit message

```text
feat(outreach): add minimal campaign domain
```
