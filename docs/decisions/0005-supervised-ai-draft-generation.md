# ADR 0005: Supervised AI draft generation

**Status:** Proposed — OUTREACH-03C implementation; not production accepted.

AI draft generation is an explicit, foreground user action in Campaign Full Workspace. The user must confirm the exact latest immutable research snapshot before the browser can request a draft. The browser sends only member, confirmed-snapshot, and idempotency IDs; the authenticated Edge Function derives permitted lead, campaign, proof, and research fields after organization authorization.

The Edge Function calls the OpenAI Responses API once with `store:false`, strict `draft_v1` JSON output, no tools, no web search, no arbitrary URL fetch, and an approximately 25-second timeout. Trusted instructions are separate from serialized untrusted CRM input. Raw prompts and provider responses are never persisted.

Completion atomically creates one immutable `outbound_messages` version (`source=ai`, `status=draft`) linked to its `ai_generations` ledger and research snapshot, writes audit events and the canonical `outreach_draft_saved` activity, and moves a member only to `draft_ready`. A changed latest research snapshot finalizes safely as `stale_research`, without a message or status change. Manual edits create later immutable manual versions.

This feature never sends email, creates a Gmail draft, approves/submits a message, changes a campaign to sent, schedules follow-ups, retries automatically, or runs in the background. It is gated by independent server `AI_RUNTIME_ENABLED` and `AI_DRAFT_GENERATION_ENABLED` switches and client `outreach_ops_enabled`, `ai_runtime_enabled`, and `ai_draft_generation_enabled` flags.
