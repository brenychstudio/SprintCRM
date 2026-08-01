import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const migrationsDirectory = path.resolve('supabase/migrations')
const schemaSnapshotPath = path.resolve('supabase/schema.sql')
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

const schemaSnapshot = await readFile(schemaSnapshotPath, 'utf8')
for (const marker of [
  'uidx_leads_org_email_norm on public.leads(org_id, email_norm)',
  'uidx_leads_org_domain_norm on public.leads(org_id, website_domain_norm)',
  'uidx_leads_org_phone_norm on public.leads(org_id, phone_norm)',
]) {
  if (!schemaSnapshot.includes(marker)) throw new Error(`Schema snapshot is missing organization-scoped dedup guard: ${marker}`)
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
