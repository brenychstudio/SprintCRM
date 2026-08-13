-- CRM-GMAIL-00A: Gmail account identity, OAuth custody, and additive
-- communication-domain foundation. This migration does not create a Gmail
-- draft, send a message, or read mailbox content.

create extension if not exists citext with schema extensions;
create extension if not exists supabase_vault with schema vault;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

alter type public.next_action add value if not exists 'review_reply';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'outbound_messages_id_organization_id_key'
  ) then
    alter table public.outbound_messages
      add constraint outbound_messages_id_organization_id_key unique (id, organization_id);
  end if;
end $$;

create table public.mailbox_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  provider text not null default 'gmail'
    constraint mailbox_accounts_provider_check check (provider = 'gmail'),
  provider_account_subject text not null
    constraint mailbox_accounts_subject_check check (btrim(provider_account_subject) <> ''),
  email_address extensions.citext not null
    constraint mailbox_accounts_email_check check (btrim(email_address::text) <> ''),
  display_name text,
  status text not null default 'connected'
    constraint mailbox_accounts_status_check check (status in (
      'connected', 'reauthorization_required', 'disconnected', 'revoked', 'error'
    )),
  granted_scopes text[] not null default '{}'::text[]
    constraint mailbox_accounts_scopes_check check (
      array_position(granted_scopes, '') is null
    ),
  connected_by_user_id uuid not null references auth.users(id) on delete restrict,
  connected_at timestamptz,
  last_verified_at timestamptz,
  reauthorization_required_at timestamptz,
  disconnected_at timestamptz,
  revoked_at timestamptz,
  last_revocation_outcome text
    constraint mailbox_accounts_revocation_outcome_check check (
      last_revocation_outcome is null
      or last_revocation_outcome in ('confirmed', 'already_invalid', 'unconfirmed')
    ),
  last_safe_error_code text
    constraint mailbox_accounts_safe_error_check check (
      last_safe_error_code is null or last_safe_error_code ~ '^[a-z0-9_]{1,64}$'
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailbox_accounts_org_provider_subject_key
    unique (organization_id, provider, provider_account_subject),
  constraint mailbox_accounts_id_organization_id_key unique (id, organization_id),
  constraint mailbox_accounts_connection_time_check check (
    status <> 'connected' or (connected_at is not null and last_verified_at is not null)
  )
);

create table private.gmail_oauth_requests (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  initiating_user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique
    constraint gmail_oauth_requests_state_hash_check
    check (state_hash ~ '^sha256:[0-9a-f]{64}$'),
  nonce text not null check (length(nonce) between 32 and 256),
  pkce_code_verifier text not null
    constraint gmail_oauth_requests_verifier_check
    check (
      length(pkce_code_verifier) between 43 and 128
      and pkce_code_verifier ~ '^[A-Za-z0-9._~-]+$'
    ),
  requested_scopes text[] not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  status text not null default 'pending'
    constraint gmail_oauth_requests_status_check check (
      status in ('pending', 'claimed', 'completed', 'failed', 'expired')
    ),
  safe_error_code text
    constraint gmail_oauth_requests_safe_error_check check (
      safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'
    ),
  constraint gmail_oauth_requests_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '10 minutes'
  ),
  constraint gmail_oauth_requests_consumption_check check (
    (status = 'pending' and consumed_at is null)
    or (status <> 'pending' and consumed_at is not null)
  ),
  constraint gmail_oauth_requests_id_organization_id_key unique (id, organization_id)
);

