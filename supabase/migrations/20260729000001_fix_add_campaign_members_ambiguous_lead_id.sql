begin;

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
  select c.* into v_campaign
  from public.campaigns as c
  where c.id = p_campaign_id
  for update of c;

  if v_campaign.id is null then
    raise exception 'Campaign not found or permission denied' using errcode = 'P0002';
  end if;

  foreach v_lead_id in array p_lead_ids loop
    v_lead := null;
    v_member := null;
    v_suppressed := false;

    select l.* into v_lead
    from public.leads as l
    where l.id = v_lead_id
      and l.org_id = v_campaign.organization_id;

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
      from public.suppression_entries as s
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
    on conflict on constraint campaign_members_campaign_id_lead_id_key do nothing
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
  end loop;
end;
$$;

revoke all on function public.add_campaign_members(uuid, uuid[]) from public;
grant execute on function public.add_campaign_members(uuid, uuid[]) to authenticated;

commit;
