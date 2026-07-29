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

console.log(`Verified ${files.length} migration files, unique versions, and required OutreachOps guards.`)
console.log('Linked-environment verification remains a release step: run `supabase migration list --linked`.')
