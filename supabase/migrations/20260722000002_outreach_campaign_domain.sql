begin;

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

commit;
