# OUTREACH-02R-FIX-05 — Activity localization and Drawer outreach detail

## Task goal

Replace raw activity translation keys in LeadDrawer with localized Outreach labels and show the latest Research and Message versions in its compact Outreach summary.

## Current-state evidence

- LeadDrawer renders `t(`activity.${activity.type}`)`, and the i18n fallback returns the raw key when a dictionary entry is missing.
- Activity types created by the manual Campaign workspace lack dictionary entries in all four locales.
- `OutreachDrawerSummary` only queries campaign/member state, even though existing APIs can fetch immutable research and message versions.

## File plan

- Add all activity labels and an unknown-activity fallback to `en`, `uk`, `es`, and `ru`.
- Add a small `activityLabel` helper and tests, then use it in LeadDrawer.
- Extend `listCampaignSummariesForLead` with latest research/message versions and render two compact rows in `OutreachDrawerSummary`.
- Add component/unit coverage for the fallback and version summary contract.

## Risks and acceptance

No RPC, migration, RLS, or status transition changes. The summary query must retain organization-scoped access through existing API calls. Verify populated and empty versions, multi-campaign selection, feature flag off, four locales, themes, responsive Drawer, typecheck, lint, tests, build, and `git diff --check`.

## Proposed commit

`fix(outreach): localize timeline and enrich drawer summary`

## Implementation result

All activity labels and the fallback are covered by automated tests in four locales. The summary shows the latest version through existing RLS-scoped research/message reads. No migration, RPC, or production apply is required for this UI/i18n follow-up.

Authenticated visual smoke remains pending because this environment has no connected browser binding. Verify the Drawer in light/dark mode and all four locales during the next authenticated OUTREACH-02R smoke run.
