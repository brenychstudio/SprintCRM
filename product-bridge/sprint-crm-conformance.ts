import {
  OPERATION_CLASSES,
  type ActionRequest,
  type BridgeIdentity,
} from '@brenych/product-bridge-contracts'
import type { ProductAdapterConformanceFixtures } from '@brenych/product-bridge-testing'

import {
  SPRINT_CRM_PRODUCT_ID,
  SPRINT_CRM_SCHEMA_VERSION,
  SPRINT_CRM_SCOPES,
} from './sprint-crm-product-adapter.js'

export function createSprintCrmReadActionRequest(
  organizationId: string,
  overrides: Partial<ActionRequest> = {},
): ActionRequest {
  const identity: BridgeIdentity = {
    identityId: 'crm-conformance-identity',
    actor: { actorType: 'test-operator', actorId: 'crm-conformance' },
    productId: SPRINT_CRM_PRODUCT_ID,
    scopes: [SPRINT_CRM_SCOPES.CONTEXT_READ],
    subject: organizationId,
    issuedAt: '2026-08-10T12:00:00.000Z',
  }
  return {
    schemaVersion: SPRINT_CRM_SCHEMA_VERSION,
    requestId: 'crm-conformance-read',
    correlationId: 'crm-conformance-correlation',
    timestamp: '2026-08-10T12:00:00.000Z',
    productId: SPRINT_CRM_PRODUCT_ID,
    namespace: 'crm.workspace',
    operationId: 'get_context',
    operationClass: OPERATION_CLASSES.READ,
    subject: { type: 'organization', id: organizationId },
    identity,
    input: {},
    ...overrides,
  }
}

export function createSprintCrmConformanceFixtures(
  organizationId: string,
): ProductAdapterConformanceFixtures {
  return {
    validRead: () => createSprintCrmReadActionRequest(organizationId, { requestId: 'crm-valid-read' }),
    malformedInput: () => createSprintCrmReadActionRequest(organizationId, {
      requestId: 'crm-malformed-input',
      input: { organizationId },
    }),
    missingScope: () => {
      const request = createSprintCrmReadActionRequest(organizationId, { requestId: 'crm-missing-scope' })
      return { ...request, identity: { ...request.identity, scopes: [] } }
    },
    wrongProductScope: () => {
      const request = createSprintCrmReadActionRequest(organizationId, { requestId: 'crm-wrong-product' })
      return { ...request, identity: { ...request.identity, productId: 'other-product' } }
    },
    wrongSubjectScope: () => {
      const request = createSprintCrmReadActionRequest(organizationId, { requestId: 'crm-wrong-subject' })
      return { ...request, identity: { ...request.identity, subject: 'other-organization' } }
    },
    adapterException: () => createSprintCrmReadActionRequest(organizationId, {
      requestId: 'crm-adapter-exception',
    }),
    safeResult: () => createSprintCrmReadActionRequest(organizationId, { requestId: 'crm-safe-result' }),
  }
}
