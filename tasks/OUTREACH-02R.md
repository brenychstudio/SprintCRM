# OUTREACH-02R - Manual Campaign Workspace

## Task goal

Deliver the first usable, human-controlled OutreachOps workflow without AI or Gmail:

```text
Create campaign -> add leads -> manual research -> manual message
                -> review -> approve or skip -> next member
```

## Current-state evidence

- Branch: `codex/outreach-02r-manual-campaign-workspace`, created from accepted `OUTREACH-01R`.
- Working tree was clean at task start.
- Linked production history matches local through `20260722000003`; initial dry-run reported the remote database was up to date.
- Existing UI uses React Router, TanStack Query, feature flags, AppShell, LeadDrawer, and four locale dictionaries.
- `OUTREACH-01R` provides campaign/version/suppression/audit tables but no UI, domain services, activity types, or atomic workflow RPCs.

## Files inspected

- `AGENTS.md`
- `src/App.tsx`
- `src/app/layout/AppShell.tsx`
- `src/app/pages/today/TodayPage.tsx`
- `src/app/features/leads/LeadDrawer.tsx`
- `src/features/leads/*`
- `src/features/featureFlags/*`
- `src/i18n/*`
- `supabase/schema.sql`, migrations, and generated database types

## File plan

- Add a narrow additive migration for campaign activity values and atomic approval/skip workflow functions.
- Add campaign domain types, pure workflow helpers/tests, service/repository functions, and query hooks.
- Add feature-flagged Campaign routes: list, setup, overview, review queue, and full workspace.
- Extend sidebar, LeadDrawer, and Today only while `outreach_ops_enabled` is on.
- Add complete `en/uk/es/ru` presentation strings and responsive styles/selectors.
- Record ADR, state updates, manual smoke, and accepted checkpoint.

## Implementation plan

1. Build deterministic status/eligibility/progress/version helpers and tests.
2. Use the existing organization-scoped Supabase access model for reads and normal writes.
3. Add narrow RPCs for approval and skip so their member/message/audit/activity changes are atomic.
4. Keep all campaign routes and integrations inaccessible by default unless `outreach_ops_enabled` is true.
5. Build manual research/message forms that create versions only on explicit save.
6. Validate in authenticated browser state, light/dark modes, narrow viewport, and all locales.

## Risks

- Existing generated database types are stored but the client is not yet instantiated with the generic type; domain services must validate and normalize errors carefully.
- Docker is unavailable, so local reset and behavioral RLS integration remain debt. Production migrations require review/dry-run and catalog verification.
- Current `current_org_id()` is single-workspace oriented; UI must not imply a workspace switcher.
- Activity enum values are additive but must be checked against existing foundation values.

## Acceptance criteria

- Campaign workflow works manually and no action sends mail.
- Member addition is deterministic, explains eligibility, and does not duplicate records.
- Research/message versions are created only by explicit saves.
- Approve/skip write audit and CRM activity without partial success states.
- Full Workspace has stable URLs and next-member navigation.
- Drawer/Today summary and sidebar stay hidden when the feature flag is off.
- Every user-facing new string is localized in `en`, `uk`, `es`, and `ru`.

## Tests and manual smoke

Required gates:

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

Manual smoke covers feature flag off/on, campaign creation, eligibility, duplicate prevention, research/message versioning, approval, skip, drawer, Today, light/dark, narrow view, routes, and all locales.

## Proposed commit message

```text
feat(outreach): add manual campaign workspace
```

## Documentation impact

- `docs/current-state.md`
- `docs/architecture/outreach-target.md`
- `docs/decisions/0005-manual-campaign-workspace.md`
- `docs/accepted-checkpoints/OUTREACH-02R.md`
