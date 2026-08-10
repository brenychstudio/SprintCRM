# CRM-PBG-01 — Product Bridge read adapter

## Status

`READY_FOR_CRM_PBG_01_HUMAN_READ_PILOT`

This status means that the bounded read adapter and the local supervised runtime are ready for an operator-controlled real-data check. It does **not** mean that the human pilot has run or passed. CRM-PBG-02, staged writes, privileged actions, and productionized token acquisition remain out of scope.

## Purpose and authority boundary

CRM-PBG-01 exposes a deliberately small read-only view of authoritative SprintCRM state through the frozen Shared AI Product Bridge. It preserves the existing product loop and keeps Supabase Postgres, reached through organization-scoped RLS, as the source of truth.

```text
AI client
  -> Shared Bridge generic MCP transport and core
  -> SprintCRM Product Adapter
  -> product-owned bounded SprintCRM read models
  -> authenticated Supabase user authority
  -> organization-scoped RLS
  -> authoritative Supabase Postgres
```

The product-owned read-model layer contains the SprintCRM/Supabase query semantics, projections, limits, redaction, cursor handling, and freshness evidence. It is usable independently of MCP. The adapter maps those semantic reads to Shared contracts; it is not a raw SQL or general-purpose Supabase query surface.

The registered authority profile is fixed at:

```text
READ = 7
STAGED_WRITE = 0
PRIVILEGED_ACTION = 0
```

The descriptor is:

| Field | Value |
| --- | --- |
| Product ID | `sprint-crm` |
| Product version | `0.0.0` |
| Adapter version | `0.1.0-dev` |
| Schema version | `1.0.0` |
| Namespaces | `crm.workspace`, `crm.leads`, `crm.followups`, `crm.activities`, `crm.pipeline` |

## Frozen operation surface

Shared operation definitions use the frozen Shared validator's lowercase operation keys. Stable CRM semantic names and the explicitly mapped MCP aliases remain the public product surface.

| CRM semantic operation | Shared definition | MCP alias | Required scope |
| --- | --- | --- | --- |
| `crm.workspace.getContext` | `crm.workspace:get_context` | `crm_workspace__getContext` | `crm.context.read` |
| `crm.leads.search` | `crm.leads:search` | `crm_leads__search` | `crm.leads.read` |
| `crm.leads.get` | `crm.leads:get` | `crm_leads__get` | `crm.leads.read` |
| `crm.leads.listActionQueue` | `crm.leads:list_action_queue` | `crm_leads__listActionQueue` | `crm.leads.read` |
| `crm.followups.listDue` | `crm.followups:list_due` | `crm_followups__listDue` | `crm.followups.read` |
| `crm.activities.listRecent` | `crm.activities:list_recent` | `crm_activities__listRecent` | `crm.activities.read` |
| `crm.pipeline.getSummary` | `crm.pipeline:get_summary` | `crm_pipeline__getSummary` | `crm.pipeline.read` |

There are no convenience, campaign, outreach, write, approval, send, delete, or privileged tools in this checkpoint. MCP discovery must return exactly the seven aliases above.

### Operation semantics

- `crm.workspace.getContext` accepts an empty semantic input and returns only safe expected-organization context: organization ID and name, the authenticated user's membership role, CRM-PBG-01 capabilities, and generation time. It never returns the user ID/email, other memberships, provider metadata, or credentials.
- `crm.leads.search` accepts `q`, `stage`, `status`, `nextAction`, `cursor`, and `limit`. It returns bounded lead summaries through explicit safe projections. It never returns contact data, notes, outreach content, AI/audit data, or normalized deduplication fields.
- `crm.leads.get` requires a valid lead UUID and returns one safe business, pipeline, next-action, service, revenue, and timestamp projection. Safe not-found behavior does not reveal whether a lead exists outside the bound organization. Only this operation may add allowlisted `email` and `phone` fields, and only when trusted runtime authority includes `crm.contactData.read`.
- `crm.leads.listActionQueue` exposes the existing active-lead due/next-action behavior behind Today. It accepts `dueBefore`, `stage`, and `limit`, orders deterministically, and returns safe overdue, due-today, due timestamp, next-action, and stage facts. It is intentionally not called `listPriority`: SprintCRM has no authoritative numeric lead-scoring model.
- `crm.followups.listDue` accepts `dueBefore`, `stage`, `cursor`, and `limit`. It represents lead-backed next-action state; SprintCRM does not currently persist a separate Task or FollowUp entity. It returns safe lead references without contact data.
- `crm.activities.listRecent` requires a lead UUID and accepts bounded `types` and `limit`. It returns only explicit activity columns plus type-specific allowlisted metadata. Arbitrary activity `meta` JSON and audit payloads never pass through.
- `crm.pipeline.getSummary` accepts `status`, `niche`, and `serviceInterest`. It uses bounded server-side count queries and reports the actual stages `new`, `contacted`, `replied`, `proposal`, `won`, and `lost`. It does not invent opportunities, configurable stages, or scores.

