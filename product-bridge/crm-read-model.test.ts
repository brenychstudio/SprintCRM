import { describe, expect, it, vi } from 'vitest'

import {
  CRM_ACTIVITY_TYPES,
  CRM_LEAD_STAGES,
  CRM_READ_LIMITS,
  ProductOwnedSprintCrmReadModel,
  getMadridDayBounds,
  isValidDueFollowupsCursor,
  isValidLeadSearchCursor,
  type ActionQueueGatewayInput,
  type ActivityReadRecord,
  type FollowupsGatewayInput,
  type LeadReadRecord,
  type LeadSearchGatewayInput,
  type PipelineGatewayFilters,
  type RecentActivitiesGatewayInput,
  type SprintCrmReadGateway,
  type WorkspaceReadRecord,
} from './crm-read-model'

const FIXED_NOW = '2026-08-10T10:00:00.000Z'

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function lead(sequence: number, overrides: Partial<LeadReadRecord> = {}): LeadReadRecord {
  return {
    id: uuid(sequence),
    company_name: `Company ${sequence}`,
    contact_name: `Contact ${sequence}`,
    website_domain: `company-${sequence}.example`,
    niche: 'software',
    country_city: 'Madrid',
    service_interest: 'Web application',
    offer_type: 'project',
    stage: 'new',
    status: 'active',
    next_action: 'follow_up',
    next_action_at: `2026-08-${String(Math.min(sequence, 28)).padStart(2, '0')}T09:00:00.000Z`,
    last_touch_at: '2026-08-01T09:00:00.000Z',
    preferred_channel: 'email',
    language: 'en',
    reply_status: 'no_reply',
    revenue: 1_000,
    email: `contact-${sequence}@example.test`,
    phone: `+3400000${sequence}`,
    created_at: `2026-07-${String(Math.min(sequence, 28)).padStart(2, '0')}T08:00:00.000Z`,
    updated_at: `2026-08-${String(Math.min(sequence, 28)).padStart(2, '0')}T08:00:00.000Z`,
    ...overrides,
  }
}

function activity(
  sequence: number,
  type: ActivityReadRecord['type'],
  overrides: Partial<ActivityReadRecord> = {},
): ActivityReadRecord {
  return {
    id: uuid(1_000 + sequence),
    lead_id: uuid(1),
    type,
    channel: 'manual',
    at: `2026-08-10T09:${String(sequence).padStart(2, '0')}:00.000Z`,
    meta_from: null,
    meta_to: null,
    meta_stage: null,
    meta_next_action: null,
    meta_next_action_at: null,
    meta_changed_fields: null,
    meta_version: null,
    meta_source: null,
    meta_status: null,
    meta_reply_status: null,
    ...overrides,
  }
}

class FakeSprintCrmReadGateway implements SprintCrmReadGateway {
  workspace: WorkspaceReadRecord = {
    organizationId: uuid(900),
    organizationName: 'SprintCRM',
    membershipRole: 'owner',
  }

  searchRows: readonly LeadReadRecord[] = []
  getLeadRow: LeadReadRecord | null = null
  actionQueueRows: readonly LeadReadRecord[] = []
  followupRows: readonly LeadReadRecord[] = []
  leadWatermark: { readonly id: string; readonly updatedAt: string } | null = null
  activityRows: readonly ActivityReadRecord[] = []
  pipelineCounts = new Map(CRM_LEAD_STAGES.map((stage) => [stage, 0]))
  pipelineLatestUpdatedAt: string | null = null

  getWorkspace = vi.fn(async (): Promise<WorkspaceReadRecord> => this.workspace)

  searchLeads = vi.fn(async (input: LeadSearchGatewayInput): Promise<readonly LeadReadRecord[]> => {
    void input
    return this.searchRows
  })

  getLead = vi.fn(async (leadId: string, includeContactData: boolean): Promise<LeadReadRecord | null> => {
    void leadId
    void includeContactData
    return this.getLeadRow
  })

  listActionQueue = vi.fn(async (input: ActionQueueGatewayInput): Promise<readonly LeadReadRecord[]> => {
    void input
    return this.actionQueueRows
  })

  listDueFollowups = vi.fn(async (input: FollowupsGatewayInput): Promise<readonly LeadReadRecord[]> => {
    void input
    return this.followupRows
  })

  getLeadWatermark = vi.fn(async (leadId: string): Promise<{ readonly id: string; readonly updatedAt: string } | null> => {
    void leadId
    return this.leadWatermark
  })