create table private.mailbox_account_credentials (
  mailbox_account_id uuid primary key,
  organization_id uuid not null,
  refresh_token_secret_id uuid not null unique references vault.secrets(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailbox_account_credentials_account_org_fkey
    foreign key (mailbox_account_id, organization_id)
    references public.mailbox_accounts(id, organization_id) on delete cascade
);

create table public.communication_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  mailbox_account_id uuid not null,
  provider text not null default 'gmail'
    constraint communication_threads_provider_check check (provider = 'gmail'),
  provider_thread_id text not null check (btrim(provider_thread_id) <> ''),
  normalized_subject text,
  first_message_at timestamptz,
  latest_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communication_threads_account_org_fkey
    foreign key (mailbox_account_id, organization_id)
    references public.mailbox_accounts(id, organization_id) on delete restrict,
  constraint communication_threads_provider_identity_key
    unique (organization_id, mailbox_account_id, provider_thread_id),
  constraint communication_threads_id_organization_id_key unique (id, organization_id),
  constraint communication_threads_full_identity_key
    unique (id, organization_id, mailbox_account_id, provider_thread_id),
  constraint communication_threads_time_order_check check (
    first_message_at is null or latest_message_at is null or latest_message_at >= first_message_at
  )
);

create table public.communication_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  communication_thread_id uuid not null,
  lead_id uuid,
  campaign_member_id uuid,
  outbound_message_id uuid,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint communication_links_thread_org_fkey
    foreign key (communication_thread_id, organization_id)
    references public.communication_threads(id, organization_id) on delete cascade,
  constraint communication_links_lead_org_fkey
    foreign key (lead_id, organization_id)
    references public.leads(id, org_id) on delete restrict,
  constraint communication_links_campaign_member_org_fkey
    foreign key (campaign_member_id, organization_id)
    references public.campaign_members(id, organization_id) on delete restrict,
  constraint communication_links_outbound_message_org_fkey
    foreign key (outbound_message_id, organization_id)
    references public.outbound_messages(id, organization_id) on delete restrict,
  constraint communication_links_has_target_check check (
    lead_id is not null or campaign_member_id is not null or outbound_message_id is not null
  ),
  constraint communication_links_identity_key unique nulls not distinct (
    communication_thread_id, lead_id, campaign_member_id, outbound_message_id
  )
);

create table public.external_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  mailbox_account_id uuid not null,
  communication_thread_id uuid not null,
  direction text not null
    constraint external_messages_direction_check check (direction in ('inbound', 'outbound')),
  provider_message_id text not null check (btrim(provider_message_id) <> ''),
  provider_thread_id text not null check (btrim(provider_thread_id) <> ''),
  rfc_message_id text,
  in_reply_to text,
  "references" text[] not null default '{}'::text[],
  from_address extensions.citext,
  to_addresses extensions.citext[] not null default '{}'::extensions.citext[],
  cc_addresses extensions.citext[] not null default '{}'::extensions.citext[],
  bcc_addresses extensions.citext[] not null default '{}'::extensions.citext[],
  subject text,
  snippet text,
  body_text text,
  body_html_sanitized text,
  provider_internal_at timestamptz not null,
  observed_at timestamptz not null default now(),
  ingest_source text not null
    constraint external_messages_ingest_source_check check (
      ingest_source in ('gmail_sync', 'send_reconciliation', 'manual')
    ),
  created_at timestamptz not null default now(),
  constraint external_messages_account_org_fkey
    foreign key (mailbox_account_id, organization_id)
    references public.mailbox_accounts(id, organization_id) on delete restrict,
  constraint external_messages_thread_identity_fkey
    foreign key (
      communication_thread_id, organization_id, mailbox_account_id, provider_thread_id
    ) references public.communication_threads(
      id, organization_id, mailbox_account_id, provider_thread_id
    ) on delete restrict,
  constraint external_messages_provider_identity_key
    unique (organization_id, mailbox_account_id, provider_message_id),
  constraint external_messages_id_organization_id_key unique (id, organization_id)
);

