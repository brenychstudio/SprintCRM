import { execFileSync } from 'node:child_process'

const FROZEN_SHARED_PATH = 'C:\\PROJECTS\\shared-ai-product-bridge'
export const SPRINT_CRM_ACCEPTED_SHARED_HEAD = 'cf37a7937e55803ea48cd23cc028521cc8fc5881'

type GitOutputReader = (argumentsValue: readonly string[]) => string

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

export function verifyFrozenSharedCheckout(
  readOutput: GitOutputReader = readGitOutput,
): void {
  const head = readOutput(['-C', FROZEN_SHARED_PATH, 'rev-parse', 'HEAD'])
  const status = readOutput(['-C', FROZEN_SHARED_PATH, 'status', '--porcelain'])
  if (head !== SPRINT_CRM_ACCEPTED_SHARED_HEAD || status.length > 0) {
    throw new Error('Frozen Shared Bridge preflight failed.')
  }
}
