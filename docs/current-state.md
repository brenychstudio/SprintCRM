# Current state - OUTREACH-03B supervised AI research accepted

## OUTREACH-03B supervised AI research job

OUTREACH-03B is **ACCEPTED**. `20260801000003_ai_research_job.sql` additively introduces optional `campaigns.proof_context` and service-role-only research lifecycle RPCs. The production forward fixes `20260801000004_fix_campaign_proof_context_wrapper_assignment.sql`, `20260801000005_fix_ai_research_activity_owner.sql`, and `20260801000006_fix_ai_research_v2_start_contract.sql` retain compatibility while correcting the campaign-wrapper composite assignment, canonical activity ownership, and V2 start-contract mapping. An explicit user-triggered research job derives campaign/lead server-side, validates a public HTTP(S) website, records an idempotent pending `ai_generations` job, then either records a safe failure or atomically creates an immutable AI `research_snapshots` version. Completion preserves later workflow statuses, writes `ai.research.*` audit events, and adds a canonical `research_saved` activity. Browser clients retain organization-scoped ledger reads but cannot write the ledger.

`outreach-ai-runtime` keeps `runtime_probe` compatible and adds `generate_research`. It uses user scope for CRM reads, service role only for start/finish RPCs, and sends OpenAI only permitted public campaign/lead context. It uses `store:false`, strict JSON Schema, a 45-second timeout, no retries, and `web_search` constrained to the validated company domain. No message, approval, Gmail, send, queue, follow-up, or autonomous action is included.

The first completed production research result was technically successful but quality-rejected: it produced English for Spanish campaign/lead context, contradicted non-empty verified proof context, exceeded the website-only confidence limit, and included too many sources. OUTREACH-03B-QUALITY-01 introduced the auditable `research_v2`/`outreach_research_v2` contract; OUTREACH-03B-QUALITY-02 added safe parser diagnostics, proof-title matching, and rejected-result usage persistence. Trusted instructions are separated from untrusted CRM/site content; language, proof context, confidence (maximum 0.85), evidence (two to three sources), URL uniqueness, and concise notes are server-validated. Version 1 remains immutable.

The Campaign Full Workspace shows its explicit AI Research card only when the three UI flags are enabled. `AI_RESEARCH_ENABLED` and `VITE_AI_RESEARCH_ENABLED` default to false. The accepted V2 production job (`d0a4f643-7407-42dd-b951-9a4ac16c3505`) completed with `outreach_research_v2` / `research_v2` on `gpt-5.4-mini`: 9,309 input, 0 cached-input, 438 output, and 9,747 total tokens in 4,669 ms; confidence was 0.78 with three reviewable sources and a verified Oria House Barcelona recommendation. It created immutable Version 2 alongside immutable Version 1, linked the completed ledger, wrote requested/completed audits and an owner-populated `research_saved` activity, and left the member `research_ready`. No message, approval, Gmail draft/send, outbound send, automatic campaign progression, or pending/failed job for the request remained.

The acceptance language diagnostic is reporting-only debt, not a runtime defect. `research_v2` and `research_snapshots` intentionally have no language field; the completed `output_payload` has only the six validated research fields. The server resolves the output language from lead language, then campaign default, before provider invocation. The prior `en` diagnostic therefore inferred a fallback from an absent output field (or inspected that absent field), rather than reading persisted language metadata. No runtime code or production row was changed.

The next implementation milestone is **OUTREACH-03C — Supervised AI Draft Generation**: an explicit single-click draft based only on campaign context, the reviewed latest research snapshot, verified proof context, resolved lead/campaign language, campaign tone, and offer. It must create immutable message versions for human review and must not send to Gmail, auto-approve, or progress campaign status automatically.

## OUTREACH-03A accepted production runtime foundation

`20260801000001_outreach_ai_runtime_foundation.sql` additively extends `ai_generations` into the generic organization-scoped runtime ledger, preserving legacy rows as `legacy_draft`, preserving existing research/message foreign keys, and removing authenticated browser insert/update policies. Narrow service-role RPCs create and finalize only `runtime_probe` jobs with membership checks, idempotent request IDs, terminal-state guards, and append-only audit events. No CRM activities are created for the technical probe.

`outreach-ai-runtime` is an authenticated Supabase Edge Function using a user-scoped client for authorization and a service-role client exclusively for the narrow RPCs. It calls OpenAI Responses only with fixed synthetic input, `store: false`, strict JSON Schema, allowlisted CORS, a bounded timeout, and no automatic retry. `OPENAI_API_KEY`, model configuration, the server kill switch, and origins are runtime secrets/configuration, never browser values.

The existing Campaign Full Workspace contains an opt-in AI runtime probe card only when `outreach_ops_enabled` and `ai_runtime_enabled` are both enabled. It shows compact connection metadata and does not mutate research, message, or campaign-member workflow state.