create table public.email_send_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  mailbox_account_id uuid not null,
  outbound_message_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  stable_rfc_message_id text not null check (btrim(stable_rfc_message_id) <> ''),
  status text not null default 'pending'
    constraint email_send_requests_status_check check (status in (
      'pending', 'claimed', 'sending', 'sent', 'reconcile_required', 'failed', 'cancelled'
    )),
  provider_message_id text,
  provider_thread_id text,
  provider_response_safe jsonb not null default '{}'::jsonb
    constraint email_send_requests_safe_response_check check (
      jsonb_typeof(provider_response_safe) = 'object'
      and not (provider_response_safe ?| array[
        'access_token', 'refresh_token', 'id_token', 'authorization_code', 'raw_response'
      ])
    ),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  provider_called_at timestamptz,
  sent_at timestamptz,
  reconcile_required_at timestamptz,
  failed_at timestamptz,
  last_safe_error_code text
    constraint email_send_requests_safe_error_check check (
      last_safe_error_code is null or last_safe_error_code ~ '^[a-z0-9_]{1,64}$'
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_send_requests_account_org_fkey
    foreign key (mailbox_account_id, organization_id)
    references public.mailbox_accounts(id, organization_id) on delete restrict,
  constraint email_send_requests_outbound_org_fkey
    foreign key (outbound_message_id, organization_id)
    references public.outbound_messages(id, organization_id) on delete restrict,
  constraint email_send_requests_idempotency_key unique (organization_id, idempotency_key),
  constraint email_send_requests_outbound_account_key
    unique (organization_id, mailbox_account_id, outbound_message_id),
  constraint email_send_requests_stable_message_id_key
    unique (organization_id, stable_rfc_message_id),
  constraint email_send_requests_sent_evidence_check check (
    (status = 'sent' and sent_at is not null and provider_message_id is not null)
    or (status <> 'sent' and sent_at is null)
  )
);

create index idx_mailbox_accounts_organization_status
  on public.mailbox_accounts(organization_id, status);
create index idx_gmail_oauth_requests_expiry
  on private.gmail_oauth_requests(expires_at) where status = 'pending';
create index idx_communication_threads_latest
  on public.communication_threads(organization_id, latest_message_at desc);
create index idx_communication_links_lead
  on public.communication_links(organization_id, lead_id) where lead_id is not null;
create index idx_communication_links_campaign_member
  on public.communication_links(organization_id, campaign_member_id) where campaign_member_id is not null;
create index idx_communication_links_outbound
  on public.communication_links(organization_id, outbound_message_id) where outbound_message_id is not null;
create index idx_external_messages_thread_time
  on public.external_messages(communication_thread_id, provider_internal_at);
create index idx_email_send_requests_status
  on public.email_send_requests(organization_id, status, requested_at);

create trigger trg_mailbox_accounts_set_updated_at
before update on public.mailbox_accounts
for each row execute function public.set_updated_at();

create trigger trg_mailbox_account_credentials_set_updated_at
before update on private.mailbox_account_credentials
for each row execute function public.set_updated_at();

create trigger trg_communication_threads_set_updated_at
before update on public.communication_threads
for each row execute function public.set_updated_at();

create trigger trg_email_send_requests_set_updated_at
before update on public.email_send_requests
for each row execute function public.set_updated_at();

create or replace function private.prevent_gmail_identity_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if tg_table_name = 'mailbox_accounts' then
    if new.organization_id is distinct from old.organization_id
      or new.provider is distinct from old.provider
      or new.provider_account_subject is distinct from old.provider_account_subject
    then
      raise exception 'mailbox provider identity is immutable' using errcode = '23514';
    end if;
  elsif tg_table_name = 'communication_threads' then
    if new.organization_id is distinct from old.organization_id
      or new.mailbox_account_id is distinct from old.mailbox_account_id
      or new.provider is distinct from old.provider
      or new.provider_thread_id is distinct from old.provider_thread_id
    then
      raise exception 'communication thread provider identity is immutable' using errcode = '23514';
    end if;
  elsif tg_table_name = 'external_messages' then
    if new.organization_id is distinct from old.organization_id
      or new.mailbox_account_id is distinct from old.mailbox_account_id
      or new.communication_thread_id is distinct from old.communication_thread_id
      or new.provider_message_id is distinct from old.provider_message_id
      or new.provider_thread_id is distinct from old.provider_thread_id
    then
      raise exception 'external provider message identity is immutable' using errcode = '23514';
    end if;
  elsif tg_table_name = 'email_send_requests' then
    if new.organization_id is distinct from old.organization_id
      or new.mailbox_account_id is distinct from old.mailbox_account_id
      or new.outbound_message_id is distinct from old.outbound_message_id
      or new.idempotency_key is distinct from old.idempotency_key
      or new.stable_rfc_message_id is distinct from old.stable_rfc_message_id
    then
      raise exception 'email send request identity is immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_mailbox_accounts_identity_immutable
