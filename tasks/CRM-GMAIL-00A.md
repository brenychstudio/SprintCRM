# CRM-GMAIL-00A — Gmail Account + Communication Domain Foundation

## Pre-edit record

- **Task goal:** Add a forward-compatible communication schema, secure product-owned Gmail OAuth lifecycle, Vault-backed refresh-token custody, and a minimal Settings connect/status/disconnect surface. No email is sent or read.
- **Current-state evidence:** Work began from clean `main` at `c1ce11541278720e612262de936779a343cbe920`. `origin/main` was the ancestor `77d0f7cffa6d0a80efa582ca92254ded4c606b1d`, local was ahead seven/behind zero, and the explicitly authorized fast-forward push synchronized `origin/main` to `c1ce115`. The focused branch is `codex/crm-gmail-00a-foundation`. The accepted local Shared Bridge dependency remained clean at `cf37a7937e55803ea48cd23cc028521cc8fc5881`.
- **Files inspected:** `AGENTS.md`; migration/schema/generated-type conventions; Campaign/outbound/suppression/audit schemas; accepted Product Bridge migration and disposable PostgreSQL proof; Edge Function auth/CORS/error patterns; feature flags; route/navigation/i18n/UI tests; current-state/ADR/task documentation.
- **File plan:** Add one migration and PostgreSQL proof, shared OAuth helper and three Edge Functions, typed Gmail client and Settings page/tests, route/navigation/locales/flags configuration, schema/types/verifier, this task, ADR, current-state note, and Google Cloud checklist.
- **Implementation plan:** Prove Vault first in disposable Supabase PostgreSQL 17.6; add organization-safe public communication entities plus private OAuth/credential tables; expose only narrow lifecycle RPCs; implement code-flow OAuth with state hash, PKCE S256, nonce, signed ID-token validation, refresh/revocation helpers, and safe redirects; add a default-off operator UI; validate without real Google.
- **Risks:** OAuth replay/open redirect; provider token leakage; mutable email used as identity; cross-organization links; duplicate future sends; overly broad browser/service grants; incomplete local schema used for generated types; accidental Bridge/send authority expansion.
- **Acceptance criteria:** Exact scopes only; Google `sub` identity; Vault refresh token only; no access/ID token persistence; callback claim one-time; all public tables RLS/read-only for members; real composite organization FKs; deterministic safe errors; localized Settings states/actions; no send/inbox action; full required checks.
- **Tests:** OAuth crypto/URL/JWT/refresh/revocation unit tests; static Edge/migration authority contracts; Settings states/actions tests; 37-assertion pgTAP suite on disposable PostgreSQL; repository regression checks and Product Bridge tests.
- **Manual smoke:** No real OAuth in this task. Before production acceptance, verify authenticated Settings in light/dark/narrow layouts with the feature disabled and in mocked/local safe states. Real connect/status/disconnect/reconnect is deferred to `CRM-GMAIL-00A-ACCEPT`.
- **Proposed commit:** `feat(gmail): add account and communication foundation`
- **Documentation impact:** This task record, ADR 0007, `docs/current-state.md`, and a no-secret Google Cloud setup checklist.

## Implemented domain

Migration `20260812000001_gmail_account_communication_foundation.sql` is additive and creates:

- `public.mailbox_accounts`, keyed by organization/provider/Google `sub`, with safe account metadata and connection lifecycle only;
- private, short-lived `private.gmail_oauth_requests`, storing only SHA-256 state hash plus nonce and PKCE verifier;
- private `private.mailbox_account_credentials`, linking an account to a Supabase Vault refresh-token secret;
- `public.communication_threads`, `communication_links`, and `external_messages` as empty forward-compatible provider-fact storage;
- `public.email_send_requests` as an empty durable idempotency/evidence schema for a later send checkpoint;
- additive `review_reply` support in `public.next_action` and application localization.

All public communication tables have organization-scoped SELECT RLS and no authenticated INSERT/UPDATE/DELETE policy or grant. Cross-domain relationships use composite organization foreign keys. Provider account, thread, external-message, and send-request identity fields are immutable. Existing `outbound_messages` history and its immutability guard are unchanged. `activities` remains the canonical CRM timeline; this connection-only checkpoint creates audit events, not lead activities.

