# LEADS-EDIT-01 Checkpoint

Status: implementation complete; awaiting authenticated browser smoke.

Date: 2026-07-29
Branch: `codex/leads-edit-01-manual-lead-form`
Recommended commit: `feat(leads): add manual creation and contact editing`

## Delivered

- Focused `/leads/new` and `/leads/:leadId/edit` routes backed by one shared form.
- No database insert before final create submission; Cancel and dirty-navigation protection.
- Required company validation, localized email/website validation, normalization, pending state, and lifetime double-submit protection.
- Exact email/domain/phone duplicate blocking, company-only warning, Open existing, and safe Create anyway behavior.
- Compact LeadDrawer contact summary and `Edit details` action without changing its operational stage/next-action workflow.
- Campaign Leads-step eligibility reasons, `Edit lead` repair action, safe return target, draft persistence, and query refetch after save.
- One `manual_edit` activity per successful detail update with changed field names only.
- Repository schema snapshot and migration verifier synchronized to the already-applied organization-scoped dedup indexes. No migration or production write is part of this task.
- DOM tests for no-write open/cancel, create, double submit, validation, exact duplicate, edit persistence, and focused create navigation, plus pure tests for normalization, duplicate classification, return-target safety, campaign draft persistence, and eligibility recalculation.
- P2 Drawer polish removes website/location duplication: Contact details owns contact/email/phone/website, while Lead context owns niche/location/language. The header no longer duplicates or clips email.

## Acceptance still required

Run the authenticated smoke in a test organization before marking this checkpoint or `OUTREACH-02R` accepted:

```text
New lead -> Cancel -> verify no row
New lead -> save populated lead -> refresh
Drawer -> Edit details -> save -> verify Drawer and table
Campaign Leads -> Edit lead -> return -> selectable -> add
Repeat exact email/domain/phone -> blocked with Open existing
```

Also verify light/dark, 1440/1024/768/390 widths, `en/uk/es/ru`, browser Back/refresh, and that existing Drawer operations still work. The two historical `New company` test rows must be archived or safely deleted through the CRM workflow during this smoke.

`OUTREACH-02R` remains unaccepted until this authenticated gate and the remaining campaign smoke are successful.

## Automated verification

```text
npm run verify:migrations - pass (9 migrations plus canonical dedup-index assertions)
npm run typecheck - pass
npm run lint - pass
npm run test:unit - pass (23 tests)
npm run build - pass; existing main-chunk size warning remains
git diff --check - pass
local HTTP /leads/new - 200 on the existing port 5178 development server
```

The browser runtime exposed no connected browser, so authenticated visual smoke could not be completed in this environment. The linked Supabase history and dry-run checks are also temporarily blocked because the non-empty local `SUPABASE_DB_PASSWORD` is rejected by the linked project. No migration exists in this task and no database apply was attempted.

`npm audit --omit=dev` reports dependency advisories in the current tree, including `xlsx` with no npm fix and advisories affecting the current Vite/React Router toolchain. Automated dependency upgrades were intentionally not mixed into this product task; track remediation separately.
