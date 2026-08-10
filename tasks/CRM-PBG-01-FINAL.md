# CRM-PBG-01-FINAL — Human Read Acceptance and Operator Handoff

## Task goal

Record the completed supervised CRM-PBG-01 human READ pilot as accepted, preserve its factual real-data and security evidence, and finalize the existing operator runbook without changing runtime behavior or beginning CRM-PBG-02.

## Current-state evidence

- SprintCRM started clean on `main` at `4ba0847ee8977a59843fb71aa18ed2aaa4799514`.
- Shared AI Product Bridge is clean and frozen at `563b6c8f0b6452ccc5f18f3aac5e058633b7cdb0`.
- The operator reports a successful human path through the separate `Sprint CRM — Read Pilot` ChatGPT custom MCP app and OpenAI Secure MCP Tunnel to authenticated, organization-scoped production SprintCRM reads.
- The observed authority profile was `READ=7`, `STAGED_WRITE=0`, `PRIVILEGED_ACTION=0`, with `contactDataGranted=false` and no side effects.
- No credential value, organization UUID, JWT, key, or secret is authorized for documentation.

## Files to inspect

- `AGENTS.md`.
- `docs/CRM-PBG-01-PRODUCT-BRIDGE-READ-ADAPTER.md`.
- Existing accepted-checkpoint and task-record conventions for documentation structure only.
- Git baselines/status for SprintCRM and frozen Shared.

## File plan

- Update `docs/CRM-PBG-01-PRODUCT-BRIDGE-READ-ADAPTER.md` in place with final accepted status, exact human-pilot evidence, authenticated-RLS proof, zero-side-effect acceptance, operator lifecycle/credential cleanup, tunnel/app guidance, and next-checkpoint direction.
- Add only this engineering task record to satisfy the repository workflow; do not create a redundant product/runbook document.
- Do not modify application, adapter, runtime, test, package, Supabase, migration, Shared, DD, BDB, or Weekfield files.

## Implementation plan

1. Replace the pre-pilot status with `CRM-PBG-01 ACCEPTED` and state that SprintCRM ↔ Shared Bridge READ integration is complete.
2. Record the exact proven path, seven operations/aliases, real-data observations, redaction outcome, receipt profile, authenticated-user/RLS proof, and explicit absence of side effects.
3. Convert the supervised checklist into a reusable operator runbook, including the safe scope set, fresh-token recovery, shutdown, and exact PowerShell environment cleanup.
4. Record the pilot-only ChatGPT app/tunnel boundary without any actual key material.
5. Record CRM-PBG-02 as design-only future direction, prioritizing `crm.email.stageDraft` and `crm.research.stageSnapshot` while explicitly excluding dishonest generic staged mutations.
6. Run all required validation, verify documentation-only scope and frozen external repositories, then create one local documentation commit without push.

## Risks

- Human evidence could accidentally disclose contact data, organization UUID, JWTs, publishable key values, provider keys, or other credentials.
- An email-formatted organization name could be misclassified as leaked lead contact data; it must be identified accurately as the existing `organizations.name` value.
- Historical research/draft activity could be misstated as pilot-generated side effects; it was existing read-only CRM history.
- Acceptance wording could imply transactional/MVCC guarantees or authorize staged writes that were not proven.
- Token recovery guidance must remain manual and must not encourage automatic browser-storage scraping.

## Acceptance criteria

- Existing documentation states `CRM-PBG-01 HUMAN READ PILOT — PASS` and final status `CRM-PBG-01 ACCEPTED`.
- The proven path, exact `7/0/0` profile, operations, aliases, bounded real-data facts, redaction result, receipts, authenticated-user/RLS checks, and zero-side-effect result are recorded faithfully.
- No actual UUID, token, key, credential, message body, research text, draft body, note, or unrestricted metadata is documented.
- The runbook contains the exact safe scopes, startup/health flow, tunnel/app lifecycle, and six PowerShell credential-cleanup commands.
- Next direction names only `crm.email.stageDraft` and `crm.research.stageSnapshot` as natural candidates and explicitly leaves generic lead/contact/follow-up staging for separate domain-seam design.
- No runtime/config/schema/migration/source behavior changes; full repository validation passes; Shared remains frozen; final SprintCRM tree is clean after one local documentation commit.

## Tests and validation

- `npm run verify:migrations`
- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run build`
- `git diff --check`
- `npm audit --audit-level=low`
- Documentation-only diff inspection and secret-marker review.

## Manual smoke

No new pilot, provider call, database access, production write, tunnel session, or browser operation is performed. This task records the already completed human pilot evidence supplied by the operator.

## Proposed commit

`docs: finalize crm bridge read acceptance`

## Documentation impact

The existing CRM-PBG-01 adapter document becomes the canonical accepted checkpoint and reusable supervised READ runbook. No separate redundant acceptance document is added.

## Acceptance implementation record

- Updated the canonical CRM-PBG-01 document in place from pre-pilot readiness to `CRM-PBG-01 ACCEPTED` and recorded `CRM-PBG-01 HUMAN READ PILOT — PASS` against implementation baseline `4ba0847ee8977a59843fb71aa18ed2aaa4799514` and frozen Shared baseline `563b6c8f0b6452ccc5f18f3aac5e058633b7cdb0`.
- Recorded the exact seven READ operations/aliases, real workspace/lead/activity/follow-up/pipeline observations, redaction result, READ receipts, authenticated-user/RLS proof, expired-token recovery lesson, and zero-side-effect outcome without recording the organization UUID or any credential value.
- Replaced the future pilot checklist with the exact 17-step reusable operator lifecycle, safe default scopes, separate `Sprint CRM — Read Pilot` app/tunnel boundary, and explicit PowerShell cleanup for all six runtime environment names.
- Recorded CRM-PBG-02 only as a future design checkpoint for `crm.email.stageDraft` and `crm.research.stageSnapshot`; no staged-write implementation or generic lead/contact/follow-up staging was started.
- Final validation passed: `npm run verify:migrations` (21 files), `npm run typecheck`, `npm run lint`, `npm run test:unit` (23 files, 178 tests), `npm run build`, `git diff --check`, and `npm audit --audit-level=low` (0 vulnerabilities). The existing Vite large-chunk advisory remains non-blocking.
- No runtime, operation, test, package, source, Supabase, migration, production data, Shared, DD, BDB, or Weekfield change occurred. No human pilot, tunnel session, token retrieval, provider call, or database operation was rerun by Codex.
