import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const migrationsDirectory = path.resolve('supabase/migrations')
const schemaSnapshotPath = path.resolve('supabase/schema.sql')
const databaseTypesPath = path.resolve('src/lib/supabase/database.types.ts')
const expectedFoundationMigration = '20260427000001_ai_outreach_foundation.sql'
const expectedImportDriftMigration = '20260722000001_capture_import_schema_drift.sql'
const expectedCampaignDomainMigration = '20260722000002_outreach_campaign_domain.sql'
const expectedCampaignRlsMigration = '20260722000003_outreach_campaign_rls.sql'
const expectedCampaignActivityMigration = '20260725000001_campaign_activity_types.sql'
const expectedCampaignWorkspaceRpcMigration = '20260725000002_manual_campaign_workspace_rpc.sql'
const expectedCampaignMemberAmbiguityFix = '20260729000001_fix_add_campaign_members_ambiguous_lead_id.sql'
const expectedManualMessageChannelFix = '20260729000002_fix_manual_message_channel_cast.sql'
const expectedAiRuntimeProbeRequestIdFix = '20260801000002_fix_ai_runtime_probe_request_id_ambiguity.sql'
const expectedAiResearchJobMigration = '20260801000003_ai_research_job.sql'
const expectedCampaignProofContextWrapperFix = '20260801000004_fix_campaign_proof_context_wrapper_assignment.sql'
const expectedAiResearchActivityOwnerFix = '20260801000005_fix_ai_research_activity_owner.sql'
const expectedAiResearchV2StartContractFix = '20260801000006_fix_ai_research_v2_start_contract.sql'
const expectedAiDraftGenerationMigration = '20260801000007_supervised_ai_draft_generation.sql'
const expectedAiDraftPromptV2Migration = '20260801000008_accept_ai_draft_prompt_v2.sql'
const expectedAiDraftPromptV3Migration = '20260801000009_accept_ai_draft_prompt_v3.sql'
const expectedAiDraftPromptV4Migration = '20260801000010_accept_ai_draft_prompt_v4.sql'
const expectedProductBridgeStagingMigration = '20260810000001_product_bridge_transactional_staging.sql'
const expectedGmailFoundationMigration = '20260812000001_gmail_account_communication_foundation.sql'
const requiredCampaignTables = [
  'campaigns',
  'campaign_members',
  'research_snapshots',
  'message_templates',
  'template_versions',
  'outbound_messages',
  'suppression_entries',
  'audit_events',
]
const migrationName = /^\d{8,}_[a-z0-9_]+\.sql$/

const files = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith('.sql'))
  .sort()

if (!files.length) throw new Error('No SQL migrations found.')

if (files.some((file) => !migrationName.test(file))) {
  throw new Error(`Invalid migration filename: ${files.find((file) => !migrationName.test(file))}`)
}

const versions = files.map((file) => file.split('_', 1)[0])
if (new Set(versions).size !== versions.length) {
  throw new Error('Duplicate migration versions are not allowed.')
}

if (!files.includes(expectedFoundationMigration)) {
  throw new Error(`Missing required baseline migration: ${expectedFoundationMigration}`)
}

if (!files.includes(expectedImportDriftMigration)) {
  throw new Error(`Missing required import drift migration: ${expectedImportDriftMigration}`)
}

if (!files.includes(expectedCampaignDomainMigration) || !files.includes(expectedCampaignRlsMigration)) {
  throw new Error('Missing required OutreachOps campaign domain migrations.')
}

if (!files.includes(expectedCampaignActivityMigration) || !files.includes(expectedCampaignWorkspaceRpcMigration)) {
  throw new Error('Missing required manual campaign workspace migrations.')
}

if (!files.includes(expectedCampaignMemberAmbiguityFix)) {
  throw new Error(`Missing required campaign member RPC forward-fix: ${expectedCampaignMemberAmbiguityFix}`)
}

if (!files.includes(expectedManualMessageChannelFix)) {
  throw new Error(`Missing required manual message channel forward-fix: ${expectedManualMessageChannelFix}`)
}

if (!files.includes(expectedProductBridgeStagingMigration)) {
  throw new Error(`Missing required Product Bridge staging migration: ${expectedProductBridgeStagingMigration}`)
}
if (!files.includes(expectedGmailFoundationMigration)) {
  throw new Error(`Missing required Gmail account/communication migration: ${expectedGmailFoundationMigration}`)
}
if (files.indexOf(expectedGmailFoundationMigration) <= files.indexOf(expectedProductBridgeStagingMigration)) {
  throw new Error('Gmail foundation migration must follow the accepted Product Bridge baseline.')
}