## OAuth and authority

Requested scopes are exactly:

```text
openid
email
profile
https://www.googleapis.com/auth/gmail.send
```

No Gmail read, metadata, modify, compose, settings, or full-mail scope is requested. Start is authenticated and server-gated, creates one ten-minute request per explicit click, returns only authorization URL/request ID/expiry, and uses offline consent plus PKCE S256. Callback is public only as Google redirect transport; it atomically claims the hashed state, handles denial/code errors, exchanges with the exact redirect and verifier, verifies the Google JWKS signature plus issuer/audience/expiry/nonce/email verification, validates granted scopes, and persists `sub` as stable identity.

Refresh tokens are created or rotated inside Supabase Vault through a SECURITY DEFINER function; access and ID tokens are memory-only. The refresh helper loads credentials through a service-only RPC and marks `reauthorization_required` on `invalid_grant`. Disconnect attempts Google revocation, distinguishes confirmed/already-invalid/unconfirmed evidence, and always removes the local credential association/Vault secret through a human-authorized completion RPC. Provider secrets and token material are never returned to the browser or logged.

The browser can list safe mailbox metadata and invoke only the authenticated Edge Functions. The callback has platform JWT verification disabled solely because Google cannot supply a SprintCRM JWT; state/PKCE/nonce and narrow service RPCs enforce the application boundary. Gmail connection is not approval or send authority. The Shared Bridge remains READ 8 / STAGED_WRITE 2 / PRIVILEGED_ACTION 0.

## UI and flags

`/settings` adds a Quiet Operator Console Gmail card with feature-disabled, not-connected, connecting, connected, reauthorization-required, disconnecting, disconnected, revoked, and safe-error states. It shows only email, optional display name, connection time, status, and a human-facing capability summary. Connect/reconnect starts OAuth; disconnect requires confirmation. Callback query state is converted to localized copy, account metadata is refetched, and transient parameters are removed.

`VITE_GMAIL_CONNECTION_ENABLED` remains default-off. Edge Functions independently require `GMAIL_CONNECTION_ENABLED=true`. `VITE_CONTROLLED_SEND_ENABLED` remains default-off and unused. There is no Send, Draft, Inbox, or Sync control.

## Validation and generated artifacts

Supabase Vault 0.3.1 and its create/update/decrypted APIs were proven in the pinned disposable Supabase PostgreSQL 17.6 image before implementation. `scripts/qa/crm-gmail-00a-postgres-proof.ps1` composes the accepted Outreach/AI/PBG schema, applies the Gmail migration, runs pgTAP, and can generate public schema types from that isolated database. A narrow post-generation normalization preserves the accepted nullable Product Bridge RPC input contract that postgres-meta cannot infer; it does not change the database or Bridge runtime.

The schema snapshot is mechanically synchronized from the migration. No migration was linked or applied to production.

## Rollout and forward-fix

Production work is intentionally pending:

1. review the migration and Google Cloud checklist;
2. verify linked migration state;
3. configure the OAuth client and exact callback URI;
4. set Edge Function secrets outside source control;
5. apply the migration and deploy the three functions;
6. enable server/client connection flags;
7. run one supervised connect → authoritative account reread → disconnect/reconnect smoke.

Rollback before production apply is code-only. After apply, do not remove tables, enum values, audit rows, or provider facts. Disable both Gmail connection flags, undeploy/replace the functions if required, and use an additive forward-fix migration for schema/security corrections. Disconnect any test account through the product-owned path so Vault access is removed. Email send remains a separate checkpoint after production acceptance.

## Implementation verification record

