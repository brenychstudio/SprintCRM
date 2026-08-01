begin;

-- OUTREACH-03B is an additive, supervised, single-contact research boundary.
-- Historical research and ledger rows remain immutable; disable via flags or
-- deliver an additive forward-fix rather than deleting provider history.
alter table public.campaigns add column if not exists proof_context text;

-- Keep the existing API callable while exposing proof context to new clients.
create or replace function public.create_manual_campaign(
  p_name text, p_description text, p_target_segment text, p_offer_summary text,
  p_default_channel text, p_default_language text, p_tone text, p_proof_context text
)
returns public.campaigns
language plpgsql
security invoker
set search_path = public
as $$
declare v_campaign public.campaigns;
begin
  select public.create_manual_campaign(p_name, p_description, p_target_segment, p_offer_summary, p_default_channel, p_default_language, p_tone) into v_campaign;
  update public.campaigns as campaign set proof_context = nullif(btrim(p_proof_context), '') where campaign.id = v_campaign.id returning campaign.* into v_campaign;
  return v_campaign;
end;
$$;

create or replace function public.update_manual_campaign(
  p_campaign_id uuid, p_name text, p_description text, p_target_segment text,
  p_offer_summary text, p_default_channel text, p_default_language text,
  p_tone text, p_status text, p_proof_context text
)
returns public.campaigns
language plpgsql
security invoker
set search_path = public
as $$
declare v_campaign public.campaigns;
begin
  select public.update_manual_campaign(p_campaign_id, p_name, p_description, p_target_segment, p_offer_summary, p_default_channel, p_default_language, p_tone, p_status) into v_campaign;
  update public.campaigns as campaign set proof_context = nullif(btrim(p_proof_context), '') where campaign.id = v_campaign.id returning campaign.* into v_campaign;
  return v_campaign;
end;
$$;

