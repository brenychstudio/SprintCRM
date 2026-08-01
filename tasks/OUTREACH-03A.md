# OUTREACH-03A — OpenAI API Runtime Foundation

## Pre-edit record

- **Task goal:** add the supervised, server-only OpenAI Responses API runtime boundary and a synthetic connection probe in the existing Campaign Full Workspace. This task must not generate research, messages, QA, drafts, or sends.
- **Current-state evidence:** `main` is synchronized with `origin/main` at `f8eee8e`; OutreachOps feature gates, campaign workspace, `ai_generations`, campaign domain/RLS migrations, and controlled-AI documentation already exist. No Edge Function runtime probe currently exists.
- **Files inspected:** `AGENTS.md`, `.env.example`, feature flags and tests, campaign API/types/workspace, and the task-required database/config/i18n/docs files listed below.
- **Files to inspect:** `.env.example`; feature flags/tests; campaign API/types/workspace; i18n provider and all four locales; Supabase config/schema/foundation/domain/RLS migrations/types; target architecture, controlled-AI ADR, current state; package/test conventions.
- **File plan:** add one additive migration, Edge Function plus pure shared runtime modules/tests, client API/types/component tests, feature flag/env/i18n updates, generated DB types, and targeted documentation/ADR updates.
- **Implementation plan:** harden `ai_generations` as the generic runtime ledger; expose server-only start/finish probe RPCs with organization and audit checks; call OpenAI only with fixed synthetic input and strict schema; add an allowlisted authenticated function endpoint; display only non-sensitive metadata in the existing workspace behind both flags.
- **Risks:** existing schema/RPC/audit conventions may require compatible SQL; generated types must match migration; browser must never write completed jobs; provider/network credentials are unavailable locally; Docker reset is known unavailable debt.
- **Acceptance criteria:** runtime is disabled by default on client and server; probe is authorized, idempotent, audited, and persisted; no CRM content crosses the provider boundary; UI has tested/connected/failed states in four locales; no research/message/member-status mutation occurs; required static checks pass.
- **Tests:** pure runtime request/UUID/parser/usage/error/origin tests, feature-flag test, and workspace probe UI pending/success/failure/no-side-effect tests; run migration/type/lint/test/build/diff checks and Supabase dry-run commands.
- **Production smoke plan:** after reviewed migration application, user-configured Edge Function secrets, and deployment, run an authenticated probe in light/dark and narrow layouts; confirm no research/message/status changes, OpenAI project usage, audit rows, and `ai_generations` rows.
- **Proposed commit:** `feat(outreach): add supervised AI runtime foundation`
- **Documentation impact:** update current state and outreach target architecture; add an ADR describing the generic AI runtime ledger and synthetic-only probe; record rollout/forward-fix guidance here.

## Rollout and rollback

The migration is additive. If a production issue is discovered, keep the ledger data and deploy a forward-fix migration or disable `AI_RUNTIME_ENABLED`; do not remove or rewrite historical rows. Final acceptance is explicitly pending reviewed production migration, secrets, deployment, and authenticated smoke.

## Implementation record

- Added `20260801000001_outreach_ai_runtime_foundation.sql`, the `outreach-ai-runtime` Edge Function, strict synthetic probe contract, server-only RPCs, CORS allowlist, audit/ledger persistence, and the default-off client runtime flag.
- The Campaign Workspace card reads only runtime-probe ledger metadata and calls no research, message, status, Gmail, or send operation.
- Completed static verification: `npm run verify:migrations`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and `git diff --check`.
- `npx supabase migration list` and `npx supabase db push --dry-run` could not connect to the linked database because the local non-secret database credential is rejected (`28P01`). No migration was applied and no function was deployed. Docker/local reset remains known verification debt.
- Final acceptance remains pending: reviewed production migration apply; user-configured Edge Function secrets (`OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_RUNTIME_ENABLED`, `AI_ALLOWED_ORIGINS`); function deployment; authenticated production probe smoke; confirmation that no research/message/status data changed; OpenAI project usage; and ledger/audit inspection.

## Production smoke forward fix

