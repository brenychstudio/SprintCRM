begin;

-- Capture import-history fields that already exist in production and are used by
-- the Imports UI. This migration intentionally mirrors production: nullable
-- columns, no defaults, no foreign keys.
alter table public.leads
  add column if not exists source_import_id uuid;

alter table public.imports
  add column if not exists reverted_at timestamptz,
  add column if not exists reverted_by uuid;

create index if not exists idx_leads_source_import_id
  on public.leads(source_import_id);

commit;
