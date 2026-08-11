# CRM-PBG-02A — Transactional staging domain seam

Status: **IMPLEMENTED — REAL POSTGRESQL BEHAVIORAL GATE PASS**

This checkpoint adds the CRM-owned persistence boundary needed by future revenue staged writes. It does not register an operation, expose an MCP tool, call an AI provider, approve a message, create a provider draft, or send communication. The accepted Product Adapter remains 7 READ / 0 STAGED_WRITE / 0 PRIVILEGED_ACTION.

## Purpose and authority boundary

The seam supports two future semantic effects only:

- `crm.research.stageSnapshot`: persist one bounded, immutable research snapshot supplied by a reasoning client.
- `crm.email.stageDraft`: persist one bounded, immutable email draft tied to the exact latest research snapshot.

Both effects remain pending human review. Research staging does not generate or approve research. Email staging always writes `channel=email`, `status=draft`, and null approval/provider/send fields. Neither path calls `outreach-ai-runtime`, OpenAI, Gmail, or an AI job RPC.

## Additive database objects

Migration `20260810000001_product_bridge_transactional_staging.sql`:

- extends `research_snapshots.source` and `outbound_messages.source` with `bridge` while retaining all existing values;
- creates `product_bridge_write_requests`, a durable ledger keyed by `(organization_id, product_id, operation_id, idempotency_key)`;
- adds one safe staging-context RPC;
- adds narrow claim, release, research-commit, and email-commit RPCs;
- enables RLS on the ledger and grants no direct authenticated table access;
- grants only the five public orchestration RPCs to `authenticated`.

The ledger stores a semantic SHA-256 fingerprint, pending lease owner, exact completed Shared receipt, staged entity reference, bounded provenance, actor, and timestamps. It never stores the JWT, Supabase key, model/provider secret, prompt, research body, draft subject/body, or unrestricted request payload.

## Staging context and freshness

`get_product_bridge_staging_context(expectedOrganizationId, campaignMemberId)` verifies the authenticated user and exact organization membership, then returns only:

- campaign-member ID, lifecycle status, and `updatedAt`;
- campaign ID, channel, default language, and `updatedAt`;
- lead language and `updatedAt` (no lead contact fields);
- latest research ID/version/created time;
- latest outbound-message ID/version/status/updated time;
- a deterministic `sha256:` staging-context version and `generatedAt`.

It does not return company/contact names, email, phone, notes, research content, evidence, warnings, subject, body, AI payload, or provider state. The version is computed in PostgreSQL through the already-enabled `pgcrypto` `digest` function over canonical current-state evidence. The commit RPC recomputes the same version after locking the campaign member.

Freshness behavior is fail-closed:

- completed same-fingerprint requests replay the exact stored receipt before freshness is consulted;
- a new request with a different current version returns `STALE` and creates no effect;
- unavailable/cross-organization context raises one generic unavailable error;
- lifecycle state outside the operation allowlist returns `INVALID_STATE` and creates no effect.

## Durable idempotency and ordering

`claim_product_bridge_write` accepts only product `sprint-crm`, one of the two fixed operation IDs, a bounded key, a `sha256:` semantic fingerprint, a UUID claim token, and a 15–300 second lease.

Outcomes:

- `CLAIMED`: the caller owns a new or expired pending claim;
- `REPLAY`: same key and fingerprint completed previously; exact JSON receipt returned;
- `CONFLICT`: same address belongs to a different fingerprint or actor;
- `IN_PROGRESS`: an unexpired equivalent claim already owns the effect.

The unique address and row lock serialize concurrent claims. Expired pending work can be reclaimed. `release_product_bridge_write` deletes only a matching pending row owned by the authenticated actor, exact fingerprint, and exact claim token. It cannot release completed work or another claimant.

The required coordinator order is:

1. validate trusted identity/scopes and bounded semantic input;
2. claim durable idempotency;
3. return `REPLAY` or `CONFLICT` without freshness/effect work when applicable;
4. resolve authoritative staging context and require `CURRENT`;
5. prepare deterministic staged UUID and expected next version;
6. let Shared create the exact staged receipt;
7. call the narrow CRM commit RPC with prepared content and that exact receipt;
8. release only the matching pending claim if work fails before commit.

This ordering preserves Shared FIX2 semantics. A restart can reconstruct the gateway and replay from the CRM ledger. Shared in-memory idempotency is not sufficient for these production effects.

## Transactional effects

### Research snapshot

`stage_product_bridge_research_snapshot` locks the ledger claim and campaign member, validates freshness/lifecycle/version, then atomically:

- inserts one immutable `research_snapshots` row with `source=bridge` and no `ai_generation_id`;
- accepts `observedOpportunity` 50–900, `recommendedOffer` 30–700, optional case up to 700, confidence 0–0.85, one to three unique normalized HTTPS `{url,note}` evidence items, and up to five bounded warnings;
- advances only `queued`, `researching`, or `research_ready` to `research_ready` (advanced review/send states cannot regress);
- appends `research_saved` to the canonical `activities` timeline;
- appends `product_bridge.research.staged` to `audit_events`;
- completes the ledger with bounded provenance and the exact supplied safe receipt.

### Email draft

`stage_product_bridge_email_draft` locks the same state and additionally requires:

- member lifecycle `research_ready` or `draft_ready`;
- campaign default channel `email`;
- the exact latest research snapshot for the same member and organization;
- expected next message version;
- language `en`, `es`, `uk`, or `ru`;
- trimmed single-line 5–120 character subject and trimmed 120–2400 character plain-text body;
- no HTML tags or unresolved `{{…}}`/`[[…]]` placeholders.

