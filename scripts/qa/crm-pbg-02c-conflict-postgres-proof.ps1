param(
  [ValidateRange(1024, 65535)]
  [int]$DatabasePort = 54522,
  [ValidateRange(1024, 65535)]
  [int]$PostgrestPort = 54521
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$databaseContainer = 'sprintcrm-pbg02c-conflict-db-proof'
$postgrestContainer = 'sprintcrm-pbg02c-conflict-api-proof'
$postgresImage = 'public.ecr.aws/supabase/postgres@sha256:178f0976b54a39237096bfa310c1a352dbc82fb1b08dda45cdb8acb5d40c1426'
$postgrestImage = 'public.ecr.aws/supabase/postgrest@sha256:e9490aa503a5fb07d8e8c80da46e5c0c193894e583b59ed9077e74c4101ffae2'
$databaseStarted = $false
$postgrestStarted = $false
$authenticatorPassword = [Guid]::NewGuid().ToString('N')
$jwtSecret = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')

function Invoke-TrackedSql {
  param(
    [Parameter(Mandatory)]
    [AllowEmptyString()]
    [string[]]$SqlLines,
    [Parameter(Mandatory)]
    [string]$Label
  )

  $arguments = @(
    'exec', '-i', $databaseContainer,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-U', 'postgres', '-d', 'postgres'
  )
  $output = $SqlLines | & docker @arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label failed against disposable PostgreSQL." }
  return @($output)
}

function Invoke-ScalarSql {
  param([Parameter(Mandatory)][string]$Sql)
  $output = & docker exec $databaseContainer psql -X -A -t -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c $Sql
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL scalar check failed.' }
  return ($output | Select-Object -Last 1).Trim()
}

function Assert-PortAvailable {
  param([Parameter(Mandatory)][int]$Port)
  $owner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($owner) { throw "Port $Port is already in use." }
}

function Assert-ContainerAbsent {
  param([Parameter(Mandatory)][string]$Name)
  $existing = & docker ps -a --filter "name=^/$Name$" --format '{{.Names}}'
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker containers.' }
  if ($existing) { throw "Refusing to reuse or delete an existing container named $Name." }
}

Push-Location $repositoryRoot
$previousProofUrl = $env:SPRINTCRM_PBG02C_PROOF_POSTGREST_URL
$previousProofSecret = $env:SPRINTCRM_PBG02C_PROOF_JWT_SECRET
try {
  & docker version --format 'Docker client={{.Client.Version}} server={{.Server.Version}}' | Write-Output
  if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is unavailable.' }
  if ($DatabasePort -eq $PostgrestPort) { throw 'Database and PostgREST ports must differ.' }
  Assert-ContainerAbsent -Name $databaseContainer
  Assert-ContainerAbsent -Name $postgrestContainer
  Assert-PortAvailable -Port $DatabasePort
  Assert-PortAvailable -Port $PostgrestPort

  & docker run --rm -d --name $databaseContainer -e POSTGRES_PASSWORD=postgres `
    -p "127.0.0.1:${DatabasePort}:5432" $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL.' }
  $databaseStarted = $true

  $initialized = $false
  for ($attempt = 0; $attempt -lt 240; $attempt++) {
    $startupLog = (& {
      $ErrorActionPreference = 'SilentlyContinue'
      & docker logs $databaseContainer 2>&1
    }) -join "`n"
    if ($startupLog -match 'PostgreSQL init process complete; ready for start up\.') {
      $initialized = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $initialized) { throw 'Disposable PostgreSQL initialization did not complete.' }

  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    & docker exec $databaseContainer pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  $serverVersion = Invoke-ScalarSql "select current_setting('server_version');"
  Write-Output "PostgreSQL server=$serverVersion port=$DatabasePort"
  if ($serverVersion -ne '17.6') { throw "Expected PostgreSQL 17.6, received $serverVersion." }

  # Reuse the accepted test-only pre-02A composition without rewriting the
  # known non-bootstrap historical production migration chain.
  $schemaLines = Get-Content 'supabase/schema.sql'
  $domainMarker = '-- 9) OutreachOps minimal campaign domain (OUTREACH-01R)'
  $pbgMarker = '-- 17) Product Bridge transactional staging seam (CRM-PBG-02A)'
  $domainIndex = [Array]::IndexOf($schemaLines, $domainMarker)
  $pbgIndex = [Array]::IndexOf($schemaLines, $pbgMarker)
  if ($domainIndex -lt 0 -or $pbgIndex -le $domainIndex) {
    throw 'Accepted baseline markers are unavailable.'
  }

  Invoke-TrackedSql -SqlLines $schemaLines[0..($domainIndex - 1)] -Label 'Foundation schema slice' | Out-Null
  Invoke-TrackedSql `
    -SqlLines (Get-Content 'supabase/migrations/20260427000001_ai_outreach_foundation.sql') `
    -Label 'Accepted AI foundation dependency' | Out-Null
  Invoke-TrackedSql -SqlLines $schemaLines[$domainIndex..($pbgIndex - 1)] `
    -Label 'Accepted Outreach pre-02A schema slice' | Out-Null
  Write-Output 'Accepted pre-02A baseline=PASS'

  Invoke-TrackedSql `
    -SqlLines (Get-Content 'supabase/migrations/20260810000001_product_bridge_transactional_staging.sql') `
    -Label 'CRM-PBG-02A migration' | Out-Null
  $functionCount = Invoke-ScalarSql @'
select count(*)
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = any(array[
    'product_bridge_json_object_has_only_keys',
    'product_bridge_json_has_forbidden_key',
    'product_bridge_valid_provenance',
    'product_bridge_valid_safe_diagnostics',
    'product_bridge_valid_receipt',
    'product_bridge_valid_research_evidence',
    'product_bridge_valid_warnings',
    'product_bridge_require_actor',
    'product_bridge_staging_context_version',
    'get_product_bridge_staging_context',
    'claim_product_bridge_write',
    'release_product_bridge_write',
    'stage_product_bridge_research_snapshot',
    'stage_product_bridge_email_draft'
  ]);
'@
  if ($functionCount -ne '14') { throw "Expected 14 PBG-02A functions, found $functionCount." }
  Write-Output 'CRM-PBG-02A migration=PASS functions=14'

  Invoke-TrackedSql `
    -SqlLines (Get-Content 'supabase/tests/product_bridge_idempotency_conflict.fixture.sql') `
    -Label 'CRM-PBG-02C conflict fixture' | Out-Null
  Write-Output 'CRM-PBG-02C conflict fixture=PASS'

  Invoke-TrackedSql -SqlLines @(
    "create role pbg02c_authenticator with login noinherit password '$authenticatorPassword';",
    'grant anon to pbg02c_authenticator;',
    'grant authenticated to pbg02c_authenticator;'
  ) -Label 'Disposable PostgREST authenticator' | Out-Null

  $databaseUri = "postgres://pbg02c_authenticator:${authenticatorPassword}@host.docker.internal:${DatabasePort}/postgres"
  & docker run --rm -d --name $postgrestContainer `
    -e "PGRST_DB_URI=$databaseUri" `
    -e 'PGRST_DB_SCHEMAS=public' `
    -e 'PGRST_DB_EXTRA_SEARCH_PATH=public,extensions' `
    -e 'PGRST_DB_ANON_ROLE=anon' `
    -e 'PGRST_DB_PRE_REQUEST=public.pbg02c_proof_set_legacy_claims' `
    -e "PGRST_JWT_SECRET=$jwtSecret" `
    -e 'PGRST_DB_CONFIG=false' `
    -e 'PGRST_LOG_LEVEL=warn' `
    -e 'PGRST_SERVER_PORT=3000' `
    -p "127.0.0.1:${PostgrestPort}:3000" `
    $postgrestImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgREST.' }
  $postgrestStarted = $true

  $postgrestReady = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:${PostgrestPort}/" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $postgrestReady = $true; break }
    } catch {
      # Expected while the disposable service establishes its first DB connection.
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $postgrestReady) { throw 'Disposable PostgREST did not become ready.' }
  Write-Output "PostgREST server=14.1 port=$PostgrestPort"

  $env:SPRINTCRM_PBG02C_PROOF_POSTGREST_URL = "http://127.0.0.1:${PostgrestPort}"
  $env:SPRINTCRM_PBG02C_PROOF_JWT_SECRET = $jwtSecret
  $tsx = Join-Path $repositoryRoot 'node_modules\.bin\tsx.cmd'
  if (-not (Test-Path -LiteralPath $tsx)) { throw 'Local tsx runner is unavailable.' }
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $proofOutput = & $tsx 'scripts/qa/crm-pbg-02c-conflict-postgres-proof.ts' 2>&1
    $proofExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  $proofOutput | Write-Output

  # Administrative reread is test-only. It independently proves the primary
  # stage/replay/conflict cardinality, the isolated meaningful-receipt mismatch,
  # and the expired-token control without relying on public DTOs alone.
  $ledgerRows = Invoke-ScalarSql @'
select count(*)
from public.product_bridge_write_requests
where organization_id = 'a2000000-0000-4000-8000-000000000001'
  and operation_id = 'crm.email.stageDraft'
  and idempotency_key = 'crm-pbg-02c-postgres-conflict-proof';
'@
  $outboundRows = Invoke-ScalarSql @'
select count(*)
from public.outbound_messages
where campaign_member_id = 'a5000000-0000-4000-8000-000000000001';
'@
  $correlatedRows = Invoke-ScalarSql @'
select count(*)
from public.product_bridge_write_requests as request
join public.outbound_messages as message
  on message.id = request.staged_entity_id
where request.organization_id = 'a2000000-0000-4000-8000-000000000001'
  and request.operation_id = 'crm.email.stageDraft'
  and request.idempotency_key = 'crm-pbg-02c-postgres-conflict-proof'
  and request.status = 'completed'
  and request.receipt ->> 'stagedEntityId' = message.id::text
  and request.receipt #>> '{result,entityId}' = message.id::text
  and message.version = 1
  and message.status = 'draft'
  and message.approved_by is null
  and message.approved_at is null
  and message.sent_at is null
  and message.ai_generation_id is null;
'@
  $mismatchLedgerRows = Invoke-ScalarSql @'
select count(*)
from public.product_bridge_write_requests
where organization_id = 'a2000000-0000-4000-8000-000000000001'
  and operation_id = 'crm.email.stageDraft'
  and idempotency_key = 'crm-pbg-02c-postgres-receipt-mismatch-proof'
  and status = 'completed'
  and receipt ->> 'receiptId' like '%-meaningfully-different';
'@
  $mismatchOutboundRows = Invoke-ScalarSql @'
select count(*)
from public.outbound_messages
where campaign_member_id = 'b5000000-0000-4000-8000-000000000001'
  and version = 1
  and status = 'draft'
  and approved_by is null
  and approved_at is null
  and sent_at is null
  and ai_generation_id is null;
'@
  $invalidAuthLedgerRows = Invoke-ScalarSql @'
select count(*)
from public.product_bridge_write_requests
where organization_id = 'a2000000-0000-4000-8000-000000000001'
  and operation_id = 'crm.email.stageDraft'
  and idempotency_key = 'crm-pbg-02c-postgres-conflict-proof-invalid-auth';
'@
  if ($ledgerRows -ne '1' -or $outboundRows -ne '1' -or $correlatedRows -ne '1' -or $mismatchLedgerRows -ne '1' -or $mismatchOutboundRows -ne '1' -or $invalidAuthLedgerRows -ne '0') {
    throw "Authoritative proof failed: primaryLedger=$ledgerRows primaryOutbound=$outboundRows primaryCorrelated=$correlatedRows mismatchLedger=$mismatchLedgerRows mismatchOutbound=$mismatchOutboundRows invalidAuthLedger=$invalidAuthLedgerRows."
  }
  Write-Output 'Authoritative primary reread=PASS ledgerRows=1 outboundRows=1 version=1 approval=none send=none'
  Write-Output 'Authoritative mismatch control=PASS changedPersistedReceipt=1 committedEffect=1 failClosed=true'
  Write-Output 'Authoritative expired-JWT control=PASS ledgerRows=0 effectRows=0'

  if ($proofExitCode -ne 0) {
    throw 'CRM-PBG-02C production-equivalent durable receipt proof failed on the current implementation.'
  }
  Write-Output 'CRM-PBG-02C PRODUCTION-EQUIVALENT DURABLE RECEIPT PROOF=PASS'
}
finally {
  if ($null -eq $previousProofUrl) {
    Remove-Item Env:SPRINTCRM_PBG02C_PROOF_POSTGREST_URL -ErrorAction SilentlyContinue
  } else {
    $env:SPRINTCRM_PBG02C_PROOF_POSTGREST_URL = $previousProofUrl
  }
  if ($null -eq $previousProofSecret) {
    Remove-Item Env:SPRINTCRM_PBG02C_PROOF_JWT_SECRET -ErrorAction SilentlyContinue
  } else {
    $env:SPRINTCRM_PBG02C_PROOF_JWT_SECRET = $previousProofSecret
  }
  Pop-Location
  if ($postgrestStarted) {
    $resolved = & docker ps -a --filter "name=^/$postgrestContainer$" --format '{{.Names}}'
    if ($resolved -eq $postgrestContainer) { & docker rm -f $postgrestContainer | Out-Null }
  }
  if ($databaseStarted) {
    $resolved = & docker ps -a --filter "name=^/$databaseContainer$" --format '{{.Names}}'
    if ($resolved -eq $databaseContainer) { & docker rm -f $databaseContainer | Out-Null }
  }
}
