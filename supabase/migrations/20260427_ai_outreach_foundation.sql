-- SprintCRM AI Outreach MVP foundation
-- Adds AI generation history, outreach snapshot fields, and AI-related activity events.

-- 1) Activity type enum values

alter type public.activity_type add value if not exists 'ai_draft_generated';
alter type public.activity_type add value if not exists 'ai_draft_applied';
alter type public.activity_type add value if not exists 'ai_draft_copied';
alter type public.activity_type add value if not exists 'outreach_sent';
alter type public.activity_type add value if not exists 'followup_scheduled';
alter type public.activity_type add value if not exists 'reply_marked';
alter type public.activity_type add value if not exists 'manual_edit';

-- 2) AI generations table

create table if not exists public.ai_generations (
  id uuid primary key default gen_random_uuid(),

  org_id uuid not null default public.current_org_id() references public.organizations(id) on delete cascade,
  owner uuid not null default auth.uid(),
  created_by uuid not null default auth.uid(),

  lead_id uuid not null references public.leads(id) on delete cascade,

  type text not null default 'outreach'
    check (type in ('outreach')),

  channel text not null default 'email'
    check (channel in ('email', 'linkedin', 'ig', 'other')),

  variant text not null default 'standard'
    check (variant in ('short', 'standard', 'premium')),

  language text not null default 'en'
    check (language in ('en', 'uk', 'es', 'ru')),

  input_snapshot jsonb not null default '{}'::jsonb,

  subject text,
  body text,
  personalization_notes text,

  model_name text,
  prompt_version text not null default 'outreach_v1',
  estimated_tokens int,

  generation_status text not null default 'completed'
    check (generation_status in ('pending', 'completed', 'failed')),

  error_message text,

  applied_to_lead boolean not null default false,
  applied_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists idx_ai_generations_org on public.ai_generations(org_id);
create index if not exists idx_ai_generations_lead on public.ai_generations(lead_id);
create index if not exists idx_ai_generations_created_at on public.ai_generations(created_at desc);

alter table public.ai_generations enable row level security;

drop policy if exists ai_generations_select_org on public.ai_generations;
create policy ai_generations_select_org
on public.ai_generations
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists ai_generations_insert_org on public.ai_generations;
create policy ai_generations_insert_org
on public.ai_generations
for insert
to authenticated
with check (public.is_org_member(org_id));

drop policy if exists ai_generations_update_org on public.ai_generations;
create policy ai_generations_update_org
on public.ai_generations
for update
to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

-- 3) Leads outreach snapshot fields

alter table public.leads
  add column if not exists preferred_channel text default 'email'
    check (preferred_channel in ('email', 'linkedin', 'ig', 'other')),

  add column if not exists language text default 'en'
    check (language in ('en', 'uk', 'es', 'ru')),

  add column if not exists service_interest text,
  add column if not exists offer_type text,
  add column if not exists observed_issue text,

  add column if not exists reply_status text default 'not_sent'
    check (reply_status in ('not_sent', 'sent', 'no_reply', 'replied', 'positive', 'negative')),

  add column if not exists current_outreach_generation_id uuid,
  add column if not exists current_outreach_subject text,
  add column if not exists current_outreach_body text,
  add column if not exists current_outreach_variant text,
  add column if not exists current_outreach_channel text,
  add column if not exists current_outreach_personalization_notes text,
  add column if not exists outreach_generated_at timestamptz,
  add column if not exists outreach_edited_manually boolean not null default false,
  add column if not exists sent_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'leads'
      and constraint_name = 'leads_current_outreach_generation_fk'
  ) then
    alter table public.leads
      add constraint leads_current_outreach_generation_fk
      foreign key (current_outreach_generation_id)
      references public.ai_generations(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_leads_reply_status on public.leads(reply_status);
create index if not exists idx_leads_sent_at on public.leads(sent_at);
create index if not exists idx_leads_current_outreach_generation_id on public.leads(current_outreach_generation_id);