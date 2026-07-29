# ADR 0001: Rebaseline before OutreachOps implementation

**Status:** Accepted for implementation planning on 2026-07-22.

## Context

The repository contains a stable CRM and a prior lead-centric AI draft foundation. The current product strategy requires campaign-scoped, supervised OutreachOps with no uncontrolled sending.

## Decision

Do not build the prior planned AI drawer panel. First document the current state, establish engineering gates and feature flags, and treat the current migration as a compatibility input rather than the final target schema.

## Consequences

- No CRM workflow or user-facing UI changes occur in OUTREACH-00R.
- Future migrations are additive and must preserve `leads` and `activities`.
- The earliest implementation task is `OUTREACH-01R`, after remote migration state is verified.
