begin;

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
  select * into v_campaign
  from public.campaigns
  where id = p_campaign_id
  for update;

  if v_campaign.id is null then
    raise exception 'Campaign not found or permission denied' using errcode = 'P0002';
  end if;

  foreach v_lead_id in array p_lead_ids loop
    select * into v_lead
    from public.leads
    where id = v_lead_id
      and org_id = v_campaign.organization_id;

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
      from public.suppression_entries s
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
    on conflict (campaign_id, lead_id) do nothing
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

    v_member := null;
    v_lead := null;
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
begin
  if p_submission_status not in ('draft', 'needs_review') then
    raise exception 'Manual messages may only be saved as draft or needs_review' using errcode = '22023';
  end if;

  select * into v_member
  from public.campaign_members
  where id = p_campaign_member_id
  for update;

  if v_member.id is null then
    raise exception 'Campaign member not found or permission denied' using errcode = 'P0002';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.outbound_messages
  where campaign_member_id = v_member.id;

  insert into public.outbound_messages (
    organization_id, campaign_member_id, version, source, channel, language, subject, body, status,
    research_snapshot_id, template_version_id
  )
  values (
    v_member.organization_id, v_member.id, v_version, 'manual', p_channel, p_language,
    nullif(btrim(p_subject), ''), p_body, p_submission_status, p_research_snapshot_id, p_template_version_id
  )
  returning * into v_message;

  v_next_member_status := case when p_submission_status = 'needs_review' then 'needs_review' else 'draft_ready' end;

  update public.campaign_members
  set status = v_next_member_status, last_error = null
  where id = v_member.id;

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
    v_member.organization_id, v_member.lead_id, 'outreach_draft_saved', v_message.channel,
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
begin
  select * into v_message
  from public.outbound_messages
  where id = p_outbound_message_id
  for update;

  if v_message.id is null then
    raise exception 'Outbound message not found or permission denied' using errcode = 'P0002';
  end if;

  if v_message.status <> 'needs_review' then
    raise exception 'Only a message awaiting review can be approved' using errcode = '22023';
  end if;

  select * into v_member
  from public.campaign_members
  where id = v_message.campaign_member_id
  for update;

  update public.outbound_messages
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = v_message.id
  returning * into v_message;

  update public.campaign_members
  set status = 'approved', last_error = null
  where id = v_member.id;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_message.organization_id, 'human', auth.uid(), 'outbound_message.approved', 'outbound_message', v_message.id,
    jsonb_build_object('campaign_member_id', v_member.id, 'version', v_message.version)
  );

  insert into public.activities (org_id, lead_id, type, channel, meta)
  values (
    v_member.organization_id, v_member.lead_id, 'outreach_approved', v_message.channel,
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


commit;