It atomically inserts one immutable `outbound_messages` row with `source=bridge`, `channel=email`, `status=draft`, null approval/sent/template/AI fields; keeps/advances the member at `draft_ready`; appends `outreach_draft_saved` and `product_bridge.email_draft.staged`; and completes the same durable ledger transaction.

Any SQL exception rolls back the immutable row, member transition, activity, audit, provenance, and receipt together. A normal stale/invalid-state result deletes its pending claim in that same no-effect transaction so a corrected request can be submitted.

## Authentication and RLS

The seam preserves the CRM-PBG-01 model: low-privilege publishable/legacy anon project identity plus a real short-lived authenticated user JWT and explicit trusted organization binding.

Every callable RPC is `SECURITY DEFINER` with a fixed `pg_catalog, public[, extensions]` search path and explicitly requires:

- `auth.role() = authenticated`;
- non-null `auth.uid()`;
- membership of the expected organization;
- organization-matching campaign/member/lead/research rows.

No actor ID is accepted as authority. The actor is always `auth.uid()`. Anonymous and service-role execution fail closed. Helper functions and the ledger table have no browser grants; only the narrow authenticated RPC surface is executable.

The pre-existing broad authenticated `UPDATE`/`DELETE` policies on `outbound_messages` remain known product debt. CRM-PBG-02A does not widen, reuse, or attempt to redesign those policies. The future Bridge integration must call only the transactional RPC and never direct table mutation.

## Safe provenance and exact receipt

Persisted provenance is an exact bounded object containing only product ID, semantic operation ID, request/correlation IDs, authenticated user subject, organization/member IDs, source snapshot ID, staged entity ID, and timestamp. Recursive key guards reject credentials and business content.

The completed ledger receipt is the exact JSON object supplied at the future Shared commit boundary. It is capped at 16 KiB, must identify `sprint-crm`, `STAGED_WRITE`, `staged`, the exact staged entity and source snapshot, an allowlisted ID/version/status-only result, and pending validation/approval. Bounded safe diagnostics are permitted. Receipt-level `metadataSafe` and duplicate `provenance` are deliberately omitted in this seam; canonical bounded provenance lives in the ledger/audit payload. Staged research/email content and secrets are rejected.

## TypeScript seam for CRM-PBG-02B

- `crm-staging-context.ts` defines and fail-closed parses the PII/content-free context.
- `crm-staged-write-domain-gateway.ts` binds the verified organization/user and calls only the five narrow RPCs.

The future product-specific coordinator should implement Shared `IdempotencyStore` semantics around this gateway:

- `claim(address, fingerprint)` → `claim_product_bridge_write`;
- Product Adapter invocation → validate and register a prepared effect in process, without writing;
- `commit(address, fingerprint, exactReceipt)` → the appropriate `stage_product_bridge_*` RPC;
- `release(address, fingerprint)` → `release_product_bridge_write` with the owned claim token.

This lets Shared create the receipt before the CRM effect commit while CRM transactionally couples that exact receipt to the immutable effect. No Shared package change is required.

CRM-PBG-02B must add exactly two staged operations/scopes only after this database seam passes behavioral proof. It must not expose `get_product_bridge_staging_context` as an MCP tool or add generic lead/contact/follow-up mutations.

## Verification and local behavioral proof

Static migration guards, generated types, gateway unit tests, existing Product Adapter tests, typecheck, lint, unit suite, build, diff check, and audit are required. `supabase/tests/product_bridge_transactional_staging.test.sql` is a disposable-database pgTAP suite covering context redaction, authenticated org binding, claim/replay/conflict, immutable effects, exact receipt, lifecycle, activity/audit, and no approval/send effect.

Run the repository-owned acceptance gate from Windows PowerShell with Docker Desktop running:

```powershell
npm run test:product-bridge:postgres
```

The gate starts a uniquely named disposable container from a digest-pinned Supabase PostgreSQL 17.6 image on `127.0.0.1:54522`, composes the accepted pre-02A baseline without rewriting historical migrations, applies the complete PBG-02A migration, verifies all 14 functions, runs exactly 37 pgTAP assertions, and proves equivalent concurrent authenticated claims resolve to one `CLAIMED`, one `IN_PROGRESS`, and one ledger row. It always removes only its own disposable container.

The gate passed on 2026-08-11. The 37 assertions include authenticated organization authority, service-role rejection, claim/release/lease reclaim, conflict and exact durable replay, stale and unknown-state zero-effect behavior, research and email atomicity, immutable email content, receipt/effect/audit correlation, pending approval, and zero OpenAI/provider/send effect.

This test-only baseline composition exists because the historical SprintCRM chain is not clean-bootstrap reproducible: it includes a historical BOM and accepted snapshots/migrations with ordering assumptions around `leads` and `ai_generations`. The gate deliberately uses canonical snapshot slices plus the accepted AI-foundation dependency. It does not change, replay against, or connect to production/linked Supabase.

## Rollback / forward-fix

Production was not migrated by this task. Before any environment applies the migration, rollback is simply omission of the unapplied migration. In a disposable local database, `supabase db reset` restores the prior migration chain.

After any shared environment has applied the migration or stored staged rows, do not run a destructive down migration. Use an additive forward-fix that first revokes the five execution grants, preserves ledger/immutable history, replaces affected functions or constraints, synchronizes `schema.sql` and generated types, and repeats the full SQL/RLS proof.
