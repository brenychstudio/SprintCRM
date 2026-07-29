# SprintCRM engineering guide

## Product guardrails

SprintCRM is an internal, human-controlled CRM. Preserve the current loop:

```text
Import -> Leads -> Today -> Lead Work Panel -> Active Contacts -> Pipeline -> Reports
```

OutreachOps is additive. Do not add AI UI, automatic sending, an OpenAI key in the browser, or broad service-role database access unless the task explicitly introduces the required reviewed backend boundary.

## Task workflow

Before editing, record the task goal, current-state evidence, files to inspect, file plan, implementation plan, risks, acceptance criteria, tests, manual smoke, proposed commit message, and documentation impact. Keep one task on one branch/worktree and preserve unrelated changes.

For every database change, add an additive migration, retain organization-scoped RLS, document a rollback or forward-fix, verify the linked migration state, and synchronize generated database types. `activities` remains the canonical CRM timeline.

For every AI change, use a server-side Edge Function, validate structured results, version outputs, persist prompt/model/usage/audit data, keep a human approval gate, and never auto-send in the supervised MVP.

## Required checks

Run the applicable checks before handoff:

```text
npm run verify:migrations
npm run typecheck
npm run lint
npm run test:unit
npm run build
git diff --check
```

Also smoke-test authenticated workflow and both light and dark themes when a UI surface changes. Do not expose secrets in logs, commits, fixtures, or documentation.
