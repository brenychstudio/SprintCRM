-- SprintCRM schema v2 (Org-ready) for Supabase (public)
-- Includes: organizations + memberships + org-scoped RLS, plus leads/activities/imports.

create extension if not exists pgcrypto;

-- 1) Enums
do $$ begin
  create type public.org_role as enum ('owner','admin','member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_stage as enum ('new','contacted','replied','proposal','won','lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_status as enum ('active','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.next_action as enum ('follow_up','send_proposal','request_call','nurture');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_type as enum ('imported','contacted','replied','proposal_sent','won','lost','note','stage_changed','next_action_set');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_channel as enum ('email','ig','linkedin','other');
exception when duplicate_object then null; end $$;

-- 2) Org tables
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_memberships_org on public.memberships(org_id);

-- 3) Helper functions (org membership / current org)
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at asc
  limit 1;
$$;

-- 4) Create вЂњpersonal orgвЂќ automatically for new auth users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  -- Create org
  insert into public.organizations (name, created_by)
  values (coalesce(new.email, 'Personal workspace'), new.id)
  returning id into v_org_id;

  -- Create membership (owner)
  insert into public.memberships (org_id, user_id, role)
  values (v_org_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 5) Leads / Activities / Imports
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),

  org_id uuid not null default public.current_org_id() references public.organizations(id) on delete cascade,

  owner uuid not null default auth.uid(),       -- assigned_to (future)
  created_by uuid not null default auth.uid(),  -- audit (future)

  company_name text not null,
  website text,
  website_domain text,
  niche text,
  country_city text,
  contact_name text,
  email text,
  phone text,

  source_file text,
  stage public.lead_stage not null default 'new',
  status public.lead_status not null default 'active',

  last_touch_at timestamptz not null default now(),
  next_action public.next_action not null default 'follow_up',
  next_action_at timestamptz not null default (now() + interval '3 days'),

  notes text,
  revenue numeric,

  -- normalized fields for dedup
  email_norm text,
  website_domain_norm text,
  phone_norm text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),

  org_id uuid not null default public.current_org_id() references public.organizations(id) on delete cascade,
  owner uuid not null default auth.uid(), -- actor

  lead_id uuid not null references public.leads(id) on delete cascade,

  type public.activity_type not null,
  channel public.activity_channel,
  at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),

  org_id uuid not null default public.current_org_id() references public.organizations(id) on delete cascade,
  owner uuid not null default auth.uid(),

  file_name text not null,
  uploaded_at timestamptz not null default now(),
  rows_total int not null default 0,
  rows_imported int not null default 0,
  rows_skipped int not null default 0,
  mapping_json jsonb not null default '{}'::jsonb,
  dedup_rules jsonb not null default '{}'::jsonb
);

-- 6) Triggers: updated_at + normalization
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.normalize_lead_fields()
returns trigger language plpgsql as $$
begin
  if new.email is null or btrim(new.email) = '' then
    new.email_norm = null;
  else
    new.email_norm = lower(btrim(new.email));
  end if;

  if new.website_domain is null or btrim(new.website_domain) = '' then
    new.website_domain_norm = null;
  else
    new.website_domain_norm = lower(btrim(new.website_domain));
  end if;

  if new.phone is null or btrim(new.phone) = '' then
    new.phone_norm = null;
  else
    new.phone_norm = regexp_replace(btrim(new.phone), '[^0-9+]', '', 'g');
  end if;

  return new;
end $$;

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

drop trigger if exists trg_leads_normalize on public.leads;
create trigger trg_leads_normalize
before insert or update on public.leads
for each row execute function public.normalize_lead_fields();

-- 7) Indexes
create index if not exists idx_leads_org on public.leads(org_id);
create index if not exists idx_leads_owner on public.leads(owner);
create index if not exists idx_leads_next_action_at on public.leads(next_action_at);
create index if not exists idx_leads_stage on public.leads(stage);
create index if not exists idx_leads_status on public.leads(status);

create index if not exists idx_activities_org on public.activities(org_id);
create index if not exists idx_activities_lead_id on public.activities(lead_id);

create index if not exists idx_imports_org on public.imports(org_id);
create index if not exists idx_imports_uploaded_at on public.imports(uploaded_at);

-- Dedup uniques (nulls allowed), scoped globally in v2
create unique index if not exists uidx_leads_email_norm on public.leads(email_norm) where email_norm is not null;
create unique index if not exists uidx_leads_domain_norm on public.leads(website_domain_norm) where website_domain_norm is not null;
create unique index if not exists uidx_leads_phone_norm on public.leads(phone_norm) where phone_norm is not null;

-- 8) RLS
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.imports enable row level security;

-- Organizations: user can see orgs they belong to
drop policy if exists org_select_member on public.organizations;
create policy org_select_member on public.organizations
for select to authenticated
using (public.is_org_member(id));

-- Memberships: user can see own memberships
drop policy if exists memberships_select_own on public.memberships;
create policy memberships_select_own on public.memberships
for select to authenticated
using (user_id = auth.uid());

-- Leads: org-scoped
drop policy if exists leads_select_org on public.leads;
create policy leads_select_org on public.leads
for select to authenticated
using (public.is_org_member(org_id));

drop policy if exists leads_insert_org on public.leads;
create policy leads_insert_org on public.leads
for insert to authenticated
with check (public.is_org_member(org_id));

drop policy if exists leads_update_org on public.leads;
create policy leads_update_org on public.leads
for update to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- Activities: org-scoped (via org_id)
drop policy if exists activities_select_org on public.activities;
create policy activities_select_org on public.activities
for select to authenticated
using (public.is_org_member(org_id));

drop policy if exists activities_insert_org on public.activities;
create policy activities_insert_org on public.activities
for insert to authenticated
with check (public.is_org_member(org_id));

-- Imports: org-scoped
drop policy if exists imports_select_org on public.imports;
create policy imports_select_org on public.imports
for select to authenticated
using (public.is_org_member(org_id));

drop policy if exists imports_insert_org on public.imports;
create policy imports_insert_org on public.imports
for insert to authenticated
with check (public.is_org_member(org_id));

