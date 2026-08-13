-- CRM-GMAIL-00A-FIX-03: align persistence with capability-based Google scope validation.
-- The signed ID token proves identity in the Edge callback. This RPC requires the
-- exact Gmail send capability and rejects every scope outside the accepted set.

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
    or not coalesce(
      p_granted_scopes @> array[
        'https://www.googleapis.com/auth/gmail.send'
      ]::text[],
      false
    )
    or exists (
      select 1
      from unnest(coalesce(p_granted_scopes, array[]::text[])) as granted_scope(scope_name)
      where granted_scope.scope_name <> all (array[
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/gmail.send'
      ]::text[])
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
