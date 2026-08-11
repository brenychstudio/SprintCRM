import type { ActionRequest, BridgeResult, ProductDescriptor, ProductOperationDefinition } from '@brenych/product-bridge-contracts'
import { BridgeCore, InMemoryAuditSink } from '@brenych/product-bridge-core'
import {
  deriveProductAdapterOperationClassProfile,
  ProductRegistry,
} from '@brenych/product-bridge-product-sdk'
import {
  LocalMcpHttpService,
  ProductBridgeMcpServerFactory,
  type LocalMcpHttpConfiguration,
  type LocalMcpRuntimeStatus,
  type McpCallerContext,
  type McpInvocationContext,
  type McpToolNameMapper,
  type McpTransportContextFactory,
} from '@brenych/product-bridge-transport-mcp'

import type { VerifiedSprintCrmAuthority } from './authenticated-supabase-runtime.js'
import type { SprintCrmSemanticReadModel } from './crm-read-model.js'
import type { CrmStagedWriteDomainGateway } from './crm-staged-write-domain-gateway.js'
import {
  SprintCrmStagedWriteCoordinator,
  fingerprintSprintCrmLogicalRequest,
} from './crm-staged-write-coordinator.js'
import {
  SPRINT_CRM_ADAPTER_VERSION,
  SPRINT_CRM_DEFAULT_PILOT_SCOPES,
  SPRINT_CRM_MCP_TOOL_ALIASES,
  SPRINT_CRM_PRODUCT_ID,
  SPRINT_CRM_SCOPES,
  SprintCrmProductAdapter,
} from './sprint-crm-product-adapter.js'

export const SPRINT_CRM_MCP_DEFAULT_PORT = 47_841
export const SPRINT_CRM_MCP_PATH = '/mcp'
export const SPRINT_CRM_MCP_HEALTH_PATH = '/health'

const ALL_RUNTIME_SCOPES: ReadonlySet<string> = new Set(Object.values(SPRINT_CRM_SCOPES))

export const SPRINT_CRM_MCP_TOOL_NAME_MAPPER: McpToolNameMapper = Object.freeze({
  toToolName(_product: ProductDescriptor, operation: ProductOperationDefinition): string {
    const key = `${operation.namespace}:${operation.operationId}` as keyof typeof SPRINT_CRM_MCP_TOOL_ALIASES
    const alias = SPRINT_CRM_MCP_TOOL_ALIASES[key]
    if (!alias) throw new Error('SprintCRM MCP alias is not declared.')
    return alias
  },
})

export function parseSprintCrmRuntimeScopes(configured?: string): readonly string[] {
  if (!configured) return SPRINT_CRM_DEFAULT_PILOT_SCOPES
  const scopes = [...new Set(configured.split(',').map((scope) => scope.trim()).filter(Boolean))]
  if (scopes.length === 0 || scopes.some((scope) => !ALL_RUNTIME_SCOPES.has(scope))) {
    throw new Error('SprintCRM Bridge runtime scopes are invalid.')
  }
  return Object.freeze(scopes)
}

export function createSprintCrmTrustedCallerContextFactory(
  authority: VerifiedSprintCrmAuthority,
  scopes: readonly string[],
  now: () => string = () => new Date().toISOString(),
): McpTransportContextFactory {
  if (scopes.some((scope) => !ALL_RUNTIME_SCOPES.has(scope))) {
    throw new Error('SprintCRM Bridge caller scopes are invalid.')
  }
  return {
    create(context: McpInvocationContext): McpCallerContext {
      return {
        identityId: `sprint-crm-user-${context.transportRequestId}`,
        actor: { actorType: 'authenticated-user', actorId: authority.userId },
        scopes,
        issuedAt: now(),
        metadataSafe: {
          authority: 'supabase-user-rls',
          expectedOrganizationBound: true,
          productId: SPRINT_CRM_PRODUCT_ID,
        },
      }
    },
  }
}

export interface SprintCrmMcpRuntimeOptions {
  readonly readModel: SprintCrmSemanticReadModel
  readonly stagedWriteGateway: CrmStagedWriteDomainGateway
  readonly authority: VerifiedSprintCrmAuthority
  readonly scopes?: readonly string[]
  readonly http?: Readonly<Pick<LocalMcpHttpConfiguration, 'port'>>
  readonly now?: () => string
  readonly createId?: () => string
  readonly callerContextFactory?: McpTransportContextFactory
}

function bindTrustedOrganization(
  request: ActionRequest,
  authority: VerifiedSprintCrmAuthority,
): ActionRequest {
  const usesTransportDefault = request.subject.type === 'product'
    && request.subject.id === SPRINT_CRM_PRODUCT_ID
  const usesExpectedOrganization = request.subject.type === 'organization'
    && request.subject.id === authority.organizationId
  return {
    ...request,
    subject: usesTransportDefault || usesExpectedOrganization
      ? { type: 'organization', id: authority.organizationId }
      : request.subject,
    identity: { ...request.identity, subject: authority.organizationId },
  }
}

