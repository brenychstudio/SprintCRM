# CRM-PBG-02B — Bridge staged-write integration

Status: **AUTOMATED ACCEPTANCE PASS — HUMAN PRODUCTION PILOT NOT STARTED**

CRM-PBG-02B exposes the accepted CRM-PBG-02A transactional staging seam through the accepted Shared AI Product Bridge baseline `cf37a7937e55803ea48cd23cc028521cc8fc5881`. It adds one bounded outreach context read and two controlled staged writes. It does not add approval, provider-draft, send, publish, delete, bulk-mutation, AI-generation, or privileged authority.

`SHARED-PBG-FIX3` corrected the generic MCP discovery contract so every tool advertises the union of its strict success receipt and canonical safe Bridge error. The previously failing real `listTools() → SCOPE_DENIED` CRM regression now returns the structured error without JSON-RPC `-32602`; malformed output remains rejected by MCP SDK validation.

## Exact surface

| Semantic operation | Internal operation | MCP alias | Class | Required scope |
| --- | --- | --- | --- | --- |
| `crm.workspace.getContext` | `crm.workspace:get_context` | `crm_workspace__getContext` | READ | `crm.context.read` |
| `crm.leads.search` | `crm.leads:search` | `crm_leads__search` | READ | `crm.leads.read` |
| `crm.leads.get` | `crm.leads:get` | `crm_leads__get` | READ | `crm.leads.read` |
| `crm.leads.listActionQueue` | `crm.leads:list_action_queue` | `crm_leads__listActionQueue` | READ | `crm.leads.read` |
| `crm.followups.listDue` | `crm.followups:list_due` | `crm_followups__listDue` | READ | `crm.followups.read` |
| `crm.activities.listRecent` | `crm.activities:list_recent` | `crm_activities__listRecent` | READ | `crm.activities.read` |
| `crm.pipeline.getSummary` | `crm.pipeline:get_summary` | `crm_pipeline__getSummary` | READ | `crm.pipeline.read` |
| `crm.outreach.getStagingContext` | `crm.outreach:get_staging_context` | `crm_outreach__getStagingContext` | READ | `crm.outreach.read` |
| `crm.research.stageSnapshot` | `crm.research:stage_snapshot` | `crm_research__stageSnapshot` | STAGED_WRITE | `crm.research.stage` |
| `crm.email.stageDraft` | `crm.email:stage_draft` | `crm_email__stageDraft` | STAGED_WRITE | `crm.email.stage` |

The exact discovery profile is:

```text
READ              8
STAGED_WRITE      2
PRIVILEGED_ACTION 0
```

The adapter version is `0.2.0-dev`; the Shared contract schema remains `1.0.0` and the current SprintCRM package/product version remains `0.0.0`.

No future or privileged operation is advertised. The staged-write tools are non-destructive and idempotent in MCP annotations; they are not read-only. All eight reads remain non-destructive and read-only.

## Runtime architecture and authority

The production path is:

```text
AI / MCP transport
→ accepted Shared Bridge validation, scope, idempotency and receipt lifecycle
→ SprintCRM semantic Product Adapter
→ product-owned staging coordinator
→ five narrow CRM-PBG-02A RPCs
→ authenticated Supabase user
→ trusted organization binding and organization-scoped RLS
→ authoritative SprintCRM PostgreSQL
```

The runtime retains the CRM-PBG-01 credential model: one low-privilege publishable or legacy anon project identity plus one fresh authenticated user access token. Runtime startup verifies the user and expected organization membership. No service-role or secret project credential is accepted.

Every MCP request is rebound to that verified organization before Shared routing. A caller may omit `_bridge.subject`; the runtime replaces Shared's product default with the trusted organization. A caller-supplied different subject fails identity validation before a claim or product effect. Organization ID and actor ID are never accepted as ordinary operation input.

The local startup status now reports `sourceMode: authenticated-rls-staging`, exact `8/2/0`, and `stagedWriteGranted`. Shared's fixed `/health` response remains unchanged except that `toolCount` is now `10`.

## Default scopes

The safe default runtime scopes are:

```text
crm.context.read
crm.leads.read
crm.followups.read
crm.activities.read
crm.pipeline.read
crm.outreach.read
```

The default deliberately omits:

```text
crm.contactData.read
crm.research.stage
crm.email.stage
```

Discovery still reports the exact ten-operation product contract, but Shared denies a staged-write call unless the operator explicitly grants its operation scope in trusted runtime configuration. For the future single-email CRM-PBG-02C pilot, grant `crm.email.stage` only for the supervised session; `crm.research.stage` is unnecessary unless that separate operation is deliberately tested.

## Bounded staging context

`crm.outreach.getStagingContext` accepts exactly:

