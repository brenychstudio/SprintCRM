# ADR 0003: Generic AI runtime ledger and synthetic probe

**Status:** Accepted for implementation planning on 2026-08-01.

`public.ai_generations` is the additive, organization-scoped ledger for supervised AI runtime work. It retains early draft-history rows as `legacy_draft` and adds generic job, provider, request, schema, usage, cost, duration, output, and error metadata for later research, draft, and QA work. It is not a browser-writeable queue and no competing generic `ai_jobs` table is introduced.

OUTREACH-03A proves this boundary with a `runtime_probe` only. The Edge Function sends a fixed synthetic prompt to the OpenAI Responses API with `store: false` and strict JSON Schema; it does not send CRM or outreach data. Server-only RPCs create/finalize a pending probe once, validate membership, preserve terminal rows, and append audit events. The user remains the initiating actor; successful provider completion is audited as AI and failure as system.

The UI displays only non-sensitive runtime metadata in the existing Campaign Workspace behind independent client and server kill switches. It neither creates research/message versions nor changes campaign-member status. Pricing remains deliberately unconfigured until a reviewed pricing snapshot policy is introduced.

## Rollback / forward fix

Disable `AI_RUNTIME_ENABLED` to stop new provider calls immediately. Preserve audit and ledger history, then deploy an additive forward-fix migration or function revision; do not destructively remove completed records.