export function createSprintCrmMcpRuntime(options: SprintCrmMcpRuntimeOptions) {
  const now = options.now ?? (() => new Date().toISOString())
  const scopes = Object.freeze([...(options.scopes ?? SPRINT_CRM_DEFAULT_PILOT_SCOPES)])
  const coordinator = new SprintCrmStagedWriteCoordinator({
    gateway: options.stagedWriteGateway,
    authority: options.authority,
    now,
  })
  const adapter = new SprintCrmProductAdapter(options.readModel, coordinator)
  const registry = new ProductRegistry()
  registry.registerProduct(adapter)
  const audit = new InMemoryAuditSink()
  const bridgeCore = new BridgeCore({
    registry,
    auditSink: audit,
    now,
    createId: options.createId,
    idempotencyStore: coordinator,
    fingerprintRequest: fingerprintSprintCrmLogicalRequest,
  })
  const core = Object.freeze({
    route(request: ActionRequest): Promise<BridgeResult> {
      const boundRequest = bindTrustedOrganization(request, options.authority)
      return coordinator.runWithRequest(boundRequest, () => bridgeCore.route(boundRequest))
    },
  })
  const serverFactory = new ProductBridgeMcpServerFactory({
    bridgeCore: core,
    productRegistry: registry,
    toolNameMapper: SPRINT_CRM_MCP_TOOL_NAME_MAPPER,
    callerContextFactory: options.callerContextFactory
      ?? createSprintCrmTrustedCallerContextFactory(options.authority, scopes, now),
    serverName: 'sprint-crm-product-bridge',
    serverVersion: SPRINT_CRM_ADAPTER_VERSION,
    resultLimits: {
      maxStructuredBytes: 262_144,
      maxTextBytes: 65_536,
      maxDiagnostics: 20,
      maxDiagnosticCharacters: 512,
    },
    createId: options.createId,
    now,
  })
  const http = new LocalMcpHttpService(serverFactory, {
    host: '127.0.0.1',
    port: options.http?.port ?? SPRINT_CRM_MCP_DEFAULT_PORT,
    mcpPath: SPRINT_CRM_MCP_PATH,
    healthPath: SPRINT_CRM_MCP_HEALTH_PATH,
    serviceName: 'sprint-crm-product-bridge',
    serviceVersion: SPRINT_CRM_ADAPTER_VERSION,
  })
  const operationClassProfile = deriveProductAdapterOperationClassProfile(
    registry.listOperations(SPRINT_CRM_PRODUCT_ID),
  )

  return Object.freeze({
    adapter,
    audit,
    bridgeCore,
    coordinator,
    core,
    registry,
    serverFactory,
    http,
    operationClassProfile,
    scopes,
  })
}

export interface SprintCrmSafeStartupStatus {
  readonly status: 'ready'
  readonly productId: typeof SPRINT_CRM_PRODUCT_ID
  readonly transport: 'streamable-http'
  readonly stateless: true
  readonly endpoint: string
  readonly healthEndpoint: string
  readonly toolCount: number
  readonly operationClassProfile: {
    readonly READ: number
    readonly STAGED_WRITE: number
    readonly PRIVILEGED_ACTION: number
  }
  readonly sourceMode: 'authenticated-rls-staging'
  readonly contactDataGranted: boolean
  readonly stagedWriteGranted: boolean
  readonly canonicalRemoteUntouched: boolean
}

/** Product-owned safe status complements (and does not fork) Shared's fixed minimal /health payload. */
export function createSprintCrmSafeStartupStatus(
  runtimeStatus: LocalMcpRuntimeStatus,
  operationClassProfile: ReturnType<typeof deriveProductAdapterOperationClassProfile>,
  scopes: readonly string[],
  canonicalRemoteUntouched: boolean,
): SprintCrmSafeStartupStatus {
  if (runtimeStatus.state !== 'ready') throw new Error('SprintCRM Bridge runtime is not ready.')
  return {
    status: 'ready',
    productId: SPRINT_CRM_PRODUCT_ID,
    transport: 'streamable-http',
    stateless: true,
    endpoint: runtimeStatus.endpoint,
    healthEndpoint: runtimeStatus.healthEndpoint,
    toolCount: runtimeStatus.toolCount,
    operationClassProfile: {
      READ: operationClassProfile.readOperationCount,
      STAGED_WRITE: operationClassProfile.stagedWriteOperationCount,
      PRIVILEGED_ACTION: operationClassProfile.privilegedActionOperationCount,
    },
    sourceMode: 'authenticated-rls-staging',
    contactDataGranted: scopes.includes(SPRINT_CRM_SCOPES.CONTACT_DATA_READ),
    stagedWriteGranted: scopes.includes(SPRINT_CRM_SCOPES.RESEARCH_STAGE)
      || scopes.includes(SPRINT_CRM_SCOPES.EMAIL_STAGE),
    canonicalRemoteUntouched,
  }
}
