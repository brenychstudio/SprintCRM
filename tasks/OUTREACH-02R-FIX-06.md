# OUTREACH-02R-FIX-06 — Disable empty Outreach next-task action

## Task goal

Make the Today Outreach CTA truthful when there are no actionable Outreach items.

## Current-state evidence

- The core Today lead queue already disables its own `Open next lead` button when empty.
- `OutreachTodaySummary` always renders an active Link labeled `Open next task`, including when all three task counts are zero.

## File plan

- Compute the total actionable Outreach count in `OutreachTodaySummary`.
- Render a disabled button and localized empty text for zero; retain the existing Campaigns link otherwise.
- Add translations and a component regression test.

## Acceptance

- `0 + 0 + 0` shows `No outreach tasks right now` and a disabled CTA.
- Any nonzero count preserves the active CTA.
- Feature flag behavior, routing, themes, responsive layout, all locales, typecheck, lint, tests, build, and diff check remain valid.

## Proposed commit

`fix(outreach): disable empty today task action`
