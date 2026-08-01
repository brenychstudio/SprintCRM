begin;

-- OUTREACH-03C: supervised draft generation reuses the organization-scoped
-- ledger and immutable outbound message history. This migration is additive.
create index if not exists idx_ai_generations_draft_member_created_at
  on public.ai_generations(campaign_member_id, created_at desc)
  where job_type = 'draft';

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
  if p_campaign_member_id is null or p_actor_user_id is null or p_confirmed_research_snapshot_id is null or p_request_id is null or nullif(btrim(p_model), '') is null or p_prompt_version <> 'outreach_draft_v1' then
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

create or replace function public.finish_ai_draft_job(
  p_job_id uuid, p_actor_user_id uuid, p_status text, p_provider_response_id text,
  p_provider_request_id text, p_output_payload jsonb, p_input_tokens integer,
  p_cached_input_tokens integer, p_output_tokens integer, p_total_tokens integer,
  p_duration_ms integer, p_error_code text, p_error_message text
)
returns table (job_id uuid, generation_status text, model_name text, schema_version text, input_tokens integer, cached_input_tokens integer, output_tokens integer, total_tokens integer, estimated_cost_usd numeric, duration_ms integer, request_id uuid, research_snapshot_id uuid, research_version integer, message_version integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_job public.ai_generations; v_member public.campaign_members; v_snapshot public.research_snapshots;
  v_campaign public.campaigns; v_lead public.leads; v_message public.outbound_messages; v_version integer; v_language text; v_channel public.activity_channel;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then raise exception 'Server role required' using errcode = '42501'; end if;
  if p_status not in ('completed', 'failed') or coalesce(p_duration_ms, -1) < 0 then raise exception 'Invalid AI draft terminal state' using errcode = '22023'; end if;
  select generation.* into v_job from public.ai_generations as generation where generation.id = p_job_id and generation.job_type = 'draft' for update;
  if v_job.id is null or not exists (select 1 from public.memberships as membership where membership.org_id = v_job.org_id and membership.user_id = p_actor_user_id) then raise exception 'AI draft job not found or unavailable' using errcode = 'P0002'; end if;
  if v_job.generation_status <> 'pending' then raise exception 'AI draft job is already finalized' using errcode = 'P0002'; end if;
  if p_status = 'completed' and (p_output_payload is null or jsonb_typeof(p_output_payload) <> 'object') then raise exception 'Invalid AI draft output' using errcode = '22023'; end if;
  select campaign_member.* into v_member from public.campaign_members as campaign_member where campaign_member.id = v_job.campaign_member_id and campaign_member.organization_id = v_job.org_id for update;
  select snapshot.* into v_snapshot from public.research_snapshots as snapshot where snapshot.campaign_member_id = v_member.id and snapshot.organization_id = v_job.org_id order by snapshot.version desc limit 1 for key share;
  if p_status = 'completed' and (v_member.id is null or v_member.status not in ('research_ready', 'draft_ready') or v_snapshot.id is null or v_snapshot.id <> (v_job.input_snapshot ->> 'research_snapshot_id')::uuid) then
    p_status := 'failed'; p_error_code := 'stale_research'; p_error_message := 'Confirmed research changed before draft persistence.'; p_output_payload := null;
  end if;
  update public.ai_generations as generation set
    generation_status = p_status, provider_response_id = nullif(btrim(coalesce(p_provider_response_id, '')), ''), provider_request_id = nullif(btrim(coalesce(p_provider_request_id, '')), ''),
    output_payload = case when p_status = 'completed' then p_output_payload else null end,
    input_tokens = p_input_tokens, cached_input_tokens = p_cached_input_tokens, output_tokens = p_output_tokens, total_tokens = p_total_tokens,
    estimated_cost_usd = null, pricing_snapshot = jsonb_build_object('status', 'not_configured'), completed_at = now(), duration_ms = p_duration_ms,
    error_code = case when p_status = 'failed' then nullif(btrim(coalesce(p_error_code, '')), '') else null end,
    error_message = case when p_status = 'failed' then nullif(btrim(coalesce(p_error_message, '')), '') else null end
  where generation.id = v_job.id returning generation.* into v_job;
  if p_status = 'failed' then
    insert into public.audit_events as audit_event (organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload)
    values (v_job.org_id, 'system', null, 'ai.draft.failed', 'ai_generation', v_job.id, v_job.request_id,
      jsonb_build_object('initiating_user_id', p_actor_user_id, 'job_type', 'draft', 'research_snapshot_id', v_job.input_snapshot -> 'research_snapshot_id', 'research_version', v_job.input_snapshot -> 'research_version', 'error_code', v_job.error_code));
    return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version, v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens, v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, null::uuid, null::integer, null::integer;
    return;
  end if;
  if v_job.owner is null then raise exception 'AI draft job owner is unavailable' using errcode = 'P0002'; end if;
  select campaign.* into v_campaign from public.campaigns as campaign where campaign.id = v_member.campaign_id and campaign.organization_id = v_job.org_id for key share;
  select lead.* into v_lead from public.leads as lead where lead.id = v_member.lead_id and lead.org_id = v_job.org_id for key share;
  if v_campaign.id is null or v_lead.id is null then raise exception 'AI draft context is unavailable' using errcode = 'P0002'; end if;
  v_language := case when lower(coalesce(v_lead.language, '')) in ('en', 'es', 'uk', 'ru') then lower(v_lead.language) when lower(coalesce(v_campaign.default_language, '')) in ('en', 'es', 'uk', 'ru') then lower(v_campaign.default_language) else 'en' end;
  select coalesce(max(message.version), 0) + 1 into v_version from public.outbound_messages as message where message.campaign_member_id = v_member.id;
  insert into public.outbound_messages as message (organization_id, campaign_member_id, version, source, channel, language, subject, body, status, research_snapshot_id, ai_generation_id, created_by)
  values (v_job.org_id, v_member.id, v_version, 'ai', v_campaign.default_channel, v_language, p_output_payload ->> 'subject', p_output_payload ->> 'body', 'draft', v_snapshot.id, v_job.id, v_job.owner)
  returning message.* into v_message;
  update public.campaign_members as campaign_member set status = 'draft_ready', last_error = null where campaign_member.id = v_member.id and campaign_member.status in ('research_ready', 'draft_ready');
  insert into public.audit_events as audit_event (organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload)
  values (v_job.org_id, 'ai', null, 'ai.draft.completed', 'ai_generation', v_job.id, v_job.request_id,
    jsonb_build_object('initiating_user_id', p_actor_user_id, 'job_type', 'draft', 'research_snapshot_id', v_snapshot.id, 'research_version', v_snapshot.version, 'outbound_message_id', v_message.id, 'message_version', v_message.version));
  v_channel := v_message.channel::public.activity_channel;
  insert into public.activities as activity (org_id, owner, lead_id, type, channel, meta)
  values (v_job.org_id, v_job.owner, v_member.lead_id, 'outreach_draft_saved', v_channel,
    jsonb_build_object('campaign_member_id', v_member.id, 'outbound_message_id', v_message.id, 'version', v_message.version, 'status', v_message.status, 'source', 'ai', 'research_snapshot_id', v_snapshot.id, 'research_version', v_snapshot.version, 'ai_generation_id', v_job.id));
  return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version, v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens, v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, v_snapshot.id, v_snapshot.version, v_message.version;
end;
$$;

create or replace function public.fail_stale_ai_draft_job(p_job_id uuid, p_actor_user_id uuid, p_error_code text)
returns public.ai_generations
language plpgsql security definer set search_path = public
as $$
declare v_job public.ai_generations; v_completed_at timestamptz := now();
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then raise exception 'Server role required' using errcode = '42501'; end if;
  if p_job_id is null or p_actor_user_id is null or p_error_code is distinct from 'persistence_recovery' then raise exception 'Invalid AI draft recovery request' using errcode = '22023'; end if;
  select generation.* into v_job from public.ai_generations as generation where generation.id = p_job_id and generation.job_type = 'draft' for update;
  if v_job.id is null or not exists (select 1 from public.memberships as membership where membership.org_id = v_job.org_id and membership.user_id = p_actor_user_id) then raise exception 'AI draft job not found or unavailable' using errcode = 'P0002'; end if;
  if v_job.generation_status <> 'pending' then raise exception 'AI draft job is already finalized' using errcode = 'P0002'; end if;
  if v_job.created_at > v_completed_at - interval '5 minutes' then raise exception 'AI draft job is not stale' using errcode = '22023'; end if;
  update public.ai_generations as generation set generation_status = 'failed', completed_at = v_completed_at,
    duration_ms = least(2147483647::bigint, greatest(0::bigint, floor(extract(epoch from (v_completed_at - coalesce(v_job.started_at, v_job.created_at))) * 1000)::bigint))::integer,
    error_code = 'persistence_recovery', error_message = 'Recovered stale pending AI draft job after persistence failure.'
  where generation.id = v_job.id returning generation.* into v_job;
  insert into public.audit_events as audit_event (organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload)
  values (v_job.org_id, 'system', null, 'ai.draft.failed', 'ai_generation', v_job.id, v_job.request_id,
    jsonb_build_object('initiating_user_id', v_job.owner, 'job_type', 'draft', 'error_code', v_job.error_code, 'recovery_reason', p_error_code));
  return v_job;
end;
$$;

revoke all on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finish_ai_draft_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.fail_stale_ai_draft_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.finish_ai_draft_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) to service_role;
grant execute on function public.fail_stale_ai_draft_job(uuid, uuid, text) to service_role;

commit;
