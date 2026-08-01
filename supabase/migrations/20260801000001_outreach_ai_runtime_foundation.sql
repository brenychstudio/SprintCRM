begin;

-- OUTREACH-03A: preserve the early draft ledger while making it usable for
-- future supervised runtime jobs. Runtime probes deliberately carry no CRM
-- content and are the only new rows these RPCs may create.
alter table public.ai_generations
  alter column lead_id drop not null,
  add column if not exists job_type text,
  add column if not exists campaign_id uuid,
  add column if not exists campaign_member_id uuid,
  add column if not exists request_id uuid,
  add column if not exists provider text,
  add column if not exists provider_response_id text,
  add column if not exists provider_request_id text,
  add column if not exists schema_version text,
  add column if not exists output_payload jsonb,
  add column if not exists input_tokens integer,
  add column if not exists cached_input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists total_tokens integer,
  add column if not exists estimated_cost_usd numeric,
  add column if not exists pricing_snapshot jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists duration_ms integer,
  add column if not exists error_code text;

update public.ai_generations
set job_type = 'legacy_draft'
where job_type is null;

alter table public.ai_generations
  alter column job_type set default 'legacy_draft',
  alter column job_type set not null;

alter table public.ai_generations
  drop constraint if exists ai_generations_job_type_check,
  add constraint ai_generations_job_type_check
    check (job_type in ('legacy_draft', 'runtime_probe', 'research', 'draft', 'qa')),
  drop constraint if exists ai_generations_duration_ms_check,
  add constraint ai_generations_duration_ms_check
    check (duration_ms is null or duration_ms >= 0),
  drop constraint if exists ai_generations_token_counts_check,
  add constraint ai_generations_token_counts_check
    check (
      (input_tokens is null or input_tokens >= 0)
      and (cached_input_tokens is null or cached_input_tokens >= 0)
      and (output_tokens is null or output_tokens >= 0)
      and (total_tokens is null or total_tokens >= 0)
    );

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_generations_campaign_organization_fkey') then
    alter table public.ai_generations
      add constraint ai_generations_campaign_organization_fkey
      foreign key (campaign_id, org_id)
      references public.campaigns(id, organization_id) on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ai_generations_campaign_member_organization_fkey') then
    alter table public.ai_generations
      add constraint ai_generations_campaign_member_organization_fkey
      foreign key (campaign_member_id, org_id)
      references public.campaign_members(id, organization_id) on delete restrict;
  end if;
end $$;

create unique index if not exists uidx_ai_generations_org_request_id
  on public.ai_generations(org_id, request_id)
  where request_id is not null;
create index if not exists idx_ai_generations_campaign_member_created_at
  on public.ai_generations(campaign_member_id, created_at desc)
  where campaign_member_id is not null;
create index if not exists idx_ai_generations_org_status_created_at
  on public.ai_generations(org_id, generation_status, created_at desc);
create index if not exists idx_ai_generations_request_id
  on public.ai_generations(request_id)
  where request_id is not null;

-- Browser clients can continue to read their organization ledger, but may not
-- fabricate completed jobs. Narrow service-only RPCs own probe writes.
drop policy if exists ai_generations_insert_org on public.ai_generations;
drop policy if exists ai_generations_update_org on public.ai_generations;

