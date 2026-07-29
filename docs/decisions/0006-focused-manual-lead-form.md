# ADR 0006: Focused manual lead form

Date: 2026-07-29

Status: accepted for implementation; authenticated UI acceptance is pending.

## Context

SprintCRM historically created leads through CSV/XLSX import. The `New lead` action inserted an empty `New company` row immediately, while `LeadDrawer` only supported operational changes such as stage, next action, work result, notes, archive, and timeline. Outreach campaign eligibility exposed the gap because a lead without a contact channel could not be repaired from the application.

## Decision

- `/leads/new` and `/leads/:leadId/edit` host one shared, focused contact-details form inside the authenticated app shell.
- Opening or cancelling the create route does not write a row. A write happens only after valid final submission.
- `LeadDrawer` remains the operational workspace and shows a compact read-only contact block with one `Edit details` action.
- The form uses existing `leads` columns only. No schema change is introduced.
- Exact normalized email, website-domain, or phone matches block creation. A same-company match is a warning that can be explicitly overridden.
- Client preflight provides a clear user experience; organization-scoped database unique indexes remain the final concurrency authority.
- Contact-detail updates write one best-effort `manual_edit` activity containing changed field names, rather than one timeline event per field.
- Campaign repair links use an allowlisted internal `returnTo`. A session-scoped campaign draft preserves wizard fields, selected leads, and the Leads step across the edit round-trip.
- The application uses a data router so route transitions and browser navigation can be guarded when the form is dirty.

## Consequences

- Empty placeholder leads are no longer created by the normal UI.
- Lead contact data can be corrected without turning the Drawer into a second long form or adding nested scroll areas.
- Lead and Campaign query families are invalidated after save, so eligibility is recalculated without a full page reload.
- The contact update is durable even if the subsequent best-effort activity write fails. A future server-side transaction may make this audit coupling atomic if operational evidence shows it is needed.
- Existing placeholder test rows must be cleaned through the normal archive/permanent-delete workflow, not by direct production SQL.

## Recovery

This change has no database migration. A code rollback restores the previous UI but must not revert the corrected canonical schema snapshot indexes. Any further schema correction must use an additive forward migration.
