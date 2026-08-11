import { verifyFrozenSharedCheckout } from './crm-shared-checkout-preflight.js'

async function waitForShutdownSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
}

async function main(): Promise<void> {
  verifyFrozenSharedCheckout()
  const {
    ProductOwnedSprintCrmReadModel,
    SupabaseCrmReadGateway,
    SupabaseCrmStagedWriteDomainGateway,
    createAuthenticatedSprintCrmRuntime,
    createSprintCrmMcpRuntime,
    createSprintCrmSafeStartupStatus,
    loadSprintCrmBridgeRuntimeConfig,
    parseSprintCrmRuntimeScopes,
  } = await import('../../product-bridge/index.js')
  const config = loadSprintCrmBridgeRuntimeConfig()
  const scopes = parseSprintCrmRuntimeScopes(config.scopes)
  const authenticated = await createAuthenticatedSprintCrmRuntime(config)
  const gateway = new SupabaseCrmReadGateway(authenticated.client, {
    organizationId: authenticated.authority.organizationId,
    userId: authenticated.authority.userId,
  })
  const readModel = new ProductOwnedSprintCrmReadModel(gateway)
  const stagedWriteGateway = new SupabaseCrmStagedWriteDomainGateway(authenticated.client, {
    organizationId: authenticated.authority.organizationId,
    userId: authenticated.authority.userId,
  })
  const runtime = createSprintCrmMcpRuntime({
    readModel,
    stagedWriteGateway,
    authority: authenticated.authority,
    scopes,
    http: { port: config.mcpPort },
  })
  let started = false
  try {
    const status = await runtime.http.start()
    started = true
    const safeStatus = createSprintCrmSafeStartupStatus(
      status,
      runtime.operationClassProfile,
      scopes,
      true,
    )
    process.stdout.write(`${JSON.stringify(safeStatus)}\n`)
    await waitForShutdownSignal()
  } finally {
    if (started) await runtime.http.stop()
  }
}

void main().catch(() => {
  process.stderr.write('{"status":"failed","safeMessage":"SprintCRM Bridge pilot failed safely."}\n')
  process.exitCode = 1
})
