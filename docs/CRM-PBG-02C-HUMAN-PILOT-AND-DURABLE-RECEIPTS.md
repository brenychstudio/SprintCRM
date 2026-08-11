# CRM-PBG-02C — Human pilot and durable receipt equivalence

Status: **FIX2 AUTOMATED ACCEPTANCE PASS — HUMAN PRODUCTION RERUN REQUIRED**

CRM-PBG-02C is the supervised production acceptance checkpoint for the already accepted CRM-PBG-02B surface. It does not add operations or authority. The surface remains exactly eight READ operations, two STAGED_WRITE operations, and zero PRIVILEGED_ACTION operations. This checkpoint exercises `crm.email.stageDraft` only; it cannot approve, create a provider draft, send, schedule, publish, invoke OpenAI, or continue the workflow autonomously.

## Human pilot observation

The first supervised email pilot durably created immutable outbound Message Version 4 with `status=draft` and pending approval. The durable effect already existed before the operator obtained the normal receipt on the following exact replay, which is consistent with the separately reproduced first-call receipt defect below. That replay returned the original durable receipt and did not create Version 5. A later same-key request with a changed subject also created no second effect: the authoritative outbound entity remained Version 4.

That changed-request attempt returned `INTERNAL_SAFE_FAILURE` with the safe message `Idempotency evaluation failed safely.` It was initially suspected to be incorrect normalization of a durable semantic conflict. Production-equivalent investigation disproved that diagnosis:

- a valid durable ledger `CONFLICT` already flows through the CRM coordinator and Shared Bridge as canonical `DUPLICATE_REQUEST` with zero effect;
- a correctly signed but expired authenticated-user JWT reproduces the observed `INTERNAL_SAFE_FAILURE` through PostgREST `401` / `PGRST303` before a durable conflict outcome can be read;
- authentication, RLS, network, malformed-response, and other unexpected failures must not be relabeled as `DUPLICATE_REQUEST`.

The final supervised conflict rerun therefore requires a fresh short-lived authenticated-user token. It will reuse the existing Version 4 idempotency address; it must not create another production draft.

## Separate first-call receipt defect

The same production-equivalent investigation found a separate defect in the first successful commit response. Shared constructs a canonical receipt as a JavaScript object. The email-stage receipt was proven to contain the optional own properties `resultSnapshotId`, `provenance`, `diagnosticsSafe`, and `metadataSafe` with the value `undefined`. PostgreSQL JSONB correctly stores the JSON representation, in which those properties do not exist. The CRM coordinator then compares the original in-memory receipt with the read-back JSONB receipt.

The former `sameReceipt()` comparison used raw JavaScript key semantics through the general request canonicalizer. It treated an own property set to `undefined` as different from an absent property. Consequently, PostgreSQL could atomically commit the immutable message, timeline/audit/provenance records, and durable receipt, while the first public call incorrectly returned `INTERNAL_SAFE_FAILURE` with `Idempotency receipt storage failed safely.` A later exact replay succeeded because both sides then used the persisted JSON form.

This is a response-verification defect, not a failed database transaction and not a Shared contract gap. The accepted production migration remains authoritative and must not be rewritten.

## JSON-semantic receipt identity

Durable receipt comparison follows JSON semantics at this one verification boundary:

- object properties whose value is `undefined` are omitted recursively, matching JSON serialization and JSONB persistence;
- object key insertion order is irrelevant;
- JSON primitives and `null` remain exact;
- array order and contents remain exact;
- meaningful IDs, entity/version data, freshness references, validation state, approval state, and nested values remain exact;
- `null`, `false`, `0`, and the empty string are not normalized to missing;
- unsupported non-JSON values and cycles fail closed;
- a genuinely different durable receipt still causes a safe internal failure.

This normalization is used only to verify the original Shared receipt against its persisted/read-back durable representation. It does not remove verification, accept an arbitrary database receipt, compare only `receiptId`, weaken the semantic request fingerprint, or change replay/conflict ordering.

## Production-equivalent regression

The repository-owned regression uses disposable infrastructure only:

```text
PostgreSQL 17.6
→ PostgREST
→ authenticated synthetic JWT
→ supabase-js
→ SprintCRM durable gateway/coordinator
→ Shared mutation lifecycle
→ actual MCP SDK discovery and call
```

Run:

```powershell
npm run test:product-bridge:postgres:conflict
```

The acceptance sequence requires:

