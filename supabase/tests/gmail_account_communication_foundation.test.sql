begin;

create extension if not exists pgtap with schema extensions;
select plan(37);

select has_table('public', 'mailbox_accounts', 'mailbox account metadata is public and safe');
select has_table('private', 'gmail_oauth_requests', 'OAuth request secrets are private');
select has_table('private', 'mailbox_account_credentials', 'refresh-token associations are private');
select has_table('public', 'communication_threads', 'communication threads are available additively');
select has_table('public', 'communication_links', 'communication links are available additively');
select has_table('public', 'external_messages', 'external provider facts have a dedicated table');
select has_table('public', 'email_send_requests', 'durable future send identity has a dedicated table');

select ok(
  'review_reply' = any(enum_range(null::public.next_action)::text[]),
  'review_reply is an understood additive next action'
);
select is(
  (select extname from pg_extension where extname = 'supabase_vault'),
  'supabase_vault',
  'refresh-token custody uses Supabase Vault'
);
select is(
  (select count(*)::integer from pg_class
   where relnamespace = 'public'::regnamespace
     and relname = any(array[
       'mailbox_accounts', 'communication_threads', 'communication_links',
       'external_messages', 'email_send_requests'
     ]) and relrowsecurity),
  5,
  'every public communication table has RLS enabled'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public'
     and tablename = any(array[
       'mailbox_accounts', 'communication_threads', 'communication_links',
       'external_messages', 'email_send_requests'
     ]) and cmd <> 'SELECT'),
  0,
  'no direct browser write policy exists for communication state'
);
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated cannot use the private schema');
select ok(not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select'), 'authenticated cannot read Vault plaintext');
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public'
     and table_name = any(array[
       'mailbox_accounts', 'communication_threads', 'communication_links',
       'external_messages', 'email_send_requests'
     ])
     and column_name = any(array[
       'access_token', 'refresh_token', 'id_token', 'client_secret',
       'authorization_code', 'pkce_code_verifier', 'refresh_token_secret_id'
     ])),
  0,
  'public communication tables expose no OAuth secrets'
);
select ok(exists(select 1 from pg_constraint where conname = 'mailbox_accounts_org_provider_subject_key'), 'account identity is unique by organization/provider/sub');
select ok(exists(select 1 from pg_constraint where conname = 'communication_threads_provider_identity_key'), 'thread provider identity is unique per account');
select ok(exists(select 1 from pg_constraint where conname = 'external_messages_provider_identity_key'), 'provider message identity is unique per account');
select ok(exists(select 1 from pg_constraint where conname = 'email_send_requests_idempotency_key'), 'send idempotency key is unique within an organization');
select ok(exists(select 1 from pg_constraint where conname = 'email_send_requests_outbound_account_key'), 'one account/outbound version cannot have duplicate send requests');
select ok(exists(select 1 from pg_constraint where conname = 'communication_links_has_target_check'), 'communication links require an authoritative CRM target');
select is(
  (select count(*)::integer from pg_constraint
   where conname = any(array[
     'mailbox_account_credentials_account_org_fkey',
     'communication_threads_account_org_fkey',
     'communication_links_thread_org_fkey',
     'communication_links_lead_org_fkey',
     'communication_links_campaign_member_org_fkey',
     'communication_links_outbound_message_org_fkey',
     'external_messages_account_org_fkey',
     'external_messages_thread_identity_fkey',
     'email_send_requests_account_org_fkey',
     'email_send_requests_outbound_org_fkey'
   ])),
  10,
  'all cross-domain links use organization-safe composite foreign keys'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, confirmed_at,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'gmail-owner@example.test', '', now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-8000-000000000000', '11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other-owner@example.test', '', now(), now(), now(), '', '', '', '');

insert into public.organizations (id, name, created_by) values
  ('21000000-0000-4000-8000-000000000001', 'Gmail test organization', '11000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000002', 'Other organization', '11000000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role) values
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'owner'),
  ('21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'owner');

create temporary table gmail_test_state (key text primary key, value jsonb);
grant all on table gmail_test_state to authenticated, service_role;

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000001';
set local request.jwt.claim.role = 'authenticated';

insert into gmail_test_state
select 'created_request', to_jsonb(request)
from public.create_gmail_oauth_request(
  '21000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  array['openid','email','profile','https://www.googleapis.com/auth/gmail.send'],
  now() + interval '9 minutes'
) as request;

select is(
  (select value ->> 'request_id' from gmail_test_state where key = 'created_request'),
  '31000000-0000-4000-8000-000000000001',
  'authenticated member creates one bounded OAuth request'
);
select ok(
  (select value ?& array['request_id','expires_at']
      and (select count(*) from jsonb_object_keys(value)) = 2
   from gmail_test_state where key = 'created_request'),
  'OAuth request RPC returns safe metadata only'
);
select throws_ok(
  $$select * from private.gmail_oauth_requests$$,
  '42501',
  'permission denied for schema private',
  'authenticated cannot read state, nonce, or PKCE verifier'
);
reset role;

select is(
  (select claim_outcome from public.claim_gmail_oauth_callback(
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  )),
  'INVALID',
  'unknown callback state fails closed'
);
insert into private.gmail_oauth_requests (
  id, organization_id, initiating_user_id, state_hash, nonce,
  pkce_code_verifier, requested_scopes, created_at, expires_at
) values (
  '31000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'fffffffffffffffffffffffffffffffffffffffffff',
  'gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg',
  array['openid','email','profile','https://www.googleapis.com/auth/gmail.send'],
  now() - interval '9 minutes', now() - interval '1 minute'
);

set local role service_role;
select is(
  (select claim_outcome from public.claim_gmail_oauth_callback(
    'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  )),
  'EXPIRED',
  'expired callback state fails closed and becomes terminal'
);
insert into gmail_test_state
select 'claimed_request', to_jsonb(claim)
from public.claim_gmail_oauth_callback(
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
) as claim;
select is(
  (select value ->> 'claim_outcome' from gmail_test_state where key = 'claimed_request'),
  'CLAIMED',
  'callback atomically claims an unexpired state once'
);
select is(
  (select claim_outcome from public.claim_gmail_oauth_callback(
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )),
  'REPLAYED',
  'callback replay fails closed'
);

insert into gmail_test_state
select 'connected_account', to_jsonb(account)
from public.complete_gmail_account_connection(
  '31000000-0000-4000-8000-000000000001',
  'google-sub-stable-123',
  'Mutable.Address@example.test',
  'Gmail Owner',
  array['openid','email','profile','https://www.googleapis.com/auth/gmail.send'],
  'fixture-refresh-token-never-returned'
) as account;
reset role;

select ok(
  (select value ?& array['mailbox_account_id','organization_id','email_address','status','connected_at']
     and value::text !~ 'refresh|token|google-sub'
   from gmail_test_state where key = 'connected_account'),
  'connection completion returns safe account metadata without provider identity or token'
);
select ok(
  exists(select 1 from public.mailbox_accounts
    where provider_account_subject = 'google-sub-stable-123'
      and email_address = 'mutable.address@example.test'::extensions.citext
      and status = 'connected'),
  'Google sub is persisted independently from mutable email casing'
);
select is(
  (select secret.decrypted_secret
   from private.mailbox_account_credentials as credential
   join vault.decrypted_secrets as secret on secret.id = credential.refresh_token_secret_id),
  'fixture-refresh-token-never-returned',
  'refresh token round-trips only through Vault custody'
);

select throws_ok(
  $$update public.mailbox_accounts set provider_account_subject = 'changed-sub' where provider_account_subject = 'google-sub-stable-123'$$,
  '23514',
  'mailbox provider identity is immutable',
  'provider subject cannot silently change'
);

set local role service_role;
insert into gmail_test_state
select 'disconnected_account', to_jsonb(account)
from public.complete_gmail_account_disconnect(
  (select (value ->> 'mailbox_account_id')::uuid from gmail_test_state where key = 'connected_account'),
  '11000000-0000-4000-8000-000000000001',
  'unconfirmed',
  'disconnect_failed'
) as account;
reset role;
select ok(
  (select value ->> 'status' = 'disconnected'
     and value ->> 'revocation_outcome' = 'unconfirmed'
   from gmail_test_state where key = 'disconnected_account'),
  'local disconnect records only the evidenced revocation outcome'
);
select is(
  (select count(*)::integer from private.mailbox_account_credentials),
  0,
  'local disconnect always removes future refresh-token access'
);

set local role authenticated;
select throws_ok(
  $$insert into public.mailbox_accounts (
      organization_id, provider_account_subject, email_address, connected_by_user_id,
      connected_at, last_verified_at
    ) values (
      '21000000-0000-4000-8000-000000000001', 'browser-write', 'browser@example.test',
      '11000000-0000-4000-8000-000000000001', now(), now()
    )$$,
  '42501',
  'permission denied for table mailbox_accounts',
  'authenticated browser cannot directly write mailbox metadata'
);
reset role;

select is(
  (select count(*)::integer from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname like '%gmail%'
     and pg_get_functiondef(oid) ~* '(users[.]messages[.]send|gmail[.]googleapis[.]com/gmail/v1)'),
  0,
  'database functions contain no Gmail send authority'
);
select is(
  (select count(*)::integer from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = any(array[
       'product_bridge_json_object_has_only_keys',
       'product_bridge_json_has_forbidden_key',
       'product_bridge_valid_provenance',
       'product_bridge_valid_safe_diagnostics',
       'product_bridge_valid_receipt',
       'product_bridge_valid_research_evidence',
       'product_bridge_valid_warnings',
       'product_bridge_require_actor',
       'product_bridge_staging_context_version',
       'get_product_bridge_staging_context',
       'claim_product_bridge_write',
       'release_product_bridge_write',
       'stage_product_bridge_research_snapshot',
       'stage_product_bridge_email_draft'
     ])),
  14,
  'accepted Product Bridge function surface is unchanged'
);

select * from finish();
rollback;
