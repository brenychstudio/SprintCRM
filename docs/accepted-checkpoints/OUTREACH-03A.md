# OUTREACH-03A Checkpoint

Status: ACCEPTED.

Date: 2026-08-01
Branch: `codex/outreach-03a-ai-runtime-foundation`
Acceptance commit: `docs(outreach): accept supervised AI runtime foundation`

## Delivered

- An additive AI runtime ledger and service-role-only runtime-probe RPCs, with organization validation, idempotency, terminal-state guards, usage metadata, and audit events.
- The authenticated `outreach-ai-runtime` Edge Function with a server-only OpenAI API boundary, fixed synthetic request, strict schema, allowlisted CORS, timeout, and server kill switch.
- A feature-gated Campaign Workspace probe card with a separate client kill switch. It displays only compact probe metadata and does not produce research, drafts, status transitions, Gmail work, or sends.
- Forward fix `20260801000002_fix_ai_runtime_probe_request_id_ambiguity.sql`, resolving the production `request_id` ambiguity without changing the supervised boundary.

## Production verification

- Production migration apply: passed for `20260801000001_outreach_ai_runtime_foundation.sql` and `20260801000002_fix_ai_runtime_probe_request_id_ambiguity.sql`.
- Edge Function deployment: passed; `outreach-ai-runtime` is ACTIVE.
- Authenticated production runtime probe: passed. The synthetic probe reported Connected on `gpt-5.4-mini`, used 82 total tokens, and completed in 2164 ms.
- Matching audit events for the verified request are `ai.runtime_probe.requested` and `ai.runtime_probe.completed`.

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

The probe made no research, message, or campaign-member-status mutation and performed no Gmail or sending operation. The OpenAI API boundary is server-only; client and server kill switches remain available.

## Automated verification

```text
npm run verify:migrations - pass (13 migrations)
npm run typecheck - pass
npm run lint - pass
npm run test - pass (40 tests)
npm run build - pass; existing Vite large-bundle warning remains
git diff --check - pass
npx supabase migration list --password $env:SUPABASE_DB_PASSWORD - pass; local equals remote
npx supabase db push --dry-run --password $env:SUPABASE_DB_PASSWORD - pass; remote database is up to date
```

## Remaining pre-staging debt

- Docker/local Supabase reset.
- Behavioral RLS integration tests.
- Existing Vite large-bundle warning.

## Next checkpoint

`OUTREACH-03B — AI Research Job` is the next engineering checkpoint. It must remain supervised and human-reviewed; no automatic send is authorized.
