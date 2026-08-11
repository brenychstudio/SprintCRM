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

-- 4) Create РІР‚Сљpersonal orgРІР‚Сњ automatically for new auth users
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
  source_import_id uuid,
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
  dedup_rules jsonb not null default '{}'::jsonb,
  reverted_at timestamptz,
  reverted_by uuid
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
create index if not exists idx_leads_source_import_id on public.leads(source_import_id);

create index if not exists idx_activities_org on public.activities(org_id);
create index if not exists idx_activities_lead_id on public.activities(lead_id);

create index if not exists idx_imports_org on public.imports(org_id);
create index if not exists idx_imports_uploaded_at on public.imports(uploaded_at);

-- Dedup uniques (nulls allowed), scoped to the current organization.
create unique index if not exists uidx_leads_org_email_norm on public.leads(org_id, email_norm) where email_norm is not null;
create unique index if not exists uidx_leads_org_domain_norm on public.leads(org_id, website_domain_norm) where website_domain_norm is not null;
create unique index if not exists uidx_leads_org_phone_norm on public.leads(org_id, phone_norm) where phone_norm is not null;

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

-- 9) OutreachOps minimal campaign domain (OUTREACH-01R)
-- Canonical definitions are introduced by migrations 20260722000002 and
-- 20260722000003. This reference mirrors their additive database state.

-- Composite keys make every new organization-scoped reference verifiable by
-- Postgres, rather than relying on browser behavior or RLS alone. They are
-- redundant with the existing primary keys and do not rewrite application data.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_id_org_id_key'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_id_org_id_key unique (id, org_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_generations_id_org_id_key'
      and conrelid = 'public.ai_generations'::regclass
  ) then
    alter table public.ai_generations
      add constraint ai_generations_id_org_id_key unique (id, org_id);
  end if;
end $$;

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id()
    references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text,
  status text not null default 'draft'
    constraint campaigns_status_check
    check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  target_segment text,
  offer_summary text,
  default_channel text not null default 'email'
    constraint campaigns_default_channel_check
    check (default_channel in ('email', 'linkedin', 'ig', 'other')),
  default_language text not null default 'en'
    constraint campaigns_default_language_check
    check (default_language in ('en', 'uk', 'es', 'ru')),
  tone text,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_id_organization_id_key unique (id, organization_id)
);

create table public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  campaign_id uuid not null,
  lead_id uuid not null,
  status text not null default 'queued'
    constraint campaign_members_status_check
    check (status in (
      'queued', 'researching', 'research_ready', 'draft_ready', 'needs_review',
      'approved', 'provider_draft', 'sent', 'replied', 'followup_due',
      'skipped', 'suppressed', 'failed'
    )),
  skip_reason text,
  last_error text,
  added_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_members_campaign_organization_fkey
    foreign key (campaign_id, organization_id)
    references public.campaigns(id, organization_id) on delete restrict,
  constraint campaign_members_lead_organization_fkey
    foreign key (lead_id, organization_id)
    references public.leads(id, org_id) on delete restrict,
  constraint campaign_members_campaign_id_lead_id_key unique (campaign_id, lead_id),
  constraint campaign_members_id_organization_id_key unique (id, organization_id)
);

create table public.research_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  campaign_member_id uuid not null,
  version integer not null check (version >= 1),
  source text not null default 'manual'
    constraint research_snapshots_source_check
    check (source in ('manual', 'ai', 'imported')),
  observed_opportunity text,
  recommended_offer text,
  recommended_case text,
  evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence) = 'array'),
  confidence numeric check (confidence >= 0 and confidence <= 1),
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  ai_generation_id uuid,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint research_snapshots_campaign_member_organization_fkey
    foreign key (campaign_member_id, organization_id)
    references public.campaign_members(id, organization_id) on delete restrict,
  constraint research_snapshots_ai_generation_organization_fkey
    foreign key (ai_generation_id, organization_id)
    references public.ai_generations(id, org_id) on delete restrict,
  constraint research_snapshots_campaign_member_id_version_key
    unique (campaign_member_id, version),
  constraint research_snapshots_id_organization_id_key unique (id, organization_id)
);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id()
    references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text,
  channel text not null default 'email'
    constraint message_templates_channel_check
    check (channel in ('email', 'linkedin', 'ig', 'other')),
  language text not null default 'en'
    constraint message_templates_language_check
    check (language in ('en', 'uk', 'es', 'ru')),
  status text not null default 'active'
    constraint message_templates_status_check
    check (status in ('active', 'archived')),
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_id_organization_id_key unique (id, organization_id)
);

create table public.template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  template_id uuid not null,
  version integer not null check (version >= 1),
  subject_template text,
  body_template text not null,
  variables jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint template_versions_template_organization_fkey
    foreign key (template_id, organization_id)
    references public.message_templates(id, organization_id) on delete restrict,
  constraint template_versions_template_id_version_key unique (template_id, version),
  constraint template_versions_id_organization_id_key unique (id, organization_id)
);

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id(),
  campaign_member_id uuid not null,
  version integer not null check (version >= 1),
  source text not null default 'manual'
    constraint outbound_messages_source_check
    check (source in ('manual', 'template', 'ai')),
  channel text not null default 'email'
    constraint outbound_messages_channel_check
    check (channel in ('email', 'linkedin', 'ig', 'other')),
  language text not null default 'en'
    constraint outbound_messages_language_check
    check (language in ('en', 'uk', 'es', 'ru')),
  subject text,
  body text not null,
  status text not null default 'draft'
    constraint outbound_messages_status_check
    check (status in ('draft', 'needs_review', 'approved', 'provider_draft', 'sent', 'failed', 'cancelled')),
  research_snapshot_id uuid,
  template_version_id uuid,
  ai_generation_id uuid,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  sent_at timestamptz,
  failure_code text,
  failure_message text,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_messages_campaign_member_organization_fkey
    foreign key (campaign_member_id, organization_id)
    references public.campaign_members(id, organization_id) on delete restrict,
  constraint outbound_messages_research_snapshot_organization_fkey
    foreign key (research_snapshot_id, organization_id)
    references public.research_snapshots(id, organization_id) on delete restrict,
  constraint outbound_messages_template_version_organization_fkey
    foreign key (template_version_id, organization_id)
    references public.template_versions(id, organization_id) on delete restrict,
  constraint outbound_messages_ai_generation_organization_fkey
    foreign key (ai_generation_id, organization_id)
    references public.ai_generations(id, org_id) on delete restrict,
  constraint outbound_messages_campaign_member_id_version_key
    unique (campaign_member_id, version),
  constraint outbound_messages_approval_check check (
    (status in ('approved', 'provider_draft', 'sent') and approved_by is not null and approved_at is not null)
    or (status not in ('approved', 'provider_draft', 'sent') and approved_at is null)
  ),
  constraint outbound_messages_sent_at_check check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  )
);

create table public.suppression_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id()
    references public.organizations(id) on delete cascade,
  subject_type text not null
    constraint suppression_entries_subject_type_check
    check (subject_type in ('lead', 'email', 'domain')),
  subject_value text not null check (btrim(subject_value) <> ''),
  subject_value_normalized text generated always as (lower(btrim(subject_value))) stored,
  reason text,
  source text not null default 'manual'
    constraint suppression_entries_source_check
    check (source in ('manual', 'reply', 'bounce', 'compliance', 'system')),
  is_active boolean not null default true,
  expires_at timestamptz,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id()
    references public.organizations(id) on delete cascade,
  actor_type text not null
    constraint audit_events_actor_type_check
    check (actor_type in ('human', 'system', 'ai')),
  actor_user_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (btrim(event_type) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid not null,
  request_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_check check (
    (actor_type = 'human' and actor_user_id is not null)
    or (actor_type in ('system', 'ai') and actor_user_id is null)
  )
);

