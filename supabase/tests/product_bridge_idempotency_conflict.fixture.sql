begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, confirmed_at,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  'a1000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'bridge-conflict@example.test', '', now(),
  now(), now(), '', '', '', ''
);

insert into public.organizations (id, name, created_by)
values (
  'a2000000-0000-4000-8000-000000000001',
  'Bridge conflict proof organization',
  'a1000000-0000-4000-8000-000000000001'
);

insert into public.memberships (org_id, user_id, role)
values (
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'owner'
);

insert into public.leads (
  id, org_id, owner, created_by, company_name, contact_name, email, phone,
  language, stage, status, next_action, next_action_at
) values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Private conflict fixture company', 'Private conflict fixture person',
  'private-conflict@example.test', '+34999999998',
  'en', 'new', 'active', 'follow_up', now() + interval '1 day'
);

insert into public.campaigns (
  id, organization_id, name, status, default_channel, default_language, created_by
) values (
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'Bridge conflict proof campaign', 'active', 'email', 'en',
  'a1000000-0000-4000-8000-000000000001'
);

insert into public.campaign_members (
  id, organization_id, campaign_id, lead_id, status, added_by
) values (
  'a5000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'research_ready',
  'a1000000-0000-4000-8000-000000000001'
);

insert into public.research_snapshots (
  id, organization_id, campaign_member_id, version, source,
  observed_opportunity, recommended_offer, recommended_case,
  evidence, confidence, warnings, ai_generation_id, created_by
) values (
  'a7000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  1, 'manual',
  'A bounded fixture opportunity exists for a supervised outreach draft regression.',
  'Prepare one immutable email draft for human review without approval or sending.',
  null,
  '[{"url":"https://example.test/conflict-proof","note":"A public fixture fact supports the supervised draft."}]'::jsonb,
  0.8, '[]'::jsonb, null,
  'a1000000-0000-4000-8000-000000000001'
);

-- A second, isolated target exercises the negative receipt-equivalence control.
-- It keeps that deliberately corrupted durable receipt away from the primary
-- stage/replay/conflict sequence and from every production migration.
insert into public.leads (
  id, org_id, owner, created_by, company_name, contact_name, email, phone,
  language, stage, status, next_action, next_action_at
) values (
  'b3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Private receipt mismatch fixture company', 'Private receipt mismatch fixture person',
  'private-receipt-mismatch@example.test', '+34999999997',
  'en', 'new', 'active', 'follow_up', now() + interval '1 day'
);

insert into public.campaigns (
  id, organization_id, name, status, default_channel, default_language, created_by
) values (
  'b4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'Bridge receipt mismatch proof campaign', 'active', 'email', 'en',
  'a1000000-0000-4000-8000-000000000001'
);

insert into public.campaign_members (
  id, organization_id, campaign_id, lead_id, status, added_by
) values (
  'b5000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'research_ready',
  'a1000000-0000-4000-8000-000000000001'
);

insert into public.research_snapshots (
  id, organization_id, campaign_member_id, version, source,
  observed_opportunity, recommended_offer, recommended_case,
  evidence, confidence, warnings, ai_generation_id, created_by
) values (
  'b7000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  1, 'manual',
  'A bounded fixture opportunity exists for the receipt mismatch control.',
  'Prepare one immutable email draft whose returned durable receipt must be checked.',
  null,
  '[{"url":"https://example.test/receipt-mismatch-proof","note":"A public fixture fact supports the isolated mismatch control."}]'::jsonb,
  0.8, '[]'::jsonb, null,
  'a1000000-0000-4000-8000-000000000001'
);

-- The real function is retained byte-for-byte under a test-only name. The
-- wrapper is a transparent pass-through except for one reserved fixture key,
-- where it changes a meaningful receipt field before the real function stores
-- it. This proves CRM still fails closed on a genuine durable receipt mismatch.
alter function public.stage_product_bridge_email_draft(
  uuid, text, text, uuid, uuid, text, uuid, integer, uuid,
  text, text, text, jsonb, jsonb
) rename to pbg02c_proof_stage_email_draft_original;

create function public.stage_product_bridge_email_draft(
  p_expected_organization_id uuid,
  p_idempotency_key text,
  p_semantic_fingerprint text,
  p_claim_token uuid,
  p_campaign_member_id uuid,
  p_source_snapshot_id text,
  p_staged_entity_id uuid,
  p_expected_version integer,
  p_research_snapshot_id uuid,
  p_subject text,
  p_body text,
  p_language text,
  p_provenance jsonb,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_receipt jsonb := p_receipt;
begin
  if p_idempotency_key = 'crm-pbg-02c-postgres-receipt-mismatch-proof' then
    v_receipt := jsonb_set(
      p_receipt,
      '{receiptId}',
      to_jsonb((p_receipt ->> 'receiptId') || '-meaningfully-different')
    );
  end if;

  return public.pbg02c_proof_stage_email_draft_original(
    p_expected_organization_id,
    p_idempotency_key,
    p_semantic_fingerprint,
    p_claim_token,
    p_campaign_member_id,
    p_source_snapshot_id,
    p_staged_entity_id,
    p_expected_version,
    p_research_snapshot_id,
    p_subject,
    p_body,
    p_language,
    p_provenance,
    v_receipt
  );
end;
$$;

revoke all on function public.stage_product_bridge_email_draft(
  uuid, text, text, uuid, uuid, text, uuid, integer, uuid,
  text, text, text, jsonb, jsonb
) from public, anon;
grant execute on function public.stage_product_bridge_email_draft(
  uuid, text, text, uuid, uuid, text, uuid, integer, uuid,
  text, text, text, jsonb, jsonb
) to authenticated;

-- Standalone PostgREST 14 exposes JWT claims through request.jwt.claims,
-- while the pinned Supabase PostgreSQL image retains the legacy auth.uid()
-- helpers that read individual claim GUCs. Supabase's hosted API supplies that
-- compatibility layer; this disposable pre-request hook mirrors it without
-- changing any production function or migration.
create function public.pbg02c_proof_set_legacy_claims()
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_claims jsonb := coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(v_claims ->> 'sub', ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_claims ->> 'role', ''), true);
end;
$$;

revoke all on function public.pbg02c_proof_set_legacy_claims() from public;
grant execute on function public.pbg02c_proof_set_legacy_claims() to anon, authenticated;

commit;