## Scopes and default pilot authority

The adapter defines these scopes:

- `crm.context.read`
- `crm.leads.read`
- `crm.contactData.read`
- `crm.followups.read`
- `crm.activities.read`
- `crm.pipeline.read`

The initial pilot grants every read scope above **except** `crm.contactData.read`. Contact-data authority is an explicit trusted runtime decision, never a normal operation input and never self-granted through `_bridge` metadata.

Without `crm.contactData.read`, `crm.leads.get` omits `email` and `phone`. Search, action queue, follow-up, activity, pipeline, and workspace results never expose them regardless of scope. With the additional scope, only `crm.leads.get` may expose allowlisted email and phone values. Free-form notes, current outreach bodies, message bodies, prompts, AI outputs, audit payloads, credentials, and unrestricted JSON remain excluded in every case.

## Bounds, schemas, and freshness

All inputs and outputs are validated by Shared-compatible runtime schemas with unknown input properties rejected. No operation accepts `organizationId`, `workspaceId`, `userId`, a Supabase query, or a requested scope.

| Surface | Default | Hard limit |
| --- | ---: | ---: |
| Lead search query text | — | 100 characters |
| Lead search results | 10 | 25 |
| Action queue results | 10 | 25 |
| Due follow-up results | 10 | 25 |
| Recent activities | 20 | 50 |
| Structured operation result | — | 256 KiB |

Strings and arrays have conservative schema limits, list ordering and cursors are stable, and table reads use explicit projections rather than `select('*')`. Pipeline aggregation uses count queries instead of loading the lead table. The Shared `boundedOutput` contract declaration describes the bound but does not independently enforce serialized bytes, so the product adapter enforces the 256 KiB ceiling and the MCP transport applies matching result limits as defense in depth. Oversized results fail safely.

READ requests require neither incoming freshness evidence nor idempotency keys. Results provide deterministic, non-secret snapshot/freshness evidence derived from the safe returned state. This evidence supports later read consistency work; it is not a write guarantee.

## Authenticated Supabase and RLS model

The pilot runtime receives one explicit, short-lived authenticated Supabase **user** access token and uses it with a low-privilege publishable project key or legacy `anon` JWT. The token remains process-local and all database reads execute under that user's organization-scoped RLS authority.

Startup performs these checks before opening the MCP service:

1. Validate the access token using Supabase's authenticated-user mechanism.
2. Resolve the authenticated user without exposing user identity in status or results.
3. Validate the trusted expected organization UUID.
4. Verify that the user has a membership in that exact organization.
5. Load the safe organization context and bind every read model to that organization.
6. Fail closed if authentication, membership, or organization resolution does not match.

The expected organization comes only from trusted runtime configuration. Semantic inputs cannot change it. Queries retain RLS enforcement and are additionally constrained to the bound organization where applicable. The runtime does not silently use the existing oldest-membership behavior of `current_org_id()` when a user has multiple memberships.

The runtime validates both credential classes before constructing a client. Only a current `sb_publishable_...` key or a legacy JWT whose decoded role is exactly `anon` is accepted as the project identity. The user-token slot requires a structurally valid, non-expired JWT with role `authenticated` and a UUID subject; Supabase `auth.getUser(token)` then performs the authoritative remote verification. Secret/elevated `sb_secret_...`, legacy `service_role`, credentials in the wrong slot, expired tokens, and arbitrary non-empty strings fail closed. The runtime never requests, accepts, or uses an elevated credential, user password, refresh token, browser `localStorage`, or automatically extracted browser session. It never persists or logs the access token and never includes it in errors, receipts, provenance, tool results, startup status, or health output.

## Runtime configuration

The following environment variable **names** form the supervised runtime seam. Secret/configuration values must be supplied through the operator's approved ephemeral channel and must not be added to source, documentation, fixtures, shell scripts, ChatGPT app configuration, or committed `.env` files.

