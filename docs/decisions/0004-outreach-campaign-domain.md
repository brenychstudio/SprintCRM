# ADR 0004: Use an organization-isolated, versioned campaign domain

**Status:** Accepted on 2026-07-22.

## Context

SprintCRM's core CRM is lead-centric: `leads` holds contact state and `activities` is the canonical user-facing timeline. OutreachOps needs campaign-specific workflow state, research evidence, reusable template content, reviewed message versions, suppression, and a technical audit trail without overloading core lead records.

The domain must prevent a campaign in one organization from linking to an entity from another organization even if a browser client or future service is faulty.

## Decision

OUTREACH-01R adds the following additive domain:

```text
organizations
  └─ campaigns
       └─ campaign_members
            ├─ research_snapshots
            └─ outbound_messages

message_templates
  └─ template_versions

organizations
  ├─ suppression_entries
  └─ audit_events
```

All new tables use `organization_id`, `public.current_org_id()` defaults, and organization-member RLS. Every relationship that carries an organization boundary is a composite foreign key using the referenced row ID and its organization ID. The existing `leads` and `ai_generations` gain logically redundant unique pairs `(id, org_id)` solely to support this protection; no row data or current uniqueness behavior changes.

Research snapshots, template versions, and outbound messages are versioned. Authenticated clients may insert/read research and template versions but cannot update them. Substantive outbound-message content is protected by a trigger and requires a new business version; status and approval metadata can still transition on the existing version.

`audit_events` is an append-only technical/security record. It does not replace `activities`. A trigger rejects update/delete and authenticates browser-originated audit writes as human actor events. Later AI/server actions must use a reviewed narrow backend boundary, not an unrestricted browser or service-role workflow.

Workflow states are `text` columns with named `CHECK` constraints, following the existing SprintCRM schema style. This allows deliberate forward migrations as the supervised workflow learns, without prematurely freezing public PostgreSQL enums.

## Consequences

- OUTREACH-02R can build manual Campaign setup, member eligibility, research, and review UI against a stable domain.
- OUTREACH-03R can link strict AI job outputs to immutable research/message versions and audit records.
- No Campaign UI, AI API, Gmail, queues, auto-send, reply sync, or autonomy is introduced here.
- All future production schema changes remain reviewed additive migrations; direct Dashboard/Table Editor schema changes remain prohibited.
- Deleting a lead or campaign with linked campaign members is restricted. Future UI must provide archive/intentional cleanup flows rather than silently destroying outreach history.
- Local `supabase db reset` and behavioral RLS tests remain verification debt until Docker Desktop is available.
