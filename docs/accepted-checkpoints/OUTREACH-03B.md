# OUTREACH-03B Checkpoint

Status: ACCEPTED.

Date: 2026-08-01
Branch: `codex/outreach-03b-ai-research`
Acceptance commit: `docs(outreach): accept supervised AI research`

## Delivered

- A single-contact, explicit, server-only AI research operation with domain-restricted public web search, strict `research_v2` validation, immutable research snapshots, organization-scoped lifecycle controls, audit records, and the canonical owner-populated `research_saved` activity.
- Human-reviewed proof-context grounding, resolved lead/campaign-language instructions, maximum 0.85 website-only confidence, and two to three reviewable evidence sources.
- Production forward fixes for campaign proof-context RPC composite assignment (`20260801000004`), required research activity owner (`20260801000005`), and V2 start-contract mapping (`20260801000006`), plus safe parser diagnostics/proof-title matching and rejected-result usage persistence.
- No automatic message generation, approval, Gmail draft/send, outbound send, retry/background processing, or campaign progression.

## Production acceptance

The successful completed V2 job is `d0a4f643-7407-42dd-b951-9a4ac16c3505`, request `6cd4d50f-cd3e-41aa-865a-c4e597596aab`.

| Field | Verified value |
| --- | --- |
| generation_status | `completed` |
| prompt_version / schema_version | `outreach_research_v2` / `research_v2` |
| provider / model | `openai` / `gpt-5.4-mini` |
| input / cached / output / total tokens | `9309` / `0` / `438` / `9747` |
| duration_ms | `4669` |
| confidence | `0.78` |
| evidence count | `3` |

Version 1 remains immutable and Version 2 is immutable; exactly two saved research versions exist. Version 2 links to the completed ledger, uses verified Oria House Barcelona proof context, contains Spanish narrative, passed strict schema and semantic validation, and requires human review. Requested and completed research audits exist, as does one owner-populated `research_saved` CRM activity. The campaign member is `research_ready`; no message version, approval, Gmail draft/send, outbound send, campaign-status regression, or pending/failed job for this request remains.

## Language diagnostic

The reported `en` output language was a reporting inference error. The completed `output_payload` has no language/locale key and `research_snapshots` has no language column. `research_v2` intentionally persists only validated research content; the server resolves the requested output language from lead language and then campaign default before provider invocation. No completed production data or runtime code was changed.

## Automated verification

```text
npm run verify:migrations - pass (17 migration files)
npm run typecheck - pass
npm run lint - pass
npm run test:unit - pass (59 tests)
npm run build - pass; existing Vite large-bundle warning remains
git diff --check - pass
npx supabase migration list --password $env:SUPABASE_DB_PASSWORD - pass; local equals remote through 20260801000006
npx supabase db push --dry-run --password $env:SUPABASE_DB_PASSWORD - pass; remote database is up to date with no migration, seed, or role change
```

## Remaining pre-staging debt

- Token reduction was not achieved: Version 1 used 9,603 total tokens and Version 2 used 9,747.
- Cost estimation remains unconfigured.
- Docker/local Supabase reset and behavioral RLS integration tests remain unavailable.
- Existing Vite large-bundle warning remains.

## Next checkpoint

`OUTREACH-03C — Supervised AI Draft Generation` may generate only an explicit single-click immutable message draft from campaign context, the reviewed latest research snapshot, verified proof context, resolved lead/campaign language, campaign tone, and offer. Human review remains required. No Gmail send, automatic approval, or automatic campaign progression is authorized.
