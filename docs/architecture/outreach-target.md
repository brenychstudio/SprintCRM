# OutreachOps target architecture

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
| `ai_generations` | Historical early draft-generation record. | Exists locally; evaluate compatibility in OUTREACH-01R |

Campaign-member state belongs in `campaign_members`, not in `leads`. Use internal technical statuses as needed, but reduce UI language to: To prepare, Needs review, Ready, Sent, Needs attention.

## Delivery sequence

1. `OUTREACH-01R`: completed — additive campaign domain, RLS, audit and generated types; no AI API.
2. `OUTREACH-02R`: accepted — manual campaign workspace, research/evidence, review shell, atomic human-controlled transitions, and a truthful empty Today state.
3. `LEADS-EDIT-01`: accepted — focused manual contact create/edit and Campaign eligibility repair.
4. Operational pilot: one test campaign with 5–10 real contacts, manual workflow, ChatGPT Work browser assistance, and human approval only. Record actual cycle time, missing fields, confusing transitions, and version churn before automating.
5. `OUTREACH-03R`: supervised Edge Function jobs with strict schemas and human approval, scoped from the proven pilot workflow.
6. `OUTREACH-04R`: Gmail OAuth, Gmail draft-first and reconciliation.
7. `OUTREACH-05R`: replies, follow-ups, Today and Pipeline routing.
8. `AUTONOMY`: policy engine, queues, idempotency, kill switches and Shadow Mode only after validated supervised use.
