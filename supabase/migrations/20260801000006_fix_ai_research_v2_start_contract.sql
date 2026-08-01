begin;

-- Forward fix for the deployed research_v2 Edge Function. Keep the applied
-- V1 migration immutable and preserve the supervised, service-only start
-- boundary, including V1 retries and request-id idempotency.
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
  v_schema_version text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Server role required' using errcode = '42501';
  end if;
  if p_campaign_member_id is null or p_actor_user_id is null or p_request_id is null or nullif(btrim(p_model), '') is null or coalesce(p_prompt_version, '') not in ('outreach_research_v1', 'outreach_research_v2') then
    raise exception 'Invalid research request' using errcode = '22023';
  end if;
  v_schema_version := case p_prompt_version
    when 'outreach_research_v1' then 'research_v1'
    when 'outreach_research_v2' then 'research_v2'
  end;

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
    p_prompt_version, v_schema_version, 'pending', '{}'::jsonb,
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

revoke all on function public.start_ai_research_job(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_ai_research_job(uuid, uuid, uuid, text, text) to service_role;

commit;