OUTREACH-03A is accepted. Production migrations `20260801000001_outreach_ai_runtime_foundation.sql` and `20260801000002_fix_ai_runtime_probe_request_id_ambiguity.sql` are applied, the `outreach-ai-runtime` Edge Function is ACTIVE, and the authenticated synthetic runtime probe completed on `gpt-5.4-mini` with 82 total tokens in 2164 ms. The forward fix resolves the `request_id` ambiguity. Ledger and audit inspection confirms the requested and completed probe events; the probe generated no research or message content, made no status mutation, and performed no Gmail or sending operation. The OpenAI API boundary remains server-only, with both client and server kill switches available.

Baseline recorded on 2026-07-22 from `codex/outreach-00r-rebaseline` (created from `main` at `23754b0`). The working tree was clean before this task.

## Product surfaces

| Area | Current implementation |
| --- | --- |
| Routes | `/today`, `/active-contacts`, `/leads`, `/leads/new`, `/leads/:leadId/edit`, `/imports`, `/pipeline`, `/reports`, plus default-off Campaign routes; all authenticated behind `RequireAuth`. |
| Lead workspace | `LeadDrawer` remains a portal-backed operational panel for next action, result/stage changes, notes, activity history, archive and safe delete. It now shows compact read-only contact details and links to a focused create/edit form route. |
| Data access | Client-side Supabase wrappers live in `src/features/leads/leadsApi.ts`, `src/features/ai/aiGenerationsApi.ts`, and `src/features/reports/exportCsv.ts`. Generated public-schema types are stored at `src/lib/supabase/database.types.ts`; existing client wrappers remain handwritten. |
| Database | Core CRM tables remain intact. OutreachOps now adds campaign, versioning, suppression, and technical-audit domain tables through reviewed additive migrations. |
| Localization | `en`, `uk`, `es`, `ru` dictionaries via `src/i18n`. |
| Theme | `useThemeMode` persists light/dark state using `data-theme`; drawer-specific theme selectors exist in `src/style.css`. |

## Existing AI/outreach foundation

`20260427_ai_outreach_foundation.sql` adds `ai_generations`, several lead-level outreach snapshot fields, AI activity enum values, indexes, and org-member RLS policies. The frontend has matching handwritten types and direct client CRUD helpers, but no UI imports or routes currently use them.

This is an early lead-centric draft-history foundation, not the target OutreachOps domain. It must not be expanded casually: future work should introduce campaign-scoped tables additively and migrate UI access to server-side functions before any model invocation.

## Production migration verification

On 2026-07-22, Supabase CLI `2.108.0` was initialized and linked to production project `lyimwrbjyryojhprxdhk` (CRM studio). The database password stays only in the ignored root `.env` as `SUPABASE_DB_PASSWORD`; it is not in `config.toml`, source code, or Git.

Read-only production checks confirm that `organizations`, `memberships`, `leads`, `activities`, `imports`, and `ai_generations` exist and have RLS enabled. Their policies match the intended organization-scoped policy names in the local schema and outreach foundation migration.

The schema was created manually before CLI migration history existed. After evidence-based reconciliation and additive baseline work, remote history matches local through:

```text
20260222
20260427000001
20260427000002
20260427000003
20260722000001
20260722000002
20260722000003
20260725000001
20260725000002
20260729000001
20260729000002
```

`supabase db push --dry-run` reports `Remote database is up to date`; no legacy SQL was replayed. FIX-03 and FIX-04 were applied through the Supabase CLI. Future production schema changes must use reviewed migrations only.

## Minimal campaign domain

`OUTREACH-01R` adds, without changing the existing CRM flow:

- `campaigns` and campaign-scoped `campaign_members`;
- immutable, versioned `research_snapshots`;
- `message_templates` with immutable `template_versions`;
- versioned `outbound_messages` with approval/sent-state guards;
- `suppression_entries` with active normalized uniqueness;
- append-only `audit_events` for technical/security events.

All eight tables have organization-member RLS. Composite foreign keys prevent cross-organization references among campaign records and existing leads/AI generation records. `activities` remains the canonical user-facing CRM timeline. No Campaign UI, AI API, Gmail, queues, or auto-send is included.

## Manual campaign workspace

`OUTREACH-02R` is accepted. It adds a default-off `outreach_ops_enabled` Campaign workflow: campaign list/setup/overview routes, deterministic member eligibility, manual versioned research and messages, Review Queue navigation, approval/skip operations, compact LeadDrawer context, and a minimal Today entry point. Campaign routes are lazy-loaded so the stable CRM shell does not eagerly load the workspace. At zero actionable Outreach items, Today shows a localized empty state and disables `Open next task`.

`20260725000001_campaign_activity_types.sql` and `20260725000002_manual_campaign_workspace_rpc.sql` add only activity enum values and narrow `security invoker` RPCs. They atomically persist critical member/message/audit/activity transitions and do not send messages. The linked production database is current through both migrations.

