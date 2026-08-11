begin;

-- CRM-PBG-02A adds a CRM-owned durable staging seam. It is intentionally not
-- exposed by the Product Adapter in this checkpoint.

alter table public.research_snapshots
  drop constraint research_snapshots_source_check;
alter table public.research_snapshots
  add constraint research_snapshots_source_check
  check (source in ('manual', 'ai', 'imported', 'bridge'));

alter table public.outbound_messages
  drop constraint outbound_messages_source_check;
alter table public.outbound_messages
  add constraint outbound_messages_source_check
  check (source in ('manual', 'template', 'ai', 'bridge'));

create table public.product_bridge_write_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  product_id text not null check (product_id = 'sprint-crm'),
  operation_id text not null check (operation_id in (
    'crm.research.stageSnapshot',
    'crm.email.stageDraft'
  )),
  idempotency_key text not null check (
    char_length(idempotency_key) between 1 and 200
    and idempotency_key = btrim(idempotency_key)
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  semantic_fingerprint text not null check (
    semantic_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  receipt jsonb,
  staged_entity_type text check (staged_entity_type in ('research_snapshot', 'outbound_message')),
  staged_entity_id uuid,
  provenance jsonb not null default '{}'::jsonb check (
    jsonb_typeof(provenance) = 'object'
    and octet_length(provenance::text) <= 4096
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint product_bridge_write_requests_completion_check check (
    (status = 'pending' and receipt is null and completed_at is null
      and staged_entity_type is null and staged_entity_id is null)
    or
    (status = 'completed' and receipt is not null and completed_at is not null
      and staged_entity_type is not null and staged_entity_id is not null
      and jsonb_typeof(receipt) = 'object'
      and octet_length(receipt::text) <= 16384)
  ),
  constraint product_bridge_write_requests_address_key
    unique (organization_id, product_id, operation_id, idempotency_key)
);

create index idx_product_bridge_write_requests_pending_lease
  on public.product_bridge_write_requests(lease_expires_at)
  where status = 'pending';

alter table public.product_bridge_write_requests enable row level security;
revoke all on table public.product_bridge_write_requests from public, anon, authenticated;

create trigger trg_product_bridge_write_requests_set_updated_at
before update on public.product_bridge_write_requests
for each row execute function public.set_updated_at();

create or replace function public.product_bridge_json_object_has_only_keys(
  p_value jsonb,
  p_allowed_keys text[]
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if jsonb_typeof(p_value) <> 'object' then return false; end if;
  return not exists (
    select 1
    from jsonb_object_keys(p_value) as object_key(key)
    where not (object_key.key = any(p_allowed_keys))
  );
end;
$$;

create or replace function public.product_bridge_json_has_forbidden_key(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      if lower(v_key) ~ '^(authorization|access.?token|refresh.?token|jwt|secret|password|api.?key|publishable.?key|prompt|message.?body|draft.?body|research.?text|observed.?opportunity|recommended.?offer|recommended.?case|evidence|warnings|subject|body)$' then
        return true;
      end if;
      if public.product_bridge_json_has_forbidden_key(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.product_bridge_json_has_forbidden_key(v_child) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create or replace function public.product_bridge_valid_provenance(
  p_value jsonb,
  p_organization_id uuid,
  p_operation_id text,
  p_campaign_member_id uuid,
  p_source_snapshot_id text,
  p_staged_entity_id uuid,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  return coalesce(public.product_bridge_json_object_has_only_keys(
      p_value,
      array[
        'productId', 'operationId', 'requestId', 'correlationId', 'actorSubject',
        'organizationId', 'campaignMemberId', 'sourceSnapshotId',
        'stagedEntityId', 'timestamp'
      ]
    )
    and octet_length(p_value::text) <= 4096
    and p_value ->> 'productId' = 'sprint-crm'
    and p_value ->> 'operationId' = p_operation_id
    and p_value ->> 'organizationId' = p_organization_id::text
    and p_value ->> 'campaignMemberId' = p_campaign_member_id::text
    and p_value ->> 'sourceSnapshotId' = p_source_snapshot_id
    and p_value ->> 'stagedEntityId' = p_staged_entity_id::text
    and p_value ->> 'actorSubject' = 'user:' || p_actor_user_id::text
    and char_length(coalesce(p_value ->> 'requestId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'correlationId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'timestamp', '')) between 20 and 40
    and p_value ->> 'requestId' !~ '[[:cntrl:]]'
    and p_value ->> 'correlationId' !~ '[[:cntrl:]]'
    and p_value ->> 'timestamp' !~ '[[:cntrl:]]'
    and not public.product_bridge_json_has_forbidden_key(p_value), false);
end;
$$;

create or replace function public.product_bridge_valid_safe_diagnostics(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_text text;
begin
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 5 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(v_item) <> 'string' then return false; end if;
    v_text := v_item #>> '{}';
    if char_length(v_text) not between 1 and 200 or v_text ~ '[[:cntrl:]]' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.product_bridge_valid_receipt(
  p_value jsonb,
  p_staged_entity_id uuid,
  p_source_snapshot_id text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  return coalesce(public.product_bridge_json_object_has_only_keys(
      p_value,
      array[
        'schemaVersion', 'receiptId', 'requestId', 'correlationId', 'productId',
        'operationId', 'operationClass', 'status', 'timestamp', 'result',
        'sourceSnapshotId', 'resultSnapshotId', 'stagedEntityId', 'validation',
        'approval', 'provenance', 'diagnosticsSafe', 'metadataSafe'
      ]
    )
    and octet_length(p_value::text) <= 16384
    and p_value ->> 'productId' = 'sprint-crm'
    and p_value ->> 'operationClass' = 'STAGED_WRITE'
    and p_value ->> 'status' = 'staged'
    and p_value ->> 'stagedEntityId' = p_staged_entity_id::text
    and p_value ->> 'sourceSnapshotId' = p_source_snapshot_id
    and char_length(coalesce(p_value ->> 'schemaVersion', '')) between 1 and 40
    and char_length(coalesce(p_value ->> 'receiptId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'requestId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'correlationId', '')) between 1 and 200
    and char_length(coalesce(p_value ->> 'operationId', '')) between 1 and 100
    and char_length(coalesce(p_value ->> 'timestamp', '')) between 20 and 40
    and p_value ->> 'operationId' in ('stage_snapshot', 'stage_draft')
    and p_value ->> 'requestId' !~ '[[:cntrl:]]'
    and p_value ->> 'correlationId' !~ '[[:cntrl:]]'
    and p_value ->> 'timestamp' !~ '[[:cntrl:]]'
    and jsonb_typeof(p_value -> 'result') = 'object'
    and public.product_bridge_json_object_has_only_keys(
      p_value -> 'result',
      array['entityType', 'entityId', 'version', 'status', 'campaignMemberId', 'researchSnapshotId', 'researchVersion']
    )
    and p_value #>> '{result,entityId}' = p_staged_entity_id::text
    and jsonb_typeof(p_value #> '{result,version}') = 'number'
    and (p_value #>> '{result,version}')::integer >= 1
    and (
      (p_value ->> 'operationId' = 'stage_snapshot'
        and p_value #>> '{result,entityType}' = 'research_snapshot'
        and p_value #>> '{result,status}' = 'research_ready')
      or
      (p_value ->> 'operationId' = 'stage_draft'
        and p_value #>> '{result,entityType}' = 'outbound_message'
        and p_value #>> '{result,status}' = 'draft')
    )
    and public.product_bridge_json_object_has_only_keys(
      p_value -> 'validation', array['state', 'diagnosticsSafe']
    )
    and coalesce(p_value #>> '{validation,state}', '') = 'pending'
    and (
      not ((p_value -> 'validation') ? 'diagnosticsSafe')
      or public.product_bridge_valid_safe_diagnostics(p_value #> '{validation,diagnosticsSafe}')
    )
    and public.product_bridge_json_object_has_only_keys(
      p_value -> 'approval', array['state', 'diagnosticsSafe']
    )
    and coalesce(p_value #>> '{approval,state}', '') = 'pending'
    and (
      not ((p_value -> 'approval') ? 'diagnosticsSafe')
      or public.product_bridge_valid_safe_diagnostics(p_value #> '{approval,diagnosticsSafe}')
    )
    and (not (p_value ? 'diagnosticsSafe')
      or public.product_bridge_valid_safe_diagnostics(p_value -> 'diagnosticsSafe'))
    and not (p_value ? 'provenance')
    and not (p_value ? 'metadataSafe')
    and not public.product_bridge_json_has_forbidden_key(p_value), false);
end;
$$;

create or replace function public.product_bridge_valid_research_evidence(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_url text;
  v_note text;
  v_seen text[] := array[]::text[];
  v_normalized text;
begin
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) not between 1 and 3 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_value)
  loop
    if not public.product_bridge_json_object_has_only_keys(v_item, array['url', 'note'])
       or not (v_item ? 'url') or not (v_item ? 'note') then
      return false;
    end if;
    v_url := v_item ->> 'url';
    v_note := v_item ->> 'note';
    if v_url is null or v_url <> btrim(v_url)
       or char_length(v_url) not between 9 and 2048
       or v_url !~ '^https://[^[:space:]]+$'
       or v_url ~ '[[:cntrl:]]'
       or v_note is null or v_note <> btrim(v_note)
       or char_length(v_note) not between 20 and 350
       or v_note ~ '[[:cntrl:]]' then
      return false;
    end if;
    v_normalized := lower(rtrim(v_url, '/'));
    if v_normalized = any(v_seen) then
      return false;
    end if;
    v_seen := array_append(v_seen, v_normalized);
  end loop;

  return true;
end;
$$;

create or replace function public.product_bridge_valid_warnings(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_text text;
begin
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 5 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(v_item) <> 'string' then
      return false;
    end if;
    v_text := v_item #>> '{}';
    if v_text <> btrim(v_text) or char_length(v_text) not between 1 and 300
       or v_text ~ '[[:cntrl:]]' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.product_bridge_require_actor(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if auth.role() <> 'authenticated' or v_actor is null then
    raise exception 'Product Bridge staging is unavailable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships as membership
    where membership.org_id = p_organization_id and membership.user_id = v_actor
  ) then
    raise exception 'Product Bridge staging is unavailable' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.product_bridge_staging_context_version(
  p_organization_id uuid,
  p_campaign_member_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_member public.campaign_members;
  v_campaign public.campaigns;
  v_lead public.leads;
  v_research public.research_snapshots;
  v_message public.outbound_messages;
  v_canonical text;
begin
  select member.* into v_member
  from public.campaign_members as member
  where member.id = p_campaign_member_id
    and member.organization_id = p_organization_id;
  if v_member.id is null then return null; end if;

  select campaign.* into v_campaign
  from public.campaigns as campaign
  where campaign.id = v_member.campaign_id
    and campaign.organization_id = p_organization_id;
  select lead.* into v_lead
  from public.leads as lead
  where lead.id = v_member.lead_id and lead.org_id = p_organization_id;
  if v_campaign.id is null or v_lead.id is null then return null; end if;

  select snapshot.* into v_research
  from public.research_snapshots as snapshot
  where snapshot.campaign_member_id = v_member.id
    and snapshot.organization_id = p_organization_id
  order by snapshot.version desc
  limit 1;

  select message.* into v_message
  from public.outbound_messages as message
  where message.campaign_member_id = v_member.id
    and message.organization_id = p_organization_id
  order by message.version desc
  limit 1;

  v_canonical := jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignMemberId', v_member.id,
    'memberStatus', v_member.status,
    'memberUpdatedAt', v_member.updated_at,
    'campaignId', v_campaign.id,
    'campaignChannel', v_campaign.default_channel,
    'campaignLanguage', v_campaign.default_language,
    'campaignUpdatedAt', v_campaign.updated_at,
    'leadId', v_lead.id,
    'leadLanguage', v_lead.language,
    'leadUpdatedAt', v_lead.updated_at,
    'researchId', v_research.id,
    'researchVersion', v_research.version,
    'researchCreatedAt', v_research.created_at,
    'messageId', v_message.id,
    'messageVersion', v_message.version,
    'messageStatus', v_message.status,
    'messageUpdatedAt', v_message.updated_at
  )::text;

  return 'sha256:' || encode(digest(convert_to(v_canonical, 'UTF8'), 'sha256'), 'hex');
end;
$$;

create or replace function public.get_product_bridge_staging_context(
  p_expected_organization_id uuid,
  p_campaign_member_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor uuid;
  v_member public.campaign_members;
  v_campaign public.campaigns;
  v_lead public.leads;
  v_research public.research_snapshots;
  v_message public.outbound_messages;
  v_version text;
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);

  select member.* into v_member
  from public.campaign_members as member
  where member.id = p_campaign_member_id
    and member.organization_id = p_expected_organization_id;
  if v_member.id is null then
    raise exception 'Product Bridge staging context is unavailable' using errcode = 'P0002';
  end if;

  select campaign.* into v_campaign
  from public.campaigns as campaign
  where campaign.id = v_member.campaign_id
    and campaign.organization_id = p_expected_organization_id;
  select lead.* into v_lead
  from public.leads as lead
  where lead.id = v_member.lead_id and lead.org_id = p_expected_organization_id;
  if v_campaign.id is null or v_lead.id is null then
    raise exception 'Product Bridge staging context is unavailable' using errcode = 'P0002';
  end if;

  select snapshot.* into v_research
  from public.research_snapshots as snapshot
  where snapshot.campaign_member_id = v_member.id
    and snapshot.organization_id = p_expected_organization_id
  order by snapshot.version desc limit 1;
  select message.* into v_message
  from public.outbound_messages as message
  where message.campaign_member_id = v_member.id
    and message.organization_id = p_expected_organization_id
  order by message.version desc limit 1;

  v_version := public.product_bridge_staging_context_version(
    p_expected_organization_id, p_campaign_member_id
  );
  if v_version is null then
    raise exception 'Product Bridge staging context is unavailable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'organizationId', p_expected_organization_id,
    'actorSubject', 'user:' || v_actor::text,
    'campaignMember', jsonb_build_object(
      'id', v_member.id, 'status', v_member.status, 'updatedAt', v_member.updated_at
    ),
    'campaign', jsonb_build_object(
      'id', v_campaign.id, 'channel', v_campaign.default_channel,
      'defaultLanguage', v_campaign.default_language, 'updatedAt', v_campaign.updated_at
    ),
    'lead', jsonb_build_object(
      'language', v_lead.language, 'updatedAt', v_lead.updated_at
    ),
    'latestResearch', case when v_research.id is null then null else jsonb_build_object(
      'id', v_research.id, 'version', v_research.version, 'createdAt', v_research.created_at
    ) end,
    'latestOutboundMessage', case when v_message.id is null then null else jsonb_build_object(
      'id', v_message.id, 'version', v_message.version,
      'status', v_message.status, 'updatedAt', v_message.updated_at
    ) end,
    'freshness', jsonb_build_object(
      'subjectType', 'campaign_member_staging_context',
      'subjectId', v_member.id,
      'version', v_version,
      'generatedAt', now()
    )
  );
end;
$$;

create or replace function public.claim_product_bridge_write(
  p_expected_organization_id uuid,
  p_operation_id text,
  p_idempotency_key text,
  p_semantic_fingerprint text,
  p_claim_token uuid,
  p_lease_seconds integer,
  p_provenance jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
  v_request public.product_bridge_write_requests;
  v_inserted boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);
  if p_operation_id not in ('crm.research.stageSnapshot', 'crm.email.stageDraft')
     or p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 200
     or p_idempotency_key ~ '[[:cntrl:]]'
     or p_semantic_fingerprint !~ '^sha256:[0-9a-f]{64}$'
     or p_claim_token is null
     or p_lease_seconds not between 15 and 300
     or jsonb_typeof(p_provenance) <> 'object'
     or octet_length(p_provenance::text) > 4096
     or not (
       case
         when coalesce(p_provenance ->> 'campaignMemberId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and coalesce(p_provenance ->> 'stagedEntityId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and coalesce(p_provenance ->> 'sourceSnapshotId', '') ~ '^sha256:[0-9a-f]{64}$'
         then public.product_bridge_valid_provenance(
           p_provenance, p_expected_organization_id, p_operation_id,
           (p_provenance ->> 'campaignMemberId')::uuid,
           p_provenance ->> 'sourceSnapshotId',
           (p_provenance ->> 'stagedEntityId')::uuid,
           v_actor
         )
         else false
       end
     ) then
    raise exception 'Invalid Product Bridge write claim' using errcode = '22023';
  end if;

  insert into public.product_bridge_write_requests as request (
    organization_id, actor_user_id, product_id, operation_id, idempotency_key,
    semantic_fingerprint, claim_token, lease_expires_at, provenance
  ) values (
    p_expected_organization_id, v_actor, 'sprint-crm', p_operation_id,
    p_idempotency_key, p_semantic_fingerprint, p_claim_token,
    v_now + make_interval(secs => p_lease_seconds), p_provenance
  )
  on conflict on constraint product_bridge_write_requests_address_key do nothing
  returning true into v_inserted;

  select request.* into v_request
  from public.product_bridge_write_requests as request
  where request.organization_id = p_expected_organization_id
    and request.product_id = 'sprint-crm'
    and request.operation_id = p_operation_id
    and request.idempotency_key = p_idempotency_key
  for update of request;

  if v_request.id is null then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;
  if v_request.actor_user_id <> v_actor
     or v_request.semantic_fingerprint <> p_semantic_fingerprint then
    return jsonb_build_object('outcome', 'CONFLICT');
  end if;
  if v_request.status = 'completed' then
    return jsonb_build_object('outcome', 'REPLAY', 'receipt', v_request.receipt);
  end if;
  if coalesce(v_inserted, false) then
    return jsonb_build_object(
      'outcome', 'CLAIMED', 'requestLedgerId', v_request.id,
      'leaseExpiresAt', v_request.lease_expires_at
    );
  end if;
  if v_request.lease_expires_at > v_now then
    return jsonb_build_object('outcome', 'IN_PROGRESS');
  end if;

  update public.product_bridge_write_requests as request
  set claim_token = p_claim_token,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      provenance = p_provenance
  where request.id = v_request.id
  returning request.* into v_request;

  return jsonb_build_object(
    'outcome', 'CLAIMED', 'requestLedgerId', v_request.id,
    'leaseExpiresAt', v_request.lease_expires_at, 'reclaimed', true
  );
end;
$$;

create or replace function public.release_product_bridge_write(
  p_expected_organization_id uuid,
  p_operation_id text,
  p_idempotency_key text,
  p_semantic_fingerprint text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
  v_deleted uuid;
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);
  delete from public.product_bridge_write_requests as request
  where request.organization_id = p_expected_organization_id
    and request.actor_user_id = v_actor
    and request.product_id = 'sprint-crm'
    and request.operation_id = p_operation_id
    and request.idempotency_key = p_idempotency_key
    and request.semantic_fingerprint = p_semantic_fingerprint
    and request.claim_token = p_claim_token
    and request.status = 'pending'
  returning request.id into v_deleted;
  return v_deleted is not null;
end;
$$;

create or replace function public.stage_product_bridge_research_snapshot(
  p_expected_organization_id uuid,
  p_idempotency_key text,
  p_semantic_fingerprint text,
  p_claim_token uuid,
  p_campaign_member_id uuid,
  p_source_snapshot_id text,
  p_staged_entity_id uuid,
  p_expected_version integer,
  p_observed_opportunity text,
  p_recommended_offer text,
  p_evidence jsonb,
  p_recommended_case text,
  p_confidence numeric,
  p_warnings jsonb,
  p_provenance jsonb,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor uuid;
  v_request public.product_bridge_write_requests;
  v_member public.campaign_members;
  v_current_freshness text;
  v_next_version integer;
  v_snapshot public.research_snapshots;
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);
  select request.* into v_request
  from public.product_bridge_write_requests as request
  where request.organization_id = p_expected_organization_id
    and request.product_id = 'sprint-crm'
    and request.operation_id = 'crm.research.stageSnapshot'
    and request.idempotency_key = p_idempotency_key
  for update of request;

  if v_request.id is null or v_request.actor_user_id <> v_actor
     or v_request.semantic_fingerprint <> p_semantic_fingerprint then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;
  if v_request.status = 'completed' then
    return jsonb_build_object('outcome', 'REPLAY', 'receipt', v_request.receipt);
  end if;
  if v_request.claim_token <> p_claim_token or v_request.lease_expires_at <= clock_timestamp() then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;

  if p_source_snapshot_id !~ '^sha256:[0-9a-f]{64}$'
     or p_staged_entity_id is null or p_expected_version < 1
     or p_observed_opportunity is null or p_observed_opportunity <> btrim(p_observed_opportunity)
     or char_length(p_observed_opportunity) not between 50 and 900
     or p_observed_opportunity ~ '[[:cntrl:]]'
     or p_recommended_offer is null or p_recommended_offer <> btrim(p_recommended_offer)
     or char_length(p_recommended_offer) not between 30 and 700
     or p_recommended_offer ~ '[[:cntrl:]]'
     or (p_recommended_case is not null and (
       p_recommended_case <> btrim(p_recommended_case)
       or char_length(p_recommended_case) not between 1 and 700
       or p_recommended_case ~ '[[:cntrl:]]'
     ))
     or (p_confidence is not null and (
       p_confidence::text = 'NaN' or p_confidence < 0 or p_confidence > 0.85
     ))
     or not public.product_bridge_valid_research_evidence(p_evidence)
     or not public.product_bridge_valid_warnings(p_warnings)
     or not public.product_bridge_valid_provenance(
       p_provenance, p_expected_organization_id, 'crm.research.stageSnapshot',
       p_campaign_member_id, p_source_snapshot_id, p_staged_entity_id, v_actor
     )
     or not public.product_bridge_valid_receipt(
       p_receipt, p_staged_entity_id, p_source_snapshot_id
     ) then
    raise exception 'Invalid staged research snapshot' using errcode = '22023';
  end if;

  select member.* into v_member
  from public.campaign_members as member
  where member.id = p_campaign_member_id
    and member.organization_id = p_expected_organization_id
  for update of member;
  if v_member.id is null then
    raise exception 'Product Bridge staging target is unavailable' using errcode = 'P0002';
  end if;

  v_current_freshness := public.product_bridge_staging_context_version(
    p_expected_organization_id, p_campaign_member_id
  );
  if v_current_freshness is null or v_current_freshness <> p_source_snapshot_id then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;
  if v_member.status not in ('queued', 'researching', 'research_ready') then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'INVALID_STATE');
  end if;

  select coalesce(max(snapshot.version), 0) + 1 into v_next_version
  from public.research_snapshots as snapshot
  where snapshot.campaign_member_id = v_member.id;
  if v_next_version <> p_expected_version then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;

  insert into public.research_snapshots as snapshot (
    id, organization_id, campaign_member_id, version, source,
    observed_opportunity, recommended_offer, recommended_case,
    evidence, confidence, warnings, ai_generation_id, created_by
  ) values (
    p_staged_entity_id, p_expected_organization_id, v_member.id, v_next_version, 'bridge',
    p_observed_opportunity, p_recommended_offer, p_recommended_case,
    p_evidence, p_confidence, p_warnings, null, v_actor
  ) returning snapshot.* into v_snapshot;

  update public.campaign_members as member
  set status = 'research_ready', last_error = null
  where member.id = v_member.id;

  insert into public.audit_events as audit_event (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_expected_organization_id, 'human', v_actor,
    'product_bridge.research.staged', 'research_snapshot', v_snapshot.id,
    jsonb_build_object(
      'campaign_member_id', v_member.id, 'version', v_snapshot.version, 'source', 'bridge',
      'request_id', p_provenance ->> 'requestId',
      'correlation_id', p_provenance ->> 'correlationId',
      'source_snapshot_id', p_source_snapshot_id,
      'product_bridge_write_request_id', v_request.id
    )
  );
  insert into public.activities as activity (org_id, owner, lead_id, type, meta)
  values (
    p_expected_organization_id, v_actor, v_member.lead_id, 'research_saved',
    jsonb_build_object(
      'campaign_member_id', v_member.id, 'research_snapshot_id', v_snapshot.id,
      'version', v_snapshot.version, 'source', 'bridge'
    )
  );

  update public.product_bridge_write_requests as request
  set status = 'completed', receipt = p_receipt,
      staged_entity_type = 'research_snapshot', staged_entity_id = v_snapshot.id,
      provenance = p_provenance, completed_at = clock_timestamp(),
      lease_expires_at = clock_timestamp()
  where request.id = v_request.id;

  return jsonb_build_object(
    'outcome', 'COMPLETED', 'receipt', p_receipt,
    'stagedEntity', jsonb_build_object(
      'type', 'research_snapshot', 'id', v_snapshot.id,
      'version', v_snapshot.version, 'status', 'research_ready'
    )
  );
end;
$$;

create or replace function public.stage_product_bridge_email_draft(
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
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor uuid;
  v_request public.product_bridge_write_requests;
  v_member public.campaign_members;
  v_campaign public.campaigns;
  v_research public.research_snapshots;
  v_current_freshness text;
  v_next_version integer;
  v_message public.outbound_messages;
begin
  v_actor := public.product_bridge_require_actor(p_expected_organization_id);
  select request.* into v_request
  from public.product_bridge_write_requests as request
  where request.organization_id = p_expected_organization_id
    and request.product_id = 'sprint-crm'
    and request.operation_id = 'crm.email.stageDraft'
    and request.idempotency_key = p_idempotency_key
  for update of request;

  if v_request.id is null or v_request.actor_user_id <> v_actor
     or v_request.semantic_fingerprint <> p_semantic_fingerprint then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;
  if v_request.status = 'completed' then
    return jsonb_build_object('outcome', 'REPLAY', 'receipt', v_request.receipt);
  end if;
  if v_request.claim_token <> p_claim_token or v_request.lease_expires_at <= clock_timestamp() then
    raise exception 'Product Bridge write claim is unavailable' using errcode = 'P0002';
  end if;

  if p_source_snapshot_id !~ '^sha256:[0-9a-f]{64}$'
     or p_staged_entity_id is null or p_expected_version < 1
     or p_research_snapshot_id is null
     or p_subject is null or p_subject <> btrim(p_subject)
     or char_length(p_subject) not between 5 and 120
     or p_subject ~ '[[:cntrl:]]'
     or p_subject ~ '[<>]' or p_subject ~ '[{}]|<<|>>|\[\[|\]\]'
     or p_body is null or p_body <> btrim(p_body)
     or char_length(p_body) not between 120 and 2400
     or regexp_replace(p_body, E'[\\n\\r\\t]', '', 'g') ~ '[[:cntrl:]]'
     or p_body ~ '[<>]' or p_body ~ '[{}]|<<|>>|\[\[|\]\]'
     or p_language not in ('en', 'es', 'uk', 'ru')
     or not public.product_bridge_valid_provenance(
       p_provenance, p_expected_organization_id, 'crm.email.stageDraft',
       p_campaign_member_id, p_source_snapshot_id, p_staged_entity_id, v_actor
     )
     or not public.product_bridge_valid_receipt(
       p_receipt, p_staged_entity_id, p_source_snapshot_id
     ) then
    raise exception 'Invalid staged email draft' using errcode = '22023';
  end if;

  select member.* into v_member
  from public.campaign_members as member
  where member.id = p_campaign_member_id
    and member.organization_id = p_expected_organization_id
  for update of member;
  if v_member.id is null then
    raise exception 'Product Bridge staging target is unavailable' using errcode = 'P0002';
  end if;
  select campaign.* into v_campaign
  from public.campaigns as campaign
  where campaign.id = v_member.campaign_id
    and campaign.organization_id = p_expected_organization_id
  for key share of campaign;
  if v_campaign.id is null or v_campaign.default_channel <> 'email' then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'INVALID_STATE');
  end if;

  v_current_freshness := public.product_bridge_staging_context_version(
    p_expected_organization_id, p_campaign_member_id
  );
  if v_current_freshness is null or v_current_freshness <> p_source_snapshot_id then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;
  if v_member.status not in ('research_ready', 'draft_ready') then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'INVALID_STATE');
  end if;

  select snapshot.* into v_research
  from public.research_snapshots as snapshot
  where snapshot.campaign_member_id = v_member.id
    and snapshot.organization_id = p_expected_organization_id
  order by snapshot.version desc limit 1
  for key share of snapshot;
  if v_research.id is null or v_research.id <> p_research_snapshot_id then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;

  select coalesce(max(message.version), 0) + 1 into v_next_version
  from public.outbound_messages as message
  where message.campaign_member_id = v_member.id;
  if v_next_version <> p_expected_version then
    delete from public.product_bridge_write_requests as request where request.id = v_request.id;
    return jsonb_build_object('outcome', 'STALE', 'currentFreshness', v_current_freshness);
  end if;

  insert into public.outbound_messages as message (
    id, organization_id, campaign_member_id, version, source, channel, language,
    subject, body, status, research_snapshot_id, template_version_id,
    ai_generation_id, approved_by, approved_at, sent_at, created_by
  ) values (
    p_staged_entity_id, p_expected_organization_id, v_member.id, v_next_version,
    'bridge', 'email', p_language, p_subject, p_body, 'draft',
    v_research.id, null, null, null, null, null, v_actor
  ) returning message.* into v_message;

  update public.campaign_members as member
  set status = 'draft_ready', last_error = null
  where member.id = v_member.id;

  insert into public.audit_events as audit_event (
    organization_id, actor_type, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_expected_organization_id, 'human', v_actor,
    'product_bridge.email_draft.staged', 'outbound_message', v_message.id,
    jsonb_build_object(
      'campaign_member_id', v_member.id, 'version', v_message.version,
      'status', v_message.status, 'source', 'bridge',
      'research_snapshot_id', v_research.id, 'research_version', v_research.version,
      'request_id', p_provenance ->> 'requestId',
      'correlation_id', p_provenance ->> 'correlationId',
      'source_snapshot_id', p_source_snapshot_id,
      'product_bridge_write_request_id', v_request.id
    )
  );
  insert into public.activities as activity (org_id, owner, lead_id, type, channel, meta)
  values (
    p_expected_organization_id, v_actor, v_member.lead_id,
    'outreach_draft_saved', 'email',
    jsonb_build_object(
      'campaign_member_id', v_member.id, 'outbound_message_id', v_message.id,
      'version', v_message.version, 'status', 'draft', 'source', 'bridge',
      'research_snapshot_id', v_research.id, 'research_version', v_research.version
    )
  );

  update public.product_bridge_write_requests as request
  set status = 'completed', receipt = p_receipt,
      staged_entity_type = 'outbound_message', staged_entity_id = v_message.id,
      provenance = p_provenance, completed_at = clock_timestamp(),
      lease_expires_at = clock_timestamp()
  where request.id = v_request.id;

  return jsonb_build_object(
    'outcome', 'COMPLETED', 'receipt', p_receipt,
    'stagedEntity', jsonb_build_object(
      'type', 'outbound_message', 'id', v_message.id,
      'version', v_message.version, 'status', v_message.status
    )
  );
end;
$$;

revoke all on function public.product_bridge_json_object_has_only_keys(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.product_bridge_json_has_forbidden_key(jsonb) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_provenance(jsonb, uuid, text, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_safe_diagnostics(jsonb) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_receipt(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_research_evidence(jsonb) from public, anon, authenticated;
revoke all on function public.product_bridge_valid_warnings(jsonb) from public, anon, authenticated;
revoke all on function public.product_bridge_require_actor(uuid) from public, anon, authenticated;
revoke all on function public.product_bridge_staging_context_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_product_bridge_staging_context(uuid, uuid) from public, anon;
revoke all on function public.claim_product_bridge_write(uuid, text, text, text, uuid, integer, jsonb) from public, anon;
revoke all on function public.release_product_bridge_write(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.stage_product_bridge_research_snapshot(uuid, text, text, uuid, uuid, text, uuid, integer, text, text, jsonb, text, numeric, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.stage_product_bridge_email_draft(uuid, text, text, uuid, uuid, text, uuid, integer, uuid, text, text, text, jsonb, jsonb) from public, anon;

grant execute on function public.get_product_bridge_staging_context(uuid, uuid) to authenticated;
grant execute on function public.claim_product_bridge_write(uuid, text, text, text, uuid, integer, jsonb) to authenticated;
grant execute on function public.release_product_bridge_write(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.stage_product_bridge_research_snapshot(uuid, text, text, uuid, uuid, text, uuid, integer, text, text, jsonb, text, numeric, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.stage_product_bridge_email_draft(uuid, text, text, uuid, uuid, text, uuid, integer, uuid, text, text, text, jsonb, jsonb) to authenticated;

commit;
