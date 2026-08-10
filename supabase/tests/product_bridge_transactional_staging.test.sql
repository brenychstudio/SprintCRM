begin;

create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'bridge-owner@example.test', '', now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other-owner@example.test', '', now(), now(), now(), '', '', '', '');

insert into public.organizations (id, name, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Bridge test organization', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Other organization', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');
insert into public.leads (
  id, org_id, owner, created_by, company_name, contact_name, email, phone,
  language, stage, status, next_action, next_action_at
) values (
  '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'Private fixture company', 'Private fixture person', 'private@example.test', '+34999999999',
  'es', 'new', 'active', 'follow_up', now() + interval '1 day'
);
insert into public.campaigns (
  id, organization_id, name, status, default_channel, default_language, created_by
) values (
  '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'Bridge fixture campaign', 'active', 'email', 'es', '10000000-0000-4000-8000-000000000001'
);
insert into public.campaign_members (
  id, organization_id, campaign_id, lead_id, status, added_by
) values (
  '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'queued', '10000000-0000-4000-8000-000000000001'
);

create temporary table bridge_test_state (key text primary key, value jsonb);
grant all on table bridge_test_state to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into bridge_test_state values (
  'initial_context',
  public.get_product_bridge_staging_context(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001'
  )
);

select is((select value #>> '{campaignMember,status}' from bridge_test_state where key = 'initial_context'), 'queued', 'context returns member status');
select is((select value #>> '{campaign,channel}' from bridge_test_state where key = 'initial_context'), 'email', 'context returns campaign channel');
select is((select value #>> '{campaign,defaultLanguage}' from bridge_test_state where key = 'initial_context'), 'es', 'context returns default language');
select like((select value #>> '{freshness,version}' from bridge_test_state where key = 'initial_context'), 'sha256:%', 'context returns opaque SHA-256 version');
select ok((select value -> 'latestResearch' is null from bridge_test_state where key = 'initial_context'), 'context reports no research');
select ok((select value -> 'latestOutboundMessage' is null from bridge_test_state where key = 'initial_context'), 'context reports no message');
select ok((select value::text !~ 'private@example|34999999999|Private fixture person' from bridge_test_state where key = 'initial_context'), 'context excludes contact PII');
select ok((select value::text !~ 'observed_opportunity|recommended_offer|body|subject|notes' from bridge_test_state where key = 'initial_context'), 'context excludes staged content');

insert into bridge_test_state values (
  'research_provenance', jsonb_build_object(
    'productId', 'sprint-crm', 'operationId', 'crm.research.stageSnapshot',
    'requestId', 'request-research-1', 'correlationId', 'correlation-research-1',
    'actorSubject', 'user:10000000-0000-4000-8000-000000000001',
    'organizationId', '20000000-0000-4000-8000-000000000001',
    'campaignMemberId', '50000000-0000-4000-8000-000000000001',
    'sourceSnapshotId', (select value #>> '{freshness,version}' from bridge_test_state where key = 'initial_context'),
    'stagedEntityId', '70000000-0000-4000-8000-000000000001',
    'timestamp', '2026-08-10T10:00:00.000Z'
  )
);

select is(
  public.claim_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'research-key-1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000001', 60,
    (select value from bridge_test_state where key = 'research_provenance')
  ) ->> 'outcome',
  'CLAIMED', 'first semantic request claims the durable address'
);
select is(
  public.claim_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'research-key-1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000002', 60,
    (select value from bridge_test_state where key = 'research_provenance')
  ) ->> 'outcome',
  'IN_PROGRESS', 'an active pending claim blocks a second effect'
);
select is(
  public.claim_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'research-key-1',
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '60000000-0000-4000-8000-000000000003', 60,
    (select value from bridge_test_state where key = 'research_provenance')
  ) ->> 'outcome',
  'CONFLICT', 'different semantic fingerprint conflicts'
);
select ok(not has_table_privilege('authenticated', 'public.product_bridge_write_requests', 'select'), 'authenticated has no direct ledger read grant');
select is(
  public.claim_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'release-key-1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000010', 60,
    (select value from bridge_test_state where key = 'research_provenance')
  ) ->> 'outcome',
  'CLAIMED', 'a releasable request is claimed'
);
select is(
  public.release_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'release-key-1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000011'
  ), false, 'wrong claim token cannot release pending work'
);
select is(
  public.release_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'release-key-1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000010'
  ), true, 'exact owner token releases pending work'
);
select is(
  public.claim_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'expired-key-1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000012', 60,
    (select value from bridge_test_state where key = 'research_provenance')
  ) ->> 'outcome',
  'CLAIMED', 'an expirable request is claimed'
);
reset role;
update public.product_bridge_write_requests
set lease_expires_at = clock_timestamp() - interval '1 second'
where idempotency_key = 'expired-key-1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((
  select result ->> 'outcome' = 'CLAIMED' and (result ->> 'reclaimed')::boolean
  from (
    select public.claim_product_bridge_write(
      '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'expired-key-1',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '60000000-0000-4000-8000-000000000013', 60,
      (select value from bridge_test_state where key = 'research_provenance')
    ) as result
  ) as reclaimed
), 'expired pending claim is safely reclaimed');

insert into bridge_test_state values (
  'research_result',
  public.stage_product_bridge_research_snapshot(
    '20000000-0000-4000-8000-000000000001', 'research-key-1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
    (select value #>> '{freshness,version}' from bridge_test_state where key = 'initial_context'),
    '70000000-0000-4000-8000-000000000001', 1,
    'A bounded observed commercial opportunity supported by current public evidence.',
    'A focused implementation offer that gives the prospect a measurable next commercial step.',
    '[{"url":"https://example.test/research","note":"A bounded factual note supporting this commercial opportunity."}]'::jsonb,
    null, 0.8, '[]'::jsonb,
    jsonb_build_object(
      'productId', 'sprint-crm', 'operationId', 'crm.research.stageSnapshot',
      'requestId', 'request-research-1', 'correlationId', 'correlation-research-1',
      'actorSubject', 'user:10000000-0000-4000-8000-000000000001',
      'organizationId', '20000000-0000-4000-8000-000000000001',
      'campaignMemberId', '50000000-0000-4000-8000-000000000001',
      'sourceSnapshotId', (select value #>> '{freshness,version}' from bridge_test_state where key = 'initial_context'),
      'stagedEntityId', '70000000-0000-4000-8000-000000000001',
      'timestamp', '2026-08-10T10:00:00.000Z'
    ),
    jsonb_build_object(
      'schemaVersion', '1.0.0', 'receiptId', 'receipt-research-1',
      'requestId', 'request-research-1', 'correlationId', 'correlation-research-1',
      'productId', 'sprint-crm', 'operationId', 'stage_snapshot',
      'operationClass', 'STAGED_WRITE', 'status', 'staged',
      'timestamp', '2026-08-10T10:00:00.000Z',
      'sourceSnapshotId', (select value #>> '{freshness,version}' from bridge_test_state where key = 'initial_context'),
      'stagedEntityId', '70000000-0000-4000-8000-000000000001',
      'result', jsonb_build_object(
        'entityType', 'research_snapshot', 'entityId', '70000000-0000-4000-8000-000000000001',
        'version', 1, 'status', 'research_ready'
      ),
      'validation', jsonb_build_object('state', 'pending'),
      'approval', jsonb_build_object('state', 'pending')
    )
  )
);

select is((select value ->> 'outcome' from bridge_test_state where key = 'research_result'), 'COMPLETED', 'research effect completes atomically');
select is((select source from public.research_snapshots where id = '70000000-0000-4000-8000-000000000001'), 'bridge', 'research source is bridge');
select is((select version from public.research_snapshots where id = '70000000-0000-4000-8000-000000000001'), 1, 'research uses expected next version');
select is((select status from public.campaign_members where id = '50000000-0000-4000-8000-000000000001'), 'research_ready', 'research moves only eligible member to research_ready');
select is((select count(*)::integer from public.activities where type = 'research_saved' and meta ->> 'source' = 'bridge'), 1, 'research appends canonical activity');
select is((select count(*)::integer from public.audit_events where event_type = 'product_bridge.research.staged'), 1, 'research appends audit event');
select ok(
  public.claim_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'research-key-1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000014', 60,
    (select value from bridge_test_state where key = 'research_provenance')
  ) -> 'receipt' = (select value -> 'receipt' from bridge_test_state where key = 'research_result'),
  'ledger replays exact receipt JSON through the narrow RPC'
);

update public.campaigns set tone = 'changed after completed effect' where id = '40000000-0000-4000-8000-000000000001';
select is(
  public.claim_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.research.stageSnapshot', 'research-key-1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000004', 60,
    (select value from bridge_test_state where key = 'research_provenance')
  ) ->> 'outcome',
  'REPLAY', 'completed replay precedes freshness evaluation'
);
select is((select count(*)::integer from public.research_snapshots where campaign_member_id = '50000000-0000-4000-8000-000000000001'), 1, 'replay does not create version plus two');

insert into bridge_test_state values (
  'email_context', public.get_product_bridge_staging_context(
    '20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001'
  )
);
insert into bridge_test_state values (
  'email_provenance', jsonb_build_object(
    'productId', 'sprint-crm', 'operationId', 'crm.email.stageDraft',
    'requestId', 'request-email-1', 'correlationId', 'correlation-email-1',
    'actorSubject', 'user:10000000-0000-4000-8000-000000000001',
    'organizationId', '20000000-0000-4000-8000-000000000001',
    'campaignMemberId', '50000000-0000-4000-8000-000000000001',
    'sourceSnapshotId', (select value #>> '{freshness,version}' from bridge_test_state where key = 'email_context'),
    'stagedEntityId', '80000000-0000-4000-8000-000000000001',
    'timestamp', '2026-08-10T10:05:00.000Z'
  )
);
select is(
  public.claim_product_bridge_write(
    '20000000-0000-4000-8000-000000000001', 'crm.email.stageDraft', 'email-key-1',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    '60000000-0000-4000-8000-000000000005', 60,
    (select value from bridge_test_state where key = 'email_provenance')
  ) ->> 'outcome',
  'CLAIMED', 'email draft claims its own durable address'
);
insert into bridge_test_state values (
  'email_result',
  public.stage_product_bridge_email_draft(
    '20000000-0000-4000-8000-000000000001', 'email-key-1',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    '60000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000001',
    (select value #>> '{freshness,version}' from bridge_test_state where key = 'email_context'),
    '80000000-0000-4000-8000-000000000001', 1,
    '70000000-0000-4000-8000-000000000001', 'A focused idea for your next campaign',
    'Hello, I reviewed the available public context and prepared one focused idea for your team. This remains an immutable draft for human review before any communication is approved or sent.',
    'es',
    jsonb_build_object(
      'productId', 'sprint-crm', 'operationId', 'crm.email.stageDraft',
      'requestId', 'request-email-1', 'correlationId', 'correlation-email-1',
      'actorSubject', 'user:10000000-0000-4000-8000-000000000001',
      'organizationId', '20000000-0000-4000-8000-000000000001',
      'campaignMemberId', '50000000-0000-4000-8000-000000000001',
      'sourceSnapshotId', (select value #>> '{freshness,version}' from bridge_test_state where key = 'email_context'),
      'stagedEntityId', '80000000-0000-4000-8000-000000000001',
      'timestamp', '2026-08-10T10:05:00.000Z'
    ),
    jsonb_build_object(
      'schemaVersion', '1.0.0', 'receiptId', 'receipt-email-1',
      'requestId', 'request-email-1', 'correlationId', 'correlation-email-1',
      'productId', 'sprint-crm', 'operationId', 'stage_draft',
      'operationClass', 'STAGED_WRITE', 'status', 'staged',
      'timestamp', '2026-08-10T10:05:00.000Z',
      'sourceSnapshotId', (select value #>> '{freshness,version}' from bridge_test_state where key = 'email_context'),
      'stagedEntityId', '80000000-0000-4000-8000-000000000001',
      'result', jsonb_build_object(
        'entityType', 'outbound_message', 'entityId', '80000000-0000-4000-8000-000000000001',
        'version', 1, 'status', 'draft',
        'researchSnapshotId', '70000000-0000-4000-8000-000000000001', 'researchVersion', 1
      ),
      'validation', jsonb_build_object('state', 'pending'),
      'approval', jsonb_build_object('state', 'pending')
    )
  )
);

select is((select value ->> 'outcome' from bridge_test_state where key = 'email_result'), 'COMPLETED', 'email draft completes atomically');
select is((select source from public.outbound_messages where id = '80000000-0000-4000-8000-000000000001'), 'bridge', 'email source is bridge');
select is((select status from public.outbound_messages where id = '80000000-0000-4000-8000-000000000001'), 'draft', 'email remains draft');
select ok((select approved_by is null and approved_at is null and sent_at is null and channel = 'email' from public.outbound_messages where id = '80000000-0000-4000-8000-000000000001'), 'email has no approval, provider, or send effect');
select is((select research_snapshot_id from public.outbound_messages where id = '80000000-0000-4000-8000-000000000001'), '70000000-0000-4000-8000-000000000001'::uuid, 'email references exact latest research');
select is((select count(*)::integer from public.activities where type = 'outreach_draft_saved' and meta ->> 'source' = 'bridge'), 1, 'email appends canonical activity');
select is((select count(*)::integer from public.audit_events where event_type = 'product_bridge.email_draft.staged'), 1, 'email appends audit event');

select throws_ok(
  $$select public.get_product_bridge_staging_context('20000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001')$$,
  '42501', 'Product Bridge staging is unavailable', 'cross-organization binding fails closed'
);

reset role;
set local request.jwt.claims = '{}';
select throws_ok(
  $$select public.get_product_bridge_staging_context('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001')$$,
  '42501', 'Product Bridge staging is unavailable', 'unauthenticated access fails closed'
);
set local role service_role;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"service_role"}';
select throws_ok(
  $$select public.get_product_bridge_staging_context('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'service-role execution is rejected before any effect'
);

select * from finish();
rollback;
