# LEADS-EDIT-01 P2 — Drawer information hierarchy polish

## Task goal

Remove duplicated website/location presentation in LeadDrawer and prevent a long email address from being clipped in the header.

## Current-state evidence

- Website appears in both Contact details and Lead context.
- Location appears in both Contact details and Lead context.
- The header summary can select email and renders it with `truncate`.

## Files and file plan

- `src/app/features/leads/LeadDrawer.tsx`: separate contact and context fields and simplify the header identity line.
- `src/i18n/locales/{en,uk,es,ru}.ts`: add the Lead context language label.

## Implementation plan

1. Keep Contact details limited to contact, email, phone, and website.
2. Keep Lead context limited to niche, location, and localized language; notes/context remains in its existing section.
3. Show only the contact person's name in the optional header subtitle and expose its full value through `title`.

## Risks and acceptance

No data, routing, or mutation behavior changes. Verify both populated and sparse leads, all locales, themes, typecheck, lint, unit tests, build, and `git diff --check`.

## Proposed commit

`fix(leads): refine drawer contact hierarchy`