  listRecentActivities = vi.fn(async (input: RecentActivitiesGatewayInput): Promise<readonly ActivityReadRecord[]> => {
    void input
    return this.activityRows
  })

  countPipelineStage = vi.fn(async (stage: LeadReadRecord['stage'], filters: PipelineGatewayFilters): Promise<number> => {
    void filters
    return this.pipelineCounts.get(stage) ?? 0
  })

  getPipelineLatestUpdatedAt = vi.fn(async (filters: PipelineGatewayFilters): Promise<string | null> => {
    void filters
    return this.pipelineLatestUpdatedAt
  })
}

describe('ProductOwnedSprintCrmReadModel', () => {
  it('returns a bounded workspace context with deterministic canonical evidence', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.workspace = {
      ...gateway.workspace,
      organizationName: `  ${'W'.repeat(300)}  `,
    }
    let now = FIXED_NOW
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => now)

    const first = await model.getWorkspaceContext()
    now = '2026-08-10T10:05:00.000Z'
    const second = await model.getWorkspaceContext()

    expect(first.workspace.organizationName).toHaveLength(240)
    expect(first.capabilities).toEqual([
      'crm.workspace.getContext',
      'crm.leads.search',
      'crm.leads.get',
      'crm.leads.listActionQueue',
      'crm.followups.listDue',
      'crm.activities.listRecent',
      'crm.pipeline.getSummary',
    ])
    expect(first.canonicalStateVersion).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(second.canonicalStateVersion).toBe(first.canonicalStateVersion)
    expect(second.generatedAt).not.toBe(first.generatedAt)
  })

  it('applies default and maximum search bounds and produces a filter-bound cursor', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.searchRows = Array.from({ length: 11 }, (_, index) => lead(index + 1))
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => FIXED_NOW)

    const first = await model.searchLeads({ q: '  Acme  ', stage: 'new' })

    expect(gateway.searchLeads).toHaveBeenLastCalledWith({
      q: 'Acme',
      stage: 'new',
      status: 'active',
      nextAction: undefined,
      cursor: undefined,
      fetchLimit: CRM_READ_LIMITS.listDefault + 1,
    })
    expect(first.leads).toHaveLength(CRM_READ_LIMITS.listDefault)
    expect(first.page).toEqual({ hasMore: true, nextCursor: expect.any(String) })
    expect(isValidLeadSearchCursor({ q: 'Acme', stage: 'new', cursor: first.page.nextCursor! })).toBe(true)
    expect(isValidLeadSearchCursor({ q: 'Acme', stage: 'contacted', cursor: first.page.nextCursor! })).toBe(false)
    expect(isValidLeadSearchCursor({ q: 'different', stage: 'new', cursor: first.page.nextCursor! })).toBe(false)
    expect(isValidLeadSearchCursor({ q: 'Acme', stage: 'new', cursor: 'not-a-cursor' })).toBe(false)

    gateway.searchRows = []
    await model.searchLeads({ q: 'Acme', stage: 'new', cursor: first.page.nextCursor! })
    expect(gateway.searchLeads).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: {
        createdAt: lead(10).created_at,
        leadId: lead(10).id,
      },
      fetchLimit: CRM_READ_LIMITS.listDefault + 1,
    }))

    gateway.searchRows = Array.from({ length: 26 }, (_, index) => lead(index + 1))
    const maximum = await model.searchLeads({ limit: CRM_READ_LIMITS.listMaximum })
    expect(gateway.searchLeads).toHaveBeenLastCalledWith(expect.objectContaining({
      fetchLimit: CRM_READ_LIMITS.listMaximum + 1,
    }))
    expect(maximum.leads).toHaveLength(CRM_READ_LIMITS.listMaximum)

    await model.searchLeads({ limit: CRM_READ_LIMITS.listMaximum + 1 })
    expect(gateway.searchLeads).toHaveBeenLastCalledWith(expect.objectContaining({
      fetchLimit: CRM_READ_LIMITS.listDefault + 1,
    }))
  })

  it('never spreads raw lead fields and includes contact data only through trusted access', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.getLeadRow = {
      ...lead(1, {
        company_name: `  \u0000\n${'C'.repeat(300)}  `,
        contact_name: `  ${'N'.repeat(300)}  `,
        service_interest: `  ${'S'.repeat(700)}  `,
        email: `${'e'.repeat(400)}@example.test`,
        phone: `+${'1'.repeat(100)}`,
      }),
      notes: 'private note',
      message_body: 'private message body',
      org_id: uuid(901),
      owner: 'private owner',
      deduplication_key: 'private dedup key',
      ai_analysis: 'private model output',
    } as LeadReadRecord
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => FIXED_NOW)

    const redacted = await model.getLead({ leadId: uuid(1) }, { includeContactData: false })

    expect(gateway.getLead).toHaveBeenLastCalledWith(uuid(1), false)
    expect(redacted.found).toBe(true)
    if (!redacted.found) throw new Error('Expected the fake lead to be found')
    expect(redacted.contactDataIncluded).toBe(false)
    expect(redacted.lead.companyName).toHaveLength(240)
    expect(redacted.lead.contactName).toHaveLength(240)
    expect(redacted.lead.serviceInterest).toHaveLength(500)
    expect(Array.from(redacted.lead.companyName).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127
    })).toBe(false)
    expect(redacted.lead).not.toHaveProperty('contact')
    expect(redacted.lead).not.toHaveProperty('email')
    expect(redacted.lead).not.toHaveProperty('phone')
    expect(redacted.lead).not.toHaveProperty('notes')
    expect(redacted.lead).not.toHaveProperty('message_body')
    expect(redacted.lead).not.toHaveProperty('org_id')
    expect(redacted.lead).not.toHaveProperty('owner')
    expect(redacted.lead).not.toHaveProperty('deduplication_key')
    expect(redacted.lead).not.toHaveProperty('ai_analysis')
    expect(JSON.stringify(redacted)).not.toContain('private')

    const included = await model.getLead({ leadId: uuid(1) }, { includeContactData: true })

    expect(gateway.getLead).toHaveBeenLastCalledWith(uuid(1), true)
    expect(included.found).toBe(true)
    if (!included.found) throw new Error('Expected the fake lead to be found')
    expect(included.contactDataIncluded).toBe(true)
    expect(included.lead.contact?.email).toHaveLength(320)
    expect(included.lead.contact?.phone).toHaveLength(64)
    expect(included.lead).not.toHaveProperty('notes')
    expect(included.lead).not.toHaveProperty('message_body')
    expect(included.lead).not.toHaveProperty('org_id')
    expect(included.lead).not.toHaveProperty('ai_analysis')
    expect(included.canonicalStateVersion).toBe(`lead:${uuid(1)}:${lead(1).updated_at}`)
  })

  it('returns a non-enumerating result when a lead is not found', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.getLeadRow = null
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => FIXED_NOW)

    const result = await model.getLead({ leadId: uuid(404) }, { includeContactData: true })

    expect(result).toEqual({
      found: false,
      contactDataIncluded: false,
      generatedAt: FIXED_NOW,
      canonicalStateVersion: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    })
    expect(result).not.toHaveProperty('lead')
  })

  it('uses Madrid day bounds for the bounded action queue and exposes no synthetic score', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.actionQueueRows = [
      lead(1, { next_action: 'follow_up', next_action_at: '2026-08-09T21:59:59.999Z' }),
      lead(2, { next_action: 'send_proposal', next_action_at: '2026-08-09T22:00:00.000Z' }),
      lead(3, { next_action: 'request_call', next_action_at: '2026-08-10T21:59:59.999Z' }),
    ]
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => FIXED_NOW)

    const bounds = getMadridDayBounds(FIXED_NOW)
    const result = await model.listActionQueue({ stage: 'proposal' })

    expect(bounds).toEqual({
      start: '2026-08-09T22:00:00.000Z',
      end: '2026-08-10T21:59:59.999Z',
    })
    expect(gateway.listActionQueue).toHaveBeenCalledWith({
      dueBefore: bounds.end,
      stage: 'proposal',
      fetchLimit: CRM_READ_LIMITS.listDefault + 1,
    })
    expect(result.items.map(({ nextAction, overdue, dueToday }) => ({ nextAction, overdue, dueToday }))).toEqual([
      { nextAction: 'follow_up', overdue: true, dueToday: false },
      { nextAction: 'send_proposal', overdue: false, dueToday: true },
      { nextAction: 'request_call', overdue: false, dueToday: true },
    ])
    expect(result.dueBefore).toBe(bounds.end)
    expect(JSON.stringify(result)).not.toMatch(/score|priority/iu)
  })

  it('models due follow-ups as lead-backed next actions with boundary-bound cursor pagination', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.followupRows = Array.from({ length: 11 }, (_, index) => lead(index + 1, {
      next_action_at: `2026-08-10T${String(index).padStart(2, '0')}:00:00.000Z`,
    }))
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => FIXED_NOW)
    const dueBefore = '2026-08-10T21:00:00.000Z'

    const first = await model.listDueFollowups({ dueBefore, stage: 'contacted' })

    expect(gateway.listDueFollowups).toHaveBeenLastCalledWith({
      dueBefore,
      stage: 'contacted',
      cursor: undefined,
      fetchLimit: CRM_READ_LIMITS.listDefault + 1,
    })
    expect(first.representation).toBe('lead_backed_next_action')
    expect(first.followups).toHaveLength(CRM_READ_LIMITS.listDefault)
    expect(first.page).toEqual({ hasMore: true, nextCursor: expect.any(String) })
    expect(first.followups[0]).not.toHaveProperty('taskId')
    expect(first.followups[0]).not.toHaveProperty('contact')
    expect(isValidDueFollowupsCursor({ dueBefore, stage: 'contacted', cursor: first.page.nextCursor! })).toBe(true)
    expect(isValidDueFollowupsCursor({ dueBefore, stage: 'new', cursor: first.page.nextCursor! })).toBe(false)
    expect(isValidDueFollowupsCursor({
      dueBefore: '2026-08-10T20:00:00.000Z',
      stage: 'contacted',
      cursor: first.page.nextCursor!,
    })).toBe(false)

    gateway.followupRows = []
    await model.listDueFollowups({ stage: 'contacted', cursor: first.page.nextCursor! })
    expect(gateway.listDueFollowups).toHaveBeenLastCalledWith(expect.objectContaining({
      dueBefore,
      cursor: {
        nextActionAt: '2026-08-10T09:00:00.000Z',
        leadId: uuid(10),
      },
    }))
  })

  it('allowlists activity metadata and strips arbitrary contact, note, and message data', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.leadWatermark = { id: uuid(1), updatedAt: '2026-08-10T08:00:00.000Z' }
    gateway.activityRows = [
      {
        ...activity(1, 'stage_changed', {
          channel: `  ${'c'.repeat(50)}  `,
          meta_from: 'new',
          meta_to: 'contacted',
          meta_next_action: 'follow_up',
          meta_next_action_at: '2026-08-11T08:00:00.000Z',
        }),
        email: 'private@example.test',
        phone: '+34123456789',
        notes: 'private note',
        message: 'private message',
        arbitrary: 'private arbitrary value',
      } as ActivityReadRecord,
      activity(2, 'manual_edit', {
        meta_changed_fields: [
          'company_name',
          'email',
          'phone',
          'notes',
          'contact_name',
          'company_name',
          42,
        ],
      }),
      activity(3, 'outreach_draft_saved', {
        meta_version: '2',
        meta_source: 'operator',
        meta_status: 'approved',
      }),
      activity(4, 'note', {
        meta_from: 'private note',
        meta_source: 'operator',
      }),
      activity(5, 'reply_marked', { meta_reply_status: 'positive' }),
    ]
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => FIXED_NOW)

    const result = await model.listRecentActivities({
      leadId: uuid(1),
      types: ['stage_changed', 'manual_edit', 'outreach_draft_saved', 'note', 'reply_marked'],
    })

    expect(gateway.listRecentActivities).toHaveBeenCalledWith({
      leadId: uuid(1),
      types: ['stage_changed', 'manual_edit', 'outreach_draft_saved', 'note', 'reply_marked'],
      fetchLimit: CRM_READ_LIMITS.activitiesDefault + 1,
    })
    expect(result.activities[0]).toEqual({
      activityId: uuid(1_001),
      leadId: uuid(1),
      type: 'stage_changed',
      channel: 'c'.repeat(32),
      at: '2026-08-10T09:01:00.000Z',
      metadata: {
        fromStage: 'new',
        toStage: 'contacted',
        nextAction: 'follow_up',
        nextActionAt: '2026-08-11T08:00:00.000Z',
      },
    })
    expect(result.activities[1]?.metadata).toEqual({ changedFields: ['company_name', 'contact_name'] })
    expect(result.activities[2]?.metadata).toEqual({ version: 2, source: 'operator', status: 'approved' })
    expect(result.activities[3]?.metadata).toEqual({})
    expect(result.activities[4]?.metadata).toEqual({ replyStatus: 'positive' })
    expect(JSON.stringify(result)).not.toMatch(/private|email|phone|notes|message|arbitrary/iu)
    expect(result.canonicalStateVersion).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })

  it('returns a safe empty activity result for a missing lead without querying activities', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => FIXED_NOW)

    const result = await model.listRecentActivities({ leadId: uuid(404), types: CRM_ACTIVITY_TYPES })

    expect(result).toEqual({
      foundLead: false,
      activities: [],
      hasMore: false,
      generatedAt: FIXED_NOW,
      canonicalStateVersion: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    })
    expect(gateway.listRecentActivities).not.toHaveBeenCalled()
  })

  it('applies the maximum activities bound with one-row lookahead', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.leadWatermark = { id: uuid(1), updatedAt: '2026-08-10T08:00:00.000Z' }
    gateway.activityRows = Array.from(
      { length: CRM_READ_LIMITS.activitiesMaximum + 1 },
      (_, index) => activity(index + 1, 'contacted'),
    )
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => FIXED_NOW)

    const result = await model.listRecentActivities({
      leadId: uuid(1),
      limit: CRM_READ_LIMITS.activitiesMaximum,
    })

    expect(gateway.listRecentActivities).toHaveBeenCalledWith(expect.objectContaining({
      fetchLimit: CRM_READ_LIMITS.activitiesMaximum + 1,
    }))
    expect(result.activities).toHaveLength(CRM_READ_LIMITS.activitiesMaximum)
    expect(result.hasMore).toBe(true)
  })

  it('uses exactly six server-side stage counts and returns deterministic pipeline freshness', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.pipelineCounts = new Map([
      ['new', 3],
      ['contacted', 5],
      ['replied', 2],
      ['proposal', 4],
      ['won', 7],
      ['lost', 1],
    ])
    gateway.pipelineLatestUpdatedAt = '2026-08-10T09:59:00.000Z'
    let now = FIXED_NOW
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => now)

    const first = await model.getPipelineSummary({
      status: 'active',
      niche: '  software  ',
      serviceInterest: '  web applications  ',
    })
    now = '2026-08-10T11:00:00.000Z'
    const second = await model.getPipelineSummary({
      status: 'active',
      niche: 'software',
      serviceInterest: 'web applications',
    })

    expect(gateway.countPipelineStage).toHaveBeenCalledTimes(CRM_LEAD_STAGES.length * 2)
    expect(gateway.countPipelineStage.mock.calls.slice(0, CRM_LEAD_STAGES.length)).toEqual(
      CRM_LEAD_STAGES.map((stage) => [stage, {
        status: 'active',
        niche: 'software',
        serviceInterest: 'web applications',
      }]),
    )
    expect(first.countsByStage).toEqual({
      new: 3,
      contacted: 5,
      replied: 2,
      proposal: 4,
      won: 7,
      lost: 1,
    })
    expect(first.total).toBe(22)
    expect(first.latestUpdatedAt).toBe('2026-08-10T09:59:00.000Z')
    expect(first.consistency).toBe('bounded_multi_query_read')
    expect(first.canonicalStateVersion).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(second.canonicalStateVersion).toBe(first.canonicalStateVersion)
    expect(second.generatedAt).not.toBe(first.generatedAt)
  })

  it('keeps search snapshots deterministic while truncating every projected business string', async () => {
    const gateway = new FakeSprintCrmReadGateway()
    gateway.searchRows = [lead(1, {
      company_name: `  ${'C'.repeat(300)}  `,
      contact_name: `  ${'N'.repeat(300)}  `,
      website_domain: `  ${'d'.repeat(300)}  `,
      niche: `  ${'I'.repeat(400)}  `,
      country_city: `  ${'L'.repeat(400)}  `,
      service_interest: `  ${'S'.repeat(700)}  `,
    })]
    let now = FIXED_NOW
    const model = new ProductOwnedSprintCrmReadModel(gateway, () => now)

    const first = await model.searchLeads({})
    now = '2026-08-10T12:00:00.000Z'
    const second = await model.searchLeads({})
    const projected = first.leads[0]

    expect(projected?.companyName).toHaveLength(240)
    expect(projected?.contactName).toHaveLength(240)
    expect(projected?.websiteDomain).toHaveLength(253)
    expect(projected?.niche).toHaveLength(300)
    expect(projected?.location).toHaveLength(300)
    expect(projected?.serviceInterest).toHaveLength(500)
    expect(first.canonicalStateVersion).toBe(second.canonicalStateVersion)
  })
})
