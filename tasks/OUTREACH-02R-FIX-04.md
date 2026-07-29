# OUTREACH-02R-FIX-04 — Fix manual message channel enum assignment

## Task goal

Allow manual draft creation and approval to write canonical CRM activities without PostgreSQL `42804`, while preserving the existing PostgREST RPC signatures.

## Current-state evidence

- `save_manual_outbound_message` receives valid text values such as `email`.
- Repository lineage defines `outbound_messages.channel` as `text + CHECK`, while `activities.channel` is `public.activity_channel`.
- The RPC passes text (`v_message.channel`) into `activities.channel` without an explicit cast; the approval RPC repeats the same boundary.
- `language`, outbound message `status`, and `source` are text/check columns, so they do not require enum casts.

## Files and file plan

- Preserve all accepted migrations.
- Add `20260729000002_fix_manual_message_channel_cast.sql` with `CREATE OR REPLACE` for save and approval RPCs.
- Keep the API parameters unchanged and use a typed `public.activity_channel` local variable.
- Synchronize `supabase/schema.sql` and extend `scripts/verify-migrations.mjs`.
- Update current-state and OUTREACH-02R checkpoint evidence.

## Implementation plan

1. Cast `p_channel` once to `public.activity_channel`; invalid channels fail before writes.
2. Use the typed channel for message insertion and the `outreach_draft_saved` activity.
3. Cast the stored message channel before the approval transition and use it for `outreach_approved`.
4. Qualify reads and updates while preserving versioning, member transitions, research/template links, audit, return row types, `security invoker`, and grants.
5. Review linked catalog types before production apply. If production `outbound_messages.channel` differs from canonical lineage, stop and reconcile that drift explicitly.

## Risks and acceptance

- Changing the argument type would create an overload; the signature must remain `(uuid, text, text, text, text, text, uuid, uuid)`.
- Both FIX-03 and FIX-04 may be pending in the linked dry-run and must be reviewed together in timestamp order.
- Behavioral checks need the linked database because Docker remains unavailable.

Acceptance requires draft version 1, `draft_ready`, invalid-channel rejection, version 2, research linkage, review submission, approval activity, no `42804`, synchronized migration history, and a final clean dry-run.

## Tests and smoke

Run all standard gates plus linked catalog queries and repeat the existing campaign's Save draft, second version, Submit for review, and Approve flow.

## Proposed commit

`fix(outreach): cast manual message channel enum`

## Implementation result

The forward migration, canonical schema body, and verifier guards are complete. Migration verification, typecheck, lint, 23 unit tests, build, and diff check pass. Linked history/dry-run and production apply remain blocked because the non-empty local `SUPABASE_DB_PASSWORD` is rejected by the linked project; no remote change was attempted.
