# OUTREACH-00R - SprintCRM 2026 Re-baseline

## Goal

Record the real repository state and establish a safe engineering foundation for OutreachOps without changing current CRM business logic or adding AI UI.

## Current-state evidence

- Branch started from `main` at `23754b0` with a clean working tree.
- Routes are limited to the established CRM surfaces; LeadDrawer remains a portal-backed operational panel.
- `20260427_ai_outreach_foundation.sql` creates a lead-centric `ai_generations` foundation, not the campaign domain.
- Remote migration/RLS state cannot be verified because this workspace has no linked Supabase CLI project or authorized database connection.

## Files inspected

- `src/App.tsx`, `src/app/layout/AppShell.tsx`, `src/app/features/leads/LeadDrawer.tsx`
- `src/features/leads/*`, `src/features/ai/*`, `src/i18n/*`, `src/app/theme/*`
- `supabase/schema.sql`, all `supabase/migrations/*`
- `package.json`, TypeScript/ESLint configuration, environment example and existing architecture documents

## File plan and implementation

1. Add `AGENTS.md`, baseline/target architecture docs, ADRs and a candidate checkpoint.
2. Add a typed, default-off feature-flag resolver for the four approved flags; do not consume it in UI yet.
3. Add Node pin, scripts, Vitest test foundation, static migration check, and CI workflow.
4. Repair existing lint blockers with behaviour-preserving fixes or narrow documented exceptions so CI is enforceable.

## Risks and controls

| Risk | Control |
| --- | --- |
| Remote schema differs from repository | Require `supabase migration list --linked` before OUTREACH-01R. |
| Existing lead-centric AI draft model conflicts with campaign domain | Preserve it; assess compatibility during additive OUTREACH-01R migration design. |
| Client-side AI record writes imply a future unsafe pattern | Document and replace/restrict before provider integration. |
| Flags are mistaken for authorization | Document that Edge Functions must enforce policy independently. |

## Acceptance criteria

- Existing CRM routes and business flow remain unchanged.
- The four requested flags exist and resolve to `false` unless explicitly enabled.
- Typecheck, lint, unit test, build, and migration checks run locally and in CI.
- Current state, target architecture, decisions, risks and next task are documented.

## Verification

- Automated: `npm run verify:migrations`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, `git diff --check`.
- Manual UI smoke: not required for behaviourless foundation changes; authenticated light/dark smoke remains an operator check because no authenticated browser session is available in this environment.
- Production/RLS smoke: pending an authorized linked Supabase environment.

## Proposed commit

```text
chore(outreach): establish 2026 re-baseline
```

## Documentation impact

Adds the current-state report, OutreachOps target, two ADRs, task record, checkpoint, and agent guide. Marks the old AI-drawer plan as historical.
