begin;

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
  v_channel public.activity_channel;
begin
  if p_submission_status not in ('draft', 'needs_review') then
    raise exception 'Manual messages may only be saved as draft or needs_review' using errcode = '22023';
  end if;

  v_channel := p_channel::public.activity_channel;

  select cm.* into v_member
  from public.campaign_members as cm
  where cm.id = p_campaign_member_id
  for update of cm;

  if v_member.id is null then
    raise exception 'Campaign member not found or permission denied' using errcode = 'P0002';
  end if;

  select coalesce(max(om.version), 0) + 1 into v_version
  from public.outbound_messages as om
  where om.campaign_member_id = v_member.id;

  insert into public.outbound_messages (
    organization_id, campaign_member_id, version, source, channel, language, subject, body, status,
    research_snapshot_id, template_version_id
  )
  values (
    v_member.organization_id, v_member.id, v_version, 'manual', v_channel::text, p_language,
    nullif(btrim(p_subject), ''), p_body, p_submission_status, p_research_snapshot_id, p_template_version_id
  )
  returning * into v_message;

  v_next_member_status := case when p_submission_status = 'needs_review' then 'needs_review' else 'draft_ready' end;

  update public.campaign_members as cm
  set status = v_next_member_status, last_error = null
  where cm.id = v_member.id;

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
    v_member.organization_id, v_member.lead_id, 'outreach_draft_saved', v_channel,
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
  v_channel public.activity_channel;
begin
  select om.* into v_message
  from public.outbound_messages as om
  where om.id = p_outbound_message_id
  for update of om;

  if v_message.id is null then
    raise exception 'Outbound message not found or permission denied' using errcode = 'P0002';
  end if;

  if v_message.status <> 'needs_review' then
    raise exception 'Only a message awaiting review can be approved' using errcode = '22023';
  end if;

  v_channel := v_message.channel::public.activity_channel;

  select cm.* into v_member
  from public.campaign_members as cm
  where cm.id = v_message.campaign_member_id
  for update of cm;

  update public.outbound_messages as om
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where om.id = v_message.id
  returning * into v_message;

  update public.campaign_members as cm
  set status = 'approved', last_error = null
  where cm.id = v_member.id;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    v_message.organization_id, 'human', auth.uid(), 'outbound_message.approved', 'outbound_message', v_message.id,
    jsonb_build_object('campaign_member_id', v_member.id, 'version', v_message.version)
  );

  insert into public.activities (org_id, lead_id, type, channel, meta)
  values (
    v_member.organization_id, v_member.lead_id, 'outreach_approved', v_channel,
    jsonb_build_object('campaign_member_id', v_member.id, 'outbound_message_id', v_message.id, 'version', v_message.version)
  );

  return v_message;
end;
$$;

revoke all on function public.save_manual_outbound_message(uuid, text, text, text, text, text, uuid, uuid) from public;
revoke all on function public.approve_manual_outbound_message(uuid) from public;
grant execute on function public.save_manual_outbound_message(uuid, text, text, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.approve_manual_outbound_message(uuid) to authenticated;

commit;
