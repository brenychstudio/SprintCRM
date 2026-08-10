import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../src/lib/supabase/database.types.js'
import {
  CRM_ACTIVE_QUEUE_STAGES,
  type ActivityReadRecord,
  type ActionQueueGatewayInput,
  type CrmLeadStage,
  type FollowupsGatewayInput,
  type LeadReadRecord,
  type LeadSearchGatewayInput,
  type PipelineGatewayFilters,
  type RecentActivitiesGatewayInput,
  type SprintCrmReadGateway,
  type WorkspaceReadRecord,
} from './crm-read-model.js'

const LEAD_SUMMARY_PROJECTION = [
  'id',
  'company_name',
  'contact_name',
  'website_domain',
  'niche',
  'country_city',
  'service_interest',
  'stage',
  'status',
  'next_action',
  'next_action_at',
  'created_at',
  'updated_at',
].join(',')

const LEAD_DETAIL_PROJECTION = [
  LEAD_SUMMARY_PROJECTION,
  'offer_type',
  'last_touch_at',
  'preferred_channel',
  'language',
  'reply_status',
  'revenue',
].join(',')

const LEAD_CONTACT_PROJECTION = `${LEAD_DETAIL_PROJECTION},email,phone`

const ACTIVITY_SAFE_PROJECTION = [
  'id',
  'lead_id',
  'type',
  'channel',
  'at',
  'meta_from:meta->>from',
  'meta_to:meta->>to',
  'meta_stage:meta->>stage',
  'meta_next_action:meta->>next_action',
  'meta_next_action_at:meta->>next_action_at',
  'meta_changed_fields:meta->changed_fields',
  'meta_version:meta->>version',
  'meta_source:meta->>source',
  'meta_status:meta->>status',
  'meta_reply_status:meta->>reply_status',
].join(',')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function safeReadFailure(): never {
  throw new Error('SprintCRM read failed safely.')
}

function assertSafeCursorValue(timestamp: string, leadId: string): void {
  if (!Number.isFinite(Date.parse(timestamp)) || !UUID_PATTERN.test(leadId)) safeReadFailure()
}

