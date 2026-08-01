# OutreachOps target architecture

## OUTREACH-03B research boundary

The next supervised research workflow is a single-contact, explicit user action in Campaign Full Workspace. It sends no messages and changes no later workflow status. A validated public HTTP(S) company hostname is the sole OpenAI built-in web-search domain; the Edge Function never fetches an arbitrary supplied URL. URL validation rejects credentials, localhost, `.local`, loopback/private IP literals, non-default ports, and placeholder domains. Strict `research_v1` evidence must be source-returned or on that validated domain. `proof_context` is human-entered verified portfolio material: without it, `recommended_case` must be null and output must warn that no verified case context was provided.

## Product boundary

SprintCRM remains an internal, human-controlled Client Acquisition OS. The core CRM loop remains intact. OutreachOps adds the following workflow:

```text
Contact -> qualify -> research -> offer/case selection -> personalized draft
        -> human review -> Gmail draft -> user send -> reply/follow-up -> pipeline
```

Today is the operational queue, LeadDrawer is concise lead context, and the full review workspace is a route such as `/leads/:leadId/outreach`. Do not add separate technical AI pages to primary navigation.

Core contact creation and editing use focused `/leads/new` and `/leads/:leadId/edit` routes. LeadDrawer remains read-only for contact identity and operational for next actions; campaign repair returns safely to the Leads wizard step and recalculates deterministic eligibility.

## Execution boundary

```text
React UI -> Supabase Edge Function -> OpenAI Responses API
          -> validated structured result -> Supabase -> human review queue
```

`OPENAI_API_KEY` is an Edge Function secret only. The browser receives no provider secret, and AI jobs have narrow domain operations rather than unrestricted SQL/service-role access.

## Database delivery gate

CRM studio's existing migration lineage was reconciled on 2026-07-22. The formerly manual import-schema drift is captured as a forward migration, and `db push --dry-run` is clean. All future production schema changes must be additive migrations from a clean, linked worktree; direct Dashboard/Table Editor schema changes are prohibited. One operator owns a migration write at a time.

## Target domain

| Target entity | Responsibility | Current state |
| --- | --- | --- |
| `campaigns` | Shared offer, tone and language context. Limits/autonomy are deferred. | Exists: OUTREACH-01R |
| `campaign_members` | Lead/campaign relationship and campaign-specific workflow state. | Exists: OUTREACH-01R |
| `research_snapshots` | Immutable versioned evidence and recommendation. | Exists: OUTREACH-01R |
| `message_templates` / `template_versions` | Reusable, versioned campaign messaging. | Exists: OUTREACH-01R |
| `outbound_messages` | Business message versions and approval state. Provider sync is deferred. | Exists: OUTREACH-01R |
| `suppression_entries` | Contact/sending prohibition foundation. | Exists: OUTREACH-01R |
| `audit_events` | Actor, transition and human/AI audit records. | Exists: OUTREACH-01R |
| `activities` | Canonical CRM timeline. | Exists; retain |
| `ai_generations` | Organization-scoped AI runtime ledger: legacy draft history plus versioned job/provider/usage/audit metadata. | OUTREACH-03A foundation; browser writes removed |

Campaign-member state belongs in `campaign_members`, not in `leads`. Use internal technical statuses as needed, but reduce UI language to: To prepare, Needs review, Ready, Sent, Needs attention.

## Delivery sequence

1. `OUTREACH-01R`: completed — additive campaign domain, RLS, audit and generated types; no AI API.
2. `OUTREACH-02R`: accepted — manual campaign workspace, research/evidence, review shell, atomic human-controlled transitions, and a truthful empty Today state.
3. `LEADS-EDIT-01`: accepted — focused manual contact create/edit and Campaign eligibility repair.
4. `OUTREACH-PILOT-01`: one test campaign with 3 real contacts, then 3–7 more; manual workflow, ChatGPT Work browser assistance, and human approval only. Record actual cycle time, missing fields, confusing transitions, and version churn before automating.
5. `OUTREACH-03A`: accepted — safe supervised AI runtime foundation. Production migrations `20260801000001` and forward fix `20260801000002` are applied, the authenticated `outreach-ai-runtime` Edge Function is ACTIVE, and the synthetic production probe completed on `gpt-5.4-mini` with 82 total tokens in 2164 ms. The probe created no research/message content or status mutation and made no Gmail/sending operation. The OpenAI boundary remains server-only; client and server kill switches remain available.
6. `OUTREACH-03B` — AI Research Job: next engineering checkpoint. Scope a supervised, human-reviewed research job from the proven pilot workflow; do not add automatic sends.
7. `OUTREACH-03C` / `OUTREACH-03D`: supervised AI draft and QA respectively, each scoped from the proven pilot workflow.
8. `OUTREACH-04R`: Gmail OAuth, Gmail draft-first and reconciliation.
9. `OUTREACH-05R`: replies, follow-ups, Today and Pipeline routing.
10. `AUTONOMY`: policy engine, queues, idempotency, kill switches and Shadow Mode only after validated supervised use.

## Runtime foundation constraints

The OUTREACH-03A probe is a fixed synthetic request only. It uses the OpenAI Responses API with `store: false`, strict JSON Schema, an approximately 25-second timeout, no automatic provider retry, and exact provider usage where available. `OPENAI_API_KEY` exists only as an Edge Function secret. `AI_RUNTIME_ENABLED` defaults to false server-side; `VITE_AI_RUNTIME_ENABLED` only gates the existing workspace card and also defaults to false. `AI_ALLOWED_ORIGINS` is an explicit CORS allowlist for the authenticated endpoint.

The production acceptance probe completed successfully after forward fix `20260801000002`; it did not generate research/message content, alter workflow status, or perform Gmail/sending work. Remaining pre-staging debt is Docker/local Supabase reset, behavioral RLS integration tests, and the Vite large-bundle warning.
