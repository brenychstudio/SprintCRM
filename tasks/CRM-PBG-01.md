# CRM-PBG-01 — Read-only Product Adapter

## Task goal

Implement the first SprintCRM Product Adapter against the frozen Shared AI Product Bridge with exactly seven bounded `READ` operations, zero staged writes, and zero privileged actions. The supervised local pilot must use an explicit short-lived Supabase user access token, bind one expected organization outside semantic operation input, preserve organization-scoped RLS, and omit contact data unless trusted runtime authority includes `crm.contactData.read`.

## Current-state evidence

- Starting SprintCRM baseline: `77d0f7cffa6d0a80efa582ca92254ded4c606b1d` on clean `main`.
- Frozen Shared baseline: `563b6c8f0b6452ccc5f18f3aac5e058633b7cdb0`, clean and reference-only.
- SprintCRM is a React/Vite browser app backed by authenticated Supabase/Postgres and organization-scoped RLS.
- Existing CRM reads are browser-bound Supabase wrappers; aggregate and queue behavior is partly UI-coupled.
- Existing supervised AI is isolated in `supabase/functions/outreach-ai-runtime` and is out of scope.
- No database migration is expected or authorized. If one proves necessary, implementation must stop for review.

## Files to inspect

- `package.json`, TypeScript/Vite/Vitest/ESLint configuration, and CI workflow.
- `src/features/leads`, `src/features/campaigns`, generated database types, Supabase client setup, Today, Pipeline, and Reports queries.
- Frozen Shared contracts, product SDK, core, testing, and generic MCP transport public APIs.
- Distribution Desk read-only integration files only for package wiring, adapter bootstrap, conformance, MCP lifecycle, and safe health conventions.

## File plan

- Add a product-owned CRM read-model module with bounded inputs, safe projections, trusted organization context, contact redaction, activity metadata allowlists, and deterministic freshness evidence.
- Add a SprintCRM Product Adapter module with frozen descriptor, scopes, schemas, exactly seven operation definitions, and safe invocation/result mapping.
- Add an authenticated runtime bootstrap that validates a short-lived user token and expected organization without storing or logging credentials.
- Add a local Shared-backed MCP read-pilot entrypoint and safe health projection.
- Add focused unit, conformance, MCP discovery, security, bounds, redaction, and organization-binding tests.
- Add focused operator documentation and package/CI configuration required by the new runtime.

## Implementation plan

1. Reuse frozen Shared packages through the established local development dependency strategy without copying or modifying Shared.
2. Define independent CRM read-model contracts so MCP and Shared concepts do not leak into Supabase query code.
3. Implement authenticated, organization-bound Supabase read models using projected columns, stable bounded pagination, and server/query-side count aggregation.
4. Implement exactly seven Shared `READ` operations and declare conservative output bounds.
5. Run Shared read-only conformance and generic MCP discovery tests for the exact `7/0/0` profile.
6. Add the supervised pilot runtime and documentation without running it against real credentials or production data.
7. Run all repository and security validation gates, review the diff, and create one local commit without pushing.

## Risks

- A user JWT is sensitive even though it is short-lived; it must remain in memory and out of logs, errors, receipts, health, and tests.
- `current_org_id()` selects the oldest membership, so runtime authority must bind and verify an explicit expected organization instead of silently relying on it.
- Existing lead services use broad `select('*')`; the adapter must use dedicated projections and hard limits.
- Supabase/PostgREST cursor and aggregate semantics must remain deterministic and bounded.
- Activity `meta` is arbitrary JSON and must never pass through without type-specific allowlisting.
- Local unpublished Shared packages require an internal development wiring strategy that must not be presented as final external distribution.
- Normal tests must remain credential-free and must never call production, Outreach AI, Gmail, or mutations.

## Acceptance criteria

- Product ID `sprint-crm`, adapter `0.1.0-dev`, schema `1.0.0`.
- Exactly the frozen seven semantic operations and seven expected MCP aliases.
- Registered operation profile is exactly `READ=7`, `STAGED_WRITE=0`, `PRIVILEGED_ACTION=0`.
- All operations delegate to product-owned bounded read models.
- Runtime validates the authenticated user and membership in trusted expected organization, and fails closed on mismatch.
- No semantic input can select organization or self-grant contact-data authority.
- No service-role key, raw SQL, browser-session scraping, AI invocation, Gmail behavior, mutation, migration, or unrestricted metadata exposure.
- Search/follow-up/action lists are capped at 25, activities at 50, and query text at 100 characters.
- Only `crm.leads.get` may expose allowlisted email/phone when trusted `crm.contactData.read` is present; notes and message bodies are always excluded.
- Shared conformance, MCP discovery, security tests, and all standard repository gates pass.
- Human real-data pilot is documented but not executed.

## Tests

- Unit tests for all read-model normalization, bounds, cursor parsing, projections, redaction, safe activity metadata, freshness, and pipeline counts.
- Adapter tests for all seven mappings, schemas, scopes, output bounds, safe not-found behavior, and result-size rejection.
- Runtime tests for membership success/mismatch, invalid auth, trusted organization binding, secret-free errors/health, and no default contact-data scope.
- Shared Product Adapter conformance with the exact read-only profile.
- MCP discovery test for exactly seven stable aliases and zero write/privileged tools.
- Static security checks for no service-role dependency, AI invocation, raw SQL, secret output, or mutation calls.
- Full validation: migrations, typecheck, lint, unit tests, build, diff check, focused bridge tests, and npm audit.

## Manual smoke

Do not run the real-data pilot in this task. Prepare the operator flow for one authenticated user and expected organization, default safe scopes without contact-data authority, Secure MCP Tunnel connection, one known-lead comparison against Today/Lead Drawer/Pipeline, zero-write verification, and shutdown.

## Proposed commit message

`feat: add read-only product bridge adapter`

## Documentation impact

Add `docs/CRM-PBG-01-PRODUCT-BRIDGE-READ-ADAPTER.md` covering architecture, frozen surface, scopes, bounds, redaction, authenticated/RLS runtime, no-service-role invariant, Shared baseline, secret-name-only configuration, MCP startup, supervised pilot, AI non-interference, and limitations. Update current-state documentation only if needed to make the accepted-ready status discoverable without claiming a completed human pilot.