create index idx_campaigns_organization_status
  on public.campaigns(organization_id, status);
create index idx_campaigns_organization_updated_at
  on public.campaigns(organization_id, updated_at desc);

create index idx_campaign_members_campaign_status
  on public.campaign_members(campaign_id, status);
create index idx_campaign_members_organization_status
  on public.campaign_members(organization_id, status);
create index idx_campaign_members_lead_id
  on public.campaign_members(lead_id);

create index idx_research_snapshots_campaign_member_version
  on public.research_snapshots(campaign_member_id, version desc);
create index idx_research_snapshots_organization_created_at
  on public.research_snapshots(organization_id, created_at desc);

create index idx_message_templates_organization_status
  on public.message_templates(organization_id, status);
create index idx_message_templates_organization_channel_language
  on public.message_templates(organization_id, channel, language);

create index idx_template_versions_template_version
  on public.template_versions(template_id, version desc);

create index idx_outbound_messages_campaign_member_version
  on public.outbound_messages(campaign_member_id, version desc);
create index idx_outbound_messages_organization_status
  on public.outbound_messages(organization_id, status);
create index idx_outbound_messages_sent_at
  on public.outbound_messages(sent_at) where sent_at is not null;
create index idx_outbound_messages_approved_at
  on public.outbound_messages(approved_at) where approved_at is not null;

create index idx_suppression_entries_organization_subject_type
  on public.suppression_entries(organization_id, subject_type);
create unique index uidx_suppression_entries_active_subject
  on public.suppression_entries(organization_id, subject_type, subject_value_normalized)
  where is_active;

create index idx_audit_events_organization_created_at
  on public.audit_events(organization_id, created_at desc);
create index idx_audit_events_entity
  on public.audit_events(entity_type, entity_id);
create index idx_audit_events_request_id
  on public.audit_events(request_id) where request_id is not null;

create trigger trg_campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

create trigger trg_campaign_members_set_updated_at
before update on public.campaign_members
for each row execute function public.set_updated_at();

create trigger trg_message_templates_set_updated_at
before update on public.message_templates
for each row execute function public.set_updated_at();

create trigger trg_outbound_messages_set_updated_at
before update on public.outbound_messages
for each row execute function public.set_updated_at();

create trigger trg_suppression_entries_set_updated_at
before update on public.suppression_entries
for each row execute function public.set_updated_at();

create or replace function public.prevent_outbound_message_content_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.campaign_member_id is distinct from new.campaign_member_id
     or old.organization_id is distinct from new.organization_id
     or old.version is distinct from new.version
     or old.source is distinct from new.source
     or old.channel is distinct from new.channel
     or old.language is distinct from new.language
     or old.subject is distinct from new.subject
     or old.body is distinct from new.body
     or old.research_snapshot_id is distinct from new.research_snapshot_id
     or old.template_version_id is distinct from new.template_version_id
     or old.ai_generation_id is distinct from new.ai_generation_id
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'outbound message content is immutable; create a new version instead'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger trg_outbound_messages_prevent_content_rewrite
before update on public.outbound_messages
for each row execute function public.prevent_outbound_message_content_rewrite();

create or replace function public.enforce_audit_event_actor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if new.actor_type <> 'human' then
      raise exception 'authenticated clients may only write human audit events'
        using errcode = '42501';
    end if;

    new.actor_user_id := auth.uid();
  end if;

  return new;
end;
$$;

create or replace function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_events are append-only'
    using errcode = '55000';
end;
$$;

create trigger trg_audit_events_enforce_actor
before insert on public.audit_events
for each row execute function public.enforce_audit_event_actor();

create trigger trg_audit_events_append_only
before update or delete on public.audit_events
for each row execute function public.prevent_audit_event_mutation();

-- OutreachOps organization-scoped RLS

alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.research_snapshots enable row level security;
alter table public.message_templates enable row level security;
alter table public.template_versions enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.suppression_entries enable row level security;
alter table public.audit_events enable row level security;

create policy campaigns_select_org on public.campaigns
for select to authenticated
using (public.is_org_member(organization_id));
create policy campaigns_insert_org on public.campaigns
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy campaigns_update_org on public.campaigns
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy campaigns_delete_org on public.campaigns
for delete to authenticated
using (public.is_org_member(organization_id));

create policy campaign_members_select_org on public.campaign_members
for select to authenticated
using (public.is_org_member(organization_id));
create policy campaign_members_insert_org on public.campaign_members
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy campaign_members_update_org on public.campaign_members
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy campaign_members_delete_org on public.campaign_members
for delete to authenticated
using (public.is_org_member(organization_id));

create policy research_snapshots_select_org on public.research_snapshots
for select to authenticated
using (public.is_org_member(organization_id));
create policy research_snapshots_insert_org on public.research_snapshots
for insert to authenticated
with check (public.is_org_member(organization_id));

create policy message_templates_select_org on public.message_templates
for select to authenticated
using (public.is_org_member(organization_id));
create policy message_templates_insert_org on public.message_templates
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy message_templates_update_org on public.message_templates
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy message_templates_delete_org on public.message_templates
for delete to authenticated
using (public.is_org_member(organization_id));

create policy template_versions_select_org on public.template_versions
for select to authenticated
using (public.is_org_member(organization_id));
create policy template_versions_insert_org on public.template_versions
for insert to authenticated
with check (public.is_org_member(organization_id));

create policy outbound_messages_select_org on public.outbound_messages
for select to authenticated
using (public.is_org_member(organization_id));
create policy outbound_messages_insert_org on public.outbound_messages
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy outbound_messages_update_org on public.outbound_messages
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy outbound_messages_delete_org on public.outbound_messages
for delete to authenticated
using (public.is_org_member(organization_id));

create policy suppression_entries_select_org on public.suppression_entries
for select to authenticated
using (public.is_org_member(organization_id));
create policy suppression_entries_insert_org on public.suppression_entries
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy suppression_entries_update_org on public.suppression_entries
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy suppression_entries_delete_org on public.suppression_entries
for delete to authenticated
using (public.is_org_member(organization_id));

create policy audit_events_select_org on public.audit_events
for select to authenticated
using (public.is_org_member(organization_id));
create policy audit_events_insert_org on public.audit_events
for insert to authenticated
with check (public.is_org_member(organization_id));

-- 10) Manual Campaign Workspace RPCs (OUTREACH-02R)

alter type public.activity_type add value if not exists 'campaign_added';
alter type public.activity_type add value if not exists 'research_saved';
alter type public.activity_type add value if not exists 'outreach_draft_saved';
alter type public.activity_type add value if not exists 'outreach_approved';
alter type public.activity_type add value if not exists 'campaign_skipped';

create or replace function public.create_manual_campaign(
  p_name text,
  p_description text,
  p_target_segment text,
  p_offer_summary text,
  p_default_channel text,
  p_default_language text,
  p_tone text
)
returns public.campaigns
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_campaign public.campaigns;
begin
  insert into public.campaigns (
    name, description, target_segment, offer_summary, default_channel, default_language, tone
  )
  values (
    p_name, nullif(btrim(p_description), ''), nullif(btrim(p_target_segment), ''),
    nullif(btrim(p_offer_summary), ''), p_default_channel, p_default_language, nullif(btrim(p_tone), '')
  )
  returning * into v_campaign;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_campaign.organization_id, 'human', auth.uid(), 'campaign.created', 'campaign', v_campaign.id,
    jsonb_build_object('status', v_campaign.status)
  );

  return v_campaign;
end;
$$;

