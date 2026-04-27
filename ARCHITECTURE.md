# SprintCRM Architecture

SprintCRM is an internal outbound CRM built around a simple operational loop:

```text
Import → Leads → Today Queue → Lead Work Panel → Active Contacts → Pipeline → Reports / Export
```

The project is intentionally focused on manual, high-quality outbound work. It is not an email automation tool, call center system, or public SaaS product.

## Application Surfaces

### Today Queue

The Today screen is the main daily work queue. It shows the highest-priority active leads due now or overdue. The user starts from the top of the queue, opens a lead, completes the next action, records the result, and moves forward.

### Lead Work Panel

The Lead Work Panel is the primary place to manage an individual lead.

It contains:

- lead identity and contact details
- current stage and active status
- next step
- result actions
- quick context extracted from notes
- editable next action plan
- lead context
- activity timeline
- archive and deletion controls

This keeps the workflow centered around one lead at a time instead of scattering actions across tables.

### Leads Base

The Leads page is the full database surface. It supports search, filters, smart views, saved views, bulk actions, archive restore, and safe deletion workflows.

### Active Contacts

Active Contacts focuses on warm leads that are already in progress: contacted, replied, or proposal.

### Pipeline

Pipeline is an overview, not the main action surface. It shows active stages and secondary stages while routing all detailed work back into the Lead Work Panel.

### Imports

Imports handles CSV/XLSX ingestion, preview, column mapping, deduplication checks, import history, undo import, and history cleanup.

### Reports

Reports provide operational visibility: KPI cards, funnel, top niches, top sources, overdue health, and CSV exports.

## Data Model

Main entities:

- leads
- activities
- imports

### Leads

Leads hold the current operational state:

- company and contact details
- website/domain
- niche and location
- status: active or archived
- stage: new, contacted, replied, proposal, won, lost
- next action and due date
- source import metadata
- notes

### Activities

Activities are the canonical timeline for CRM events:

- imported
- contacted
- replied
- proposal sent
- stage changed
- next action set
- won/lost
- notes and workflow events

### Imports

Imports track source files and import batches:

- file name
- mapping
- rows imported/skipped
- dedup rules
- reverted status

## Safety Model

SprintCRM uses a conservative data safety model:

- active leads cannot be permanently deleted directly
- a lead must be archived before permanent deletion
- archive/restore is separate from delete
- import undo deletes only leads linked to that import
- import history cleanup removes only the import record, not leads
- Supabase RLS policies protect org-scoped data

## Frontend Architecture

The app uses:

- React
- TypeScript
- React Router
- TanStack Query
- Tailwind CSS
- Supabase client

Route protection is handled through auth wrappers. Core CRM pages live under `src/app/pages`. Domain logic and Supabase API wrappers live under `src/features`.

## Internationalization

SprintCRM supports:

- English
- Ukrainian
- Spanish
- Russian

Locale files live in `src/i18n/locales`.

## Public Repository Note

This repository is provided for portfolio and code review purposes. The live CRM is not public because it is connected to private lead data and Supabase access.

No public live demo is provided for security and privacy reasons.
