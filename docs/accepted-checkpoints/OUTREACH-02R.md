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

## Smoke follow-up

- `OUTREACH-02R-FIX-01` fixed a P1 wizard blocker where the Offer step could proceed to campaign overview before the Leads step was usable.
- The campaign editor now treats Leads as the only submit step, uses explicit wizard navigation helpers, and supports adding new leads in edit mode without deleting or duplicating existing members.
- `OUTREACH-02R` remains unaccepted until the authenticated browser smoke is repeated successfully.
- `LEADS-EDIT-01` removes the next P1 blocker exposed by smoke: `New lead` no longer creates an empty row, existing contact details have a focused edit route, and Campaign eligibility can be repaired without losing wizard state.
- Repeat the authenticated Campaign smoke only after the LEADS-EDIT-01 create/edit/duplicate/theme/localization checks pass. No AI or Gmail work starts before acceptance.
- `OUTREACH-02R-FIX-03` implements an additive replacement for `add_campaign_members`, using the named membership constraint to remove the `lead_id` ambiguity that raised PostgreSQL `42702`. Static gates pass; linked apply and authenticated regression smoke are still pending.
- `OUTREACH-02R-FIX-04` implements additive replacements for manual message save and approval, explicitly bridging text campaign channels to the `activities.channel` enum while preserving RPC signatures. Static gates pass; linked apply and authenticated draft/version/review/approval smoke remain pending.
- `OUTREACH-02R-FIX-05` localizes every known activity type, adds an unknown-activity fallback in LeadDrawer, and exposes the latest Research/Message versions in its compact Outreach summary. Automated UI/i18n coverage passes; authenticated visual smoke remains pending.
