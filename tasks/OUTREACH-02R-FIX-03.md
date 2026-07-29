# OUTREACH-02R-FIX-03 — Resolve ambiguous lead_id in add_campaign_members

## Task goal

Restore campaign member creation by replacing the production RPC with an equivalent, fully qualified PL/pgSQL implementation that cannot raise PostgreSQL `42702` for `lead_id`.

## Current-state evidence

- The authenticated UI sends the expected `p_campaign_id` and `p_lead_ids` payload.
- PostgreSQL returns `42702: column reference "lead_id" is ambiguous` from `add_campaign_members`.
- The existing function already loops with `v_lead_id`, but its `RETURNS TABLE` output includes a PL/pgSQL variable named `lead_id`.
- `on conflict (campaign_id, lead_id)` therefore conflicts with that output variable.
- The accepted unique constraint is named `campaign_members_campaign_id_lead_id_key`.

## Files to inspect and file plan

- Preserve `20260725000002_manual_campaign_workspace_rpc.sql` unchanged.
- Add `20260729000001_fix_add_campaign_members_ambiguous_lead_id.sql` with only `CREATE OR REPLACE FUNCTION`, grants, and transaction boundaries.
- Synchronize the canonical function body in `supabase/schema.sql`; the signature and generated TypeScript types do not change.
- Extend `scripts/verify-migrations.mjs` with structural regression assertions.
- Update the OUTREACH-02R checkpoint and current-state record after verification.

## Implementation plan

1. Qualify campaign, lead, suppression, and member reads with `c`, `l`, `s`, and row variables.
2. Reset loop row variables before each lead lookup.
3. Replace the ambiguous conflict target with `ON CONFLICT ON CONSTRAINT campaign_members_campaign_id_lead_id_key`.
4. Preserve eligibility outcomes, suppression audit, campaign-added activity, return columns, RLS behavior, and `security invoker`.
5. Run static gates, linked migration dry-run, apply only after review, then repeat history/dry-run and authenticated smoke.

## Risks

- Editing the accepted migration would corrupt lineage; it is explicitly out of scope.
- A changed return signature would break generated types and frontend mapping; it must remain byte-for-byte equivalent at the interface level.
- Production apply is blocked if the local database password is still rejected.
- Without Docker, multi-organization behavioral coverage requires catalog verification plus authenticated smoke.

## Acceptance criteria

- Eligible single and multiple leads can be added without `42702`.
- Duplicate membership returns `already_added` and creates no second row.
- Archived, missing-channel, suppressed, unavailable/cross-organization leads remain excluded with the existing outcome contract.
- Audit/activity writes remain unchanged.
- Linked history is synchronized and final dry-run is clean.

## Tests and smoke

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

Authenticated smoke: edit the existing manual-smoke campaign, select `Smoke Test Studio`, save, and confirm one member in `To prepare` with no duplicate on repeat.

## Proposed commit

`fix(outreach): disambiguate campaign member lead references`

## Documentation impact

Update `docs/current-state.md` and `docs/accepted-checkpoints/OUTREACH-02R.md`. No ADR is required because this is a forward-fix that preserves ADR 0005.