- Confirmed production smoke error: `column reference "request_id" is ambiguous` inside `public.start_ai_runtime_probe`. The `RETURNS TABLE` output name conflicted with an unqualified retry lookup against `ai_generations`.
- The failure occurred before an AI call, so it consumed no OpenAI tokens and recorded no provider usage.
- `20260801000002_fix_ai_runtime_probe_request_id_ambiguity.sql` is an additive forward fix. It recreates only `start_ai_runtime_probe`, aliases all `ai_generations` references, uses targetless `ON CONFLICT DO NOTHING`, and retains the fully qualified idempotent retry lookup, service-role restriction, organization/membership validation, runtime-probe scope, audit event, and grants/revokes.
- The forward-fix migration is now applied and the Edge Function is deployed. The authenticated smoke retest passed; the acceptance evidence below records the independently verified completed probe and audit trail.

## Acceptance closure record

- **Task goal:** close OUTREACH-03A only after read-only production verification; do not begin AI research work.
- **Current-state evidence:** the authenticated SprintCRM probe reported Connected on `gpt-5.4-mini`, with 82 total tokens in 2164 ms. The production ledger and audit trail below independently confirm that completed probe.
- **Files inspected:** `AGENTS.md`, this task record, `docs/current-state.md`, `docs/architecture/outreach-target.md`, the OUTREACH-03A migrations, existing accepted-checkpoint conventions, package scripts, Git state, and PR #19.
- **File plan:** update this task record, current state, the OutreachOps delivery roadmap, and the accepted checkpoint only.
- **Implementation plan:** preserve the implementation and forward fix; record the reviewed production evidence; run the required read-only validation; commit only the acceptance documents; then publish, ready, and merge PR #19.
- **Risks:** this closing task must not invoke OpenAI, alter Supabase secrets, deploy a function, apply a migration, or disclose credentials. Production values are limited to the approved ledger fields below.
- **Acceptance criteria:** both runtime migrations are present remotely; the Edge Function is ACTIVE; a completed synthetic probe is persisted and audited; no research, message, member-status, Gmail, or sending action resulted; all required validation is clean; PR #19 is merged.
- **Tests and manual smoke:** run migration verification, typecheck, lint, test, build, diff check, migration list, dry-run, and Git status. The authenticated production smoke is the completed Connected probe recorded below; no new probe is run for closure.
- **Proposed commit:** `docs(outreach): accept supervised AI runtime foundation`.
- **Documentation impact:** this record, `docs/current-state.md`, `docs/architecture/outreach-target.md`, and `docs/accepted-checkpoints/OUTREACH-03A.md` now capture acceptance and the next checkpoint.

## Acceptance evidence

Status: **ACCEPTED**.

- Production migration apply: passed. `20260801000001_outreach_ai_runtime_foundation.sql` and forward fix `20260801000002_fix_ai_runtime_probe_request_id_ambiguity.sql` are applied.
- Edge Function deployment: passed. `outreach-ai-runtime` is deployed and ACTIVE.
- Authenticated production runtime probe: passed. The fixed synthetic probe connected using `gpt-5.4-mini`; it did not create research or message content, mutate campaign-member status, invoke Gmail, or send anything.
- The OpenAI API boundary remains server-only. Client and server kill switches remain available.

| Field | Verified value |
| --- | --- |
| id | `098c87cc-e510-4856-8174-6e610fafbb03` |
| request_id | `4639e1e5-994b-46f9-8e2d-829532cea683` |
| generation_status | `completed` |
| provider | `openai` |
| model_name | `gpt-5.4-mini` |
| schema_version | `runtime_probe_v1` |
| input_tokens | `61` |
| cached_input_tokens | `0` |
| output_tokens | `21` |
| total_tokens | `82` |
| duration_ms | `2164` |
| estimated_cost_usd | `null` (not configured) |
| error_code | `null` |
| created_at | `2026-08-01 10:35:42.209194+00` |
| completed_at | `2026-08-01 10:35:44.495649+00` |

Matching audit events for that `request_id`: `ai.runtime_probe.requested` and `ai.runtime_probe.completed`.

Remaining pre-staging debt: Docker/local Supabase reset; behavioral RLS integration tests; and the existing Vite large-bundle warning.
