import { execFileSync } from 'node:child_process'

const FROZEN_SHARED_PATH = 'C:\\PROJECTS\\shared-ai-product-bridge'
const FROZEN_SHARED_HEAD = '563b6c8f0b6452ccc5f18f3aac5e058633b7cdb0'

function createGitPreflightEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith('SPRINTCRM_BRIDGE_'),
    ),
  )
}

function readGitOutput(argumentsValue: readonly string[]): string {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...argumentsValue], {
    encoding: 'utf8',
    env: createGitPreflightEnvironment(),
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  }).trim()
}

function verifyFrozenSharedCheckout(): void {
  const head = readGitOutput(['-C', FROZEN_SHARED_PATH, 'rev-parse', 'HEAD'])
  const status = readGitOutput(['-C', FROZEN_SHARED_PATH, 'status', '--porcelain'])
  if (head !== FROZEN_SHARED_HEAD || status.length > 0) {
    throw new Error('Frozen Shared Bridge preflight failed.')
  }
}

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
