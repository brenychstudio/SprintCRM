begin;

-- OUTREACH-03A forward fix: the RETURNS TABLE request_id output is a PL/pgSQL
-- variable. Qualify every ai_generations reference so retry lookups cannot
-- resolve request_id ambiguously at runtime.
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

  select campaign_member.* into v_member
  from public.campaign_members as campaign_member
  where campaign_member.id = p_campaign_member_id
  for key share;
  if v_member.id is null or not exists (
    select 1 from public.memberships as membership
    where membership.org_id = v_member.organization_id
      and membership.user_id = p_actor_user_id
  ) then
    raise exception 'Campaign member not found or unavailable' using errcode = 'P0002';
  end if;

  insert into public.ai_generations as new_job (
    org_id, owner, created_by, lead_id, job_type, campaign_id, campaign_member_id,
    request_id, provider, model_name, schema_version, generation_status,
    input_snapshot, pricing_snapshot, started_at
  ) values (
    v_member.organization_id, p_actor_user_id, p_actor_user_id, null, 'runtime_probe',
    v_member.campaign_id, v_member.id, p_request_id, 'openai', btrim(p_model),
    'runtime_probe_v1', 'pending', '{}'::jsonb,
    jsonb_build_object('status', 'not_configured'), now()
  ) on conflict do nothing
  returning new_job.* into v_job;

  if v_job.id is null then
    select existing_job.* into v_job
    from public.ai_generations as existing_job
    where existing_job.org_id = v_member.organization_id
      and existing_job.request_id = p_request_id;
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

revoke all on function public.start_ai_runtime_probe(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.start_ai_runtime_probe(uuid, uuid, uuid, text) to service_role;

commit;