create or replace function public.update_manual_campaign(
  p_campaign_id uuid,
  p_name text,
  p_description text,
  p_target_segment text,
  p_offer_summary text,
  p_default_channel text,
  p_default_language text,
  p_tone text,
  p_status text
)
returns public.campaigns
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_campaign public.campaigns;
begin
  update public.campaigns
  set
    name = p_name,
    description = nullif(btrim(p_description), ''),
    target_segment = nullif(btrim(p_target_segment), ''),
    offer_summary = nullif(btrim(p_offer_summary), ''),
    default_channel = p_default_channel,
    default_language = p_default_language,
    tone = nullif(btrim(p_tone), ''),
    status = p_status
  where id = p_campaign_id
  returning * into v_campaign;

  if v_campaign.id is null then
    raise exception 'Campaign not found or permission denied' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_campaign.organization_id, 'human', auth.uid(), 'campaign.updated', 'campaign', v_campaign.id,
    jsonb_build_object('status', v_campaign.status)
  );

  return v_campaign;
end;
$$;

create or replace function public.add_campaign_members(
  p_campaign_id uuid,
  p_lead_ids uuid[]
)
returns table (
  lead_id uuid,
  outcome text,
  reason text,
  campaign_member_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_campaign public.campaigns;
  v_lead public.leads;
  v_member public.campaign_members;
  v_lead_id uuid;
  v_suppressed boolean;
begin
  select c.* into v_campaign
  from public.campaigns as c
  where c.id = p_campaign_id
  for update of c;

  if v_campaign.id is null then
    raise exception 'Campaign not found or permission denied' using errcode = 'P0002';
  end if;

  foreach v_lead_id in array p_lead_ids loop
    v_lead := null;
    v_member := null;
    v_suppressed := false;

    select l.* into v_lead
    from public.leads as l
    where l.id = v_lead_id
      and l.org_id = v_campaign.organization_id;

    if v_lead.id is null then
      lead_id := v_lead_id;
      outcome := 'ineligible';
      reason := 'Lead is unavailable in this organization.';
      campaign_member_id := null;
      return next;
      continue;
    end if;

    if v_lead.status <> 'active' then
      lead_id := v_lead.id;
      outcome := 'archived';
      reason := 'Lead is archived.';
      campaign_member_id := null;
      return next;
      continue;
    end if;

    select exists (
      select 1
      from public.suppression_entries as s
      where s.organization_id = v_campaign.organization_id
        and s.is_active
        and (s.expires_at is null or s.expires_at > now())
        and (
          (s.subject_type = 'lead' and s.subject_value_normalized = lower(v_lead.id::text))
          or (s.subject_type = 'email' and v_lead.email_norm is not null and s.subject_value_normalized = v_lead.email_norm)
          or (s.subject_type = 'domain' and v_lead.website_domain_norm is not null and s.subject_value_normalized = v_lead.website_domain_norm)
        )
    ) into v_suppressed;

    if v_suppressed then
      insert into public.audit_events (
        organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
      )
      values (
        v_campaign.organization_id, 'human', auth.uid(), 'campaign_member.suppressed', 'lead', v_lead.id,
        jsonb_build_object('campaign_id', v_campaign.id)
      );

      lead_id := v_lead.id;
      outcome := 'suppressed';
      reason := 'A lead, email, or domain suppression entry is active.';
      campaign_member_id := null;
      return next;
      continue;
    end if;

    if coalesce(nullif(btrim(v_lead.email), ''), nullif(btrim(v_lead.phone), ''), nullif(btrim(v_lead.website), '')) is null then
      lead_id := v_lead.id;
      outcome := 'needs_information';
      reason := 'No contact channel is available.';
      campaign_member_id := null;
      return next;
      continue;
    end if;

    insert into public.campaign_members (organization_id, campaign_id, lead_id)
    values (v_campaign.organization_id, v_campaign.id, v_lead.id)
    on conflict on constraint campaign_members_campaign_id_lead_id_key do nothing
    returning * into v_member;

    if v_member.id is null then
      lead_id := v_lead.id;
      outcome := 'already_added';
      reason := 'Lead is already a member of this campaign.';
      campaign_member_id := null;
      return next;
      continue;
    end if;

    insert into public.audit_events (
      organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
    )
    values (
      v_campaign.organization_id, 'human', auth.uid(), 'campaign_member.added', 'campaign_member', v_member.id,
      jsonb_build_object('campaign_id', v_campaign.id, 'lead_id', v_lead.id)
    );

    insert into public.activities (org_id, lead_id, type, meta)
    values (
      v_campaign.organization_id, v_lead.id, 'campaign_added',
      jsonb_build_object('campaign_id', v_campaign.id, 'campaign_member_id', v_member.id)
    );

    lead_id := v_lead.id;
    outcome := 'eligible';
    reason := null;
    campaign_member_id := v_member.id;
    return next;
  end loop;
end;
$$;

create or replace function public.save_manual_research_snapshot(
  p_campaign_member_id uuid,
  p_observed_opportunity text,
  p_recommended_offer text,
  p_recommended_case text,
  p_evidence jsonb,
  p_confidence numeric,
  p_warnings jsonb
)
returns public.research_snapshots
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member public.campaign_members;
  v_snapshot public.research_snapshots;
  v_version integer;
begin
  select * into v_member
  from public.campaign_members
  where id = p_campaign_member_id
  for update;

  if v_member.id is null then
    raise exception 'Campaign member not found or permission denied' using errcode = 'P0002';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.research_snapshots
  where campaign_member_id = v_member.id;

  insert into public.research_snapshots (
    organization_id, campaign_member_id, version, source, observed_opportunity,
    recommended_offer, recommended_case, evidence, confidence, warnings
  )
  values (
    v_member.organization_id, v_member.id, v_version, 'manual',
    nullif(btrim(p_observed_opportunity), ''), nullif(btrim(p_recommended_offer), ''),
    nullif(btrim(p_recommended_case), ''), coalesce(p_evidence, '[]'::jsonb),
    p_confidence, coalesce(p_warnings, '[]'::jsonb)
  )
  returning * into v_snapshot;

  update public.campaign_members
  set status = 'research_ready', last_error = null
  where id = v_member.id;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_member.organization_id, 'human', auth.uid(), 'research_snapshot.created', 'research_snapshot', v_snapshot.id,
    jsonb_build_object('campaign_member_id', v_member.id, 'version', v_snapshot.version)
  );

  insert into public.activities (org_id, lead_id, type, meta)
  values (
    v_member.organization_id, v_member.lead_id, 'research_saved',
    jsonb_build_object('campaign_member_id', v_member.id, 'research_snapshot_id', v_snapshot.id, 'version', v_snapshot.version)
  );

  return v_snapshot;
end;
$$;

create or replace function public.save_manual_outbound_message(
  p_campaign_member_id uuid,
  p_subject text,
  p_body text,
  p_channel text,
  p_language text,
  p_submission_status text,
  p_research_snapshot_id uuid,
  p_template_version_id uuid
)
returns public.outbound_messages
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member public.campaign_members;
  v_message public.outbound_messages;
  v_version integer;
  v_next_member_status text;
  v_channel public.activity_channel;