create or replace function public.start_ai_research_job(
  p_campaign_member_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_model text,
  p_prompt_version text
)
returns table (
  job_id uuid, generation_status text, model_name text, schema_version text,
  input_tokens integer, cached_input_tokens integer, output_tokens integer,
  total_tokens integer, estimated_cost_usd numeric, duration_ms integer,
  request_id uuid, was_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.campaign_members;
  v_lead public.leads;
  v_authority text;
  v_hostname text;
  v_ip inet;
  v_job public.ai_generations;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Server role required' using errcode = '42501';
  end if;
  if p_campaign_member_id is null or p_actor_user_id is null or p_request_id is null or nullif(btrim(p_model), '') is null or p_prompt_version <> 'outreach_research_v1' then
    raise exception 'Invalid research request' using errcode = '22023';
  end if;

  select campaign_member.* into v_member
  from public.campaign_members as campaign_member
  where campaign_member.id = p_campaign_member_id
  for key share;
  if v_member.id is null or not exists (
    select 1 from public.memberships as membership
    where membership.org_id = v_member.organization_id and membership.user_id = p_actor_user_id
  ) then raise exception 'Campaign member not found or unavailable' using errcode = 'P0002'; end if;

  select lead.* into v_lead from public.leads as lead
  where lead.id = v_member.lead_id and lead.org_id = v_member.organization_id
  for key share;
  if v_lead.id is null or nullif(btrim(coalesce(v_lead.website, '')), '') is null then
    raise exception 'A public website is required for AI research' using errcode = '22023';
  end if;
  if v_lead.website !~* '^https?://[^/?#]+' then raise exception 'Invalid public website' using errcode = '22023'; end if;
  v_authority := substring(v_lead.website from '^https?://([^/?#]+)');
  if v_authority is null or v_authority like '%@%' or v_authority !~* '^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+|[0-9.]+|\[[0-9a-f:.]+\])(?::(?:80|443))?$' then
    raise exception 'Invalid public website' using errcode = '22023';
  end if;
  v_hostname := lower(regexp_replace(regexp_replace(v_authority, ':((80)|(443))$', ''), '^\[|\]$', '', 'g'));
  if v_hostname = 'localhost' or right(v_hostname, 6) = '.local' or v_hostname in ('example.com', 'example.org', 'example.net') then
    raise exception 'Invalid public website' using errcode = '22023';
  end if;
  begin
    v_ip := v_hostname::inet;
    if (family(v_ip) = 4 and (v_ip <<= '0.0.0.0/8'::inet or v_ip <<= '10.0.0.0/8'::inet or v_ip <<= '100.64.0.0/10'::inet or v_ip <<= '127.0.0.0/8'::inet or v_ip <<= '169.254.0.0/16'::inet or v_ip <<= '172.16.0.0/12'::inet or v_ip <<= '192.168.0.0/16'::inet or v_ip <<= '198.18.0.0/15'::inet or v_ip <<= '224.0.0.0/4'::inet))
      or (family(v_ip) = 6 and (v_ip <<= '::1/128'::inet or v_ip <<= 'fc00::/7'::inet or v_ip <<= 'fe80::/10'::inet)) then
      raise exception 'Invalid public website' using errcode = '22023';
    end if;
  exception when invalid_text_representation then null;
  end;

  insert into public.ai_generations as new_job (
    org_id, owner, created_by, lead_id, job_type, campaign_id, campaign_member_id,
    request_id, provider, model_name, prompt_version, schema_version, generation_status,
    input_snapshot, pricing_snapshot, started_at
  ) values (
    v_member.organization_id, p_actor_user_id, p_actor_user_id, v_member.lead_id, 'research',
    v_member.campaign_id, v_member.id, p_request_id, 'openai', btrim(p_model),
    'outreach_research_v1', 'research_v1', 'pending', '{}'::jsonb,
    jsonb_build_object('status', 'not_configured'), now()
  ) on conflict do nothing returning new_job.* into v_job;

  if v_job.id is null then
    select existing_job.* into v_job from public.ai_generations as existing_job
    where existing_job.org_id = v_member.organization_id and existing_job.request_id = p_request_id;
    if v_job.id is null or v_job.job_type <> 'research' or v_job.campaign_member_id <> v_member.id then
      raise exception 'Request identifier is unavailable' using errcode = '22023';
    end if;
    return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version, v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens, v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, false;
    return;
  end if;
  insert into public.audit_events as audit_event (organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, request_id, payload)
  values (v_member.organization_id, 'human', p_actor_user_id, 'ai.research.requested', 'ai_generation', v_job.id, p_request_id, jsonb_build_object('initiating_user_id', p_actor_user_id, 'job_type', 'research'));
  return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version, v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens, v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, true;
end;
$$;

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
  insert into public.activities as activity (org_id, lead_id, type, meta) values (v_member.organization_id, v_member.lead_id, 'research_saved', jsonb_build_object('campaign_member_id', v_member.id, 'research_snapshot_id', v_snapshot.id, 'version', v_snapshot.version, 'source', 'ai', 'research_version', v_snapshot.version, 'ai_generation_id', v_job.id));
  return query select v_job.id, v_job.generation_status, v_job.model_name, v_job.schema_version, v_job.input_tokens, v_job.cached_input_tokens, v_job.output_tokens, v_job.total_tokens, v_job.estimated_cost_usd, v_job.duration_ms, v_job.request_id, v_snapshot.id, v_snapshot.version;
end;
$$;

drop policy if exists ai_generations_insert_org on public.ai_generations;
drop policy if exists ai_generations_update_org on public.ai_generations;
revoke insert, update on table public.ai_generations from public, anon, authenticated;
revoke all on function public.create_manual_campaign(text, text, text, text, text, text, text, text) from public;
revoke all on function public.update_manual_campaign(uuid, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.start_ai_research_job(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finish_ai_research_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_manual_campaign(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_manual_campaign(uuid, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.start_ai_research_job(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.finish_ai_research_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) to service_role;

commit;
