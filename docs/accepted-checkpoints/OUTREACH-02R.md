# OUTREACH-02R Checkpoint

Status: accepted.

Date: 2026-07-29
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
- `20260729000001_fix_add_campaign_members_ambiguous_lead_id.sql` (FIX-03) and `20260729000002_fix_manual_message_channel_cast.sql` (FIX-04) were applied through the Supabase CLI, not the Dashboard.
- `supabase migration list` matched local and remote after apply.
- `supabase db push --dry-run` reported the remote database is up to date.
- Catalog query confirmed all seven RPCs exist and are `security invoker`.

## Automated verification

```text
npm run verify:migrations - pass (11 migrations)
npm run typecheck - pass
npm run lint - pass
npm run test:unit - pass (32 tests)
npm run build - pass; Campaign surfaces are route-level lazy chunks
git diff --check - pass
```

## Authenticated acceptance smoke

The product owner completed the authenticated smoke with `outreach_ops_enabled` enabled. The accepted path is:

```text
Create/Edit lead
→ Add to campaign
→ Research versions
→ Message versions
→ Submit for review
→ Approve
→ Drawer summary
→ Full Workspace
→ Today queue
```

The smoke also confirmed light/dark themes, `en`/`uk`/`es`/`ru`, responsive layouts, production migrations, and Supabase synchronization. Approval remains human-controlled and does not send a message.

Acceptance outcome: P0 = `0`; workflow-blocking P1 = `0`.

Docker-dependent local reset and behavioral RLS integration remain the pre-existing verification debt before staging/private beta; they do not block this manual UI milestone.

## Smoke follow-up

- `OUTREACH-02R-FIX-01` fixed a P1 wizard blocker where the Offer step could proceed to campaign overview before the Leads step was usable.
- The campaign editor now treats Leads as the only submit step, uses explicit wizard navigation helpers, and supports adding new leads in edit mode without deleting or duplicating existing members.
- `LEADS-EDIT-01` removes the next P1 blocker exposed by smoke: `New lead` no longer creates an empty row, existing contact details have a focused edit route, and Campaign eligibility can be repaired without losing wizard state.
- FIX-03 removes the `add_campaign_members` `lead_id` ambiguity that raised PostgreSQL `42702`; production regression smoke passed after its CLI apply.
- FIX-04 bridges text campaign channels to the `activities.channel` enum while preserving RPC signatures; production draft/version/review/approval smoke passed after its CLI apply.
- FIX-05 localizes every known activity type, adds an unknown-activity fallback in LeadDrawer, and exposes latest Research/Message versions in its compact Outreach summary.
- FIX-06 disables the Outreach `Open next task` CTA at zero actionable items and explains the localized empty state.
