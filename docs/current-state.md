# Current state - OUTREACH-00R

Baseline recorded on 2026-07-22 from `codex/outreach-00r-rebaseline` (created from `main` at `23754b0`). The working tree was clean before this task.

## Product surfaces

| Area | Current implementation |
| --- | --- |
| Routes | `/today`, `/active-contacts`, `/leads`, `/imports`, `/pipeline`, `/reports`; all authenticated behind `RequireAuth`. |
| Lead workspace | `LeadDrawer` is a portal-backed, fixed-position operational panel for identity, next action, result/stage changes, notes, context, activity history, archive and safe delete. |
| Data access | Client-side Supabase wrappers live in `src/features/leads/leadsApi.ts`, `src/features/ai/aiGenerationsApi.ts`, and `src/features/reports/exportCsv.ts`. |
| Database | `organizations`, `memberships`, `leads`, `activities`, and `imports` are defined in `supabase/schema.sql`; later migrations harden org deduplication, activity org consistency, and delete/update policies. |
| Localization | `en`, `uk`, `es`, `ru` dictionaries via `src/i18n`. |
| Theme | `useThemeMode` persists light/dark state using `data-theme`; drawer-specific theme selectors exist in `src/style.css`. |

## Existing AI/outreach foundation

`20260427_ai_outreach_foundation.sql` adds `ai_generations`, several lead-level outreach snapshot fields, AI activity enum values, indexes, and org-member RLS policies. The frontend has matching handwritten types and direct client CRUD helpers, but no UI imports or routes currently use them.

This is an early lead-centric draft-history foundation, not the target OutreachOps domain. It must not be expanded casually: future work should introduce campaign-scoped tables additively and migrate UI access to server-side functions before any model invocation.

## Production migration verification

The repository has no `supabase/config.toml`, linked project reference, Supabase CLI setup, or safe production credential in the task environment. Therefore whether `20260427_ai_outreach_foundation.sql` is applied to production is **unverified**. Before `OUTREACH-01R`, an authorized operator must run:

```text
supabase link --project-ref <project-ref>
supabase migration list --linked
```

Record the remote/local result and, if it is missing, apply it only through the approved migration flow. Do not use the browser client or a frontend key to infer schema state.

## Engineering baseline added here

- Node pin: `.nvmrc` (`24.13.0`).
- Scripts: `typecheck`, `test:unit`, and static `verify:migrations`.
- Unit-test foundation: Vitest plus tests for the feature-flag resolver.
- CI: `.github/workflows/ci.yml` runs install, migration checks, typecheck, lint, unit tests, and build.
- Feature-flag foundation defaults all future OutreachOps controls to off; no screen reads it yet.

## Known gaps and risks

1. There are no generated Supabase database types; current domain types are handwritten.
2. The `aiGenerationsApi` permits authenticated browser clients to create/update AI generation records. This must be replaced or restricted before supervised AI jobs are introduced.
3. Existing `ai_generations` RLS has select/insert/update policies but no delete policy; this is conservative but needs an explicit retention decision.
4. The current `current_org_id()` function selects the oldest membership. This is adequate for a personal internal CRM but is not a future active-organization selector.
5. Production migration state and live RLS policy state are unverified from this workspace.
6. The supplied PDF references could not be text-extracted or visually opened in this runtime because neither Poppler/Python PDF tools nor an available browser runtime is installed. The master brief remains the authoritative source for this baseline; review the original PDFs before schema implementation if they contain constraints not repeated in it.
