# SprintCRM

# SprintCRM

Premium internal CRM for lead imports, daily outreach actions, pipeline tracking, reports, and AI-ready outbound workflows.

SprintCRM is a focused operator-facing workspace built to manage the full outbound loop: import leads, review and deduplicate contacts, 
prioritize daily actions, open a lead drawer, log outcomes, track pipeline stages, and review reporting signals.

The product is designed as a calm business tool rather than a generic sales dashboard. 
It combines practical CRM workflows with a premium light/dark interface, multilingual UI, Supabase-backed data, 
and a manual-control-first foundation for future AI-assisted outreach.

## Current product status

- Lead import workflow: XLSX/CSV upload, preview, mapping, deduplication, import report, undo support.
- Lead management: lead database, saved views, active contacts, next actions, due dates, and status tracking.
- Daily workflow: Today queue for processing the next relevant lead.
- Lead drawer: context, next action planning, activity timeline, stage updates, archive/delete controls.
- Pipeline and reports: active stages, secondary stages, funnel metrics, top niches, top sources, overdue health.
- Visual system: premium light/dark mode, tokenized app surfaces, refined drawer, badge/status system, and upgraded Signal Gate login.
- AI readiness: data structure prepared for future manual AI-assisted outreach drafting without auto-send.


## Main Features

- Supabase authentication
- Protected CRM routes
- Multi-language UI: English, Ukrainian, Spanish, Russian
- CSV / XLSX import flow
- Column mapping
- Import preview
- Deduplication checks
- Import history
- Undo import
- Import history cleanup
- Lead database with filters and smart views
- Saved views
- Bulk actions
- Daily work queue
- Lead Work Panel
- Active Contacts view
- Pipeline / funnel overview
- Reports and CSV export
- Archive / restore workflow
- Permanent delete only for archived leads
- RLS-backed data safety policies

## UX Direction

SprintCRM is designed as a focused business tool, not a generic admin dashboard.

The latest UX pass simplified the main workflow around four surfaces:

- Today — daily work queue
- Lead Work Panel — single place to manage a lead
- Active Contacts — warm leads already in progress
- Pipeline — overview of current funnel state

The goal is that a non-technical user can understand the next action without needing to understand CRM internals.

## Tech Stack

- Vite
- React
- TypeScript
- Tailwind CSS
- React Router
- TanStack Query
- Supabase
- Postgres
- Supabase Auth
- Row Level Security
- XLSX import support

## Repository Status

This repository is shared as a portfolio and code review reference.

The live production CRM is not public because it is connected to private lead data and Supabase access.

The project should be reviewed through anonymized screenshots, workflow video, code structure, architecture notes, and implementation details.

No public live demo is provided for security and privacy reasons.

## Environment Variables

Create a local .env file based on .env.example.

Required variables:

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

Do not commit .env files.

## Local Development

Install dependencies:

    npm install

Run locally:

    npm run dev

Build:

    npm run build

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a concise overview of the application structure, workflow model, data model, and safety rules.

## Supabase

Database migrations are stored in:

    supabase/migrations

A working Supabase project with the required schema, auth, RLS policies, and environment variables is required to run the CRM locally.

## Security Notes

- No Supabase service role key should be used in the frontend.
- .env and .env.* are ignored.
- Only .env.example is committed.
- The app uses Supabase Row Level Security policies for org-scoped access.
- This repository should not contain real lead databases, CSV/XLSX files, private emails, phone numbers, or production secrets.

## Portfolio Note

SprintCRM is best understood as an internal product system case study.

It demonstrates product UX thinking, operational workflow design, React / TypeScript implementation, Supabase integration, data safety logic, import / dedup / rollback flow, CRM lifecycle modeling, multilingual interface work, and practical business-tool design.

## License

All rights reserved.

This repository is provided for portfolio review only. No permission is granted to reuse, redistribute, resell, repackage, or commercialize this code without explicit written permission.
