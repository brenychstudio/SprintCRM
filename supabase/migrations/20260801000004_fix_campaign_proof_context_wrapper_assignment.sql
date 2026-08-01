begin;

-- The legacy campaign RPCs return public.campaigns composite rows. Expand the
-- row result before assigning it to the campaign record so proof-context
-- wrappers retain the legacy invoker/RLS behavior without composite-to-UUID
-- coercion.
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
  select *
  into v_campaign
  from public.create_manual_campaign(
    p_name,
    p_description,
    p_target_segment,
    p_offer_summary,
    p_default_channel,
    p_default_language,
    p_tone
  );

  update public.campaigns as campaign
  set proof_context = nullif(btrim(p_proof_context), '')
  where campaign.id = v_campaign.id
  returning campaign.* into v_campaign;

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
  select *
  into v_campaign
  from public.update_manual_campaign(
    p_campaign_id,
    p_name,
    p_description,
    p_target_segment,
    p_offer_summary,
    p_default_channel,
    p_default_language,
    p_tone,
    p_status
  );

  update public.campaigns as campaign
  set proof_context = nullif(btrim(p_proof_context), '')
  where campaign.id = v_campaign.id
  returning campaign.* into v_campaign;

  return v_campaign;
end;
$$;

revoke all on function public.create_manual_campaign(text, text, text, text, text, text, text, text) from public;
revoke all on function public.update_manual_campaign(uuid, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_manual_campaign(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_manual_campaign(uuid, text, text, text, text, text, text, text, text, text) to authenticated;

commit;
