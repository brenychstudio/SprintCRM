# CRM-EDGE-00A — Outreach Edge Function Deno type-safety rebaseline

## Pre-edit record

- **Task goal:** Rebaseline the production-proven `outreach-ai-runtime` against Deno 2.1.12 without changing runtime behavior, make Edge dependency resolution deterministic, add an automatically discovered `check:functions` command, and make it a permanent CI gate.
- **Current-state evidence:** Canonical `main` and `origin/main` are clean at `48c11d2e3d06585546c207aafcdbc1d2ae9d99ff`. Gmail PR #22 remains open and draft at `3b9fb153e936da4f4baf289d07bd9d95b17279b4` and is outside this task. Shared Bridge remains clean and frozen locally/remotely at `cf37a7937e55803ea48cd23cc028521cc8fc5881`. The Node lock resolves `@supabase/supabase-js` to `2.97.0`, while the Edge import was the floating major specifier `npm:@supabase/supabase-js@2`.
- **Files inspected:** `AGENTS.md`, `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `supabase/config.toml`, `supabase/functions/outreach-ai-runtime/index.ts`, its imported `_shared` modules and contract tests, `src/lib/supabase/database.types.ts`, `docs/current-state.md`, and the existing QA/task-document conventions.
- **File plan:** Type only the existing Supabase clients/helpers in `outreach-ai-runtime/index.ts`; pin its Edge Supabase import; add a committed Edge Deno lockfile; add `scripts/qa/check-edge-functions.mjs`; expose it through `package.json`; add pinned Deno setup and the command to `.github/workflows/ci.yml`; update this record and `docs/current-state.md`. Do not change migrations, Gmail, Shared Bridge, provider behavior, prompts, validation, queries, or lifecycle logic.
- **Implementation plan:** Import the canonical generated `Database` type with `import type`; create all user/service clients as `createClient<Database>`; type persistence helpers as `SupabaseClient<Database>`; pin Edge Supabase JS to the Node-locked `2.97.0`; generate a Deno lock with 2.1.12; add a cross-platform script that discovers sorted `supabase/functions/*/index.ts` entrypoints excluding `_shared`, verifies Deno 2.1.12, and checks all entrypoints with the committed frozen lock; then add that command to existing CI without altering the Shared bootstrap.
- **Risks:** A frontend-path type import could fail Deno resolution or Edge bundling; generated JSON/RPC types could expose additional legitimate mismatches; a stale lock could hide non-reproducible resolution; automatic discovery could accidentally skip or reorder functions; or a type-only edit could inadvertently alter runtime text.
- **Acceptance criteria:** Deno 2.1.12 reports zero diagnostics for every current Edge entrypoint; the original 14 errors are resolved rather than suppressed; all existing gates and runtime contract tests remain green; CI installs exact Deno 2.1.12 and runs the new gate without credentials; no runtime logic or production state changes; focused PR is green and merged to `main`.
- **Tests:** Direct Deno check of `outreach-ai-runtime`; `npm run check:functions`; migration verification; application typecheck; lint; 25-file unit suite including runtime contracts; build; 6-file Product Bridge suite; `git diff --check`; focused GitHub Actions acceptance.
- **Manual smoke:** No UI smoke is applicable. Static Edge checking only; do not execute the function, provider, Supabase, OpenAI, Gmail, or production paths.
- **Proposed commit:** `fix(edge): align outreach runtime with generated database types`
- **Documentation impact:** Add this task record and a minimal current-state note for the canonical Edge type gate. Gmail task documentation remains untouched.

## Original Deno 2.1.12 diagnostic inventory

The canonical command before editing was:

```text
deno 2.1.12 check --no-config --no-lock supabase/functions/outreach-ai-runtime/index.ts
```

It returned exactly 14 `TS2345` diagnostics:

- RPC argument inference to `undefined`: lines 151 (`finish_ai_research_job`), 283 (`finish_ai_draft_job`), and 390 (`finish_ai_runtime_probe`).
- `SupabaseClient<any, ...>` rejected by helpers inferred as `SupabaseClient<unknown, ..., never, never, ...>`: research lines 221, 230, 238, and 252; draft lines 335, 351, 365, and 381; runtime probe lines 483, 490, and 510.

There were no JSON-payload, import-resolution, or other diagnostic classes. The shared root cause is schema erasure in untyped `createClient` calls combined with helper parameters based on `ReturnType<typeof createClient>`. This is compile-time debt; the already deployed runtime behavior was not affected before the fix.

## Implementation and reproducibility record

- All six user/service client constructions now use `createClient<Database>` and all three failure-persistence helpers receive `SupabaseClient<Database>`. The canonical generated type remains at `src/lib/supabase/database.types.ts` and is imported type-only, so it adds no runtime module dependency.
- Generated query typing exposed one additional `TS2322`: the database correctly models `leads.website` as nullable while the already validated research builder requires a string. A stable local value is validated by the existing function, narrowed without an unsafe cast, and forwarded with the otherwise unchanged lead fields. Invalid/null behavior and the provider payload for valid values are unchanged.
- Edge Supabase JS is pinned to the Node-lock resolution `2.97.0`. Deno 2.1.12 generated `supabase/functions/deno.lock`; the check runs from the Edge Functions root with `--no-config`, `--node-modules-dir=none`, and `--frozen=true`, keeping the lock limited to the Edge graph rather than the frontend package workspace.
- `scripts/qa/check-edge-functions.mjs` requires exact Deno 2.1.12, discovers and sorts all function-directory `index.ts` files except `_shared`, fails if none exist, and checks them together through the frozen lock. No environment secret or runtime invocation is involved.

## Local verification record

- Direct Deno 2.1.12 check: `outreach-ai-runtime` passed with all original 14 diagnostics resolved and no suppressions.
- Fresh empty Deno cache: frozen-lock `npm run check:functions` downloaded and verified only locked dependencies, checked the single current entrypoint, and passed; the task-owned temporary cache was removed.
- Focused runtime contracts: 4 files / 77 tests passed.
- Full clean regression: `npm ci` reported 0 vulnerabilities; 22 migrations verified; typecheck and lint passed; 25 files / 213 tests passed; build passed with only the existing Vite large-chunk advisory; 6 files / 79 Product Bridge tests passed; `check:functions` and `git diff --check` passed.
- No Supabase function was executed or deployed, no provider was called, and no production state was read or changed.