if (!files.includes(expectedAiRuntimeProbeRequestIdFix)) {
  throw new Error(`Missing required AI runtime probe request-id forward-fix: ${expectedAiRuntimeProbeRequestIdFix}`)
}
if (!files.includes(expectedAiResearchJobMigration)) {
  throw new Error(`Missing required supervised AI research migration: ${expectedAiResearchJobMigration}`)
}
if (!files.includes(expectedCampaignProofContextWrapperFix)) {
  throw new Error(`Missing required campaign proof-context wrapper forward-fix: ${expectedCampaignProofContextWrapperFix}`)
}
if (files.indexOf(expectedCampaignProofContextWrapperFix) <= files.indexOf(expectedAiResearchJobMigration)) {
  throw new Error('Campaign proof-context wrapper forward-fix must follow the AI research migration.')
}
if (!files.includes(expectedAiResearchActivityOwnerFix)) {
  throw new Error(`Missing required AI research activity-owner forward-fix: ${expectedAiResearchActivityOwnerFix}`)
}
if (files.indexOf(expectedAiResearchActivityOwnerFix) <= files.indexOf(expectedCampaignProofContextWrapperFix)) {
  throw new Error('AI research activity-owner forward-fix must follow the campaign proof-context wrapper forward-fix.')
}
if (!files.includes(expectedAiResearchV2StartContractFix)) {
  throw new Error(`Missing required AI research V2 start-contract forward-fix: ${expectedAiResearchV2StartContractFix}`)
}
if (!files.includes(expectedAiDraftGenerationMigration)) {
  throw new Error(`Missing required supervised AI draft migration: ${expectedAiDraftGenerationMigration}`)
}
if (files.indexOf(expectedAiResearchV2StartContractFix) <= files.indexOf(expectedAiResearchActivityOwnerFix)) {
  throw new Error('AI research V2 start-contract forward-fix must follow the AI research activity-owner forward-fix.')
}

for (const file of files) {
  const sql = (await readFile(path.join(migrationsDirectory, file), 'utf8')).trim()
  if (!sql) throw new Error(`Migration is empty: ${file}`)
}

const campaignDomainSql = await readFile(path.join(migrationsDirectory, expectedCampaignDomainMigration), 'utf8')
const campaignRlsSql = await readFile(path.join(migrationsDirectory, expectedCampaignRlsMigration), 'utf8')

for (const table of requiredCampaignTables) {
  if (!campaignDomainSql.includes(`create table public.${table}`)) {
    throw new Error(`Campaign domain migration is missing table: ${table}`)
  }

  if (!campaignRlsSql.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`Campaign RLS migration is missing RLS enablement: ${table}`)
  }
}

for (const marker of [
  'foreign key (campaign_id, organization_id)',
  'foreign key (lead_id, organization_id)',
  'uidx_suppression_entries_active_subject',
  'prevent_audit_event_mutation',
]) {
  if (!campaignDomainSql.includes(marker)) {
    throw new Error(`Campaign domain migration is missing required guard: ${marker}`)
  }
}

const campaignWorkspaceRpcSql = await readFile(path.join(migrationsDirectory, expectedCampaignWorkspaceRpcMigration), 'utf8')
for (const marker of [
  'create_manual_campaign',
  'add_campaign_members',
  'save_manual_research_snapshot',
  'save_manual_outbound_message',
  'approve_manual_outbound_message',
  'skip_manual_campaign_member',
]) {
  if (!campaignWorkspaceRpcSql.includes(marker)) {
    throw new Error(`Manual campaign workspace migration is missing RPC: ${marker}`)
  }
}

const campaignMemberFixSql = await readFile(path.join(migrationsDirectory, expectedCampaignMemberAmbiguityFix), 'utf8')
for (const marker of [
  'create or replace function public.add_campaign_members(',
  'from public.campaigns as c',
  'from public.leads as l',
  'where l.id = v_lead_id',
  'on conflict on constraint campaign_members_campaign_id_lead_id_key do nothing',
  'security invoker',
]) {
  if (!campaignMemberFixSql.includes(marker)) {
    throw new Error(`Campaign member RPC forward-fix is missing disambiguation guard: ${marker}`)
  }
}
if (/on conflict\s*\([^)]*\blead_id\b[^)]*\)/i.test(campaignMemberFixSql)) {
  throw new Error('Campaign member RPC forward-fix reintroduces an ambiguous lead_id conflict target.')
}

const manualMessageChannelFixSql = await readFile(path.join(migrationsDirectory, expectedManualMessageChannelFix), 'utf8')
for (const marker of [
  'create or replace function public.save_manual_outbound_message(',
  'create or replace function public.approve_manual_outbound_message(',
  'v_channel := p_channel::public.activity_channel',
  "v_channel::text, p_language",
  "'outreach_draft_saved', v_channel",
  'v_channel := v_message.channel::public.activity_channel',
  "'outreach_approved', v_channel",
  'security invoker',
]) {
  if (!manualMessageChannelFixSql.includes(marker)) {
    throw new Error(`Manual message channel forward-fix is missing enum boundary guard: ${marker}`)
  }
}
if (/outreach_(draft_saved|approved)'\s*,\s*v_message\.channel/i.test(manualMessageChannelFixSql)) {
  throw new Error('Manual message channel forward-fix writes text directly into activities.channel.')
}

