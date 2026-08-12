# ADR 0007: Product-owned Gmail communication authority

- **Status:** Accepted for implementation; production acceptance pending
- **Date:** 2026-08-12
- **Checkpoint:** CRM-GMAIL-00A

## Context

SprintCRM already owns leads, campaigns, immutable outreach drafts, human review/approval, suppression, audit, and the canonical activities timeline. It did not own a provider account, credential, message/thread fact, or durable future-send identity. Shared Bridge can read and stage research/drafts but has no privileged action authority. A full Company/Contact/Opportunity refactor is not required to connect Gmail safely.

## Decision

Gmail is a product-owned communication capability. SprintCRM uses server-side OAuth authorization code flow with state, PKCE S256, nonce, offline access, and signed Google ID-token verification. The stable provider identity is Google OpenID Connect `sub`; email is mutable address/display data.

The initial grant requests only `openid`, `email`, `profile`, and `gmail.send`. Inbox/read scopes are excluded and may be introduced only through a later explicit incremental-consent decision paired with reply synchronization.

The Google client secret lives only in Edge Function secrets. Per-account refresh tokens are encrypted in Supabase Vault and reachable only through narrow service-role RPCs; access and ID tokens are not persisted. Browser members can read organization-safe mailbox metadata but cannot write provider or communication state directly.

Communication facts are represented independently from the current lead row: accounts own threads and external messages; explicit organization-safe links may reference a lead, campaign member, and outbound message. Future company/contact/opportunity foreign keys can be added without rewriting provider identity or message history.

Connection is not approval and approval is not send. A later send checkpoint must require an explicit authenticated human product action, a durable idempotent send request, actual provider response, persisted message/thread evidence, audit/activity updates, and authoritative reread. Shared Bridge receives no Gmail/send operation in the supervised MVP.

## Consequences

- Gmail connection can proceed before Company/Contact/Opportunity separation.
- Reconnect rotates the Vault secret while preserving account identity/history.
- Disconnect removes local token access even when provider revocation is unconfirmed, and records only the observed outcome.
- Reply ingestion, inbox scopes, follow-up cancellation, and commercial intent remain later checkpoints.
- Disabling connection flags safely stops the OAuth surface without destructive rollback.
- Any production schema correction is additive; accepted migrations and provider facts are never rewritten.