before update on public.mailbox_accounts
for each row execute function private.prevent_gmail_identity_change();

create trigger trg_communication_threads_identity_immutable
before update on public.communication_threads
for each row execute function private.prevent_gmail_identity_change();

create trigger trg_external_messages_identity_immutable
before update on public.external_messages
for each row execute function private.prevent_gmail_identity_change();

create trigger trg_email_send_requests_identity_immutable
before update on public.email_send_requests
for each row execute function private.prevent_gmail_identity_change();

alter table public.mailbox_accounts enable row level security;
alter table public.communication_threads enable row level security;
alter table public.communication_links enable row level security;
alter table public.external_messages enable row level security;
alter table public.email_send_requests enable row level security;

create policy mailbox_accounts_member_select on public.mailbox_accounts
for select to authenticated using (public.is_org_member(organization_id));
create policy communication_threads_member_select on public.communication_threads
for select to authenticated using (public.is_org_member(organization_id));
create policy communication_links_member_select on public.communication_links
for select to authenticated using (public.is_org_member(organization_id));
create policy external_messages_member_select on public.external_messages
for select to authenticated using (public.is_org_member(organization_id));
create policy email_send_requests_member_select on public.email_send_requests
for select to authenticated using (public.is_org_member(organization_id));

revoke all on table public.mailbox_accounts from public, anon, authenticated;
revoke all on table public.communication_threads from public, anon, authenticated;
revoke all on table public.communication_links from public, anon, authenticated;
revoke all on table public.external_messages from public, anon, authenticated;
revoke all on table public.email_send_requests from public, anon, authenticated;
grant select on table public.mailbox_accounts to authenticated;
grant select on table public.communication_threads to authenticated;
grant select on table public.communication_links to authenticated;
grant select on table public.external_messages to authenticated;
grant select on table public.email_send_requests to authenticated;

revoke all on table private.gmail_oauth_requests from public, anon, authenticated, service_role;
revoke all on table private.mailbox_account_credentials from public, anon, authenticated, service_role;
revoke all on table vault.secrets from public, anon, authenticated, service_role;
revoke all on table vault.decrypted_secrets from public, anon, authenticated, service_role;

create or replace function public.create_gmail_oauth_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_state_hash text,
  p_nonce text,
  p_pkce_code_verifier text,
  p_requested_scopes text[],
  p_expires_at timestamptz
)
returns table (request_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_org_member(p_organization_id) then
    raise exception 'gmail_unauthorized' using errcode = '42501';
  end if;
  if p_state_hash !~ '^sha256:[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '10 minutes'
    or not (
      p_requested_scopes @> array[
        'openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send'
      ]::text[]
      and p_requested_scopes <@ array[
        'openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send'
      ]::text[]
    )
  then
    raise exception 'gmail_invalid_oauth_request' using errcode = '22023';
  end if;

  insert into private.gmail_oauth_requests (
    id, organization_id, initiating_user_id, state_hash, nonce,
    pkce_code_verifier, requested_scopes, expires_at
  ) values (
    p_request_id, p_organization_id, v_user_id, p_state_hash, p_nonce,
    p_pkce_code_verifier, p_requested_scopes, p_expires_at
  );

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type,
    entity_id, request_id, payload
  ) values (
    p_organization_id, 'human', v_user_id, 'gmail.oauth.requested',
    'gmail_oauth_request', p_request_id, p_request_id,
    jsonb_build_object('provider', 'gmail', 'expires_at', p_expires_at, 'scopes', p_requested_scopes)
  );

  return query select p_request_id, p_expires_at;
