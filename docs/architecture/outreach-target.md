# OutreachOps target architecture

## Product boundary

SprintCRM remains an internal, human-controlled Client Acquisition OS. The core CRM loop remains intact. OutreachOps adds the following workflow:

```text
Contact -> qualify -> research -> offer/case selection -> personalized draft
        -> human review -> Gmail draft -> user send -> reply/follow-up -> pipeline
```

Today is the operational queue, LeadDrawer is concise lead context, and the full review workspace is a route such as `/leads/:leadId/outreach`. Do not add separate technical AI pages to primary navigation.

## Execution boundary

```text
React UI -> Supabase Edge Function -> OpenAI Responses API
          -> validated structured result -> Supabase -> human review queue
```

`OPENAI_API_KEY` is an Edge Function secret only. The browser receives no provider secret, and AI jobs have narrow domain operations rather than unrestricted SQL/service-role access.

## Database delivery gate

CRM studio's existing migration lineage was reconciled on 2026-07-22 and `db push --dry-run` is clean. All future production schema changes must be additive migrations from a clean, linked worktree; direct Dashboard/Table Editor schema changes are prohibited. One operator owns a migration write at a time. The existing manual import-schema drift remains a separately documented adoption gap and must not be silently overwritten.

## Target domain

| Target entity | Responsibility | Current state |
| --- | --- | --- |
| `campaigns` | Shared offer, tone, language, cases, limits and autonomy profile. | Missing |
| `campaign_members` | Lead/campaign relationship and campaign-specific workflow state. | Missing |
| `research_snapshots` | Immutable versioned evidence and recommendation. | Missing |
| `message_templates` / `template_versions` | Reusable, versioned campaign messaging. | Missing |
| `outbound_messages` | Business message versions, approval and provider state. | Missing |
| `suppression_entries` | Contact/sending prohibition. | Missing |
| `audit_events` | Actor, transition and human/AI audit records. | Missing |
| `activities` | Canonical CRM timeline. | Exists; retain |
| `ai_generations` | Historical early draft-generation record. | Exists locally; evaluate compatibility in OUTREACH-01R |

Campaign-member state belongs in `campaign_members`, not in `leads`. Use internal technical statuses as needed, but reduce UI language to: To prepare, Needs review, Ready, Sent, Needs attention.

## Delivery sequence

1. `OUTREACH-01R`: additive campaign domain, RLS, audit and generated types; no AI API.
2. `OUTREACH-02R`: manual campaign workspace, research/evidence and review shell.
3. `OUTREACH-03R`: supervised Edge Function jobs with strict schemas and human approval.
4. `OUTREACH-04R`: Gmail OAuth, Gmail draft-first and reconciliation.
5. `OUTREACH-05R`: replies, follow-ups, Today and Pipeline routing.
6. `AUTONOMY`: policy engine, queues, idempotency, kill switches and Shadow Mode only after validated supervised use.
