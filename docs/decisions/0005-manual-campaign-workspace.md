# ADR 0005: Manual-first Campaign Workspace uses routes and atomic workflow RPCs

**Status:** Accepted on 2026-07-29 after authenticated manual smoke.

## Context

OUTREACH-01R introduced the organization-isolated campaign domain but no operational interface. The first workflow must be usable by a human and a browser-assisted pilot before any AI or Gmail integration.

## Decision

Campaigns are available only when `outreach_ops_enabled` is enabled. The primary surfaces are:

```text
/campaigns
/campaigns/new
/campaigns/:campaignId
/campaigns/:campaignId/edit
/campaigns/:campaignId/review
/campaigns/:campaignId/review/:memberId
```

LeadDrawer remains compact and links into the Full Workspace. Today adds only an aggregate outreach entry point under the same flag. The Full Workspace is a stable route for one campaign member, not a modal.

Manual research and messages create explicit new versions only on Save/Submit. The database owns version increments and locks the campaign member row to prevent duplicate concurrent versions.

Critical transitions use narrow `security invoker` database RPCs: campaign creation/update, member eligibility/addition, research save, message save, approve, and skip. Approval atomically updates message/member state and creates the corresponding audit and CRM activity. These functions are executable only by `authenticated`; no service role, AI, Gmail, or sending path is introduced.

The Review Queue orders `needs_review`, then `draft_ready`, then `research_ready`, with `failed` after them. Approve and Skip navigate to the next available review member or back to the Campaign overview.

## Consequences

- A Work pilot can validate the manual workflow on real contacts.
- The UI remains hidden and direct Campaign routes redirect when the feature flag is off.
- `activities` stays the user-facing timeline; `audit_events` remains the technical/security trail.
- AI, Gmail, auto-send, queues, replies, follow-ups, template library, and policy/autonomy work remain deferred.
- Authenticated browser smoke confirmed feature-flag behavior, light/dark, responsive views, four locales, manual versioning, review/approval, Drawer context, and Today navigation. Docker-backed local reset and behavioral RLS integration remain separate pre-staging verification debt.
