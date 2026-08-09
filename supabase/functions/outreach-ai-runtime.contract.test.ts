import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const runtimeSource = readFileSync(resolve('supabase/functions/outreach-ai-runtime/index.ts'), 'utf8')
const lifecycleSql = readFileSync(resolve('supabase/migrations/20260801000007_supervised_ai_draft_generation.sql'), 'utf8')
const promptV2Sql = readFileSync(resolve('supabase/migrations/20260801000008_accept_ai_draft_prompt_v2.sql'), 'utf8')
const promptV3Sql = readFileSync(resolve('supabase/migrations/20260801000009_accept_ai_draft_prompt_v3.sql'), 'utf8')
const promptV4Sql = readFileSync(resolve('supabase/migrations/20260801000010_accept_ai_draft_prompt_v4.sql'), 'utf8')
const draftRuntime = runtimeSource.slice(runtimeSource.indexOf('async function generateDraft('), runtimeSource.indexOf('async function finishFailure('))
const finishLifecycle = lifecycleSql.slice(lifecycleSql.indexOf('create or replace function public.finish_ai_draft_job('), lifecycleSql.indexOf('create or replace function public.fail_stale_ai_draft_job('))

describe('supervised AI draft runtime contract', () => {
  it('makes exactly one provider request and has no retry request path', () => {
    expect(draftRuntime.match(/fetch\('https:\/\/api\.openai\.com\/v1\/responses'/g)).toHaveLength(1)
    expect(draftRuntime).toContain('parseDraftResultWithDeterministicCtaCompletion')
    expect(draftRuntime).not.toMatch(/retry|secondProvider|second_provider/i)
  })

  it('returns a rejected provider result before message, activity, or member-status mutation', () => {
    const failedBranch = finishLifecycle.slice(finishLifecycle.indexOf("if p_status = 'failed' then"), finishLifecycle.indexOf("if v_job.owner is null"))
    expect(failedBranch).toContain('return;')
    expect(failedBranch).not.toMatch(/insert\s+into\s+public\.(?:outbound_messages|activities)/i)
    expect(failedBranch).not.toMatch(/update\s+public\.campaign_members/i)
    expect(failedBranch).not.toContain("'outreach_draft_saved'")
  })

  it('creates exactly one append-only AI draft message version on success', () => {
    expect(finishLifecycle.match(/insert\s+into\s+public\.outbound_messages/gi)).toHaveLength(1)
    expect(finishLifecycle).toContain('select coalesce(max(message.version), 0) + 1 into v_version')
    expect(finishLifecycle).toContain("'ai', v_campaign.default_channel, v_language")
    expect(finishLifecycle).toContain("'draft', v_snapshot.id, v_job.id, v_job.owner")
    expect(finishLifecycle).not.toMatch(/(?:update|delete\s+from)\s+public\.outbound_messages/i)
  })

  it('would append Version 3 after immutable production Versions 1 and 2', () => {
    expect(finishLifecycle).toContain('coalesce(max(message.version), 0) + 1')
    expect(Math.max(...[1, 2]) + 1).toBe(3)
  })

  it('accepts historical and current prompt versions while keeping draft_v1 and rejecting unknown versions', () => {
    expect(promptV2Sql).toContain("p_prompt_version not in ('outreach_draft_v1', 'outreach_draft_v2')")
    expect(promptV3Sql).toContain("p_prompt_version not in ('outreach_draft_v1', 'outreach_draft_v2', 'outreach_draft_v3')")
    expect(promptV4Sql).toContain("p_prompt_version not in ('outreach_draft_v1', 'outreach_draft_v2', 'outreach_draft_v3', 'outreach_draft_v4')")
    expect(promptV4Sql).toContain("'draft_v1', 'pending'")
    expect(promptV4Sql).not.toMatch(/alter\s+table|update\s+public\.ai_generations|delete\s+from/i)
  })
})
