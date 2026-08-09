begin;

-- OUTREACH-03C-QUALITY-04: accept the material V2 commercial-quality prompt
-- contract for new jobs while preserving V1 as valid immutable history. Both
-- prompt versions retain the unchanged draft_v1 structured output schema.
-- Forward-fix/rollback: replace this function in a later additive migration;
-- never rewrite ai_generations or the already-applied 20260801000007 migration.
create or replace function public.start_ai_draft_job(
  p_campaign_member_id uuid,
  p_actor_user_id uuid,
  p_confirmed_research_snapshot_id uuid,
  p_request_id uuid,
  p_model text,
  p_prompt_version text
)
returns table (
  job_id uuid, generation_status text, model_name text, schema_version text,
  input_tokens integer, cached_input_tokens integer, output_tokens integer,
  total_tokens integer, estimated_cost_usd numeric, duration_ms integer,
  request_id uuid, research_snapshot_id uuid, research_version integer, was_created boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  v_member public.campaign_members;
  v_snapshot public.research_snapshots;
  v_job public.ai_generations;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Server role required' using errcode = '42501';
  end if;
  if p_campaign_member_id is null or p_actor_user_id is null or p_confirmed_research_snapshot_id is null or p_request_id is null or nullif(btrim(p_model), '') is null or p_prompt_version not in ('outreach_draft_v1', 'outreach_draft_v2') then
    raise exception 'Invalid AI draft request' using errcode = '22023';
  end if;
  select campaign_member.* into v_member from public.campaign_members as campaign_member
  where campaign_member.id = p_campaign_member_id for key share;
  if v_member.id is null or not exists (select 1 from public.memberships as membership where membership.org_id = v_member.organization_id and membership.user_id = p_actor_user_id) then
    raise exception 'Campaign member not found or unavailable' using errcode = 'P0002';
  end if;
  if v_member.status not in ('research_ready', 'draft_ready') then
    raise exception 'Invalid campaign member state for AI draft' using errcode = '22023';
  end if;
  select snapshot.* into v_snapshot from public.research_snapshots as snapshot
  where snapshot.campaign_member_id = v_member.id and snapshot.organization_id = v_member.organization_id
  order by snapshot.version desc limit 1 for key share;
  if v_snapshot.id is null then raise exception 'Latest research is required for AI draft' using errcode = 'P0002'; end if;
  if v_snapshot.id <> p_confirmed_research_snapshot_id then raise exception 'Confirmed research is stale' using errcode = '22023'; end if;

  insert into public.ai_generations as new_job (
    org_id, owner, created_by, lead_id, job_type, campaign_id, campaign_member_id,
    request_id, provider, model_name, prompt_version, schema_version, generation_status,
    input_snapshot, pricing_snapshot, started_at
  ) values (
    v_member.organization_id, p_actor_user_id, p_actor_user_id, v_member.lead_id, 'draft',
    v_member.campaign_id, v_member.id, p_request_id, 'openai', btrim(p_model), p_prompt_version,
    'draft_v1', 'pending', jsonb_build_object('research_snapshot_id', v_snapshot.id, 'research_version', v_snapshot.version),
    jsonb_build_object('status', 'not_configured'), now()
  ) on conflict do nothing returning new_job.* into v_job;
  if v_job.id is null then
    select existing_job.* into v_job from public.ai_generations as existing_job
    where existing_job.org_id = v_member.organization_id and existing_job.request_id = p_request_id;
    if v_job.id is null or v_job.job_type <> 'draft' or v_job.campaign_member_id <> v_member.id or (v_job.input_snapshot ->> 'research_snapshot_id')::uuid <> p_confirmed_research_snapshot_id then
      raise exception 'Request identifier is unavailable' using errcode = '22023';
    end if;
    return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version, v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens, v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, p_confirmed_research_snapshot_id, (v_job.input_snapshot ->> 'research_version')::integer, false;
    return;
  end if;
  insert into public.audit_events as audit_event (organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload)
  values (v_member.organization_id, 'human', p_actor_user_id, 'ai.draft.requested', 'ai_generation', v_job.id, p_request_id,
    jsonb_build_object('initiating_user_id', p_actor_user_id, 'job_type', 'draft', 'research_snapshot_id', v_snapshot.id, 'research_version', v_snapshot.version));
  return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version, v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens, v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, v_snapshot.id, v_snapshot.version, true;
end;
$$;

revoke all on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) to service_role;

commit;
