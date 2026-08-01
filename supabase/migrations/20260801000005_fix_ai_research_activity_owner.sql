begin;

-- Forward fix for OUTREACH-03B production persistence failure. Keep the
-- applied research migration immutable and retain activities.owner as a
-- required CRM actor reference.
create or replace function public.finish_ai_research_job(
  p_job_id uuid, p_actor_user_id uuid, p_status text, p_provider_response_id text,
  p_provider_request_id text, p_output_payload jsonb, p_input_tokens integer,
  p_cached_input_tokens integer, p_output_tokens integer, p_total_tokens integer,
  p_duration_ms integer, p_error_code text, p_error_message text
)
returns table (job_id uuid, generation_status text, model_name text, schema_version text, input_tokens integer, cached_input_tokens integer, output_tokens integer, total_tokens integer, estimated_cost_usd numeric, duration_ms integer, request_id uuid, research_snapshot_id uuid, research_version integer)
language plpgsql security definer set search_path = public
as $$
declare v_job public.ai_generations; v_member public.campaign_members; v_snapshot public.research_snapshots; v_version integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then raise exception 'Server role required' using errcode = '42501'; end if;
  if p_status not in ('completed', 'failed') or coalesce(p_duration_ms, -1) < 0 then raise exception 'Invalid research terminal state' using errcode = '22023'; end if;
  select generation.* into v_job from public.ai_generations as generation where generation.id = p_job_id and generation.job_type = 'research' for update;
  if v_job.id is null or not exists (select 1 from public.memberships as membership where membership.org_id = v_job.org_id and membership.user_id = p_actor_user_id) then raise exception 'Research job not found or unavailable' using errcode = 'P0002'; end if;
  if v_job.generation_status <> 'pending' then raise exception 'Research job is already finalized' using errcode = 'P0002'; end if;
  if p_status = 'completed' and (p_output_payload is null or jsonb_typeof(p_output_payload) <> 'object') then raise exception 'Invalid research output' using errcode = '22023'; end if;
  if p_status = 'completed' and v_job.owner is null then raise exception 'Research job owner is unavailable' using errcode = 'P0002'; end if;
  update public.ai_generations as generation set generation_status = p_status, provider_response_id = nullif(btrim(coalesce(p_provider_response_id, '')), ''), provider_request_id = nullif(btrim(coalesce(p_provider_request_id, '')), ''), output_payload = case when p_status = 'completed' then p_output_payload else null end, input_tokens = case when p_status = 'completed' then p_input_tokens else null end, cached_input_tokens = case when p_status = 'completed' then p_cached_input_tokens else null end, output_tokens = case when p_status = 'completed' then p_output_tokens else null end, total_tokens = case when p_status = 'completed' then p_total_tokens else null end, estimated_cost_usd = null, pricing_snapshot = jsonb_build_object('status', 'not_configured'), completed_at = now(), duration_ms = p_duration_ms, error_code = case when p_status = 'failed' then nullif(btrim(coalesce(p_error_code, '')), '') else null end, error_message = case when p_status = 'failed' then nullif(btrim(coalesce(p_error_message, '')), '') else null end where generation.id = v_job.id returning generation.* into v_job;
  if p_status = 'failed' then
    insert into public.audit_events as audit_event (organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload) values (v_job.org_id, 'system', null, 'ai.research.failed', 'ai_generation', v_job.id, v_job.request_id, jsonb_build_object('initiating_user_id', p_actor_user_id, 'job_type', 'research', 'error_code', v_job.error_code));
    return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version, v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens, v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, null::uuid, null::integer;
    return;
  end if;
  select campaign_member.* into v_member from public.campaign_members as campaign_member where campaign_member.id = v_job.campaign_member_id for update;
  select coalesce(max(snapshot.version), 0) + 1 into v_version from public.research_snapshots as snapshot where snapshot.campaign_member_id = v_member.id;
  insert into public.research_snapshots as snapshot (organization_id, campaign_member_id, version, source, observed_opportunity, recommended_offer, recommended_case, evidence, confidence, warnings, ai_generation_id, created_by)
  values (v_member.organization_id, v_member.id, v_version, 'ai', p_output_payload ->> 'observed_opportunity', p_output_payload ->> 'recommended_offer', p_output_payload ->> 'recommended_case', p_output_payload -> 'evidence', (p_output_payload ->> 'confidence')::numeric, p_output_payload -> 'warnings', v_job.id, p_actor_user_id) returning snapshot.* into v_snapshot;
  update public.campaign_members as campaign_member set status = 'research_ready', last_error = null where campaign_member.id = v_member.id and campaign_member.status in ('queued', 'researching', 'research_ready');
  insert into public.audit_events as audit_event (organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload) values (v_job.org_id, 'ai', null, 'ai.research.completed', 'ai_generation', v_job.id, v_job.request_id, jsonb_build_object('initiating_user_id', p_actor_user_id, 'job_type', 'research', 'research_snapshot_id', v_snapshot.id, 'research_version', v_snapshot.version));
  insert into public.activities as activity (org_id, owner, lead_id, type, meta) values (v_member.organization_id, v_job.owner, v_member.lead_id, 'research_saved', jsonb_build_object('campaign_member_id', v_member.id, 'research_snapshot_id', v_snapshot.id, 'version', v_snapshot.version, 'source', 'ai', 'research_version', v_snapshot.version, 'ai_generation_id', v_job.id));
  return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version, v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens, v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, v_snapshot.id, v_snapshot.version;