```json
{ "campaignMemberId": "<uuid>" }
```

It returns one content-free, organization-scoped context containing:

- campaign-member ID, lifecycle status, and update time;
- campaign ID, channel, default language, and update time;
- lead language and update time only;
- latest research ID/version/time or `null`;
- latest outbound-message ID/version/status/time or `null`;
- the canonical `sha256:` freshness version and generated time.

The public projection removes internal organization and actor fields. It never returns lead email, phone, notes, research text/evidence, draft subject/body, arbitrary activity metadata, JWTs, project keys, provider credentials, or model secrets. Its `resultSnapshotId` is the same canonical freshness version returned in `result.freshness.version`.

## Research staging contract

`crm.research.stageSnapshot` accepts only:

- `campaignMemberId`: UUID;
- `observedOpportunity`: trimmed 50–900 characters;
- `recommendedOffer`: trimmed 30–700 characters;
- `evidence`: one to three exact `{url,note}` objects, unique normalized HTTPS URLs, notes of 20–350 characters;
- optional `recommendedCase`: `null` or bounded text up to 700 characters;
- optional `confidence`: `null` or `0..0.85`;
- optional `warnings`: at most five bounded entries.

The adapter supplies normalized defaults for omitted optional fields. It prepares one immutable `research_snapshot` receipt with the next version, `research_ready`, and pending validation/approval. The transactional RPC alone creates the snapshot with `source=bridge`, updates the member only within the accepted conservative lifecycle, appends activity/audit/provenance, and durably stores the exact Shared receipt.

The operation does not call OpenAI or `outreach-ai-runtime`, approve research, communicate with a provider, or mutate unrelated lead state.

## Email draft staging contract

`crm.email.stageDraft` accepts exactly five fields:

- `campaignMemberId`: UUID;
- `researchSnapshotId`: UUID for the exact latest same-member research snapshot;
- `subject`: trimmed single-line plain text, 5–120 characters;
- `body`: trimmed plain text, 120–2400 characters;
- `language`: `en`, `es`, `uk`, or `ru`.

Channel is not caller input. The CRM seam fixes it to email. HTML-like markup and unresolved placeholder delimiters are rejected. The result identifies only the immutable outbound-message ID/version, campaign member, exact research snapshot/version, and `status=draft`; validation and approval remain pending.

The accepted RPC inserts `source=bridge`, `status=draft`, `approved_by=null`, `approved_at=null`, and `sent_at=null`, then makes only the accepted `draft_ready` member transition and audit/activity entries in the same transaction. It cannot approve, schedule, create a Gmail/provider draft, send, invoke a provider, or create an AI generation.

## Freshness, idempotency and exact receipts

Both staged writes require transport-owned `_bridge` metadata:

```json
{
  "_bridge": {
    "idempotencyKey": "<bounded operator/client key, maximum 200 characters>",
    "sourceSnapshot": {
      "snapshotId": "sha256:<64 lowercase hex characters>",
      "generatedAt": "<timestamp from the staging-context read>"
    }
  }
}
```

Use the exact current `crm.outreach.getStagingContext` freshness version. Do not place the organization, actor, approval, provider action, or send instruction in business input.

The coordinator implements Shared's `IdempotencyStore` against the accepted durable CRM ledger. It uses a canonical SHA-256 semantic fingerprint and a request-local coordinator context. Shared owns the lifecycle ordering; the adapter does not reproduce it:

1. Shared validates identity, scope, operation class, and strict input.
2. CRM atomically claims the durable idempotency address.
3. A completed same-key/same-request claim returns the exact stored receipt immediately, before freshness.
4. Same key with different semantic input returns `DUPLICATE_REQUEST` with zero effect.
5. An equivalent active claim returns a retryable duplicate/in-progress result with zero second effect.
6. A new claim reads current CRM context and requires the supplied snapshot to be `CURRENT`.
7. Adapter invocation prepares one effect in process; it performs no database mutation.
8. Shared validates the bounded result and creates the canonical staged receipt.
9. Coordinator sends the exact receipt and prepared command to one narrow transactional commit RPC.
10. PostgreSQL rechecks authority, row locks, lifecycle, latest research, freshness, and version; the effect, activity, audit, provenance, ledger completion, and exact receipt commit atomically.

New `STALE` or `UNKNOWN` state fails closed with zero effect and releases only the matching pending claim. A completed replay survives runtime restart because the receipt lives in CRM PostgreSQL. A commit-time race that makes state stale or invalid also returns a generic safe failure and creates zero effect. Shared in-memory idempotency is not used for production CRM effects.

Persisted provenance is generated only from verified runtime/request state and is bounded to product, semantic operation, request/correlation IDs, authenticated user subject, organization/member IDs, source snapshot, staged entity, and timestamp. Business content remains in canonical CRM tables; credentials and unrestricted request bodies never enter provenance or the ledger.

