import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const migrationsDirectory = path.resolve('supabase/migrations')
const expectedFoundationMigration = '20260427000001_ai_outreach_foundation.sql'
const expectedImportDriftMigration = '20260722000001_capture_import_schema_drift.sql'
const migrationName = /^\d{8,}_[a-z0-9_]+\.sql$/

const files = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith('.sql'))
  .sort()

if (!files.length) throw new Error('No SQL migrations found.')

if (files.some((file) => !migrationName.test(file))) {
  throw new Error(`Invalid migration filename: ${files.find((file) => !migrationName.test(file))}`)
}

if (!files.includes(expectedFoundationMigration)) {
  throw new Error(`Missing required baseline migration: ${expectedFoundationMigration}`)
}

if (!files.includes(expectedImportDriftMigration)) {
  throw new Error(`Missing required import drift migration: ${expectedImportDriftMigration}`)
}

for (const file of files) {
  const sql = (await readFile(path.join(migrationsDirectory, file), 'utf8')).trim()
  if (!sql) throw new Error(`Migration is empty: ${file}`)
}

console.log(`Verified ${files.length} migration files and required baseline migrations.`)
console.log('Linked-environment verification remains a release step: run `supabase migration list --linked`.')
