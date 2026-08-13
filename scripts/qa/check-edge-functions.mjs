import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const expectedDenoVersion = '2.1.12'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const functionsRoot = resolve(repositoryRoot, 'supabase', 'functions')
const lockPath = resolve(functionsRoot, 'deno.lock')

const denoVersion = spawnSync('deno', ['--version'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  shell: false,
})

if (denoVersion.error) {
  console.error(`Unable to run Deno ${expectedDenoVersion}: ${denoVersion.error.message}`)
  process.exit(1)
}

if (denoVersion.status !== 0) {
  process.stderr.write(denoVersion.stderr)
  process.exit(denoVersion.status ?? 1)
}

const actualDenoVersion = denoVersion.stdout.match(/^deno\s+(\S+)/m)?.[1]
if (actualDenoVersion !== expectedDenoVersion) {
  console.error(`Deno version mismatch: expected ${expectedDenoVersion}, received ${actualDenoVersion ?? 'unknown'}`)
  process.exit(1)
}

if (!existsSync(lockPath)) {
  console.error(`Missing Edge dependency lockfile: ${relative(repositoryRoot, lockPath)}`)
  process.exit(1)
}

const entrypoints = readdirSync(functionsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => resolve(functionsRoot, entry.name, 'index.ts'))
  .filter((entrypoint) => existsSync(entrypoint))
  .sort((left, right) => left.localeCompare(right, 'en'))

if (entrypoints.length === 0) {
  console.error('No Supabase Edge Function entrypoints were found.')
  process.exit(1)
}

console.log(`Checking ${entrypoints.length} Supabase Edge Function entr${entrypoints.length === 1 ? 'y' : 'ies'} with Deno ${expectedDenoVersion}:`)
for (const entrypoint of entrypoints) {
  console.log(`- ${relative(repositoryRoot, entrypoint).replaceAll('\\', '/')}`)
}

const check = spawnSync('deno', [
  'check',
  '--no-config',
  '--node-modules-dir=none',
  `--lock=${lockPath}`,
  '--frozen=true',
  ...entrypoints.map((entrypoint) => relative(functionsRoot, entrypoint)),
], {
  cwd: functionsRoot,
  stdio: 'inherit',
  shell: false,
})

if (check.error) {
  console.error(`Unable to check Edge Functions: ${check.error.message}`)
  process.exit(1)
}

process.exit(check.status ?? 1)