create or replace function public.start_ai_runtime_probe(
  p_campaign_member_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_model text
)
returns table (
  job_id uuid,
  generation_status text,
  model_name text,
  schema_version text,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  estimated_cost_usd numeric,
  duration_ms integer,
  request_id uuid,
  was_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.campaign_members;
  v_job public.ai_generations;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Server role required' using errcode = '42501';
  end if;
  if p_request_id is null or p_actor_user_id is null or p_campaign_member_id is null or nullif(btrim(p_model), '') is null then
    raise exception 'Invalid runtime probe request' using errcode = '22023';
  end if;

  select * into v_member
  from public.campaign_members
  where id = p_campaign_member_id
  for key share;
  if v_member.id is null or not exists (
    select 1 from public.memberships
    where org_id = v_member.organization_id and user_id = p_actor_user_id
  ) then
    raise exception 'Campaign member not found or unavailable' using errcode = 'P0002';
  end if;

  insert into public.ai_generations (
    org_id, owner, created_by, lead_id, job_type, campaign_id, campaign_member_id,
    request_id, provider, model_name, schema_version, generation_status,
    input_snapshot, pricing_snapshot, started_at
  ) values (
    v_member.organization_id, p_actor_user_id, p_actor_user_id, null, 'runtime_probe',
    v_member.campaign_id, v_member.id, p_request_id, 'openai', btrim(p_model),
    'runtime_probe_v1', 'pending', '{}'::jsonb,
    jsonb_build_object('status', 'not_configured'), now()
  ) on conflict (org_id, request_id) where request_id is not null do nothing
  returning * into v_job;

  if v_job.id is null then
    select * into v_job
    from public.ai_generations
    where org_id = v_member.organization_id and request_id = p_request_id;
    if v_job.id is null or v_job.job_type <> 'runtime_probe' or v_job.campaign_member_id <> v_member.id then
      raise exception 'Request identifier is unavailable' using errcode = '22023';
    end if;
    return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version,
      v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens,
      v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, false;
    return;
  end if;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload
  ) values (
    v_member.organization_id, 'human', p_actor_user_id, 'ai.runtime_probe.requested',
    'ai_generation', v_job.id, p_request_id,
    jsonb_build_object('initiating_user_id', p_actor_user_id, 'job_type', 'runtime_probe')
  );

  return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version,
    v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens,
    v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, true;
end;
$$;

create or replace function public.finish_ai_runtime_probe(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_provider_response_id text,
  p_provider_request_id text,
  p_output_payload jsonb,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_duration_ms integer,
  p_error_code text,
  p_error_message text
)
returns public.ai_generations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.ai_generations;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Server role required' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'failed') then
    raise exception 'Invalid runtime probe terminal state' using errcode = '22023';
  end if;

  select * into v_job
  from public.ai_generations
  where id = p_job_id and job_type = 'runtime_probe'
  for update;
  if v_job.id is null or not exists (
    select 1 from public.memberships
    where org_id = v_job.org_id and user_id = p_actor_user_id
  ) then
    raise exception 'Runtime probe not found or unavailable' using errcode = 'P0002';
  end if;
  if v_job.generation_status <> 'pending' then
    raise exception 'Runtime probe is already finalized' using errcode = 'P0002';
  end if;

  update public.ai_generations
  set generation_status = p_status,
      provider_response_id = nullif(btrim(coalesce(p_provider_response_id, '')), ''),
      provider_request_id = nullif(btrim(coalesce(p_provider_request_id, '')), ''),
      output_payload = case when p_status = 'completed' then p_output_payload else null end,
      input_tokens = case when p_status = 'completed' then p_input_tokens else null end,
      cached_input_tokens = case when p_status = 'completed' then p_cached_input_tokens else null end,
      output_tokens = case when p_status = 'completed' then p_output_tokens else null end,
      total_tokens = case when p_status = 'completed' then p_total_tokens else null end,
      completed_at = now(),
      duration_ms = p_duration_ms,
      error_code = case when p_status = 'failed' then nullif(btrim(coalesce(p_error_code, '')), '') else null end,
      error_message = case when p_status = 'failed' then nullif(btrim(coalesce(p_error_message, '')), '') else null end
  where id = v_job.id
  returning * into v_job;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload
  ) values (
    v_job.org_id,
    case when p_status = 'completed' then 'ai' else 'system' end,
    null,
    case when p_status = 'completed' then 'ai.runtime_probe.completed' else 'ai.runtime_probe.failed' end,
    'ai_generation', v_job.id, v_job.request_id,
    jsonb_build_object('initiating_user_id', p_actor_user_id, 'job_type', 'runtime_probe', 'error_code', v_job.error_code)
  );

  return v_job;
end;
$$;

revoke all on function public.start_ai_runtime_probe(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_ai_runtime_probe(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.start_ai_runtime_probe(uuid, uuid, uuid, text) to service_role;
grant execute on function public.finish_ai_runtime_probe(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) to service_role;

commit;