| Name | Purpose | Secret |
| --- | --- | --- |
| `SPRINTCRM_BRIDGE_SUPABASE_URL` | Existing Supabase project URL | No |
| `SPRINTCRM_BRIDGE_SUPABASE_ANON_KEY` | Low-privilege publishable key or legacy `anon` JWT (historic env name retained) | Treat as configuration; never expose in tool/status output |
| `SPRINTCRM_BRIDGE_USER_ACCESS_TOKEN` | Short-lived authenticated user JWT | Yes |
| `SPRINTCRM_BRIDGE_EXPECTED_ORGANIZATION_ID` | Trusted single-organization binding | Sensitive configuration |
| `SPRINTCRM_BRIDGE_SCOPES` | Trusted comma-separated runtime scopes | No |
| `SPRINTCRM_BRIDGE_MCP_PORT` | Optional loopback port override | No |

The safe default port is `47841`. The initial `SPRINTCRM_BRIDGE_SCOPES` configuration must omit `crm.contactData.read`. Token retrieval and renewal UX are deliberately not productized in CRM-PBG-01; an expired token requires the operator to stop the runtime, provide a new short-lived token, and restart.

## Frozen Shared dependency

SprintCRM consumes the local unpublished Shared packages through package `file:` dependencies, following the internal development/pilot strategy already proven by Distribution Desk. Shared source is neither copied into SprintCRM nor modified.

The required Shared repository baseline is:

```text
C:\PROJECTS\shared-ai-product-bridge
563b6c8f0b6452ccc5f18f3aac5e058633b7cdb0
```

Before installing dependencies or running the pilot, verify that this exact commit is checked out and its working tree is clean. The relative package links resolve from SprintCRM to the Shared `packages/*` directories. This is an internal local pilot distribution mechanism, not the final external packaging or release strategy.

Shared remains the generic contract/core/conformance/MCP transport layer. CRM-specific auth, organization binding, projection, redaction, bounds, and domain semantics remain SprintCRM adapter concerns; none requires a Shared change.

## Local MCP runtime and safe status

After supplying the required runtime environment through an ephemeral operator-controlled channel, start the loopback-only service from the SprintCRM repository:

```powershell
npm run product-bridge:read-pilot
```

Default endpoints:

- MCP: `http://127.0.0.1:47841/mcp`
- Health: `http://127.0.0.1:47841/health`

The frozen Shared `LocalMcpHttpService` owns `/health`; its deliberately minimal response contains only `status`, `transport`, `sessionMode`, and `toolCount`. A ready CRM pilot therefore reports the safe equivalent of:

```json
{
  "status": "ready",
  "transport": "streamable-http",
  "sessionMode": "stateless",
  "toolCount": 7
}
```

The CRM startup line is the separate safe readiness profile. It may additionally report `productId: sprint-crm`, the `7/0/0` operation-class profile, `sourceMode: authenticated-rls-readonly`, and `canonicalRemoteUntouched: true`. Keeping those fields out of `/health` preserves the frozen Shared transport rather than forking it for CRM convenience.

Neither status surface may contain JWTs, keys, user IDs/emails, contact data, membership details, organization names, organization secrets, or database records. The HTTP service binds only to loopback and uses Shared's stateless Streamable HTTP transport.

## Supervised real-data pilot checklist

Do not automate this checklist and do not run it from a coding agent. The operator performs it later with one known internal record.

### Prepare

1. Confirm SprintCRM validations and Shared read-adapter conformance pass with the exact `7/0/0` profile.
2. Confirm the Shared repository is clean at `563b6c8f0b6452ccc5f18f3aac5e058633b7cdb0`.
3. Select one internal SprintCRM user and one expected organization in which that user is already a member.
4. Obtain a fresh short-lived user access token through the approved operator workflow. Do not paste it into chat, source, logs, tunnel configuration, or a committed file.
5. Supply the six runtime configuration names above in an ephemeral process environment. Grant the safe read scopes and intentionally omit `crm.contactData.read`.
6. Record one known lead's visible Today, Lead Drawer, activity, and Pipeline facts for comparison. Do not modify the lead for the pilot.

### Connect

1. Run `npm run product-bridge:read-pilot` and confirm the safe startup profile reports `READ=7`, `STAGED_WRITE=0`, and `PRIVILEGED_ACTION=0`.
2. Open `/health` locally and verify ready/stateless/Streamable HTTP/tool-count-only output with `toolCount: 7` and no sensitive data.
3. Start Secure MCP Tunnel for the local `/mcp` endpoint. Do not put the Supabase token or anon key in tunnel or client metadata.
4. Connect a separate ChatGPT app named `Sprint CRM — Read Pilot` to the tunnel endpoint.
5. Run MCP discovery and verify the exact seven aliases listed in this document. Stop if any write, privileged, campaign, Gmail, or unexpected tool appears.

