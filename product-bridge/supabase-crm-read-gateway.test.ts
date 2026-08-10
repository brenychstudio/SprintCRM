import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Database } from '../src/lib/supabase/database.types.js'
import {
  CRM_SUPABASE_SAFE_PROJECTIONS,
  SupabaseCrmReadGateway,
  escapedPostgrestIlikePattern,
} from './supabase-crm-read-gateway.js'

interface RecordedCall {
  readonly method: string
  readonly argumentsValue: readonly unknown[]
}

interface RecordedQuery {
  readonly table: string
  readonly calls: RecordedCall[]
}

class FakeQuery implements PromiseLike<unknown> {
  constructor(
    readonly record: RecordedQuery,
    private readonly response: Record<string, unknown>,
  ) {}

  private call(method: string, ...argumentsValue: unknown[]): this {
    this.record.calls.push({ method, argumentsValue })
    return this
  }

  select(...value: unknown[]) { return this.call('select', ...value) }
  eq(...value: unknown[]) { return this.call('eq', ...value) }
  in(...value: unknown[]) { return this.call('in', ...value) }
  lte(...value: unknown[]) { return this.call('lte', ...value) }
  or(...value: unknown[]) { return this.call('or', ...value) }
  order(...value: unknown[]) { return this.call('order', ...value) }
  limit(...value: unknown[]) { return this.call('limit', ...value) }

  maybeSingle(): Promise<Record<string, unknown>> {
    this.call('maybeSingle')
    return Promise.resolve(this.response)
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected)
  }
}

class FakeSupabaseClient {
  readonly queries: RecordedQuery[] = []
  readonly responses: Record<string, unknown>[] = []

  from(table: string): FakeQuery {
    const record = { table, calls: [] }
    this.queries.push(record)
    return new FakeQuery(record, this.responses.shift() ?? { data: [], error: null, count: 0 })
  }
}

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const LEAD_ID = '33333333-3333-4333-8333-333333333333'

function called(query: RecordedQuery, method: string): RecordedCall[] {
  return query.calls.filter((entry) => entry.method === method)
}

