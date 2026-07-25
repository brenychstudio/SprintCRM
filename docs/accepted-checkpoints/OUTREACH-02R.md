# OUTREACH-02R Checkpoint

Status: implementation complete; awaiting authenticated browser smoke.

Date: 2026-07-25
Branch: `codex/outreach-02r-manual-campaign-workspace`
Recommended commit: `feat(outreach): add manual campaign workspace`

## Delivered

- Feature-flagged Campaign routes, sidebar navigation, list, setup wizard, overview, Review Queue redirect, and Full Workspace.
- Manual research/evidence and manual message flows that create immutable versions on explicit save.
- Compact LeadDrawer outreach summary and minimal Today entry point, both flag-gated.
- Narrow atomic RPCs for create/update, eligibility/member addition, research/message version creation, approval, and skip.
- New CRM activity enum values, audit writes, generated types, migration verifier coverage, unit tests, and lazy route chunks.

## Production verification

- `20260725000001_campaign_activity_types.sql` and `20260725000002_manual_campaign_workspace_rpc.sql` are applied to linked production.
- `supabase migration list` matched local and remote after apply.
- `supabase db push --dry-run` reported the remote database is up to date.
- Catalog query confirmed all seven RPCs exist and are `security invoker`.

## Automated verification

```text
npm run verify:migrations - pass (9 migrations)
npm run typecheck - pass
npm run lint - pass
npm run test - pass (5 tests)
npm run build - pass; Campaign surfaces are route-level lazy chunks
git diff --check - pass
```

## Remaining acceptance gate

This runtime has no available browser binding, so authenticated visual smoke could not run here. Before marking accepted, run the brief manual smoke with `VITE_OUTREACH_OPS_ENABLED=true`: feature flag off/on, campaign creation, eligibility, research/message versioning, approve/skip, activity/audit, Drawer, Today, light/dark, narrow viewport, route refresh/back, and all four locales.

Docker-dependent local reset and behavioral RLS integration remain the pre-existing verification debt before staging/private beta.