begin
  if p_submission_status not in ('draft', 'needs_review') then
    raise exception 'Manual messages may only be saved as draft or needs_review' using errcode = '22023';
  end if;

  v_channel := p_channel::public.activity_channel;

  select cm.* into v_member
  from public.campaign_members as cm
  where cm.id = p_campaign_member_id
  for update of cm;

  if v_member.id is null then
    raise exception 'Campaign member not found or permission denied' using errcode = 'P0002';
  end if;

  select coalesce(max(om.version), 0) + 1 into v_version
  from public.outbound_messages as om
  where om.campaign_member_id = v_member.id;

  insert into public.outbound_messages (
    organization_id, campaign_member_id, version, source, channel, language, subject, body, status,
    research_snapshot_id, template_version_id
  )
  values (
    v_member.organization_id, v_member.id, v_version, 'manual', v_channel::text, p_language,
    nullif(btrim(p_subject), ''), p_body, p_submission_status, p_research_snapshot_id, p_template_version_id
  )
  returning * into v_message;

  v_next_member_status := case when p_submission_status = 'needs_review' then 'needs_review' else 'draft_ready' end;

  update public.campaign_members as cm
  set status = v_next_member_status, last_error = null
  where cm.id = v_member.id;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_member.organization_id, 'human', auth.uid(),
    case when p_submission_status = 'needs_review' then 'outbound_message.submitted' else 'outbound_message.created' end,
    'outbound_message', v_message.id,
    jsonb_build_object('campaign_member_id', v_member.id, 'version', v_message.version, 'status', v_message.status)
  );

  insert into public.activities (org_id, lead_id, type, channel, meta)
  values (
    v_member.organization_id, v_member.lead_id, 'outreach_draft_saved', v_channel,
    jsonb_build_object('campaign_member_id', v_member.id, 'outbound_message_id', v_message.id, 'version', v_message.version, 'status', v_message.status)
  );

  return v_message;
end;
$$;

create or replace function public.approve_manual_outbound_message(
  p_outbound_message_id uuid
)
returns public.outbound_messages
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_message public.outbound_messages;
  v_member public.campaign_members;
  v_channel public.activity_channel;
begin
  select om.* into v_message
  from public.outbound_messages as om
  where om.id = p_outbound_message_id
  for update of om;

  if v_message.id is null then
    raise exception 'Outbound message not found or permission denied' using errcode = 'P0002';
  end if;

  if v_message.status <> 'needs_review' then
    raise exception 'Only a message awaiting review can be approved' using errcode = '22023';
  end if;

  v_channel := v_message.channel::public.activity_channel;

  select cm.* into v_member
  from public.campaign_members as cm
  where cm.id = v_message.campaign_member_id
  for update of cm;

  update public.outbound_messages as om
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where om.id = v_message.id
  returning * into v_message;

  update public.campaign_members as cm
  set status = 'approved', last_error = null
  where cm.id = v_member.id;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_message.organization_id, 'human', auth.uid(), 'outbound_message.approved', 'outbound_message', v_message.id,
    jsonb_build_object('campaign_member_id', v_member.id, 'version', v_message.version)
  );

  insert into public.activities (org_id, lead_id, type, channel, meta)
  values (
    v_member.organization_id, v_member.lead_id, 'outreach_approved', v_channel,
    jsonb_build_object('campaign_member_id', v_member.id, 'outbound_message_id', v_message.id, 'version', v_message.version)
  );

  return v_message;
end;
$$;

create or replace function public.skip_manual_campaign_member(
  p_campaign_member_id uuid,
  p_reason text default null
)
returns public.campaign_members
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member public.campaign_members;
begin
  select * into v_member
  from public.campaign_members
  where id = p_campaign_member_id
  for update;

  if v_member.id is null then
    raise exception 'Campaign member not found or permission denied' using errcode = 'P0002';
  end if;

  update public.campaign_members
  set status = 'skipped', skip_reason = nullif(btrim(p_reason), ''), last_error = null
  where id = v_member.id
  returning * into v_member;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_member.organization_id, 'human', auth.uid(), 'campaign_member.skipped', 'campaign_member', v_member.id,
    jsonb_build_object('reason', v_member.skip_reason)
  );

  insert into public.activities (org_id, lead_id, type, meta)
  values (
    v_member.organization_id, v_member.lead_id, 'campaign_skipped',
    jsonb_build_object('campaign_member_id', v_member.id, 'reason', v_member.skip_reason)
  );

  return v_member;
end;
$$;

