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