const aiRuntimeProbeRequestIdFixSql = await readFile(path.join(migrationsDirectory, expectedAiRuntimeProbeRequestIdFix), 'utf8')
for (const marker of [
  'create or replace function public.start_ai_runtime_probe(',
  'returns table (',
  'request_id uuid,',
  "<> 'service_role'",
  'insert into public.ai_generations as new_job',
  ') on conflict do nothing',
  'returning new_job.* into v_job',
  'from public.ai_generations as existing_job',
  'where existing_job.org_id = v_member.organization_id',
  'and existing_job.request_id = p_request_id',
  "'runtime_probe'",
  "'ai.runtime_probe.requested'",
  'revoke all on function public.start_ai_runtime_probe(uuid, uuid, uuid, text) from public, anon, authenticated;',
  'grant execute on function public.start_ai_runtime_probe(uuid, uuid, uuid, text) to service_role;',
]) {
  if (!aiRuntimeProbeRequestIdFixSql.includes(marker)) {
    throw new Error(`AI runtime probe request-id forward-fix is missing required guard: ${marker}`)
  }
}
if (/from\s+public\.ai_generations\s*\n\s*where\s+org_id\s*=\s*v_member\.organization_id\s+and\s+request_id\s*=\s*p_request_id/i.test(aiRuntimeProbeRequestIdFixSql)) {
  throw new Error('AI runtime probe request-id forward-fix reintroduces an ambiguous retry lookup.')
}

const aiResearchJobSql = await readFile(path.join(migrationsDirectory, expectedAiResearchJobMigration), 'utf8')
for (const marker of [
  'add column if not exists proof_context text',
  'create or replace function public.start_ai_research_job(',
  'create or replace function public.finish_ai_research_job(',
  "'research'", "'research_v1'", "'outreach_research_v1'",
  "'ai.research.requested'", "'ai.research.completed'", "'ai.research.failed'",
  "source, observed_opportunity", "'ai'", 'ai_generation_id',
  "campaign_member.status in ('queued', 'researching', 'research_ready')",
  'for update;', 'coalesce(max(snapshot.version), 0) + 1',
  'revoke insert, update on table public.ai_generations from public, anon, authenticated;',
  'revoke all on function public.start_ai_research_job(uuid, uuid, uuid, text, text) from public, anon, authenticated;',
  'grant execute on function public.start_ai_research_job(uuid, uuid, uuid, text, text) to service_role;',
  'grant execute on function public.finish_ai_research_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) to service_role;',
]) {
  if (!aiResearchJobSql.includes(marker)) throw new Error(`AI research migration is missing required guard: ${marker}`)
}
if (!aiResearchJobSql.includes("where generation.id = v_job.id returning generation.* into v_job") || !aiResearchJobSql.includes("if v_job.generation_status <> 'pending'")) {
  throw new Error('AI research migration is missing terminal-state protection.')
}

const campaignProofContextWrapperFixSql = await readFile(path.join(migrationsDirectory, expectedCampaignProofContextWrapperFix), 'utf8')
for (const marker of [
  'create or replace function public.create_manual_campaign(',
  'p_default_channel text, p_default_language text, p_tone text, p_proof_context text',
  'create or replace function public.update_manual_campaign(',
  'p_tone text, p_status text, p_proof_context text',
  'returns public.campaigns',
  'security invoker',
  'set search_path = public',
  'from public.create_manual_campaign(',
  'from public.update_manual_campaign(',
  "nullif(btrim(p_proof_context), '')",
  'revoke all on function public.create_manual_campaign(text, text, text, text, text, text, text, text) from public;',
  'revoke all on function public.update_manual_campaign(uuid, text, text, text, text, text, text, text, text, text) from public;',
  'grant execute on function public.create_manual_campaign(text, text, text, text, text, text, text, text) to authenticated;',
  'grant execute on function public.update_manual_campaign(uuid, text, text, text, text, text, text, text, text, text) to authenticated;',
]) {
  if (!campaignProofContextWrapperFixSql.includes(marker)) {
    throw new Error(`Campaign proof-context wrapper forward-fix is missing required guard: ${marker}`)
  }
}
for (const functionName of ['create_manual_campaign', 'update_manual_campaign']) {
  const rowExpandedCompositeAssignment = new RegExp(`select\\s+\\*\\s+into\\s+v_campaign\\s+from\\s+public\\.${functionName}\\s*\\(`, 'i')
  if (!rowExpandedCompositeAssignment.test(campaignProofContextWrapperFixSql)) {
    throw new Error(`Campaign proof-context wrapper forward-fix is missing row-expanded composite assignment: ${functionName}`)
  }
  const brokenScalarCompositeAssignment = new RegExp(`select\\s+public\\.${functionName}\\s*\\([\\s\\S]*?\\)\\s+into\\s+v_campaign`, 'i')
  if (brokenScalarCompositeAssignment.test(campaignProofContextWrapperFixSql)) {
    throw new Error(`Campaign proof-context wrapper forward-fix retains broken scalar composite assignment: ${functionName}`)
  }
}