describe('SupabaseCrmReadGateway', () => {
  let fake: FakeSupabaseClient
  let gateway: SupabaseCrmReadGateway

  beforeEach(() => {
    fake = new FakeSupabaseClient()
    gateway = new SupabaseCrmReadGateway(fake as unknown as SupabaseClient<Database>, {
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
    })
  })

  it('binds workspace reads to both the authenticated user and expected organization', async () => {
    fake.responses.push(
      { data: { org_id: ORGANIZATION_ID, role: 'owner' }, error: null },
      { data: { id: ORGANIZATION_ID, name: 'Bound CRM' }, error: null },
    )
    await expect(gateway.getWorkspace()).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      organizationName: 'Bound CRM',
      membershipRole: 'owner',
    })
    expect(fake.queries.map(({ table }) => table)).toEqual(['memberships', 'organizations'])
    expect(fake.queries[0]?.calls).toContainEqual({ method: 'eq', argumentsValue: ['org_id', ORGANIZATION_ID] })
    expect(fake.queries[0]?.calls).toContainEqual({ method: 'eq', argumentsValue: ['user_id', USER_ID] })
    expect(fake.queries[1]?.calls).toContainEqual({ method: 'eq', argumentsValue: ['id', ORGANIZATION_ID] })
  })

  it('uses fixed safe search projection, bound organization, stable keyset and escaped q grammar', async () => {
    fake.responses.push({ data: [], error: null })
    const queryText = 'ACME, Inc. (100%)_"\\'
    await gateway.searchLeads({
      q: queryText,
      stage: 'contacted',
      status: 'active',
      nextAction: 'follow_up',
      cursor: { createdAt: '2026-08-10T10:00:00.000Z', leadId: LEAD_ID },
      fetchLimit: 26,
    })
    const query = fake.queries[0]!
    expect(called(query, 'select')[0]?.argumentsValue[0]).toBe(CRM_SUPABASE_SAFE_PROJECTIONS.leadSummary)
    expect(String(called(query, 'select')[0]?.argumentsValue[0])).not.toContain('*')
    expect(query.calls).toContainEqual({ method: 'eq', argumentsValue: ['org_id', ORGANIZATION_ID] })
    expect(query.calls).toContainEqual({ method: 'eq', argumentsValue: ['status', 'active'] })
    expect(query.calls).toContainEqual({ method: 'limit', argumentsValue: [26] })
    expect(called(query, 'order').map(({ argumentsValue }) => argumentsValue[0])).toEqual(['created_at', 'id'])
    const orValues = called(query, 'or').map(({ argumentsValue }) => String(argumentsValue[0]))
    expect(orValues).toHaveLength(2)
    expect(orValues[0]).toContain(`company_name.ilike.${escapedPostgrestIlikePattern(queryText)}`)
    expect(orValues[1]).toContain(`created_at.lt."2026-08-10T10:00:00.000Z"`)
    expect(orValues[0]).not.toContain('email.ilike')
  })

  it('selects contact columns only for the trusted lead-get expansion', async () => {
    fake.responses.push({ data: null, error: null }, { data: null, error: null })
    await gateway.getLead(LEAD_ID, false)
    await gateway.getLead(LEAD_ID, true)
    const withoutContact = String(called(fake.queries[0]!, 'select')[0]?.argumentsValue[0])
    const withContact = String(called(fake.queries[1]!, 'select')[0]?.argumentsValue[0])
    expect(withoutContact).not.toMatch(/(?:^|,)email(?:,|$)|(?:^|,)phone(?:,|$)/u)
    expect(withContact).toMatch(/,email,phone$/u)
    for (const query of fake.queries) {
      expect(query.calls).toContainEqual({ method: 'eq', argumentsValue: ['org_id', ORGANIZATION_ID] })
      expect(String(called(query, 'select')[0]?.argumentsValue[0])).not.toContain('*')
    }
  })

  it('keeps queue/follow-up reads active, nonterminal, bounded and correctly cursor-ordered', async () => {
    fake.responses.push({ data: [], error: null }, { data: [], error: null })
    await gateway.listActionQueue({ dueBefore: '2026-08-10T21:59:59.999Z', fetchLimit: 11 })
    await gateway.listDueFollowups({
      dueBefore: '2026-08-10T21:59:59.999Z',
      cursor: { nextActionAt: '2026-08-10T09:00:00.000Z', leadId: LEAD_ID },
      fetchLimit: 26,
    })
    for (const query of fake.queries) {
      expect(query.calls).toContainEqual({ method: 'eq', argumentsValue: ['org_id', ORGANIZATION_ID] })
      expect(query.calls).toContainEqual({ method: 'eq', argumentsValue: ['status', 'active'] })
      expect(called(query, 'in')[0]?.argumentsValue[1]).toEqual(['new', 'contacted', 'replied', 'proposal'])
    }
    expect(String(called(fake.queries[1]!, 'or')[0]?.argumentsValue[0])).toContain('next_action_at.gt.')
    expect(called(fake.queries[1]!, 'order').map(({ argumentsValue }) => argumentsValue[1])).toEqual([
      { ascending: true },
      { ascending: true },
    ])
  })

  it('projects only named activity metadata paths and always binds the lead and organization', async () => {
    fake.responses.push({ data: [], error: null })
    await gateway.listRecentActivities({ leadId: LEAD_ID, types: ['manual_edit'], fetchLimit: 51 })
    const query = fake.queries[0]!
    const projection = String(called(query, 'select')[0]?.argumentsValue[0])
    expect(projection).toBe(CRM_SUPABASE_SAFE_PROJECTIONS.activity)
    expect(projection).not.toMatch(/(?:^|,)meta(?:,|$)/u)
    expect(projection).not.toMatch(/body|notes|email|phone|generation_id/iu)
    expect(projection).toContain('meta_changed_fields:meta->changed_fields')
    expect(query.calls).toContainEqual({ method: 'eq', argumentsValue: ['org_id', ORGANIZATION_ID] })
    expect(query.calls).toContainEqual({ method: 'eq', argumentsValue: ['lead_id', LEAD_ID] })
    expect(query.calls).toContainEqual({ method: 'limit', argumentsValue: [51] })
  })

  it('uses HEAD exact counts and a one-row watermark instead of loading pipeline rows', async () => {
    fake.responses.push({ data: null, error: null, count: 7 }, { data: { updated_at: '2026-08-10T10:00:00Z' }, error: null })
    await expect(gateway.countPipelineStage('proposal', {
      status: 'active', niche: 'software', serviceInterest: 'web',
    })).resolves.toBe(7)
    await expect(gateway.getPipelineLatestUpdatedAt({ status: 'active' })).resolves.toBe('2026-08-10T10:00:00Z')
    const countSelect = called(fake.queries[0]!, 'select')[0]!
    expect(countSelect.argumentsValue).toEqual(['id', { count: 'exact', head: true }])
    expect(fake.queries[0]?.calls).toContainEqual({ method: 'eq', argumentsValue: ['org_id', ORGANIZATION_ID] })
    expect(fake.queries[1]?.calls).toContainEqual({ method: 'limit', argumentsValue: [1] })
  })

  it('turns provider details into one safe read failure', async () => {
    fake.responses.push({ data: null, error: { message: 'JWT secret stack details' } })
    await expect(gateway.getLead(LEAD_ID, false)).rejects.toThrow('SprintCRM read failed safely.')
  })
})
