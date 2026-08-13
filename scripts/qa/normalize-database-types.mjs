import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const typesPath = resolve(process.argv[2] ?? 'src/lib/supabase/database.types.ts')
let source = readFileSync(typesPath, 'utf8').replaceAll('\r\n', '\n')

function functionBlock(name) {
  const startMarker = `      ${name}: {`
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`Generated database types are missing RPC: ${name}`)
  const remaining = source.slice(start + startMarker.length)
  const nextMatch = remaining.match(/\n      [a-z][a-z0-9_]*: /)
  const next = nextMatch?.index === undefined ? -1 : start + startMarker.length + nextMatch.index
  if (next < 0) throw new Error(`Generated database type block is unterminated: ${name}`)
  return { start, end: next, text: source.slice(start, next) }
}

function replaceFunctionBlock(name, transform) {
  const block = functionBlock(name)
  const normalized = transform(block.text)
  if (!normalized.startsWith(`      ${name}: {`)) {
    throw new Error(`Generated database type normalization corrupted RPC: ${name}`)
  }
  source = source.slice(0, block.start) + normalized + source.slice(block.end)
}

function nullableFields(block, fields, section = 'Args') {
  const sectionStart = block.indexOf(`        ${section}:`)
  if (sectionStart < 0) throw new Error(`Generated RPC block is missing ${section}.`)
  const sectionEnd = block.indexOf(section === 'Args' ? '\n        Returns:' : '\n        SetofOptions:', sectionStart)
  const end = sectionEnd < 0 ? block.length : sectionEnd
  let prefix = block.slice(0, sectionStart)
  let target = block.slice(sectionStart, end)
  const suffix = block.slice(end)

  for (const field of fields) {
    const pattern = new RegExp(`(          ${field}: (?![^\\n]*\\| null)[^\\n]+)`)
    if (pattern.test(target)) target = target.replace(pattern, '$1 | null')
    if (!new RegExp(`          ${field}: [^\\n]+\\| null`).test(target)) {
      throw new Error(`Generated ${section} did not expose nullable field: ${field}`)
    }
  }
  return prefix + target + suffix
}

if (!source.includes('__InternalSupabase:')) {
  const databaseMarker = 'export type Database = {\n'
  if (!source.includes(databaseMarker)) throw new Error('Generated Database declaration was not found.')
  source = source.replace(databaseMarker, `${databaseMarker}  // Allows to automatically instantiate createClient with right options\n  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)\n  __InternalSupabase: {\n    PostgrestVersion: "14.1"\n  }\n`)
}

const defaultNextStep = `      default_next_step_for_stage: {
        Args: {
          p_base_at?: string
          p_stage: Database["public"]["Enums"]["lead_stage"]
          p_tz?: string
        }
        Returns: {
          next_action: Database["public"]["Enums"]["next_action"]
          next_action_at: string
        }[]
      }
`
if (!source.includes('      default_next_step_for_stage: {')) {
  const marker = '      fail_gmail_oauth_request: {'
  if (!source.includes(marker)) throw new Error('Generated Gmail RPC insertion boundary was not found.')
  source = source.replace(marker, defaultNextStep + marker)
}

const finishNullableArgs = [
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
for (const name of ['finish_ai_draft_job', 'finish_ai_research_job']) {
  replaceFunctionBlock(name, (block) => nullableFields(block, finishNullableArgs))
}
replaceFunctionBlock('finish_ai_runtime_probe', (block) => nullableFields(
  nullableFields(block, finishNullableArgs),
  ['p_duration_ms'],
))

const nullableLedgerReturns = [
  'cached_input_tokens',
  'duration_ms',
  'estimated_cost_usd',
  'input_tokens',
  'model_name',
  'output_tokens',
  'request_id',
  'schema_version',
  'total_tokens',
]
for (const name of ['start_ai_draft_job', 'start_ai_research_job', 'start_ai_runtime_probe']) {
  replaceFunctionBlock(name, (block) => nullableFields(block, nullableLedgerReturns, 'Returns'))
}
replaceFunctionBlock('start_ai_draft_job', (block) => nullableFields(
  block,
  ['research_snapshot_id', 'research_version'],
  'Returns',
))
for (const name of ['finish_ai_draft_job', 'finish_ai_research_job']) {
  replaceFunctionBlock(name, (block) => nullableFields(block, nullableLedgerReturns, 'Returns'))
}
replaceFunctionBlock('finish_ai_draft_job', (block) => nullableFields(
  block,
  ['message_version', 'research_snapshot_id', 'research_version'],
  'Returns',
))
replaceFunctionBlock('finish_ai_research_job', (block) => nullableFields(
  block,
  ['research_snapshot_id', 'research_version'],
  'Returns',
))

replaceFunctionBlock('stage_product_bridge_research_snapshot', (block) => nullableFields(
  block,
  ['p_confidence', 'p_recommended_case'],
))

for (const name of [
  'claim_gmail_oauth_callback',
  'complete_gmail_account_connection',
  'complete_gmail_account_disconnect',
  'create_gmail_oauth_request',
  'fail_gmail_oauth_request',
  'get_gmail_refresh_credential',
  'mark_gmail_reauthorization_required',
]) {
  functionBlock(name)
}

writeFileSync(typesPath, source, 'utf8')
console.log(`Normalized generated database contracts: ${typesPath}`)