- Disposable Supabase PostgreSQL 17.6 applied the accepted Outreach/AI/Product Bridge baseline and CRM-GMAIL-00A migration; Supabase Vault 0.3.1 secret creation, rotation API, server-only decryption, OAuth lifecycle, replay/expiry behavior, RLS/grants, immutable identity, disconnect cleanup, and unchanged Product Bridge surface passed 37/37 pgTAP assertions.
- `npm run verify:migrations` passed with 23 unique migrations. `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. The existing Vite large-chunk advisory remains non-blocking debt.
- `npm run test:unit` passed 28 files / 250 tests. `npm run test:product-bridge` passed the unchanged 6 files / 79 tests.
- Deno is not installed locally, so a separate `deno check` could not run; shared Edge logic is exercised through Vitest and the three transports have static authority/configuration contracts. No function was served or deployed.
- Browser smoke reached the local authenticated route guard and correctly showed Sign in. The available browser had no local SprintCRM session, so authenticated Settings light/dark/narrow smoke was not bypassed with stored credentials or a production user; it remains explicit acceptance work. All required Gmail card states/actions and authoritative-reread behavior passed jsdom tests.
- No real OAuth, Google/Gmail request, provider draft, email send, inbox read, OpenAI call, production migration/data mutation, function deployment, secret change, Shared Bridge edit, or PR merge occurred during implementation.

## CRM-GMAIL-00A-FIX-01 pre-edit record

- **Task goal:** Reconcile the checked-in Gmail `Database` snapshot with every accepted pre-Gmail RPC contract, restore the green outreach Edge gate, pin Gmail Edge Supabase imports, fix JWKS object narrowing, and make PR #22 green without changing OAuth behavior or production state.
- **Current-state evidence:** Local `codex/crm-gmail-00a-foundation` is clean at unpushed merge commit `6c0a3a03ba0e0dbd98b52ac92181cd08c70a5268`; remote remains `3b9fb153e936da4f4baf289d07bd9d95b17279b4`, local ahead five/behind zero. Canonical `main` is `8579b7638ed4c009dbc1cd031820b6f682c87fc8`; Shared is frozen at `cf37a7937e55803ea48cd23cc028521cc8fc5881`; PR #22 remains open, draft, and unmerged.
- **Files inspected:** Canonical/current generated types and type history; all pre-Gmail RPC AST signatures; Gmail migration/proof script/task; schema markers and migration composition; installed/npm-cached Supabase CLI versions; Edge lock/check tooling; Gmail entrypoints/shared OAuth code; current PR metadata and historical CI.
- **File plan:** Make the Gmail disposable generation workflow deterministic at canonical Supabase CLI `2.108.0`, include the accepted hardening migration missing from its composed database, extend the established post-generation reconciliation only if pinned generation still cannot express accepted non-STRICT nullable contracts, regenerate `database.types.ts`, add narrow verifier guards, pin the three Gmail imports to `2.97.0`, correct the JWKS predicate, refresh the Deno lock, and update only focused task/current-state documentation.
- **Implementation plan:** First regenerate from the complete disposable merged schema with the pinned canonical CLI; structurally compare every pre-Gmail RPC to canonical `main`; if postgres-meta still loses nullability, extend the existing deterministic normalization rather than inventing types ad hoc; require outreach Deno green before Gmail source edits; then pin imports, fix explicit key narrowing, refresh the lock with Deno 2.1.12, run all repository/Gmail/pgTAP gates, commit exact files, push normally, update PR #22, and inspect clean Linux CI.
- **Risks:** Generator drift recurring through floating `npx`; incomplete disposable schema; accidental loss of Gmail additions or Product Bridge types; brittle text normalization; modifying outreach runtime instead of its generated contract; OAuth scope/identity/token semantics changing under a type fix; or production/provider activity.
- **Acceptance criteria:** All 32 canonical pre-Gmail RPCs remain represented with accepted signatures, seven Gmail RPCs and five public Gmail tables remain additive, AI finish-RPC nullable inputs are guarded, all four Edge entrypoints pass exact Deno 2.1.12 with a frozen `2.97.0` graph, full 23-migration/250-test/79-Bridge and disposable 37/37 pgTAP baselines pass, and PR #22 is open/draft/clean/green.
- **Tests:** Structural RPC comparison; migration/type verifier guards; direct outreach-first Deno check; full `check:functions`; `npm ci`, migration verification, typecheck, lint, unit tests, build, Product Bridge tests, Gmail contract/UI suites, disposable PostgreSQL/Vault pgTAP proof, and `git diff --check`; then clean Linux Actions log review.
- **Manual smoke:** None. No deployment, feature enablement, Google OAuth, Gmail/provider call, production database action, authenticated browser bypass, or UI change occurs in this code-level reconciliation.
- **Proposed commit:** `fix(gmail): reconcile edge database contracts`
- **Documentation impact:** Append exact generator-drift/reconciliation evidence here and a minimal current-state note; replace the stale PR CI-blocker section after validation. Production acceptance remains pending.

### Generated-type forensics

Canonical main types were produced with repository-documented Supabase CLI `2.108.0` and contain `__InternalSupabase.PostgrestVersion = "14.1"`. The Gmail proof uses unpinned `npx supabase`; the retained npm execution package is `2.113.0`, while the same command now resolves `2.114.0`. Its disposable composition also omitted the idempotent `20260222_org_ready_hardening_patch.sql`, so `default_next_step_for_stage` was absent. The script already documents postgres-meta's inability to infer non-STRICT argument nullability and deliberately normalizes two PBG inputs, proving the checked-in generated artifact has an accepted deterministic reconciliation step; that step simply did not cover the older AI contracts.

AST comparison found 32 canonical pre-Gmail RPCs versus 38 current RPC entries: 21 identical, one missing (`default_next_step_for_stage`), ten structurally different, and seven additive Gmail lifecycle RPCs. The six AI start/finish functions lost nullable return/argument contracts; the three finish functions caused the 30 outreach `TS2322` errors. Two stale-job return differences are equivalent inline-vs-table-alias output, and campaign create/update now expose the real legacy/new overload union while retaining the canonical proof-context overload. The reconciliation must preserve canonical behavior plus additive Gmail objects without rewriting outreach runtime.

### FIX-01 implementation and validation

- The disposable proof now applies the previously omitted accepted organization-hardening migration and invokes exact `npx supabase@2.108.0`; floating CLI resolution is removed. A reusable idempotent normalizer preserves PostgREST 14.1 metadata, the canonical next-action helper, nullable AI start/finish contracts, the established PBG nullable inputs, and asserts all seven Gmail RPCs before writing the checked-in snapshot.
- `scripts/verify-migrations.mjs` now fails if any of the three AI finish RPCs loses a nullable argument, if any Gmail RPC/table disappears, or if canonical Product Bridge/internal metadata/next-action markers disappear. Structural reconciliation leaves all 32 canonical pre-Gmail RPCs present; 27 are textually identical and the remaining five are equivalent generator representations or additive overload unions. Seven Gmail RPCs remain additive.
- Outreach was checked before Gmail source edits: the 30 `TS2322` regressions fell to zero with no `outreach-ai-runtime` source or behavior change. The three Gmail clients now import exact Supabase JS `2.97.0`; the Deno lock remains an exact frozen `2.97.0` graph. Explicit `if (!key) return false` narrowing removes all three JWKS `TS18047` diagnostics while preserving `kid`, RSA, and signing-use predicates.
- Deno 2.1.12 discovers four entrypoints and checks outreach, Gmail start, callback, and disconnect successfully. `npm ci` reported zero vulnerabilities; 23 migrations, typecheck, lint, build, 28 files / 251 tests, 6 files / 79 Product Bridge tests, frozen `check:functions`, and `git diff --check` pass. The additional test pins all Gmail Edge imports; the existing atomic-state assertion is now LF/CRLF portable without changing SQL semantics.
- The disposable PostgreSQL/Vault proof was attempted but Docker Desktop's engine is unavailable in both configured contexts, so it could not be rerun locally. The Gmail migration and pgTAP source are unchanged; the accepted implementation evidence remains 37/37. No production database, provider, or OAuth action was substituted for the unavailable disposable run.
- OAuth scopes, state hash, PKCE S256, nonce/TTL/replay claim, redirect, Google `sub`, claim validation, Vault custody, safe errors, default-off flags, and no-send/no-inbox/no-Bridge-authority boundaries are unchanged. No migration, deployment, secret, Google/Gmail/OpenAI request, or production mutation occurred.

## CRM-GMAIL-00A-FIX-02 pre-edit record

- **Task goal:** Reconcile Google token-response scope aliases with the accepted connection contract by separating signed ID-token identity proof from the exact `gmail.send` capability proof, while rejecting every additional Gmail authority and preserving the requested scopes.
- **Current-state evidence:** The first supervised production OAuth returned safely to SprintCRM but ended `failed / required_scope_missing`. Its recorded request scopes are exactly `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/gmail.send`; audit contains only requested/failed evidence. Production has zero mailbox accounts, credential rows, Vault secrets, communication threads/links, external messages, and email send requests; existing activities and outbound-message counts are unchanged. `GMAIL_CONNECTION_ENABLED` was disabled before source work and controlled send remains false.
- **Files to inspect:** The shared OAuth scope constants/normalizer/validator, callback validation and persistence ordering, shared OAuth unit tests, Gmail source-contract tests, task/current-state documentation, deployed function metadata, and PR #22 state.
- **File plan:** Replace the literal identity-scope requirement with a deterministic scope classifier in `_shared/gmail-oauth.ts`; update the callback to name the Gmail capability boundary explicitly; add real-world alias/omission and forbidden-Gmail-scope regression tests; strengthen the callback contract ordering guard; record the production observation here and in current state.
- **Implementation plan:** Preserve `gmailOAuthScopes` byte-for-byte; classify known identity aliases separately; require exact `https://www.googleapis.com/auth/gmail.send`; reject every other Gmail API/full-mail authority; retain signed ID-token verification unchanged; run focused and full validation; commit/push one narrow fix; wait for green CI; redeploy all three OAuth functions with server connection disabled; repeat disabled/zero-effect smoke; re-enable connection only after PASS.
- **Risks:** Accidentally broadening Gmail authority, treating identity aliases as authority, weakening signed identity checks, persisting tokens before validation, logging provider token bodies, or retrying OAuth before accepted deployment.
- **Acceptance criteria:** All approved granted-scope representations pass, omitted redundant identity scope names pass only because signed ID-token verification remains mandatory, missing `gmail.send` and any additional Gmail authority fail, requested scopes and Google configuration stay unchanged, all repository/Edge gates and PR CI pass, deployed kill-switch smoke creates zero side effects, and no OAuth retry is initiated by Codex.
- **Tests:** Table-driven classifier tests; signed ID-token tests; callback source-contract ordering; full unit/Bridge/Edge/build/migration gates; clean Linux CI; production disabled smoke and authoritative database count reread.
- **Manual smoke:** No OAuth during this source-fix turn. The operator receives a separate supervised retry handoff only after CI, redeploy, kill-switch, and zero-effect checks pass.
- **Proposed commit:** `fix(gmail): validate granted scopes by capability`
- **Documentation impact:** Append safe production failure/root-cause/fix evidence without any token, authorization code, state, nonce, verifier, client secret, or provider payload.