const aiResearchActivityOwnerFixSql = await readFile(path.join(migrationsDirectory, expectedAiResearchActivityOwnerFix), 'utf8')
for (const marker of [
  'create or replace function public.finish_ai_research_job(',
  'p_job_id uuid, p_actor_user_id uuid, p_status text, p_provider_response_id text,',
  'p_provider_request_id text, p_output_payload jsonb, p_input_tokens integer,',
  'p_cached_input_tokens integer, p_output_tokens integer, p_total_tokens integer,',
  'p_duration_ms integer, p_error_code text, p_error_message text',
  'language plpgsql security definer set search_path = public',
  "if p_status = 'completed' and v_job.owner is null",
  'insert into public.activities as activity (org_id, owner, lead_id, type, meta)',
  "values (v_member.organization_id, v_job.owner, v_member.lead_id, 'research_saved'",
  'create or replace function public.fail_stale_ai_research_job(',
  "where generation.id = p_job_id and generation.job_type = 'research'",
  "if v_job.generation_status <> 'pending'",
  "v_job.created_at > v_completed_at - interval '5 minutes'",
  "p_error_code is distinct from 'persistence_recovery'",
  "generation_status = 'failed'",
  'completed_at = v_completed_at',
  'duration_ms = least(',
  "error_code = 'persistence_recovery'",
  "error_message = 'Recovered stale pending research job after persistence failure.'",
  "'ai.research.failed'",
  "'initiating_user_id', v_job.owner",
  "'recovery_reason', p_error_code",
  "interval '5 minutes'",
  'revoke all on function public.finish_ai_research_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) from public, anon, authenticated;',
  'grant execute on function public.finish_ai_research_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) to service_role;',
  'revoke all on function public.fail_stale_ai_research_job(uuid, uuid, text) from public, anon, authenticated;',
  'grant execute on function public.fail_stale_ai_research_job(uuid, uuid, text) to service_role;',
]) {
  if (!aiResearchActivityOwnerFixSql.includes(marker)) {
    throw new Error(`AI research activity-owner forward-fix is missing required guard: ${marker}`)
  }
}
if (/insert\s+into\s+public\.activities\s+as\s+activity\s*\(\s*org_id\s*,\s*lead_id\s*,\s*type\s*,\s*meta\s*\)/i.test(aiResearchActivityOwnerFixSql)) {
  throw new Error('AI research activity-owner forward-fix retains the broken ownerless activity insert.')
}
for (const functionName of ['finish_ai_research_job', 'fail_stale_ai_research_job']) {
  const browserExecuteGrant = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}\\([^;]*?\\)\\s+to\\s+(?:public|anon|authenticated)`, 'i')
  if (browserExecuteGrant.test(aiResearchActivityOwnerFixSql)) {
    throw new Error(`AI research activity-owner forward-fix grants browser execution for ${functionName}.`)
  }
}

const aiResearchV2StartContractFixSql = await readFile(path.join(migrationsDirectory, expectedAiResearchV2StartContractFix), 'utf8')
for (const marker of [
  'create or replace function public.start_ai_research_job(',
  'p_campaign_member_id uuid,',
  'p_actor_user_id uuid,',
  'p_request_id uuid,',
  'p_model text,',
  'p_prompt_version text',
  'returns table (',
  'language plpgsql',
  'security definer',
  'set search_path = public',
  "coalesce(p_prompt_version, '') not in ('outreach_research_v1', 'outreach_research_v2')",
  "raise exception 'Invalid research request' using errcode = '22023';",
  "when 'outreach_research_v1' then 'research_v1'",
  "when 'outreach_research_v2' then 'research_v2'",
  'p_prompt_version, v_schema_version',
  "'research'",
  "'pending'",
  "'ai.research.requested'",
  'where membership.org_id = v_member.organization_id and membership.user_id = p_actor_user_id',
  'where lead.id = v_member.lead_id and lead.org_id = v_member.organization_id',
  'where existing_job.org_id = v_member.organization_id and existing_job.request_id = p_request_id;',
  "v_job.job_type <> 'research'",
  'revoke all on function public.start_ai_research_job(uuid, uuid, uuid, text, text) from public, anon, authenticated;',
  'grant execute on function public.start_ai_research_job(uuid, uuid, uuid, text, text) to service_role;',
]) {
  if (!aiResearchV2StartContractFixSql.includes(marker)) {
    throw new Error(`AI research V2 start-contract forward-fix is missing required guard: ${marker}`)
  }
}
if (/['\"]research_v[12]['\"]\s*,\s*['\"]pending['\"]/.test(aiResearchV2StartContractFixSql)) {
  throw new Error('AI research V2 start-contract forward-fix unconditionally hardcodes schema_version.')
}
if ((aiResearchV2StartContractFixSql.match(/create\s+or\s+replace\s+function/gi) ?? []).length !== 1 || /create\s+or\s+replace\s+function\s+public\.(?!start_ai_research_job\b)/i.test(aiResearchV2StartContractFixSql)) {
  throw new Error('AI research V2 start-contract forward-fix recreates a function other than start_ai_research_job.')
}
if (/insert\s+into\s+public\.activities|update\s+public\.campaign_members/i.test(aiResearchV2StartContractFixSql)) {
  throw new Error('AI research V2 start-contract forward-fix adds start-time CRM activity or campaign-member mutation.')
}
if (/openai|gmail|approve|send|message/i.test(aiResearchV2StartContractFixSql.replace(/'openai'/g, ''))) {
  throw new Error('AI research V2 start-contract forward-fix adds provider or outbound behavior.')
}
if (/grant\s+execute\s+on\s+function\s+public\.start_ai_research_job\([^;]*?\)\s+to\s+(?:public|anon|authenticated)/i.test(aiResearchV2StartContractFixSql)) {
  throw new Error('AI research V2 start-contract forward-fix grants browser execution.')
}

const aiDraftGenerationSql = await readFile(path.join(migrationsDirectory, expectedAiDraftGenerationMigration), 'utf8')
for (const marker of [
  'create or replace function public.start_ai_draft_job(',
  'create or replace function public.finish_ai_draft_job(',
  'create or replace function public.fail_stale_ai_draft_job(',
  "'draft_v1'", "'outreach_draft_v1'", "'draft'", "'pending'",
  "'ai.draft.requested'", "'ai.draft.completed'", "'ai.draft.failed'",
  'p_confirmed_research_snapshot_id uuid',
  "v_member.status not in ('research_ready', 'draft_ready')",
  'order by snapshot.version desc limit 1',
  "v_snapshot.id <> p_confirmed_research_snapshot_id",
  "source, channel, language, subject, body, status, research_snapshot_id, ai_generation_id, created_by",
  "'ai', v_campaign.default_channel, v_language", "'draft'",
  "campaign_member.status in ('research_ready', 'draft_ready')",
  "'outreach_draft_saved'", 'v_job.owner',
  'security definer set search_path = public',
  'revoke all on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;',
  'grant execute on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) to service_role;',
  'grant execute on function public.finish_ai_draft_job(uuid, uuid, text, text, text, jsonb, integer, integer, integer, integer, integer, text, text) to service_role;',
  'grant execute on function public.fail_stale_ai_draft_job(uuid, uuid, text) to service_role;',
]) {
  if (!aiDraftGenerationSql.includes(marker)) throw new Error(`AI draft migration is missing required guard: ${marker}`)
}
if (/grant\s+execute\s+on\s+function\s+public\.(?:start_ai_draft_job|finish_ai_draft_job|fail_stale_ai_draft_job)\([^;]*?\)\s+to\s+(?:public|anon|authenticated)/i.test(aiDraftGenerationSql)) {
  throw new Error('AI draft lifecycle RPC grants browser execution.')
}
if (/insert\s+into\s+public\.outbound_messages[\s\S]*?status\s*,\s*'needs_review'/i.test(aiDraftGenerationSql) || /gmail|send/i.test(aiDraftGenerationSql)) {
  throw new Error('AI draft migration crosses the supervised no-send or no-review boundary.')
}

const aiDraftPromptV2Sql = await readFile(path.join(migrationsDirectory, expectedAiDraftPromptV2Migration), 'utf8')
for (const marker of [
  'create or replace function public.start_ai_draft_job(',
  "p_prompt_version not in ('outreach_draft_v1', 'outreach_draft_v2')",
  "'draft_v1', 'pending'",
  "'ai.draft.requested'",
  'p_confirmed_research_snapshot_id uuid',
  "v_member.status not in ('research_ready', 'draft_ready')",
  'order by snapshot.version desc limit 1',
  'where membership.org_id = v_member.organization_id and membership.user_id = p_actor_user_id',
  'security definer set search_path = public',
  'revoke all on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;',
  'grant execute on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) to service_role;',
]) {
  if (!aiDraftPromptV2Sql.includes(marker)) throw new Error(`AI draft prompt V2 forward-fix is missing required guard: ${marker}`)
}
if ((aiDraftPromptV2Sql.match(/create\s+or\s+replace\s+function/gi) ?? []).length !== 1 || /create\s+or\s+replace\s+function\s+public\.(?!start_ai_draft_job\b)/i.test(aiDraftPromptV2Sql)) {
  throw new Error('AI draft prompt V2 forward-fix recreates a function other than start_ai_draft_job.')
}
if (/insert\s+into\s+public\.(?:outbound_messages|activities)|update\s+public\.campaign_members|alter\s+table|delete\s+from|update\s+public\.ai_generations/i.test(aiDraftPromptV2Sql)) {
  throw new Error('AI draft prompt V2 forward-fix mutates CRM history or changes the draft lifecycle.')
}
if (/grant\s+execute\s+on\s+function\s+public\.start_ai_draft_job\([^;]*?\)\s+to\s+(?:public|anon|authenticated)/i.test(aiDraftPromptV2Sql)) {
  throw new Error('AI draft prompt V2 forward-fix grants browser execution.')
}
if (!/p_prompt_version\s+not\s+in\s*\(\s*'outreach_draft_v1'\s*,\s*'outreach_draft_v2'\s*\)/i.test(aiDraftPromptV2Sql)) {
  throw new Error('AI draft prompt V2 forward-fix does not reject unknown prompt versions.')
}

const aiDraftPromptV3Sql = await readFile(path.join(migrationsDirectory, expectedAiDraftPromptV3Migration), 'utf8')
for (const marker of [
  'create or replace function public.start_ai_draft_job(',
  "p_prompt_version not in ('outreach_draft_v1', 'outreach_draft_v2', 'outreach_draft_v3')",
  "'draft_v1', 'pending'",
  "'ai.draft.requested'",
  'p_confirmed_research_snapshot_id uuid',
  "v_member.status not in ('research_ready', 'draft_ready')",
  'order by snapshot.version desc limit 1',
  'where membership.org_id = v_member.organization_id and membership.user_id = p_actor_user_id',
  'security definer set search_path = public',
  'revoke all on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;',
  'grant execute on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) to service_role;',
]) {
  if (!aiDraftPromptV3Sql.includes(marker)) throw new Error(`AI draft prompt V3 forward-fix is missing required guard: ${marker}`)
}
if ((aiDraftPromptV3Sql.match(/create\s+or\s+replace\s+function/gi) ?? []).length !== 1 || /create\s+or\s+replace\s+function\s+public\.(?!start_ai_draft_job\b)/i.test(aiDraftPromptV3Sql)) {
  throw new Error('AI draft prompt V3 forward-fix recreates a function other than start_ai_draft_job.')
}
if (/insert\s+into\s+public\.(?:outbound_messages|activities)|update\s+public\.campaign_members|alter\s+table|delete\s+from|update\s+public\.ai_generations/i.test(aiDraftPromptV3Sql)) {
  throw new Error('AI draft prompt V3 forward-fix mutates CRM history or changes the draft lifecycle.')
}
if (/grant\s+execute\s+on\s+function\s+public\.start_ai_draft_job\([^;]*?\)\s+to\s+(?:public|anon|authenticated)/i.test(aiDraftPromptV3Sql)) {
  throw new Error('AI draft prompt V3 forward-fix grants browser execution.')
}
if (!/p_prompt_version\s+not\s+in\s*\(\s*'outreach_draft_v1'\s*,\s*'outreach_draft_v2'\s*,\s*'outreach_draft_v3'\s*\)/i.test(aiDraftPromptV3Sql)) {
  throw new Error('AI draft prompt V3 forward-fix does not reject unknown prompt versions.')
}

const aiDraftPromptV4Sql = await readFile(path.join(migrationsDirectory, expectedAiDraftPromptV4Migration), 'utf8')
for (const marker of [
  'create or replace function public.start_ai_draft_job(',
  "p_prompt_version not in ('outreach_draft_v1', 'outreach_draft_v2', 'outreach_draft_v3', 'outreach_draft_v4')",
  "'draft_v1', 'pending'",
  "'ai.draft.requested'",
  'p_confirmed_research_snapshot_id uuid',
  "v_member.status not in ('research_ready', 'draft_ready')",
  'order by snapshot.version desc limit 1',
  'where membership.org_id = v_member.organization_id and membership.user_id = p_actor_user_id',
  'security definer set search_path = public',
  'revoke all on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;',
  'grant execute on function public.start_ai_draft_job(uuid, uuid, uuid, uuid, text, text) to service_role;',
]) {
  if (!aiDraftPromptV4Sql.includes(marker)) throw new Error(`AI draft prompt V4 forward-fix is missing required guard: ${marker}`)
}
if ((aiDraftPromptV4Sql.match(/create\s+or\s+replace\s+function/gi) ?? []).length !== 1 || /create\s+or\s+replace\s+function\s+public\.(?!start_ai_draft_job\b)/i.test(aiDraftPromptV4Sql)) {
  throw new Error('AI draft prompt V4 forward-fix recreates a function other than start_ai_draft_job.')
}
if (/insert\s+into\s+public\.(?:outbound_messages|activities)|update\s+public\.campaign_members|alter\s+table|delete\s+from|update\s+public\.ai_generations/i.test(aiDraftPromptV4Sql)) {
  throw new Error('AI draft prompt V4 forward-fix mutates CRM history or changes the draft lifecycle.')
}
if (/grant\s+execute\s+on\s+function\s+public\.start_ai_draft_job\([^;]*?\)\s+to\s+(?:public|anon|authenticated)/i.test(aiDraftPromptV4Sql)) {
  throw new Error('AI draft prompt V4 forward-fix grants browser execution.')
}
if (!/p_prompt_version\s+not\s+in\s*\(\s*'outreach_draft_v1'\s*,\s*'outreach_draft_v2'\s*,\s*'outreach_draft_v3'\s*,\s*'outreach_draft_v4'\s*\)/i.test(aiDraftPromptV4Sql)) {
  throw new Error('AI draft prompt V4 forward-fix does not reject unknown prompt versions.')
}

const productBridgeStagingSql = await readFile(
  path.join(migrationsDirectory, expectedProductBridgeStagingMigration),
  'utf8',
)
for (const marker of [
  'create table public.product_bridge_write_requests',
  'constraint product_bridge_write_requests_address_key',
  "status in ('pending', 'completed')",
  "operation_id in (\n    'crm.research.stageSnapshot',\n    'crm.email.stageDraft'",
  'alter table public.product_bridge_write_requests enable row level security;',
  'revoke all on table public.product_bridge_write_requests from public, anon, authenticated;',
  'create or replace function public.get_product_bridge_staging_context(',
  'create or replace function public.claim_product_bridge_write(',
  'create or replace function public.release_product_bridge_write(',
  'create or replace function public.stage_product_bridge_research_snapshot(',
  'create or replace function public.stage_product_bridge_email_draft(',
  'security definer',
  'set search_path = pg_catalog, public',
  "auth.role() <> 'authenticated'",
  "source in ('manual', 'ai', 'imported', 'bridge')",
  "source in ('manual', 'template', 'ai', 'bridge')",
  "'outcome', 'REPLAY', 'receipt', v_request.receipt",
  "'outcome', 'CONFLICT'",
  "'outcome', 'IN_PROGRESS'",
  "'outcome', 'STALE'",
  "'product_bridge.research.staged'",
  "'product_bridge.email_draft.staged'",
  "'research_saved'",
  "'outreach_draft_saved'",
  "'bridge', 'email'",
  "p_language not in ('en', 'es', 'uk', 'ru')",
  "v_member.status not in ('queued', 'researching', 'research_ready')",
  "v_member.status not in ('research_ready', 'draft_ready')",
  'grant execute on function public.get_product_bridge_staging_context(uuid, uuid) to authenticated;',
]) {
  if (!productBridgeStagingSql.includes(marker)) {
    throw new Error(`Product Bridge staging migration is missing required guard: ${marker}`)
  }
}
for (const forbidden of [
  /grant\s+execute[\s\S]*?to\s+(?:public|anon|service_role)\s*;/i,
  /insert\s+into\s+public\.ai_generations/i,
  /outreach-ai-runtime|openai|gmail|provider_draft|'sent'/i,
]) {
  if (forbidden.test(productBridgeStagingSql)) {
    throw new Error(`Product Bridge staging migration crosses a forbidden boundary: ${forbidden}`)
  }
}

const gmailFoundationSql = await readFile(
  path.join(migrationsDirectory, expectedGmailFoundationMigration),
  'utf8',
)
for (const marker of [
  "alter type public.next_action add value if not exists 'review_reply'",
  'create table public.mailbox_accounts',
  'create table private.gmail_oauth_requests',
  'create table private.mailbox_account_credentials',
  'create table public.communication_threads',
  'create table public.communication_links',
  'create table public.external_messages',
  'create table public.email_send_requests',
  'provider_account_subject text not null',
  'references vault.secrets(id)',
  'communication_links_has_target_check',
  'email_send_requests_idempotency_key',
  'email_send_requests_outbound_account_key',
  'email_send_requests_stable_message_id_key',
  'alter table public.mailbox_accounts enable row level security',
  'alter table public.communication_threads enable row level security',
  'alter table public.communication_links enable row level security',
  'alter table public.external_messages enable row level security',
  'alter table public.email_send_requests enable row level security',
  'revoke all on table private.gmail_oauth_requests from public, anon, authenticated, service_role',
  'revoke all on table vault.decrypted_secrets from public, anon, authenticated, service_role',
  'create or replace function public.create_gmail_oauth_request(',
  'create or replace function public.claim_gmail_oauth_callback(',
  'create or replace function public.complete_gmail_account_connection(',
  'create or replace function public.get_gmail_refresh_credential(',
  'create or replace function public.mark_gmail_reauthorization_required(',
  'create or replace function public.complete_gmail_account_disconnect(',
  'grant execute on function public.create_gmail_oauth_request',
  'grant execute on function public.claim_gmail_oauth_callback(text) to service_role',
  'mailbox provider identity is immutable',
  'external provider message identity is immutable',
  'email send request identity is immutable',
]) {
  if (!gmailFoundationSql.includes(marker)) {
    throw new Error(`Gmail foundation migration is missing required guard: ${marker}`)
  }
}
for (const marker of [
  'mailbox_account_credentials_account_org_fkey',
  'communication_threads_account_org_fkey',
  'communication_links_thread_org_fkey',
  'communication_links_lead_org_fkey',
  'communication_links_campaign_member_org_fkey',
  'communication_links_outbound_message_org_fkey',
  'external_messages_thread_identity_fkey',
  'email_send_requests_account_org_fkey',
  'email_send_requests_outbound_org_fkey',
]) {
  if (!gmailFoundationSql.includes(marker)) {
    throw new Error(`Gmail foundation migration is missing organization-safe FK: ${marker}`)
  }
}
if (/grant\s+(?:insert|update|delete|all)[^;]*on\s+(?:table\s+)?public\.(?:mailbox_accounts|communication_threads|communication_links|external_messages|email_send_requests)[^;]*to\s+authenticated/i.test(gmailFoundationSql)) {
  throw new Error('Gmail foundation grants direct authenticated writes to communication state.')
}
if (/users[.]messages[.]send|gmail[.]googleapis[.]com\/gmail\/v1|create\s+(?:or\s+replace\s+)?function\s+public\.(?:gmail_send|send_gmail)/i.test(gmailFoundationSql)) {
  throw new Error('Gmail foundation introduces provider send authority.')
}
if (/alter\s+table\s+public\.product_bridge|create\s+(?:or\s+replace\s+)?function\s+public\.product_bridge/i.test(gmailFoundationSql)) {
  throw new Error('Gmail foundation changes the accepted Product Bridge surface.')
}

const databaseTypes = await readFile(databaseTypesPath, 'utf8')
function generatedRpcBlock(name) {
  const marker = `      ${name}: {`
  const start = databaseTypes.indexOf(marker)
  if (start < 0) throw new Error(`Generated database types are missing RPC: ${name}`)
  const remaining = databaseTypes.slice(start + marker.length)
  const next = remaining.match(/\n      [a-z][a-z0-9_]*: /)
  if (next?.index === undefined) throw new Error(`Generated RPC type block is unterminated: ${name}`)
  return databaseTypes.slice(start, start + marker.length + next.index)
}
function requireNullableGeneratedArgs(name, fields) {
  const block = generatedRpcBlock(name)
  const args = block.slice(block.indexOf('        Args:'), block.indexOf('        Returns:'))
  for (const field of fields) {
    if (!new RegExp(`          ${field}: [^\\n]+\\| null`).test(args)) {
      throw new Error(`Generated RPC ${name} lost nullable argument: ${field}`)
    }
  }
}
const nullableAiFinishArgs = [
  'p_cached_input_tokens',
  'p_error_code',
  'p_error_message',
  'p_input_tokens',
  'p_output_payload',
  'p_output_tokens',
  'p_provider_request_id',
  'p_provider_response_id',
  'p_total_tokens',
]
for (const name of ['finish_ai_research_job', 'finish_ai_draft_job']) {
  requireNullableGeneratedArgs(name, nullableAiFinishArgs)
}
requireNullableGeneratedArgs('finish_ai_runtime_probe', [...nullableAiFinishArgs, 'p_duration_ms'])
for (const name of [
  'claim_gmail_oauth_callback',
  'complete_gmail_account_connection',
  'complete_gmail_account_disconnect',
  'create_gmail_oauth_request',
  'fail_gmail_oauth_request',
  'get_gmail_refresh_credential',
  'mark_gmail_reauthorization_required',
]) {
  generatedRpcBlock(name)
}
for (const table of [
  'mailbox_accounts',
  'communication_threads',
  'communication_links',
  'external_messages',
  'email_send_requests',
]) {
  if (!databaseTypes.includes(`      ${table}: {`)) {
    throw new Error(`Generated database types are missing Gmail table: ${table}`)
  }
}
for (const marker of [
  '__InternalSupabase:',
  'PostgrestVersion: "14.1"',
  '      default_next_step_for_stage: {',
  '      get_product_bridge_staging_context: {',
  '      stage_product_bridge_research_snapshot: {',
  '      stage_product_bridge_email_draft: {',
]) {
  if (!databaseTypes.includes(marker)) throw new Error(`Generated database types are missing canonical contract: ${marker}`)
}

const schemaSnapshot = await readFile(schemaSnapshotPath, 'utf8')
for (const marker of [
  'uidx_leads_org_email_norm on public.leads(org_id, email_norm)',
  'uidx_leads_org_domain_norm on public.leads(org_id, website_domain_norm)',
  'uidx_leads_org_phone_norm on public.leads(org_id, phone_norm)',
]) {
  if (!schemaSnapshot.includes(marker)) throw new Error(`Schema snapshot is missing organization-scoped dedup guard: ${marker}`)
}
for (const marker of [
  '-- 18) Gmail account and communication foundation (CRM-GMAIL-00A)',
  'create table public.mailbox_accounts',
  'create table private.gmail_oauth_requests',
  'create table private.mailbox_account_credentials',
  'create table public.communication_threads',
  'create table public.communication_links',
  'create table public.external_messages',
  'create table public.email_send_requests',
  'create or replace function public.complete_gmail_account_connection(',
  'create or replace function public.complete_gmail_account_disconnect(',
]) {
  if (!schemaSnapshot.includes(marker)) {
    throw new Error(`Schema snapshot is missing Gmail foundation seam: ${marker}`)
  }
}
for (const marker of [
  'create table public.product_bridge_write_requests',
  'create or replace function public.get_product_bridge_staging_context(',
  'create or replace function public.claim_product_bridge_write(',
  'create or replace function public.stage_product_bridge_research_snapshot(',
  'create or replace function public.stage_product_bridge_email_draft(',
]) {
  if (!schemaSnapshot.includes(marker)) {
    throw new Error(`Schema snapshot is missing Product Bridge staging seam: ${marker}`)
  }
}
if (/uidx_leads_(email|domain|phone)_norm on public\.leads\(/.test(schemaSnapshot)) {
  throw new Error('Schema snapshot still contains superseded global lead dedup indexes.')
}
if (!schemaSnapshot.includes('on conflict on constraint campaign_members_campaign_id_lead_id_key do nothing')) {
  throw new Error('Schema snapshot is missing the disambiguated campaign member conflict target.')
}
for (const marker of [
  'v_channel := p_channel::public.activity_channel',
  "v_channel::text, p_language",
  "'outreach_draft_saved', v_channel",
  "'outreach_approved', v_channel",
]) {
  if (!schemaSnapshot.includes(marker)) throw new Error(`Schema snapshot is missing manual message channel guard: ${marker}`)
}

console.log(`Verified ${files.length} migration files, unique versions, and required OutreachOps guards.`)
console.log('Linked-environment verification remains a release step: run `supabase migration list --linked`.')