end;
$$;

-- Recover only stale, pending research jobs that could not be finalized after
-- a persistence failure. This never creates a snapshot or changes a campaign
-- member state, and terminal rows remain immutable.
create or replace function public.fail_stale_ai_research_job(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_error_code text
)
returns public.ai_generations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.ai_generations;
  v_completed_at timestamptz := now();
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Server role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_actor_user_id is null or p_error_code is distinct from 'persistence_recovery' then
    raise exception 'Invalid research recovery request' using errcode = '22023';
  end if;

  select generation.* into v_job
  from public.ai_generations as generation
  where generation.id = p_job_id and generation.job_type = 'research'
  for update;
  if v_job.id is null or not exists (
    select 1 from public.memberships as membership
    where membership.org_id = v_job.org_id and membership.user_id = p_actor_user_id
  ) then
    raise exception 'Research job not found or unavailable' using errcode = 'P0002';
  end if;
  if v_job.generation_status <> 'pending' then
    raise exception 'Research job is already finalized' using errcode = 'P0002';
  end if;
  if v_job.created_at > v_completed_at - interval '5 minutes' then
    raise exception 'Research job is not stale' using errcode = '22023';
  end if;

  update public.ai_generations as generation
  set generation_status = 'failed',
      completed_at = v_completed_at,
      duration_ms = least(
        2147483647::bigint,
        greatest(0::bigint, floor(extract(epoch from (v_completed_at - coalesce(v_job.started_at, v_job.created_at))) * 1000)::bigint)
      )::integer,
      error_code = 'persistence_recovery',
      error_message = 'Recovered stale pending research job after persistence failure.'
  where generation.id = v_job.id
  returning generation.* into v_job;

  insert into public.audit_events as audit_event (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload
  ) values (
    v_job.org_id, 'system', null, 'ai.research.failed', 'ai_generation', v_job.id, v_job.request_id,
    jsonb_build_object(
      'initiating_user_id', v_job.owner,
      'recovery_actor_user_id', p_actor_user_id,
      'job_type', 'research',
      'error_code', v_job.error_code,
      'recovery_reason', p_error_code
    )
  );

  return v_job;
end;
$$;

revoke all on function public.finish_ai_research_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.fail_stale_ai_research_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.finish_ai_research_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) to service_role;
grant execute on function public.fail_stale_ai_research_job(uuid, uuid, text) to service_role;

commit;
