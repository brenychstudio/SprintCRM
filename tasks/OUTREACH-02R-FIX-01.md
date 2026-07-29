# OUTREACH-02R-FIX-01 - Restore Campaign Leads Wizard Step

## Task goal

Fix the campaign setup wizard so `Offer -> Next` opens the `Leads` step and only the final Leads action submits the campaign.

## Current-state evidence

- Browser smoke found a P1 workflow blocker: clicking `Next` on the Offer step redirected to campaign overview before leads could be selected.
- Code already keeps OutreachOps feature-gated and uses the campaign editor as the only create/edit wizard surface.
- Edit mode also showed only an informational hint on the Leads step, so new members could not be added from the edit wizard.

## Files inspected

- `src/app/pages/campaigns/CampaignEditorPage.tsx`
- `src/features/campaigns/campaignsApi.ts`
- `src/features/campaigns/workflow.ts`
- `src/features/campaigns/workflow.test.ts`
- `docs/accepted-checkpoints/OUTREACH-02R.md`

## File plan

- Add pure campaign wizard navigation helpers.
- Use those helpers in the editor instead of inline numeric step checks.
- Show the lead picker on the Leads step for both create and edit.
- Mark existing campaign members as already added and disabled during edit.
- Add regression coverage for `Offer -> Leads` and submit-step detection.

## Implementation plan

1. Keep `Next` buttons as `type="button"` and make them local step transitions only.
2. Make the Leads step the only submit step.
3. In edit mode, load current campaign members, show them checked/disabled, and submit only newly selected lead IDs.
4. Preserve existing members; do not remove unchecked or already-added records.
5. Re-run required local gates and Supabase dry-run.

## Risks

- This is a UI/data-layer fix only; no database schema or production data changes are expected.
- Without a DOM test harness in the repo, regression coverage is a pure helper test rather than a rendered click test.
- Authenticated browser smoke remains required before accepting `OUTREACH-02R`.

## Acceptance criteria

- `Offer -> Next` opens `Leads`.
- `Next` on Offer does not submit or navigate.
- Final `Create campaign` / `Save changes` submits.
- Edit mode can add new eligible leads without duplicating or deleting existing members.
- Feature-flag behavior remains unchanged.

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

## Manual smoke

```text
Campaigns -> Open -> Edit campaign -> Offer -> Next -> Leads
```

The Leads step should stay on screen and show eligible leads such as `New company` for selection.

## Proposed commit message

```text
fix(outreach): restore campaign leads wizard step
```

## Documentation impact

- Update the `OUTREACH-02R` checkpoint with the smoke defect and fix status.