The Supabase database advisors reported these existing follow-ups:

- add fixed `search_path` to `normalize_lead_fields` and `set_updated_at`;
- restrict unnecessary RPC execution of SECURITY DEFINER trigger/helper functions after confirming which calls require authenticated execution;
- enable Auth leaked-password protection;
- review indexes on owner foreign keys and the `memberships_select_own` policy initialization plan after measuring production workload.

## Manual lead creation and editing

`LEADS-EDIT-01` is accepted. It replaces the immediate empty-row `New lead` mutation with a focused form. The form uses only existing `leads` columns, protects dirty navigation and duplicate submission, validates and normalizes contact data, and blocks exact organization-scoped email/domain/phone duplicates while treating a company-name match as a warning.

The same form edits existing contact details. Successful saves invalidate Lead and Campaign query families, so the Drawer, list, campaign context, and eligibility refresh without a full application reload. Campaign wizard repair uses an allowlisted internal return path and session-scoped draft persistence. No database migration or production write is introduced; `supabase/schema.sql` was corrected to describe the already-applied organization-scoped normalized contact indexes.

## Campaign workspace forward-fixes

`OUTREACH-02R-FIX-03` replaces only `add_campaign_members`. The original function's table output variable `lead_id` conflicted with the unqualified `ON CONFLICT (campaign_id, lead_id)` target and raised PostgreSQL `42702`. The replacement uses qualified table aliases and the named unique constraint while preserving its signature, RLS execution mode, eligibility results, audit, and CRM activity behavior. It is applied to production through the Supabase CLI and regression-smoked.

`OUTREACH-02R-FIX-04` updates manual message save and approval. Canonical `outbound_messages.channel` remains text/check, while CRM `activities.channel` is `public.activity_channel`; the replacement RPCs validate the unchanged text parameter once, persist canonical text, and use the typed enum for timeline writes. This removes PostgreSQL `42804` without creating a PostgREST overload and protects the approval transition. It is applied to production through the Supabase CLI and regression-smoked. Generated types are unchanged because both RPC signatures and return types are unchanged.

`OUTREACH-02R-FIX-05` removes raw `activity.*` keys from the LeadDrawer timeline. All known CRM and Outreach activity types now have `en`, `uk`, `es`, and `ru` labels, and an unknown type receives a user-facing fallback instead of its internal identifier. The compact Outreach summary now includes latest immutable Research and Message versions in addition to campaign and status.

`OUTREACH-02R-FIX-06` makes the Today Outreach CTA truthful: when review, research, and attention counts are all zero, it renders a disabled `Open next task` button with a localized empty-queue message; any actionable count retains the existing Campaigns link.

## Engineering baseline added here

- Node pin: `.nvmrc` (`24.13.0`).
- Scripts: `typecheck`, `test:unit`, and static `verify:migrations`.
- Unit-test foundation: Vitest plus tests for the feature-flag resolver.
- CI: `.github/workflows/ci.yml` runs install, migration checks, typecheck, lint, unit tests, and build.
- Feature-flag foundation defaults all future OutreachOps controls to off; no screen reads it yet.
- Generated public-schema TypeScript types are stored at `src/lib/supabase/database.types.ts` after the linked production campaign-domain apply.

## Known gaps and risks

1. Generated database types are stored, but current client wrappers still use handwritten domain types and casts. Integrating them deliberately is future cleanup, not a prerequisite for this domain-only task.
2. Runtime-probe writes are now restricted to narrow service-role RPCs; the legacy client helper remains technical-debt cleanup and must not be used to bypass the supervised runtime boundary.
3. Existing `ai_generations` RLS has select/insert/update policies but no delete policy; this is conservative but needs an explicit retention decision.
4. The current `current_org_id()` function selects the oldest membership. This is adequate for a personal internal CRM but is not a future active-organization selector.
5. DB-BASELINE-02 captured the former import-schema drift (`leads.source_import_id`, `idx_leads_source_import_id`, `imports.reverted_at`, and `imports.reverted_by`) as a forward migration. The repository now represents it.
6. The supplied PDF references could not be text-extracted or visually opened in this runtime because neither Poppler/Python PDF tools nor an available browser runtime is installed. The master brief remains the authoritative source for this baseline; review the original PDFs before schema implementation if they contain constraints not repeated in it.
7. Docker Desktop/local `supabase db reset` and behavioral RLS integration remain verification debt before staging/private beta. The accepted production-linked manual smoke covered feature flags, themes, locales, responsive workspace behavior, and manual Campaign transitions.
8. Vite reports an existing large main-bundle warning after production build. Campaign routes are lazy-loaded; further bundle splitting is a performance follow-up, not an internal-pilot blocker.
9. OUTREACH-03B token optimization did not reduce usage between Versions 1 (9,603 total tokens) and 2 (9,747); cost estimation remains unconfigured. These are non-blocking supervised-research debt.
