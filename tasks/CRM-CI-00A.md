# CRM-CI-00A — Private Shared Bridge clean-runner bootstrap

## Pre-edit record

- **Task goal:** Restore the existing SprintCRM GitHub Actions baseline on a clean Linux runner by provisioning the accepted private Shared Bridge at its immutable commit. This checkpoint does not add a Deno gate.
- **Current-state evidence:** The focused branch `codex/ci-shared-bridge-bootstrap` is clean at canonical `main` `c1ce11541278720e612262de936779a343cbe920` and is ahead/behind `origin/main` by `0/0`. Gmail PR #22 remains open, draft, and unmerged at `3b9fb153e936da4f4baf289d07bd9d95b17279b4`. The private repository `brenychstudio/shared-ai-product-bridge` exposes `main` at accepted commit `cf37a7937e55803ea48cd23cc028521cc8fc5881`; its local checkout is clean at the same SHA.
- **Files inspected:** `AGENTS.md`, `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, canonical main and PR #22 Actions logs, the six Shared package directories, and Shared local/remote metadata.
- **File plan:** Update only `.github/workflows/ci.yml` plus this task record. Preserve `package.json`, `package-lock.json`, application source, Edge Functions, migrations, Gmail code, and Shared source.
- **Implementation plan:** Check out the private Shared repository under `.ci/node_modules` using the read-only repository secret and exact immutable SHA so normal Vitest discovery excludes dependency-owned tests; disable credential persistence; assert the checkout HEAD and six package directories; install the Shared workspace's locked development typings; create a runner-only symlink at the target resolved by the existing `file:` dependencies; prove every path resolves into the checked-out tree; then run the existing gates plus safe Product Bridge unit tests.
- **Risks:** Missing/incorrect PAT repository selection, accidental token exposure, floating Shared revision, an unexpected pre-existing dependency target, incorrect Linux path calculation, or a symlink escaping the pinned checkout.
- **Acceptance criteria:** Private checkout succeeds; actual HEAD exactly matches `cf37a7937e55803ea48cd23cc028521cc8fc5881`; six dependency paths resolve to the exact checkout before `npm ci`; existing validation and Product Bridge unit tests pass on GitHub Actions; no secret appears in source/logs; no application behavior changes.
- **Tests:** Local existing gates; Product Bridge unit suite; an isolated fresh product/Shared layout with no canonical `node_modules` or `C:\PROJECTS` dependency; GitHub Actions clean-runner log inspection.
- **Manual smoke:** Not applicable; no UI or runtime behavior changes.
- **Proposed commit:** `ci: provision pinned shared bridge dependencies`
- **Documentation impact:** This focused task record only. Deno type safety remains explicitly deferred to `CRM-EDGE-00A`.

## Deferred work

The previously discovered Deno 2.1.12 type errors in `supabase/functions/outreach-ai-runtime/index.ts` are not changed or gated here. `CRM-EDGE-00A` owns that typing rebaseline and the later `check:functions` gate.

## Local verification record

- Canonical checkout: `npm ci`, 22-migration verification, typecheck, lint, 25 files / 213 tests, build, and 6 files / 79 Product Bridge tests passed. The existing Vite large-chunk advisory remains non-blocking debt.
- Fresh runner-like proof: cloned SprintCRM at `c1ce11541278720e612262de936779a343cbe920` and private Shared at `cf37a7937e55803ea48cd23cc028521cc8fc5881` into a task-owned temporary root, installed both lockfiles with fresh `npm ci`, created only the temporary dependency junction, and passed typecheck plus canonical 25/213 and 6/79 test counts without canonical `node_modules` or `C:\PROJECTS` dependency. The temporary proof root was removed.
- The Shared root `npm ci` is required because its source-exporting workspace owns development declarations such as `@types/express`; this is deterministic lockfile bootstrap, not a Shared build or source change.
- Checkout under `.ci/node_modules` deliberately keeps dependency-owned tests outside SprintCRM's normal Vitest discovery while retaining a workspace-local, cleanup-safe Actions checkout.
