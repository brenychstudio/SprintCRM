# OUTREACH-03B — Supervised AI Research Job

## Pre-edit record

- **Task goal:** add one explicit, supervised AI research operation for a single Campaign Full Workspace member. It may create a versioned AI research snapshot from public website context, but must never generate messages, approve/send outreach, invoke Gmail, create follow-ups, batch work, retry providers, or run in the background.
- **Current-state evidence:** `main` is synchronized with `origin/main`; OUTREACH-03A is accepted. The existing `outreach-ai-runtime` Edge Function already provides authenticated, CORS-restricted, server-only Responses API runtime probes plus the `ai_generations` ledger and service-role RPC pattern. The next migration is `20260801000003`.
- **Files inspected:** `AGENTS.md`, Git status, OUTREACH-03A task/checkpoint evidence, `.env.example`, package scripts, feature flags/tests, the AI runtime Edge Function, and shared AI runtime helpers.
- **Files to inspect:** required campaign API/types/workflow/workspace/form, AI runtime card, i18n provider/locales, database types, foundation and AI migrations, research RPC migrations, validation scripts/tests, and the requested architecture/decision/current-state documents.
- **Data-flow plan:** user click → authenticated user-scoped context/website read → service-role `start_ai_research_job` → domain-restricted Responses API request with public campaign/lead fields only → strict result/source validation → service-role `finish_ai_research_job` → immutable `research_snapshots` version and canonical activity → invalidate/refetch workspace and summaries for human review.
- **Migration plan:** create additive `20260801000003_ai_research_job.sql`; add nullable campaign proof context; create/restrict idempotent start/finish RPCs; preserve organization RLS and browser read-only `ai_generations`; use atomic, locked version allocation; add audit and compatible canonical activity rows. Rollback is a server/client kill switch or an additive forward fix—historical ledger and snapshots will not be removed/re-written.
- **Function plan:** retain `runtime_probe` unchanged and route `generate_research` through pure shared request, URL, prompt, output/source, usage, and safe-error helpers. The function will use a user-scoped client for context reads and service role only for the two lifecycle RPCs; it will call Responses with `store:false`, a 45-second abort, no retry, and one domain-restricted `web_search` tool.
- **UI plan:** add the optional proof context field to campaign create/edit; add a feature-gated AI Research card adjacent to Manual research in the existing workspace; expose clear pending/completed/failed/website-required states and metadata; refresh existing research without touching messages or approvals.
- **Privacy boundaries:** no browser secret; never send contacts, email, phone, personal notes, IDs, messages, ownership, audit data, or credentials to OpenAI. Send only listed public lead and campaign context; web sources are constrained to validated public company domain. Human review remains mandatory.
- **Failure modes:** invalid/missing/private/placeholder URLs, authorization denial, disabled runtime/research flags, missing configuration, provider rate limit/timeout/error, malformed structured output, missing/unrelated evidence, conflicting/terminal ledger updates, and persistence failure return safe stable errors and never save a partial snapshot.
- **Acceptance criteria:** migration, function, UI and i18n support a single explicit research generation; results are strictly validated, idempotent, audited and immutable; later campaign statuses never regress; no outbound/message/send/Gmail behavior changes; flags default off; required checks and non-applying linked-migration verification complete.
- **Test plan:** unit coverage for flags, UUID/request/URL/prompt/result/source/usage/error helpers plus workspace state/invalidation/no-message side effects; migration verifier coverage; run migration/type/lint/test/build/diff checks and linked migration/dry-run commands. No provider calls are made in implementation testing.
- **Production rollout plan:** do not mark accepted until reviewed migration application, Edge Function deployment, `AI_RESEARCH_ENABLED` configuration, local client activation, an authenticated single real-site smoke in light/dark themes, provider usage/evidence inspection, ledger/snapshot/audit inspection, and confirmation of no message/send/status regression.
- **Proposed commit:** `feat(outreach): add supervised AI research job`
- **Documentation impact:** update this record, current state, outreach target architecture, and add a focused source-policy ADR if existing AI-boundary ADRs do not sufficiently capture domain-restricted research.

## Rollout and forward-fix

The migration is additive. Keep `AI_RESEARCH_ENABLED=false` and `VITE_AI_RESEARCH_ENABLED=false` until reviewed rollout. For a production issue, disable either kill switch and deploy an additive SQL/function/client forward-fix. Never delete/rewrite completed ledger rows or immutable snapshots.

## Implementation record

- Added `20260801000003_ai_research_job.sql` with nullable campaign proof context, compatible campaign RPC overloads, service-role-only idempotent research start/finish RPCs, terminal-state guards, immutable AI snapshots, canonical CRM activity/audit records, browser ledger read preservation, and browser write revocation.
- Extended the existing runtime Edge Function with `generate_research` while retaining `runtime_probe`; all CRM context reads are user-scoped, service role is limited to lifecycle RPCs, OpenAI receives only the allowed public fields, and no provider call is made by tests.
- Added pure URL, request, prompt, strict result/source, usage, and safe-error helpers; domain-restricted OpenAI web search is configured with `store:false`, a 45-second abort, bounded output, and no retry/background mode.
- Added default-off client/server research gates, proof-context campaign form/API/types support, generated type synchronization, four-locale workspace strings, and a feature-gated AI Research card that invalidates workspace/overview/lead/job queries and never invokes message or approval mutations.
- Completed local static verification: `npm run verify:migrations`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, and `git diff --check` (build retains the known Vite large-bundle warning).
- Linked read-only verification passed: remote migrations end at `20260801000002`; `npx supabase migration list --password $env:SUPABASE_DB_PASSWORD` identifies only `20260801000003` as pending, and `npx supabase db push --dry-run --password $env:SUPABASE_DB_PASSWORD` would push only that migration. Nothing was applied or deployed.

## Acceptance status

**Not accepted.** Still required: reviewed migration apply; Edge Function deployment; `AI_RESEARCH_ENABLED` secret configuration; local `VITE_AI_RESEARCH_ENABLED` activation; authenticated real-site browser smoke in light/dark themes; evidence/OpenAI usage/ledger/snapshot/audit inspection; and confirmation that no message, send, or later-status regression occurred.