## Implementation boundaries

- `crm-staged-write-coordinator.ts` joins the accepted Shared lifecycle to CRM's durable claim/commit/release seam. Async request context is internal plumbing only; durable correctness remains PostgreSQL-owned.
- `crm-staged-write-domain-gateway.ts` is the only TypeScript code that invokes the five staging RPCs. It exposes no generic RPC, table, SQL, or admin surface.
- `sprint-crm-product-adapter.ts` owns semantic schemas, strict projections, manifest classes/scopes, freshness delegation, and safe staged result shapes.
- `sprint-crm-mcp-runtime.ts` owns verified organization rebinding and installs the CRM coordinator as Shared's durable idempotency store.
- The seven CRM-PBG-01 read implementations are unchanged apart from advertising the expanded accepted capability set in workspace context.

No Shared package modification within SprintCRM, database migration, schema/type change, AI-runtime change, UI change, or direct table mutation is part of CRM-PBG-02B. SprintCRM consumes the accepted Shared checkout through its existing local `file:` junctions; no dependency or lockfile rewrite is required.

## Automated proof

Run:

```powershell
npm run verify:migrations
npm run typecheck
npm run lint
npm test
npm run build
npm run test:product-bridge
npm run test:product-bridge:postgres
git diff --check
npm audit --audit-level=low
```

Product Bridge tests prove exact discovery `8/2/0`, MCP annotations and aliases, strict input/output projection, organization binding, content-free staging context, both staged receipts, durable replay before freshness, conflict and in-progress behavior, stale/unknown release, commit-time fail-closed behavior, one effect on replay, and exact receipt propagation. Shared adapter conformance covers READ and STAGED_WRITE classes. The real MCP SDK 1.30.0 negative path performs discovery before a denied staged-write call, returns bounded `SCOPE_DENIED`, and proves the CRM claim/effect gateway was not invoked. The repository-owned real PostgreSQL 17.6 gate compiles all 14 PBG-02A functions and passes all 37 pgTAP assertions plus its concurrency proof.

Final CRM-PBG-02B unblock evidence against Shared `cf37a7937e55803ea48cd23cc028521cc8fc5881`:

- actual discovered-tool `SCOPE_DENIED` regression: PASS, no JSON-RPC `-32602`, no claim/effect;
- Product Bridge suite: 64/64 PASS;
- full repository suite: 198/198 PASS;
- real PostgreSQL gate: accepted baseline and migration PASS, 14/14 functions, 37/37 pgTAP, concurrent equivalent claims produce one ledger row;
- migration verification, typecheck, lint, production build, diff check, and low-level dependency audit: PASS; audit reports zero vulnerabilities.

## Runtime and future human pilot

The historical command remains compatible:

```powershell
npm run product-bridge:read-pilot
```

It now starts the complete `8/2/0` runtime, although safe default scopes still deny both staged writes. Use the same six documented `SPRINTCRM_BRIDGE_*` environment variables from the CRM-PBG-01 operator guide. For any later staged session, set scopes ephemerally and clear all credentials afterward. Never store actual keys or JWTs in source, fixtures, documentation, shell history, or logs.

CRM-PBG-02C is intentionally not performed here. Its separate supervised gate should select one known campaign member, read a fresh staging context, grant only `crm.email.stage`, create exactly one real immutable draft, test exact replay and changed-request conflict, inspect the CRM UI/database state, verify approval/provider/send effects remain zero, then stop the tunnel/runtime and clear credentials.

## Known residual risks

- The existing broad authenticated direct `UPDATE`/`DELETE` policies on `outbound_messages` remain separate product authority debt; this adapter never uses them.
- A short-lived user token can expire during operator setup or a session; startup and subsequent RLS calls fail closed, and the operator must replace only the token with a fresh authenticated-session token.
- The local `file:` Shared dependencies require the accepted sibling checkout at `cf37a7937e55803ea48cd23cc028521cc8fc5881` and are not standalone hosted-CI packaging.
- `/health` is transport readiness, not a live Supabase/RLS dependency probe; an unreachable backend causes operations to fail safely.
- No production migration or staged-write human pilot was performed in CRM-PBG-02B.

Rollback before any pilot is code-level: stop the runtime and revert the CRM-PBG-02B integration commit. The already accepted 02A database seam and historical ledger data are not destructively rolled back. After deployment, use a forward fix rather than rewriting an applied migration or deleting immutable/audit history.

Current checkpoint state: **CRM-PBG-02B AUTOMATED ACCEPTANCE PASS — CRM-PBG-02C HUMAN PRODUCTION PILOT NOT STARTED**.
