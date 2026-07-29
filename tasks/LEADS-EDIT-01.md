# LEADS-EDIT-01 — Manual Lead Creation and Contact Editing

## Task goal

Replace the blank-record `New lead` behavior with focused create/edit routes, add safe duplicate handling, and let corrected contact details immediately participate in Campaign eligibility.

## Current-state evidence

- `LeadsPage` currently calls `createLead({ company_name: 'New company' })` directly from the `New lead` button.
- There are no `/leads/new` or `/leads/:leadId/edit` routes.
- `LeadDrawer` edits operational state but does not edit core contact details.
- Campaign membership correctly rejects records without email, phone, or website, but the campaign picker has no repair CTA.
- Production has organization-scoped unique indexes for normalized email, website domain, and phone. The linked catalog was checked read-only.
- `supabase/schema.sql` still describes the superseded global index names and must be synchronized with the accepted migration lineage.

## Files to inspect

- `src/App.tsx`
- `src/app/pages/leads/LeadsPage.tsx`
- `src/app/features/leads/LeadDrawer.tsx`
- `src/features/leads/leadsApi.ts`
- `src/features/leads/types.ts`
- `src/lib/normalize.ts`
- `src/app/pages/imports/ImportsPage.tsx`
- `src/app/pages/campaigns/CampaignEditorPage.tsx`
- `src/features/campaigns/campaignsApi.ts`
- `src/features/campaigns/workflow.ts`
- `src/i18n/locales/{en,uk,es,ru}.ts`
- `supabase/schema.sql`
- `scripts/verify-migrations.mjs`

## File plan

- Add shared lead-details validation, normalization, duplicate classification, and tests.
- Extend the existing leads API rather than creating a parallel repository pattern.
- Add one shared `LeadDetailsForm` used by create and edit route pages.
- Add authenticated lead create/edit routes and canonical `/leads?open=<id>` return behavior.
- Add compact Drawer contact details and `Edit details` navigation.
- Add deterministic campaign picker eligibility, repair CTA, and session-backed wizard draft round-trip.
- Add all new strings in `en`, `uk`, `es`, and `ru`.
- Correct only the stale dedup-index section of the repository schema snapshot; no production migration is expected.
- Update task/checkpoint/current-state documentation after verification.

## Implementation plan

1. Define the exact form contract from existing `leads` columns only.
2. Normalize nullable text, lowercase email, preserve human-readable phone, normalize website URL, and derive domain.
3. Preflight exact identifier duplicates and company-only warnings; retain the database unique indexes as the race-condition authority.
4. Implement focused create/edit pages with pending/error/dirty states and one-submit protection.
5. Invalidate lead and campaign query families after successful mutations.
6. Add Drawer and Campaign repair entry points with allowlisted internal return targets.
7. Add regression tests and run the full project/Supabase verification gates.

## Risks

- Exact website-domain and phone duplicates are database hard blocks; `Create anyway` is allowed only for company-only warnings.
- Contact detail update and `manual_edit` activity are two client writes. Activity failure must not encourage a duplicate update retry; this behavior will be documented and handled as best-effort timeline logging.
- Campaign wizard state is currently component-local, so route round-trips need explicit session-scoped persistence.
- The repository had no DOM test harness. A dev-only Testing Library/jsdom setup now covers the critical create/edit contracts without changing production runtime dependencies.
- Authenticated browser smoke remains required before this task and `OUTREACH-02R` are accepted.

## Acceptance criteria

- Opening create does not insert a row; Cancel leaves no row; Save creates exactly one populated lead.
- Existing lead details load and persist through a focused edit route.
- Drawer and Leads table show the saved values without a full application reload.
- Exact email/domain/phone duplicates block create with an existing-lead action.
- Company-only match requires an explicit override.
- Unsaved changes are protected on Cancel, browser navigation, and reload.
- Campaign repair returns to the Leads step with fields and selections intact, then recalculates eligibility.
- No new database columns or production migration are introduced.
- Feature flags and the CRM operational Drawer workflow remain intact.

## Tests

```powershell
npm run verify:migrations
npm run typecheck
npm run lint
npm run test:unit
npm run build
git diff --check
supabase migration list
supabase db push --dry-run
```

Targeted coverage includes normalization, validation, duplicate classification, double-submit guard, safe return targets, campaign draft persistence, eligibility recalculation, and create/edit data operations.

## Manual smoke

```text
Leads -> New lead -> Cancel -> confirm no row
Leads -> New lead -> save populated lead -> /leads?open=<id>
Drawer -> Edit details -> save -> updated Drawer and table
Campaign -> Leads -> repair no-channel lead -> return -> selectable -> add
Repeat exact email -> blocked with Open existing lead
```

Also verify light/dark, responsive widths, and `en/uk/es/ru`.

## Proposed commit message

```text
feat(leads): add manual creation and contact editing
```

## Documentation impact

- Create `docs/accepted-checkpoints/LEADS-EDIT-01.md` after evidence is available.
- Create an ADR for the focused lead form and duplicate behavior.
- Update `docs/current-state.md`, `docs/architecture/outreach-target.md`, and the pending `OUTREACH-02R` checkpoint.

## Implementation result

Implementation and automated gates are complete on 2026-07-29. Authenticated theme/localization/responsive smoke remains open because no browser was connected. Linked migration verification is also open because the current local database password is rejected; this task contains no migration or production database write.