revoke all on function public.create_manual_campaign(text, text, text, text, text, text, text) from public;
revoke all on function public.update_manual_campaign(uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function public.add_campaign_members(uuid, uuid[]) from public;
revoke all on function public.save_manual_research_snapshot(uuid, text, text, text, jsonb, numeric, jsonb) from public;
revoke all on function public.save_manual_outbound_message(uuid, text, text, text, text, text, uuid, uuid) from public;
revoke all on function public.approve_manual_outbound_message(uuid) from public;
revoke all on function public.skip_manual_campaign_member(uuid, text) from public;

grant execute on function public.create_manual_campaign(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_manual_campaign(uuid, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.add_campaign_members(uuid, uuid[]) to authenticated;
grant execute on function public.save_manual_research_snapshot(uuid, text, text, text, jsonb, numeric, jsonb) to authenticated;
grant execute on function public.save_manual_outbound_message(uuid, text, text, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.approve_manual_outbound_message(uuid) to authenticated;
grant execute on function public.skip_manual_campaign_member(uuid, text) to authenticated;

-- 17) Product Bridge transactional staging seam (CRM-PBG-02A)

-- CRM-PBG-02A adds a CRM-owned durable staging seam. It is intentionally not
-- exposed by the Product Adapter in this checkpoint.

alter table public.research_snapshots
  drop constraint research_snapshots_source_check;
alter table public.research_snapshots
  add constraint research_snapshots_source_check
  check (source in ('manual', 'ai', 'imported', 'bridge'));

alter table public.outbound_messages
  drop constraint outbound_messages_source_check;
alter table public.outbound_messages
  add constraint outbound_messages_source_check
  check (source in ('manual', 'template', 'ai', 'bridge'));

create table public.product_bridge_write_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  product_id text not null check (product_id = 'sprint-crm'),
  operation_id text not null check (operation_id in (
    'crm.research.stageSnapshot',
    'crm.email.stageDraft'
  )),
  idempotency_key text not null check (
    char_length(idempotency_key) between 1 and 200
    and idempotency_key = btrim(idempotency_key)
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  semantic_fingerprint text not null check (
    semantic_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  receipt jsonb,
  staged_entity_type text check (staged_entity_type in ('research_snapshot', 'outbound_message')),
  staged_entity_id uuid,
  provenance jsonb not null default '{}'::jsonb check (
    jsonb_typeof(provenance) = 'object'
    and octet_length(provenance::text) <= 4096
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint product_bridge_write_requests_completion_check check (
    (status = 'pending' and receipt is null and completed_at is null
      and staged_entity_type is null and staged_entity_id is null)
    or
    (status = 'completed' and receipt is not null and completed_at is not null
      and staged_entity_type is not null and staged_entity_id is not null
      and jsonb_typeof(receipt) = 'object'
      and octet_length(receipt::text) <= 16384)
  ),
  constraint product_bridge_write_requests_address_key
    unique (organization_id, product_id, operation_id, idempotency_key)
);

create index idx_product_bridge_write_requests_pending_lease
  on public.product_bridge_write_requests(lease_expires_at)
  where status = 'pending';

alter table public.product_bridge_write_requests enable row level security;
revoke all on table public.product_bridge_write_requests from public, anon, authenticated;

create trigger trg_product_bridge_write_requests_set_updated_at
before update on public.product_bridge_write_requests
for each row execute function public.set_updated_at();

create or replace function public.product_bridge_json_object_has_only_keys(
  p_value jsonb,
  p_allowed_keys text[]
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if jsonb_typeof(p_value) <> 'object' then return false; end if;
  return not exists (
    select 1
    from jsonb_object_keys(p_value) as object_key(key)
    where not (object_key.key = any(p_allowed_keys))
  );
end;
$$;

create or replace function public.product_bridge_json_has_forbidden_key(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      if lower(v_key) ~ '^(authorization|access.?token|refresh.?token|jwt|secret|password|api.?key|publishable.?key|prompt|message.?body|draft.?body|research.?text|observed.?opportunity|recommended.?offer|recommended.?case|evidence|warnings|subject|body)$' then
        return true;
      end if;
      if public.product_bridge_json_has_forbidden_key(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.product_bridge_json_has_forbidden_key(v_child) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create or replace function public.product_bridge_valid_provenance(
  p_value jsonb,
  p_organization_id uuid,
  p_operation_id text,
  p_campaign_member_id uuid,
  p_source_snapshot_id text,
  p_staged_entity_id uuid,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  return coalesce(public.product_bridge_json_object_has_only_keys(
      p_value,
      array[
        'productId', 'operationId', 'requestId', 'correlationId', 'actorSubject',
        'organizationId', 'campaignMemberId', 'sourceSnapshotId',
        'stagedEntityId', 'timestamp'
      ]
    )
    and octet_length(p_value::text) <= 4096
    and p_value ->> 'productId' = 'sprint-crm'
    and p_value ->> 'operationId' = p_operation_id
    and p_value ->> 'organizationId' = p_organization_id::text
    and p_value ->> 'campaignMemberId' = p_campaign_member_id::text
    and p_value ->> 'sourceSnapshotId' = p_source_snapshot_id
    and p_value ->> 'stagedEntityId' = p_staged_entity_id::text
    and p_value ->> 'actorSubject' = 'user:' || p_actor_user_id::text
    and char_length(coalesce(p_value ->> 'requestId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'correlationId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'timestamp', '')) between 20 and 40
    and p_value ->> 'requestId' !~ '[[:cntrl:]]'
    and p_value ->> 'correlationId' !~ '[[:cntrl:]]'
    and p_value ->> 'timestamp' !~ '[[:cntrl:]]'
    and not public.product_bridge_json_has_forbidden_key(p_value), false);
end;
$$;

create or replace function public.product_bridge_valid_safe_diagnostics(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_text text;
begin
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 5 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(v_item) <> 'string' then return false; end if;
    v_text := v_item #>> '{}';
    if char_length(v_text) not between 1 and 200 or v_text ~ '[[:cntrl:]]' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.product_bridge_valid_receipt(
  p_value jsonb,
  p_staged_entity_id uuid,
  p_source_snapshot_id text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  return coalesce(public.product_bridge_json_object_has_only_keys(
      p_value,
      array[
        'schemaVersion', 'receiptId', 'requestId', 'correlationId', 'productId',
        'operationId', 'operationClass', 'status', 'timestamp', 'result',
        'sourceSnapshotId', 'resultSnapshotId', 'stagedEntityId', 'validation',
        'approval', 'provenance', 'diagnosticsSafe', 'metadataSafe'
      ]
    )
    and octet_length(p_value::text) <= 16384
    and p_value ->> 'productId' = 'sprint-crm'
    and p_value ->> 'operationClass' = 'STAGED_WRITE'
    and p_value ->> 'status' = 'staged'
    and p_value ->> 'stagedEntityId' = p_staged_entity_id::text
    and p_value ->> 'sourceSnapshotId' = p_source_snapshot_id
    and char_length(coalesce(p_value ->> 'schemaVersion', '')) between 1 and 40
    and char_length(coalesce(p_value ->> 'receiptId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'requestId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'correlationId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'operationId', '')) between 1 and 100
    and char_length(coalesce(p_value ->> 'timestamp', '')) between 20 and 40
    and p_value ->> 'operationId' in ('stage_snapshot', 'stage_draft')
    and p_value ->> 'requestId' !~ '[[:cntrl:]]'
    and p_value ->> 'correlationId' !~ '[[:cntrl:]]'
    and p_value ->> 'timestamp' !~ '[[:cntrl:]]'
    and jsonb_typeof(p_value -> 'result') = 'object'
    and public.product_bridge_json_object_has_only_keys(
      p_value -> 'result',
      array['entityType', 'entityId', 'version', 'status', 'campaignMemberId', 'researchSnapshotId', 'researchVersion']
    )
    and p_value #>> '{result,entityId}' = p_staged_entity_id::text
    and jsonb_typeof(p_value #> '{result,version}') = 'number'
    and (p_value #>> '{result,version}')::integer >= 1
    and (
      (p_value ->> 'operationId' = 'stage_snapshot'
        and p_value #>> '{result,entityType}' = 'research_snapshot'
        and p_value #>> '{result,status}' = 'research_ready')
      or
      (p_value ->> 'operationId' = 'stage_draft'
        and p_value #>> '{result,entityType}' = 'outbound_message'
        and p_value #>> '{result,status}' = 'draft')
    )
    and public.product_bridge_json_object_has_only_keys(
      p_value -> 'validation', array['state', 'diagnosticsSafe']
    )
    and coalesce(p_value #>> '{validation,state}', '') = 'pending'
    and (
      not ((p_value -> 'validation') ? 'diagnosticsSafe')
      or public.product_bridge_valid_safe_diagnostics(p_value #> '{validation,diagnosticsSafe}')
    )
    and public.product_bridge_json_object_has_only_keys(
      p_value -> 'approval', array['state', 'diagnosticsSafe']
    )
    and coalesce(p_value #>> '{approval,state}', '') = 'pending'
    and (
      not ((p_value -> 'approval') ? 'diagnosticsSafe')
      or public.product_bridge_valid_safe_diagnostics(p_value #> '{approval,diagnosticsSafe}')
    )
    and (not (p_value ? 'diagnosticsSafe')
      or public.product_bridge_valid_safe_diagnostics(p_value -> 'diagnosticsSafe'))
    and not (p_value ? 'provenance')
    and not (p_value ? 'metadataSafe')
    and not public.product_bridge_json_has_forbidden_key(p_value), false);
end;
$$;

create or replace function public.product_bridge_valid_research_evidence(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_url text;
  v_note text;
  v_seen text[] := array[]::text[];
  v_normalized text;
begin
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) not between 1 and 3 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_value)
  loop
    if not public.product_bridge_json_object_has_only_keys(v_item, array['url', 'note'])
       or not (v_item ? 'url') or not (v_item ? 'note') then
      return false;
    end if;
    v_url := v_item ->> 'url';
    v_note := v_item ->> 'note';
    if v_url is null or v_url <> btrim(v_url)
       or char_length(v_url) not between 9 and 2048
       or v_url !~ '^https://[^[:space:]]+$'
       or v_url ~ '[[:cntrl:]]'
       or v_note is null or v_note <> btrim(v_note)
       or char_length(v_note) not between 20 and 350
       or v_note ~ '[[:cntrl:]]' then
      return false;
    end if;
    v_normalized := lower(rtrim(v_url, '/'));
    if v_normalized = any(v_seen) then
      return false;
    end if;
    v_seen := array_append(v_seen, v_normalized);
  end loop;

  return true;
end;
$$;

create or replace function public.product_bridge_valid_warnings(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_text text;
begin
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 5 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(v_item) <> 'string' then
      return false;
    end if;
    v_text := v_item #>> '{}';
    if v_text <> btrim(v_text) or char_length(v_text) not between 1 and 300
       or v_text ~ '[[:cntrl:]]' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.product_bridge_require_actor(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if auth.role() <> 'authenticated' or v_actor is null then
    raise exception 'Product Bridge staging is unavailable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships as membership
    where membership.org_id = p_organization_id and membership.user_id = v_actor
  ) then
    raise exception 'Product Bridge staging is unavailable' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.product_bridge_staging_context_version(
  p_organization_id uuid,
  p_campaign_member_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_member public.campaign_members;
  v_campaign public.campaigns;
  v_lead public.leads;
  v_research public.research_snapshots;
  v_message public.outbound_messages;
  v_canonical text;
begin
  select member.* into v_member
  from public.campaign_members as member
  where member.id = p_campaign_member_id
    and member.organization_id = p_organization_id;
  if v_member.id is null then return null; end if;

  select campaign.* into v_campaign
  from public.campaigns as campaign
  where campaign.id = v_member.campaign_id
    and campaign.organization_id = p_organization_id;
  select lead.* into v_lead
  from public.leads as lead
  where lead.id = v_member.lead_id and lead.org_id = p_organization_id;
  if v_campaign.id is null or v_lead.id is null then return null; end if;

  select snapshot.* into v_research
  from public.research_snapshots as snapshot
  where snapshot.campaign_member_id = v_member.id
    and snapshot.organization_id = p_organization_id
  order by snapshot.version desc
  limit 1;

  select message.* into v_message
  from public.outbound_messages as message
  where message.campaign_member_id = v_member.id
    and message.organization_id = p_organization_id
  order by message.version desc
  limit 1;

  v_canonical := jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignMemberId', v_member.id,
    'memberStatus', v_member.status,
    'memberUpdatedAt', v_member.updated_at,
    'campaignId', v_campaign.id,
    'campaignChannel', v_campaign.default_channel,
    'campaignLanguage', v_campaign.default_language,
    'campaignUpdatedAt', v_campaign.updated_at,
    'leadId', v_lead.id,
    'leadLanguage', v_lead.language,
    'leadUpdatedAt', v_lead.updated_at,
    'researchId', v_research.id,
    'researchVersion', v_research.version,
    'researchCreatedAt', v_research.created_at,
    'messageId', v_message.id,
    'messageVersion', v_message.version,
    'messageStatus', v_message.status,
    'messageUpdatedAt', v_message.updated_at
  )::text;

  return 'sha256:' || encode(digest(convert_to(v_canonical, 'UTF8'), 'sha256'), 'hex');
end;
$$;

create or replace function public.get_product_bridge_staging_context(
  p_expected_organization_id uuid,
  p_campaign_member_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor uuid;
  v_member public.campaign_members;
  v_campaign public.campaigns;
  v_lead public.leads;
  v_research public.research_snapshots;
  v_message public.outbound_messages;
  v_version text;
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);

  select member.* into v_member
  from public.campaign_members as member
  where member.id = p_campaign_member_id
    and member.organization_id = p_expected_organization_id;
  if v_member.id is null then
    raise exception 'Product Bridge staging context is unavailable' using errcode = 'P0002';
  end if;

  select campaign.* into v_campaign
  from public.campaigns as campaign
  where campaign.id = v_member.campaign_id
    and campaign.organization_id = p_expected_organization_id;
  select lead.* into v_lead
  from public.leads as lead
  where lead.id = v_member.lead_id and lead.org_id = p_expected_organization_id;
  if v_campaign.id is null or v_lead.id is null then
    raise exception 'Product Bridge staging context is unavailable' using errcode = 'P0002';
  end if;

  select snapshot.* into v_research
  from public.research_snapshots as snapshot
  where snapshot.campaign_member_id = v_member.id
    and snapshot.organization_id = p_expected_organization_id
  order by snapshot.version desc limit 1;
  select message.* into v_message
  from public.outbound_messages as message
  where message.campaign_member_id = v_member.id
    and message.organization_id = p_expected_organization_id
  order by message.version desc limit 1;

  v_version := public.product_bridge_staging_context_version(
    p_expected_organization_id, p_campaign_member_id
  );
  if v_version is null then
    raise exception 'Product Bridge staging context is unavailable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'organizationId', p_expected_organization_id,
    'actorSubject', 'user:' || v_actor::text,
    'campaignMember', jsonb_build_object(
      'id', v_member.id, 'status', v_member.status, 'updatedAt', v_member.updated_at
    ),
    'campaign', jsonb_build_object(
      'id', v_campaign.id, 'channel', v_campaign.default_channel,
      'defaultLanguage', v_campaign.default_language, 'updatedAt', v_campaign.updated_at
    ),
    'lead', jsonb_build_object(
      'language', v_lead.language, 'updatedAt', v_lead.updated_at
    ),
    'latestResearch', case when v_research.id is null then null else jsonb_build_object(
      'id', v_research.id, 'version', v_research.version, 'createdAt', v_research.created_at
    ) end,
    'latestOutboundMessage', case when v_message.id is null then null else jsonb_build_object(
      'id', v_message.id, 'version', v_message.version,
      'status', v_message.status, 'updatedAt', v_message.updated_at
    ) end,
    'freshness', jsonb_build_object(
      'subjectType', 'campaign_member_staging_context',
      'subjectId', v_member.id,
      'version', v_version,
      'generatedAt', now()
    )
  );
end;
$$;

create or replace function public.claim_product_bridge_write(
  p_expected_organization_id uuid,
  p_operation_id text,
  p_idempotency_key text,
  p_semantic_fingerprint text,
  p_claim_token uuid,
  p_lease_seconds integer,
  p_provenance jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
  v_request public.product_bridge_write_requests;
  v_inserted boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);
  if p_operation_id not in ('crm.research.stageSnapshot', 'crm.email.stageDraft')
     or p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 200
     or p_idempotency_key ~ '[[:cntrl:]]'
     or p_semantic_fingerprint !~ '^sha256:[0-9a-f]{64}$'
     or p_claim_token is null
     or p_lease_seconds not between 15 and 300
     or jsonb_typeof(p_provenance) <> 'object'
     or octet_length(p_provenance::text) > 4096
     or not (
       case
         when coalesce(p_provenance ->> 'campaignMemberId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and coalesce(p_provenance ->> 'stagedEntityId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and coalesce(p_provenance ->> 'sourceSnapshotId', '') ~ '^sha256:[0-9a-f]{64}$'
         then public.product_bridge_valid_provenance(
           p_provenance, p_expected_organization_id, p_operation_id,
           (p_provenance ->> 'campaignMemberId')::uuid,
           p_provenance ->> 'sourceSnapshotId',
           (p_provenance ->> 'stagedEntityId')::uuid,
           v_actor
         )
         else false
       end
     ) then
    raise exception 'Invalid Product Bridge write claim' using errcode = '22023';
  end if;

  insert into public.product_bridge_write_requests as request (
    organization_id, actor_user_id, product_id, operation_id, idempotency_key,
    semantic_fingerprint, claim_token, lease_expires_at, provenance
  ) values (
    p_expected_organization_id, v_actor, 'sprint-crm', p_operation_id,
    p_idempotency_key, p_semantic_fingerprint, p_claim_token,
    v_now + make_interval(secs => p_lease_seconds), p_provenance
  )
  on conflict on constraint product_bridge_write_requests_address_key do nothing
  returning true into v_inserted;

  select request.* into v_request
  from public.product_bridge_write_requests as request
  where request.organization_id = p_expected_organization_id
    and request.product_id = 'sprint-crm'
    and request.operation_id = p_operation_id
    and request.idempotency_key = p_idempotency_key
  for update of request;

  if v_request.id is null then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;
  if v_request.actor_user_id <> v_actor
     or v_request.semantic_fingerprint <> p_semantic_fingerprint then
    return jsonb_build_object('outcome', 'CONFLICT');
  end if;
  if v_request.status = 'completed' then
    return jsonb_build_object('outcome', 'REPLAY', 'receipt', v_request.receipt);
  end if;
  if coalesce(v_inserted, false) then
    return jsonb_build_object(
      'outcome', 'CLAIMED', 'requestLedgerId', v_request.id,
      'leaseExpiresAt', v_request.lease_expires_at
    );
  end if;
  if v_request.lease_expires_at > v_now then
    return jsonb_build_object('outcome', 'IN_PROGRESS');
  end if;

  update public.product_bridge_write_requests as request
  set claim_token = p_claim_token,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      provenance = p_provenance
  where request.id = v_request.id
  returning request.* into v_request;

  return jsonb_build_object(
    'outcome', 'CLAIMED', 'requestLedgerId', v_request.id,
    'leaseExpiresAt', v_request.lease_expires_at, 'reclaimed', true
  );
end;
$$;

create or replace function public.release_product_bridge_write(
  p_expected_organization_id uuid,
  p_operation_id text,
  p_idempotency_key text,
  p_semantic_fingerprint text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
  v_deleted uuid;
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);
  delete from public.product_bridge_write_requests as request
  where request.organization_id = p_expected_organization_id
    and request.actor_user_id = v_actor
    and request.product_id = 'sprint-crm'
    and request.operation_id = p_operation_id
    and request.idempotency_key = p_idempotency_key
    and request.semantic_fingerprint = p_semantic_fingerprint
    and request.claim_token = p_claim_token
    and request.status = 'pending'
  returning request.id into v_deleted;
  return v_deleted is not null;
end;
$$;

create or replace function public.stage_product_bridge_research_snapshot(
  p_expected_organization_id uuid,
  p_idempotency_key text,
  p_semantic_fingerprint text,
  p_claim_token uuid,
  p_campaign_member_id uuid,
  p_source_snapshot_id text,
  p_staged_entity_id uuid,
  p_expected_version integer,
  p_observed_opportunity text,
  p_recommended_offer text,
  p_evidence jsonb,
  p_recommended_case text,
  p_confidence numeric,
  p_warnings jsonb,
  p_provenance jsonb,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor uuid;
  v_request public.product_bridge_write_requests;
  v_member public.campaign_members;
  v_current_freshness text;
  v_next_version integer;
  v_snapshot public.research_snapshots;
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);
  select request.* into v_request
  from public.product_bridge_write_requests as request
  where request.organization_id = p_expected_organization_id
    and request.product_id = 'sprint-crm'
    and request.operation_id = 'crm.research.stageSnapshot'
    and request.idempotency_key = p_idempotency_key
  for update of request;

  if v_request.id is null or v_request.actor_user_id <> v_actor
     or v_request.semantic_fingerprint <> p_semantic_fingerprint then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;
  if v_request.status = 'completed' then
    return jsonb_build_object('outcome', 'REPLAY', 'receipt', v_request.receipt);
  end if;
  if v_request.claim_token <> p_claim_token or v_request.lease_expires_at <= clock_timestamp() then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;

  if p_source_snapshot_id !~ '^sha256:[0-9a-f]{64}$'
     or p_staged_entity_id is null or p_expected_version < 1
     or p_observed_opportunity is null or p_observed_opportunity <> btrim(p_observed_opportunity)
     or char_length(p_observed_opportunity) not between 50 and 900
     or p_observed_opportunity ~ '[[:cntrl:]]'
     or p_recommended_offer is null or p_recommended_offer <> btrim(p_recommended_offer)
     or char_length(p_recommended_offer) not between 30 and 700
     or p_recommended_offer ~ '[[:cntrl:]]'
     or (p_recommended_case is not null and (
       p_recommended_case <> btrim(p_recommended_case)
       or char_length(p_recommended_case) not between 1 and 700
       or p_recommended_case ~ '[[:cntrl:]]'
     ))
     or (p_confidence is not null and (
       p_confidence::text = 'NaN' or p_confidence < 0 or p_confidence > 0.85
     ))
     or not public.product_bridge_valid_research_evidence(p_evidence)
     or not public.product_bridge_valid_warnings(p_warnings)
     or not public.product_bridge_valid_provenance(
       p_provenance, p_expected_organization_id, 'crm.research.stageSnapshot',
       p_campaign_member_id, p_source_snapshot_id, p_staged_entity_id, v_actor
     )
     or not public.product_bridge_valid_receipt(
       p_receipt, p_staged_entity_id, p_source_snapshot_id
     ) then
    raise exception 'Invalid staged research snapshot' using errcode = '22023';
  end if;

  select member.* into v_member
  from public.campaign_members as member
  where member.id = p_campaign_member_id
    and member.organization_id = p_expected_organization_id
  for update of member;
  if v_member.id is null then
    raise exception 'Product Bridge staging target is unavailable' using errcode = 'P0002';
  end if;

  v_current_freshness := public.product_bridge_staging_context_version(
    p_expected_organization_id, p_campaign_member_id
  );
  if v_current_freshness is null or v_current_freshness <> p_source_snapshot_id then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;
  if v_member.status not in ('queued', 'researching', 'research_ready') then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'INVALID_STATE');
  end if;

  select coalesce(max(snapshot.version), 0) + 1 into v_next_version
  from public.research_snapshots as snapshot
  where snapshot.campaign_member_id = v_member.id;
  if v_next_version <> p_expected_version then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;

  insert into public.research_snapshots as snapshot (
    id, organization_id, campaign_member_id, version, source,
    observed_opportunity, recommended_offer, recommended_case,
    evidence, confidence, warnings, ai_generation_id, created_by
  ) values (
    p_staged_entity_id, p_expected_organization_id, v_member.id, v_next_version, 'bridge',
    p_observed_opportunity, p_recommended_offer, p_recommended_case,
    p_evidence, p_confidence, p_warnings, null, v_actor
  ) returning snapshot.* into v_snapshot;

  update public.campaign_members as member
  set status = 'research_ready', last_error = null
  where member.id = v_member.id;

  insert into public.audit_events as audit_event (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_expected_organization_id, 'human', v_actor,
    'product_bridge.research.staged', 'research_snapshot', v_snapshot.id,
    jsonb_build_object(
      'campaign_member_id', v_member.id, 'version', v_snapshot.version, 'source', 'bridge',
      'request_id', p_provenance ->> 'requestId',
      'correlation_id', p_provenance ->> 'correlationId',
      'source_snapshot_id', p_source_snapshot_id,
      'product_bridge_write_request_id', v_request.id
    )
  );
  insert into public.activities as activity (org_id, owner, lead_id, type, meta)
  values (
    p_expected_organization_id, v_actor, v_member.lead_id, 'research_saved',
    jsonb_build_object(
      'campaign_member_id', v_member.id, 'research_snapshot_id', v_snapshot.id,
      'version', v_snapshot.version, 'source', 'bridge'
    )
  );

  update public.product_bridge_write_requests as request
  set status = 'completed', receipt = p_receipt,
      staged_entity_type = 'research_snapshot', staged_entity_id = v_snapshot.id,
      provenance = p_provenance, completed_at = clock_timestamp(),
      lease_expires_at = clock_timestamp()
  where request.id = v_request.id;

  return jsonb_build_object(
    'outcome', 'COMPLETED', 'receipt', p_receipt,
    'stagedEntity', jsonb_build_object(
      'type', 'research_snapshot', 'id', v_snapshot.id,
      'version', v_snapshot.version, 'status', 'research_ready'
    )
  );
end;
$$;

create or replace function public.stage_product_bridge_email_draft(
  p_expected_organization_id uuid,
  p_idempotency_key text,
  p_semantic_fingerprint text,
  p_claim_token uuid,
  p_campaign_member_id uuid,
  p_source_snapshot_id text,
  p_staged_entity_id uuid,
  p_expected_version integer,
  p_research_snapshot_id uuid,
  p_subject text,
  p_body text,
  p_language text,
  p_provenance jsonb,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor uuid;
  v_request public.product_bridge_write_requests;
  v_member public.campaign_members;
  v_campaign public.campaigns;
  v_research public.research_snapshots;
  v_current_freshness text;
  v_next_version integer;
  v_message public.outbound_messages;
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);
  select request.* into v_request
  from public.product_bridge_write_requests as request
  where request.organization_id = p_expected_organization_id
    and request.product_id = 'sprint-crm'
    and request.operation_id = 'crm.email.stageDraft'
    and request.idempotency_key = p_idempotency_key
  for update of request;

  if v_request.id is null or v_request.actor_user_id <> v_actor
     or v_request.semantic_fingerprint <> p_semantic_fingerprint then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;
  if v_request.status = 'completed' then
    return jsonb_build_object('outcome', 'REPLAY', 'receipt', v_request.receipt);
  end if;
  if v_request.claim_token <> p_claim_token or v_request.lease_expires_at <= clock_timestamp() then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;

  if p_source_snapshot_id !~ '^sha256:[0-9a-f]{64}$'
     or p_staged_entity_id is null or p_expected_version < 1
     or p_research_snapshot_id is null
     or p_subject is null or p_subject <> btrim(p_subject)
     or char_length(p_subject) not between 5 and 120
     or p_subject ~ '[[:cntrl:]]'
     or p_subject ~ '[<>]' or p_subject ~ '[{}]|<<|>>|\[\[|\]\]'
     or p_body is null or p_body <> btrim(p_body)
     or char_length(p_body) not between 120 and 2400
     or regexp_replace(p_body, E'[\\n\\r\\t]', '', 'g') ~ '[[:cntrl:]]'
     or p_body ~ '[<>]' or p_body ~ '[{}]|<<|>>|\[\[|\]\]'
     or p_language not in ('en', 'es', 'uk', 'ru')
     or not public.product_bridge_valid_provenance(
       p_provenance, p_expected_organization_id, 'crm.email.stageDraft',
       p_campaign_member_id, p_source_snapshot_id, p_staged_entity_id, v_actor
     )
     or not public.product_bridge_valid_receipt(
       p_receipt, p_staged_entity_id, p_source_snapshot_id
     ) then
    raise exception 'Invalid staged email draft' using errcode = '22023';
  end if;

  select member.* into v_member
  from public.campaign_members as member
  where member.id = p_campaign_member_id
    and member.organization_id = p_expected_organization_id
  for update of member;
  if v_member.id is null then
    raise exception 'Product Bridge staging target is unavailable' using errcode = 'P0002';
  end if;
  select campaign.* into v_campaign
  from public.campaigns as campaign
  where campaign.id = v_member.campaign_id
    and campaign.organization_id = p_expected_organization_id
  for key share of campaign;
  if v_campaign.id is null or v_campaign.default_channel <> 'email' then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'INVALID_STATE');
  end if;

  v_current_freshness := public.product_bridge_staging_context_version(
    p_expected_organization_id, p_campaign_member_id
  );
  if v_current_freshness is null or v_current_freshness <> p_source_snapshot_id then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;
  if v_member.status not in ('research_ready', 'draft_ready') then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'INVALID_STATE');
  end if;

  select snapshot.* into v_research
  from public.research_snapshots as snapshot
  where snapshot.campaign_member_id = v_member.id
    and snapshot.organization_id = p_expected_organization_id
  order by snapshot.version desc limit 1
  for key share of snapshot;
  if v_research.id is null or v_research.id <> p_research_snapshot_id then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;

  select coalesce(max(message.version), 0) + 1 into v_next_version
  from public.outbound_messages as message
  where message.campaign_member_id = v_member.id;
  if v_next_version <> p_expected_version then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;

  insert into public.outbound_messages as message (
    id, organization_id, campaign_member_id, version, source, channel, language,
    subject, body, status, research_snapshot_id, template_version_id,
    ai_generation_id, approved_by, approved_at, sent_at, created_by
  ) values (
    p_staged_entity_id, p_expected_organization_id, v_member.id, v_next_version,
    'bridge', 'email', p_language, p_subject, p_body, 'draft',
    v_research.id, null, null, null, null, null, v_actor
  ) returning message.* into v_message;

  update public.campaign_members as member
  set status = 'draft_ready', last_error = null
  where member.id = v_member.id;

  insert into public.audit_events as audit_event (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_expected_organization_id, 'human', v_actor,
    'product_bridge.email_draft.staged', 'outbound_message', v_message.id,
    jsonb_build_object(
      'campaign_member_id', v_member.id, 'version', v_message.version,
      'status', v_message.status, 'source', 'bridge',
      'research_snapshot_id', v_research.id, 'research_version', v_research.version,
      'request_id', p_provenance ->> 'requestId',
      'correlation_id', p_provenance ->> 'correlationId',
      'source_snapshot_id', p_source_snapshot_id,
      'product_bridge_write_request_id', v_request.id
    )
  );
  insert into public.activities as activity (org_id, owner, lead_id, type, channel, meta)
  values (
    p_expected_organization_id, v_actor, v_member.lead_id,
    'outreach_draft_saved', 'email',
    jsonb_build_object(
      'campaign_member_id', v_member.id, 'outbound_message_id', v_message.id,
      'version', v_message.version, 'status', 'draft', 'source', 'bridge',
      'research_snapshot_id', v_research.id, 'research_version', v_research.version
    )
  );

  update public.product_bridge_write_requests as request
  set status = 'completed', receipt = p_receipt,
      staged_entity_type = 'outbound_message', staged_entity_id = v_message.id,
      provenance = p_provenance, completed_at = clock_timestamp(),
      lease_expires_at = clock_timestamp()
  where request.id = v_request.id;

  return jsonb_build_object(
    'outcome', 'COMPLETED', 'receipt', p_receipt,
    'stagedEntity', jsonb_build_object(
      'type', 'outbound_message', 'id', v_message.id,
      'version', v_message.version, 'status', v_message.status
    )
  );
end;
$$;

revoke all on function public.product_bridge_json_object_has_only_keys(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.product_bridge_json_has_forbidden_key(jsonb) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_provenance(jsonb, uuid, text, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_safe_diagnostics(jsonb) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_receipt(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_research_evidence(jsonb) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_warnings(jsonb) from public, anon, authenticated;
revoke all on function public.product_bridge_require_actor(uuid) from public, anon, authenticated;
revoke all on function public.product_bridge_staging_context_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_product_bridge_staging_context(uuid, uuid) from public, anon;
revoke all on function public.claim_product_bridge_write(uuid, text, text, text, uuid, integer, jsonb) from public, anon;
revoke all on function public.release_product_bridge_write(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.stage_product_bridge_research_snapshot(uuid, text, text, uuid, uuid, text, uuid, integer, text, text, jsonb, text, numeric, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.stage_product_bridge_email_draft(uuid, text, text, uuid, uuid, text, uuid, integer, uuid, text, text, text, jsonb, jsonb) from public, anon;

grant execute on function public.get_product_bridge_staging_context(uuid, uuid) to authenticated;
grant execute on function public.claim_product_bridge_write(uuid, text, text, text, uuid, integer, jsonb) to authenticated;
grant execute on function public.release_product_bridge_write(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.stage_product_bridge_research_snapshot(uuid, text, text, uuid, uuid, text, uuid, integer, text, text, jsonb, text, numeric, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.stage_product_bridge_email_draft(uuid, text, text, uuid, uuid, text, uuid, integer, uuid, text, text, text, jsonb, jsonb) to authenticated;