function quotePostgrestValue(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** Escapes both SQL LIKE wildcards and PostgREST quoted-filter metacharacters. */
export function escapedPostgrestIlikePattern(value: string): string {
  const literal = value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
  return quotePostgrestValue(`%${literal}%`)
}

function cursorFilter(
  timestamp: string,
  leadId: string,
  column: 'created_at' | 'next_action_at',
  direction: 'after_descending' | 'after_ascending',
): string {
  assertSafeCursorValue(timestamp, leadId)
  const at = quotePostgrestValue(timestamp)
  const comparator = direction === 'after_descending' ? 'lt' : 'gt'
  return `${column}.${comparator}.${at},and(${column}.eq.${at},id.${comparator}.${leadId})`
}

function applyPipelineFilters<T extends {
  eq(column: string, value: string): T
}>(query: T, filters: PipelineGatewayFilters): T {
  let filtered = query.eq('status', filters.status)
  if (filters.niche) filtered = filtered.eq('niche', filters.niche)
  if (filters.serviceInterest) filtered = filtered.eq('service_interest', filters.serviceInterest)
  return filtered
}

export interface SupabaseCrmReadGatewayBinding {
  readonly organizationId: string
  readonly userId: string
}

/**
 * Authenticated user/RLS gateway with an immutable organization binding.
 * Every method uses a fixed projection and an explicit organization predicate.
 */
export class SupabaseCrmReadGateway implements SprintCrmReadGateway {
  private readonly organizationId: string
  private readonly userId: string

  constructor(
    private readonly client: SupabaseClient<Database>,
    binding: SupabaseCrmReadGatewayBinding,
  ) {
    this.organizationId = binding.organizationId
    this.userId = binding.userId
  }

  async getWorkspace(): Promise<WorkspaceReadRecord> {
    const [membershipResult, organizationResult] = await Promise.all([
      this.client
        .from('memberships')
        .select('org_id,role')
        .eq('org_id', this.organizationId)
        .eq('user_id', this.userId)
        .maybeSingle(),
      this.client
        .from('organizations')
        .select('id,name')
        .eq('id', this.organizationId)
        .maybeSingle(),
    ])
    if (membershipResult.error || organizationResult.error || !membershipResult.data || !organizationResult.data) {
      safeReadFailure()
    }
    return {
      organizationId: organizationResult.data.id,
      organizationName: organizationResult.data.name,
      membershipRole: membershipResult.data.role,
    }
  }

  async searchLeads(input: LeadSearchGatewayInput): Promise<readonly LeadReadRecord[]> {
    let query = this.client
      .from('leads')
      .select(LEAD_SUMMARY_PROJECTION)
      .eq('org_id', this.organizationId)
      .eq('status', input.status)

    if (input.q) {
      const pattern = escapedPostgrestIlikePattern(input.q)
      query = query.or([
        `company_name.ilike.${pattern}`,
        `contact_name.ilike.${pattern}`,
        `website_domain.ilike.${pattern}`,
        `country_city.ilike.${pattern}`,
        `niche.ilike.${pattern}`,
      ].join(','))
    }
    if (input.stage) query = query.eq('stage', input.stage)
    if (input.nextAction) query = query.eq('next_action', input.nextAction)
    if (input.cursor) {
      query = query.or(cursorFilter(input.cursor.createdAt, input.cursor.leadId, 'created_at', 'after_descending'))
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.fetchLimit)
    if (error) safeReadFailure()
    return (data ?? []) as unknown as readonly LeadReadRecord[]
  }

  async getLead(leadId: string, includeContactData: boolean): Promise<LeadReadRecord | null> {
    const { data, error } = await this.client
      .from('leads')
      .select(includeContactData ? LEAD_CONTACT_PROJECTION : LEAD_DETAIL_PROJECTION)
      .eq('org_id', this.organizationId)
      .eq('id', leadId)
      .maybeSingle()
    if (error) safeReadFailure()
    return data as unknown as LeadReadRecord | null
  }

  async listActionQueue(input: ActionQueueGatewayInput): Promise<readonly LeadReadRecord[]> {
    let query = this.client
      .from('leads')
      .select(LEAD_SUMMARY_PROJECTION)
      .eq('org_id', this.organizationId)
      .eq('status', 'active')
      .in('stage', [...CRM_ACTIVE_QUEUE_STAGES])
      .lte('next_action_at', input.dueBefore)
    if (input.stage) query = query.eq('stage', input.stage)
    const { data, error } = await query
      .order('next_action_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(input.fetchLimit)
    if (error) safeReadFailure()
    return (data ?? []) as unknown as readonly LeadReadRecord[]
  }

  async listDueFollowups(input: FollowupsGatewayInput): Promise<readonly LeadReadRecord[]> {
    let query = this.client
      .from('leads')
      .select(LEAD_SUMMARY_PROJECTION)
      .eq('org_id', this.organizationId)
      .eq('status', 'active')
      .in('stage', [...CRM_ACTIVE_QUEUE_STAGES])
      .lte('next_action_at', input.dueBefore)
    if (input.stage) query = query.eq('stage', input.stage)
    if (input.cursor) {
      query = query.or(cursorFilter(
        input.cursor.nextActionAt,
        input.cursor.leadId,
        'next_action_at',
        'after_ascending',
      ))
    }
    const { data, error } = await query
      .order('next_action_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(input.fetchLimit)
    if (error) safeReadFailure()
    return (data ?? []) as unknown as readonly LeadReadRecord[]
  }

  async getLeadWatermark(leadId: string): Promise<{ readonly id: string; readonly updatedAt: string } | null> {
    const { data, error } = await this.client
      .from('leads')
      .select('id,updated_at')
      .eq('org_id', this.organizationId)
      .eq('id', leadId)
      .maybeSingle()
    if (error) safeReadFailure()
    return data ? { id: data.id, updatedAt: data.updated_at } : null
  }

  async listRecentActivities(input: RecentActivitiesGatewayInput): Promise<readonly ActivityReadRecord[]> {
    let query = this.client
      .from('activities')
      .select(ACTIVITY_SAFE_PROJECTION)
      .eq('org_id', this.organizationId)
      .eq('lead_id', input.leadId)
    if (input.types && input.types.length > 0) query = query.in('type', [...input.types])
    const { data, error } = await query
      .order('at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.fetchLimit)
    if (error) safeReadFailure()
    return (data ?? []) as unknown as readonly ActivityReadRecord[]
  }

  async countPipelineStage(stage: CrmLeadStage, filters: PipelineGatewayFilters): Promise<number> {
    let query = this.client
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', this.organizationId)
      .eq('stage', stage)
    query = applyPipelineFilters(query, filters)
    const { count, error } = await query
    if (error) safeReadFailure()
    return Math.max(0, count ?? 0)
  }

  async getPipelineLatestUpdatedAt(filters: PipelineGatewayFilters): Promise<string | null> {
    let query = this.client
      .from('leads')
      .select('updated_at')
      .eq('org_id', this.organizationId)
    query = applyPipelineFilters(query, filters)
    const { data, error } = await query
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) safeReadFailure()
    return data?.updated_at ?? null
  }
}

export const CRM_SUPABASE_SAFE_PROJECTIONS = Object.freeze({
  leadSummary: LEAD_SUMMARY_PROJECTION,
  leadDetail: LEAD_DETAIL_PROJECTION,
  leadContact: LEAD_CONTACT_PROJECTION,
  activity: ACTIVITY_SAFE_PROJECTION,
})