end;
$$;

create or replace function public.claim_gmail_oauth_callback(p_state_hash text)
returns table (
  claim_outcome text,
  request_id uuid,
  organization_id uuid,
  initiating_user_id uuid,
  nonce text,
  pkce_code_verifier text,
  requested_scopes text[]
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_request private.gmail_oauth_requests%rowtype;
begin
  select request.* into v_request
  from private.gmail_oauth_requests as request
  where request.state_hash = p_state_hash
  for update;

  if not found then
    return query select 'INVALID'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::text, null::text[];
    return;
  end if;
  if v_request.status <> 'pending' or v_request.consumed_at is not null then
    return query select 'REPLAYED'::text, v_request.id, null::uuid, null::uuid,
      null::text, null::text, null::text[];
    return;
  end if;
  if v_request.expires_at <= now() then
    update private.gmail_oauth_requests
    set status = 'expired', consumed_at = now(), safe_error_code = 'oauth_state_expired'
    where id = v_request.id;
    return query select 'EXPIRED'::text, v_request.id, null::uuid, null::uuid,
      null::text, null::text, null::text[];
    return;
  end if;

  update private.gmail_oauth_requests
  set status = 'claimed', consumed_at = now()
  where id = v_request.id;

  return query select 'CLAIMED'::text, v_request.id, v_request.organization_id,
    v_request.initiating_user_id, v_request.nonce, v_request.pkce_code_verifier,
    v_request.requested_scopes;
end;
$$;

create or replace function public.fail_gmail_oauth_request(
  p_request_id uuid,
  p_safe_error_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_request private.gmail_oauth_requests%rowtype;
begin
  if p_safe_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'gmail_invalid_safe_error' using errcode = '22023';
  end if;
  update private.gmail_oauth_requests as request
  set status = 'failed', consumed_at = coalesce(request.consumed_at, now()),
      safe_error_code = p_safe_error_code
  where request.id = p_request_id and request.status in ('pending', 'claimed')
  returning request.* into v_request;
  if found then
    insert into public.audit_events (
      organization_id, actor_type, actor_user_id, event_type, entity_type,
      entity_id, request_id, payload
    ) values (
      v_request.organization_id, 'human', v_request.initiating_user_id,
      'gmail.oauth.failed', 'gmail_oauth_request', v_request.id, v_request.id,
      jsonb_build_object('safe_error_code', p_safe_error_code)
    );
  end if;
end;
$$;

create or replace function public.complete_gmail_account_connection(
  p_request_id uuid,
  p_provider_account_subject text,
  p_email_address text,
  p_display_name text,
  p_granted_scopes text[],
  p_refresh_token text
)
returns table (
  mailbox_account_id uuid,
  organization_id uuid,
  email_address text,
  status text,
  connected_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault, extensions
as $$
declare
  v_request private.gmail_oauth_requests%rowtype;
  v_account public.mailbox_accounts%rowtype;
  v_secret_id uuid;
begin
  select request.* into v_request
  from private.gmail_oauth_requests as request
  where request.id = p_request_id
  for update;
  if not found or v_request.status <> 'claimed' then
    raise exception 'gmail_oauth_request_not_claimed' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships as membership
    where membership.org_id = v_request.organization_id
      and membership.user_id = v_request.initiating_user_id
  ) then
    raise exception 'gmail_membership_revoked' using errcode = '42501';
  end if;
  if btrim(coalesce(p_provider_account_subject, '')) = ''
    or btrim(coalesce(p_email_address, '')) = ''
    or btrim(coalesce(p_refresh_token, '')) = ''
    or not (
      p_granted_scopes @> array[
        'openid', 'email', 'https://www.googleapis.com/auth/gmail.send'
      ]::text[]
    )
  then
    raise exception 'gmail_invalid_connection' using errcode = '22023';
  end if;

  insert into public.mailbox_accounts as account (
    organization_id, provider, provider_account_subject, email_address,
    display_name, status, granted_scopes, connected_by_user_id,
    connected_at, last_verified_at, reauthorization_required_at,
    disconnected_at, revoked_at, last_revocation_outcome, last_safe_error_code
  ) values (
    v_request.organization_id, 'gmail', p_provider_account_subject,
    p_email_address::extensions.citext, nullif(btrim(p_display_name), ''),
    'connected', p_granted_scopes, v_request.initiating_user_id,
    now(), now(), null, null, null, null, null
  )
  on conflict on constraint mailbox_accounts_org_provider_subject_key do update
  set email_address = excluded.email_address,
      display_name = excluded.display_name,
      status = 'connected',
      granted_scopes = excluded.granted_scopes,
      connected_by_user_id = excluded.connected_by_user_id,
      connected_at = now(),
      last_verified_at = now(),
      reauthorization_required_at = null,
      disconnected_at = null,
      revoked_at = null,
      last_revocation_outcome = null,
      last_safe_error_code = null
  returning account.* into v_account;

  select credential.refresh_token_secret_id into v_secret_id
  from private.mailbox_account_credentials as credential
  where credential.mailbox_account_id = v_account.id
  for update;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_refresh_token,
      'gmail-refresh-' || v_account.id::text,
      'SprintCRM Gmail refresh token'
    );
    insert into private.mailbox_account_credentials (
      mailbox_account_id, organization_id, refresh_token_secret_id
    ) values (v_account.id, v_account.organization_id, v_secret_id);
  else
    perform vault.update_secret(v_secret_id, p_refresh_token);
  end if;

  update private.gmail_oauth_requests
  set status = 'completed', safe_error_code = null
  where id = v_request.id;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type,
    entity_id, request_id, payload
  ) values (
    v_account.organization_id, 'human', v_request.initiating_user_id,
    'gmail.account.connected', 'mailbox_account', v_account.id, v_request.id,
    jsonb_build_object(
      'provider', 'gmail', 'email_address', v_account.email_address,
      'granted_scopes', p_granted_scopes
    )
  );

  return query select v_account.id, v_account.organization_id,
    v_account.email_address::text, v_account.status, v_account.connected_at;
