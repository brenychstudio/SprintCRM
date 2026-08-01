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
- The migration has not been applied, and the Edge Function has not been redeployed. An authenticated smoke retest remains pending after the reviewed forward-fix migration is applied.
