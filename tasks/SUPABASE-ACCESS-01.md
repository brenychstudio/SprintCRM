# SUPABASE-ACCESS-01 - Link CRM studio safely

## Goal

Connect this repository to the existing CRM studio Supabase project and verify production schema/RLS state without modifying production data or schema.

## Evidence and files

- Project ref: `lyimwrbjyryojhprxdhk` (CRM studio, West EU).
- `supabase/config.toml` and `supabase/.gitignore` were created by `supabase init`.
- The link is stored locally in ignored `supabase/.temp`; database credentials are read from ignored root `.env` only.

## Work performed

1. Verified existing CLI authorization with `supabase projects list`.
2. Ran `supabase init` and `supabase link --project-ref lyimwrbjyryojhprxdhk`.
3. Verified direct database access with `supabase migration list --linked`.
4. Used read-only Management API queries to inspect public tables, RLS flags, policies and database advisors.

## Findings and risk

Production holds the expected CRM schema and RLS policies, but no CLI migration history. Do not execute `supabase db push`, migration repair, or any schema write as part of this task; such a write needs a dedicated comparison and recovery plan.

## Acceptance criteria

- Repository is linked without committing credentials.
- Remote schema and RLS are observed through a read-only path.
- Migration-history anomaly and security advisor warnings are documented.

## Results

All criteria met. Recommended next task: `DB-RECONCILE-01`.

## Proposed commit

```text
chore(supabase): link CRM studio project
```