end;
$$;

create or replace function public.get_gmail_refresh_credential(p_mailbox_account_id uuid)
returns table (
  organization_id uuid,
  refresh_token text,
  account_status text
)
language sql
security definer
set search_path = pg_catalog, public, private, vault
as $$
  select account.organization_id, secret.decrypted_secret, account.status
  from public.mailbox_accounts as account
  join private.mailbox_account_credentials as credential
    on credential.mailbox_account_id = account.id
    and credential.organization_id = account.organization_id
  join vault.decrypted_secrets as secret
    on secret.id = credential.refresh_token_secret_id
  where account.id = p_mailbox_account_id
    and account.provider = 'gmail';
$$;

create or replace function public.mark_gmail_reauthorization_required(
  p_mailbox_account_id uuid,
  p_safe_error_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_account public.mailbox_accounts%rowtype;
begin
  if p_safe_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'gmail_invalid_safe_error' using errcode = '22023';
  end if;
  update public.mailbox_accounts as account
  set status = 'reauthorization_required',
      reauthorization_required_at = now(),
      last_safe_error_code = p_safe_error_code
  where account.id = p_mailbox_account_id and account.status <> 'disconnected'
  returning account.* into v_account;
  if found then
    insert into public.audit_events (
      organization_id, actor_type, event_type, entity_type, entity_id, payload
    ) values (
      v_account.organization_id, 'system', 'gmail.account.reauthorization_required',
      'mailbox_account', v_account.id,
      jsonb_build_object('safe_error_code', p_safe_error_code)
    );
  end if;
end;
$$;

create or replace function public.complete_gmail_account_disconnect(
  p_mailbox_account_id uuid,
  p_actor_user_id uuid,
  p_revocation_outcome text,
  p_safe_error_code text default null
)
returns table (mailbox_account_id uuid, status text, revocation_outcome text)
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault
as $$
declare
  v_account public.mailbox_accounts%rowtype;
  v_secret_id uuid;
begin
  if p_revocation_outcome not in ('confirmed', 'already_invalid', 'unconfirmed')
    or (p_safe_error_code is not null and p_safe_error_code !~ '^[a-z0-9_]{1,64}$')
  then
    raise exception 'gmail_invalid_disconnect_result' using errcode = '22023';
  end if;

  select account.* into v_account
  from public.mailbox_accounts as account
  where account.id = p_mailbox_account_id
  for update;
  if not found or not exists (
    select 1 from public.memberships as membership
    where membership.org_id = v_account.organization_id
      and membership.user_id = p_actor_user_id
  ) then
    raise exception 'gmail_unauthorized' using errcode = '42501';
  end if;

  delete from private.mailbox_account_credentials as credential
  where credential.mailbox_account_id = v_account.id
  returning credential.refresh_token_secret_id into v_secret_id;
  if v_secret_id is not null then
    delete from vault.secrets as secret where secret.id = v_secret_id;
  end if;

  update public.mailbox_accounts as account
  set status = 'disconnected', disconnected_at = now(),
      revoked_at = case when p_revocation_outcome = 'confirmed' then now() else account.revoked_at end,
      last_revocation_outcome = p_revocation_outcome,
      last_safe_error_code = p_safe_error_code
  where account.id = v_account.id;

  insert into public.audit_events (
    organization_id, actor_type, actor_user_id, event_type, entity_type,
    entity_id, payload
  ) values (
    v_account.organization_id, 'human', p_actor_user_id,
    'gmail.account.disconnected', 'mailbox_account', v_account.id,
    jsonb_build_object(
      'provider', 'gmail', 'revocation_outcome', p_revocation_outcome,
      'safe_error_code', p_safe_error_code
    )
  );

  return query select v_account.id, 'disconnected'::text, p_revocation_outcome;
end;
$$;

revoke all on function private.prevent_gmail_identity_change() from public, anon, authenticated, service_role;
revoke all on function public.create_gmail_oauth_request(uuid, uuid, text, text, text, text[], timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.claim_gmail_oauth_callback(text) from public, anon, authenticated, service_role;
revoke all on function public.fail_gmail_oauth_request(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.complete_gmail_account_connection(uuid, text, text, text, text[], text) from public, anon, authenticated, service_role;
revoke all on function public.get_gmail_refresh_credential(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_gmail_reauthorization_required(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.complete_gmail_account_disconnect(uuid, uuid, text, text) from public, anon, authenticated, service_role;

grant execute on function public.create_gmail_oauth_request(uuid, uuid, text, text, text, text[], timestamptz) to authenticated;
grant execute on function public.claim_gmail_oauth_callback(text) to service_role;
grant execute on function public.fail_gmail_oauth_request(uuid, text) to service_role;
grant execute on function public.complete_gmail_account_connection(uuid, text, text, text, text[], text) to service_role;
grant execute on function public.get_gmail_refresh_credential(uuid) to service_role;
grant execute on function public.mark_gmail_reauthorization_required(uuid, text) to service_role;
grant execute on function public.complete_gmail_account_disconnect(uuid, uuid, text, text) to service_role;