### Compare and verify

1. Call `crm_workspace__getContext` and confirm it describes only the expected organization and safe membership/capability context.
2. Find the known lead with `crm_leads__search`; compare its safe summary with SprintCRM.
3. Call `crm_leads__get`; compare stage/status, next action, service and timestamp facts with Lead Drawer. Confirm `email`, `phone`, notes, and message bodies are absent.
4. Compare `crm_leads__listActionQueue` and `crm_followups__listDue` with the lead's Today/next-action state. Confirm there is no fabricated score or separate task identity.
5. Compare `crm_activities__listRecent` with the lead timeline. Confirm metadata is narrowly projected and no arbitrary JSON or audit payload appears.
6. Compare `crm_pipeline__getSummary` stage counts with Pipeline for the same filters.
7. Re-check the known lead and relevant timeline in SprintCRM. Verify zero CRM mutations, zero new activities, zero campaign/message/research changes, zero AI generations, zero Gmail actions, and zero provider calls.

### Shut down

1. Disconnect and stop Secure MCP Tunnel.
2. Stop the local MCP runtime.
3. Remove the process-local runtime configuration and let the short-lived token expire according to operator policy.
4. Record the pilot evidence and outcome separately. Only a reviewed successful run may change the status from ready to pilot PASS.

## Non-interference guarantees

CRM-PBG-01 does not call or modify `supabase/functions/outreach-ai-runtime`, OpenAI, any other model provider, the AI generation ledger, research snapshots, outbound messages, campaign progression, feature flags, or supervised AI policy. It does not read AI payloads into Bridge results.

It also has no Gmail OAuth, token, inbox, draft, send, reply, or polling behavior. No customer communication is possible through this adapter.

The runtime exposes no insert, update, delete, RPC mutation, raw SQL, migration, bulk action, stage move, approval, or send capability. `activities` remains the canonical CRM timeline and this checkpoint reads it only. No database migration is required or included.

## Known limitations

1. This is an internal supervised local pilot, not a production authentication or public distribution design.
2. Access-token acquisition and renewal are manual; the runtime does not hold a refresh token and must restart after token replacement.
3. One runtime process is bound to one trusted expected organization. Organization switching requires an explicit restart with reviewed configuration.
4. The Shared packages are consumed from a pinned local repository; external package publication/versioning remains future work.
5. `/health` intentionally exposes the frozen Shared minimal shape; CRM-specific readiness details are printed separately at startup.
6. Follow-ups are lead-backed next-action projections, not independently persisted tasks.
7. Action-queue ordering reflects existing due/next-action semantics and is not a lead-scoring or AI-priority model.
8. Pipeline stages are the six existing SprintCRM stages, not configurable stages or Opportunity entities.
9. Search and list tools never expose contact data. Even with extra contact authority, only single-lead get may return email and phone; notes and message bodies remain unavailable.
10. Campaign/outreach reads, company and opportunity models, writes, approvals, Gmail, AI actions, and autonomous workers are not part of this surface.
11. Normal automated tests are credential-free and use injected fakes; the real-data pilot remains a separate human checkpoint and has not been run.
12. Pipeline counts use six bounded HEAD/count requests plus a watermark read, not one shared MVCC transaction; the result is operational read evidence rather than a transactional financial snapshot.
13. Existing indexes support the due queue, but substring search and pipeline stage counts may need additive indexes at larger scale. No migration was needed or authorized for this supervised pilot.
14. Local `file:` dependencies require the frozen Shared checkout at the documented relative path. Hosted CI or another workstation needs the same checkout topology until Shared has a reviewed package distribution strategy.
15. The runtime does not refresh or proactively rotate an expired user token. Reads fail closed and the operator must restart; loopback/tunnel access must remain restricted because the supervised process supplies its trusted scope profile to connected MCP calls.
16. Supabase requests have a 15-second abort bound, but frozen Shared `/health` reports local transport readiness rather than continuously probing the remote database or token lifetime.
17. Shared's in-memory audit sink is appropriate for this short supervised pilot, not an unattended high-volume or long-running production process; production audit retention/bounding remains a later checkpoint.

## Checkpoint

The next authorized action is the supervised checklist above. Do not begin CRM-PBG-02 or grant write/privileged authority from this status.

`READY_FOR_CRM_PBG_01_HUMAN_READ_PILOT`