1. A new request returns a successful staged receipt on its first call and creates exactly one durable ledger row and one immutable outbound version.
2. The exact same request and key replay the exact original durable receipt without a second effect.
3. The same key with changed semantic input returns `DUPLICATE_REQUEST`, with no new entity or version.
4. An expired-JWT control remains a safe internal failure and creates zero effect.
5. A deliberately changed meaningful persisted receipt field fails closed.

The FIX2 production-equivalent gate passed twice using Docker `29.7.2`, PostgreSQL `17.6`, and PostgREST `14.1`. Through actual MCP discovery and invocation it proved:

- the first call returns `ok=true`, `status=staged`, and Version 1 while PostgreSQL contains exactly one ledger row and one correlated outbound row;
- exact replay is deeply equal to the original durable receipt and leaves the entity at Version 1;
- changed semantic input with the same key returns `DUPLICATE_REQUEST`, leaves the same entity/version, and creates zero second effect;
- an isolated test-only wrapper that changes the persisted `receiptId` causes `INTERNAL_SAFE_FAILURE` with `Idempotency receipt storage failed safely.` after its one deliberately committed fixture effect, proving meaningful mismatches are still rejected;
- the correctly signed expired-JWT control returns PostgREST `401 PGRST303` and Bridge `INTERNAL_SAFE_FAILURE`, with zero ledger rows and zero effects;
- approval, send, provider, and AI effects remain absent.

Focused unit coverage also distinguishes absent optional JSON properties from meaningful values: absent and `undefined` are equivalent in objects, including nested objects; absent remains different from `null`, `false`, `0`, and `""`; different receipt/entity/version or array data remain different; object insertion order is irrelevant.

The existing database gate remains mandatory:

```powershell
npm run test:product-bridge:postgres
```

It must continue to apply the accepted pre-02A fixture and production migration in a disposable PostgreSQL database, compile all 14 staging functions, pass all 37 pgTAP assertions, and pass the concurrency proof.

FIX2 automated acceptance passed with:

- migration verification: 22 migration files verified;
- TypeScript typecheck and lint: PASS;
- full unit suite: 25 files, 213 tests;
- Product Bridge suite: 6 files, 79 tests;
- production build: PASS;
- disposable PostgreSQL gate: 14 functions, 37/37 pgTAP assertions, and concurrent equivalent claims producing `CLAIMED` / `IN_PROGRESS` with one ledger row;
- production-equivalent PostgREST/MCP receipt gate: PASS for first-call success, exact replay, semantic conflict, meaningful-mismatch fail-closed, and expired-JWT controls.

## Authority and data-integrity boundaries

- The Shared baseline remains frozen at `cf37a7937e55803ea48cd23cc028521cc8fc5881`.
- `20260810000001_product_bridge_transactional_staging.sql` remains unchanged; no forward migration is required for receipt comparison.
- FIX2 implementation and automated acceptance use disposable local data only; they perform no production mutation or deployment.
- The runtime continues to use a low-privilege publishable/legacy anon project identity plus a verified short-lived authenticated-user token and organization-scoped RLS. No `service_role` credential is introduced.
- Expired credentials, malformed durable responses, database/network failures, unknown ledger outcomes, and genuine receipt mismatches remain fail-closed safe internal failures.
- Valid same-key/different-request ledger conflicts alone map to `DUPLICATE_REQUEST`.
- Freshness, durable idempotency, replay-before-freshness ordering, one-effect concurrency, organization binding, and exact meaningful receipt correlation remain unchanged.
- No production data, credential, JWT, project key, provider secret, message body, or unrestricted request payload belongs in this regression's fixtures, logs, or documentation.
- Approval, provider-draft, Gmail, send, AI-generation, publish, bulk, delete, and PRIVILEGED_ACTION effects remain zero.

## Final supervised rerun

CRM-PBG-02 is not final until a supervised production rerun completes with a fresh user token. The operator must:

1. Replay the existing Version 4 request with its original idempotency key and confirm the exact durable receipt with no new version.
2. Submit changed semantic input with that same key and confirm `DUPLICATE_REQUEST`.
3. Authoritatively reread the CRM state and confirm the same Version 4 entity remains current and Version 5 does not exist.
4. Confirm `approved_by`, `approved_at`, and `sent_at` remain `null` and that provider/Gmail/send effects remain zero.
5. Stop the tunnel/runtime and clear ephemeral credentials.

Do not create a replacement production draft merely to repeat the first-call proof; that behavior is covered by the disposable production-equivalent regression.

Current checkpoint state: **CRM-PBG-02C-FIX2 AUTOMATED ACCEPTANCE PASS — HUMAN PRODUCTION RERUN REQUIRED — CRM-PBG-02 FINAL NOT YET**.