### FIX-02 implementation and local validation

- `classifyGoogleGrantedScope` distinguishes the five accepted identity representations, exact `gmail.send`, every other `gmail.*`/full-mail authority, and unrelated scopes. `hasRequiredGmailCapability` requires exact send and fails closed on any additional Gmail authority; it does not use identity-scope spelling as identity proof.
- The callback still validates scope capability and then the signed ID token before invoking `complete_gmail_account_connection`. Issuer, audience, expiry, nonce, signature, stable `sub`, email, and `email_verified` checks are unchanged. Requested OAuth scopes, refresh-token requirement, Vault-only custody, public safe errors, and no-persistence-before-validation ordering are unchanged.
- Table-driven coverage accepts OIDC aliases, canonical `userinfo.*` forms, and send-only token scope paired with a valid signed ID token. It rejects missing send, readonly, metadata, modify, compose, labels, settings, and both full-mail URL spellings. No token-body logging or unsafe cast was added.
- Local acceptance passes: 23 migrations, typecheck, lint, build, 28 files / 265 tests, 6 files / 79 Product Bridge tests, all four Edge entrypoints with Deno 2.1.12, and `git diff --check`. The first `npm ci` attempt was blocked only by the active local Vite process holding `lightningcss`; after stopping the local dev servers, a clean `npm ci` and the full suite passed.
