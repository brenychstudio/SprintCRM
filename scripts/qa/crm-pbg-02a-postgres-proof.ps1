param(
  [ValidateRange(1024, 65535)]
  [int]$DatabasePort = 54522
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$containerName = 'sprintcrm-pbg02a-proof'
$postgresImage = 'public.ecr.aws/supabase/postgres@sha256:178f0976b54a39237096bfa310c1a352dbc82fb1b08dda45cdb8acb5d40c1426'
$containerStarted = $false

function Invoke-TrackedSql {
  param(
    [Parameter(Mandatory)]
    [AllowEmptyString()]
    [string[]]$SqlLines,
    [Parameter(Mandatory)]
    [string]$Label,
    [switch]$TuplesOnly
  )

  $arguments = @('exec', '-i', $containerName, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose')
  if ($TuplesOnly) { $arguments += @('-A', '-t', '-q') }
  $arguments += @('-U', 'postgres', '-d', 'postgres')
  $output = $SqlLines | & docker @arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label failed against disposable PostgreSQL." }
  return @($output)
}

function Invoke-ScalarSql {
  param([Parameter(Mandatory)][string]$Sql)
  $output = & docker exec $containerName psql -X -A -t -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c $Sql
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL scalar check failed.' }
  return ($output | Select-Object -Last 1).Trim()
}

Push-Location $repositoryRoot
try {
  & docker version --format 'Docker client={{.Client.Version}} server={{.Server.Version}}' | Write-Output
  if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is unavailable.' }

  $existing = & docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker containers.' }
  if ($existing) {
    throw "Refusing to reuse or delete an existing container named $containerName."
  }

  $portOwner = Get-NetTCPConnection -LocalPort $DatabasePort -State Listen -ErrorAction SilentlyContinue
  if ($portOwner) { throw "Port $DatabasePort is already in use." }

  & docker run --rm -d --name $containerName -e POSTGRES_PASSWORD=postgres `
    -p "127.0.0.1:${DatabasePort}:5432" $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL.' }
  $containerStarted = $true

  # The image briefly accepts connections during its temporary initialization
  # server, then restarts PostgreSQL. Wait for the official entrypoint's final
  # initialization marker so a transient pg_isready cannot race schema apply.
  $initialized = $false
  for ($attempt = 0; $attempt -lt 240; $attempt++) {
    $startupLog = (& {
      $ErrorActionPreference = 'SilentlyContinue'
      & docker logs $containerName 2>&1
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
    & docker exec $containerName pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready.' }

  $serverVersion = Invoke-ScalarSql "select current_setting('server_version');"
  Write-Output "PostgreSQL server=$serverVersion port=$DatabasePort"
  if ($serverVersion -ne '17.6') { throw "Expected PostgreSQL 17.6, received $serverVersion." }

  # The historical chain is intentionally not rewritten. Compose the accepted
  # pre-02A state from the canonical snapshot slices plus its missing accepted
  # AI foundation dependency, stripping any historical BOM through Get-Content.
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

  $tapOutput = Invoke-TrackedSql `
    -SqlLines (Get-Content 'supabase/tests/product_bridge_transactional_staging.test.sql') `
    -Label 'CRM-PBG-02A pgTAP suite' -TuplesOnly
  $tapOutput | Write-Output
  $tapText = $tapOutput -join "`n"
  $passedAssertions = [regex]::Matches($tapText, '(?m)^ok [0-9]+ -').Count
  if ($tapText -notmatch '(?m)^1\.\.37$' -or $passedAssertions -ne 37 -or $tapText -match '(?m)^not ok ') {
    throw "Expected 37/37 pgTAP assertions, observed $passedAssertions passing assertions."
  }
  Write-Output 'CRM-PBG-02A pgTAP=PASS assertions=37/37'

  # Prove the unique-address/row-lock behavior with two overlapping real
  # authenticated PostgreSQL sessions. The winning transaction holds its claim
  # open briefly; the equivalent session must resolve to IN_PROGRESS.
  $concurrencySetup = @'
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, confirmed_at,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '91000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'concurrency@example.test', '', now(),
  now(), now(), '', '', '', ''
);
insert into public.organizations (id, name, created_by)
values ('92000000-0000-4000-8000-000000000001', 'Concurrency proof', '91000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'owner');
'@
  Invoke-TrackedSql -SqlLines ($concurrencySetup -split "`n") -Label 'Concurrency fixture' | Out-Null

  $claimSqlTemplate = @'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000001';
set local request.jwt.claim.role = 'authenticated';
select public.claim_product_bridge_write(
  '92000000-0000-4000-8000-000000000001',
  'crm.research.stageSnapshot',
  'concurrent-equivalent-key',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '__CLAIM_TOKEN__',
  60,
  jsonb_build_object(
    'productId', 'sprint-crm',
    'operationId', 'crm.research.stageSnapshot',
    'requestId', 'concurrent-request',
    'correlationId', 'concurrent-correlation',
    'actorSubject', 'user:91000000-0000-4000-8000-000000000001',
    'organizationId', '92000000-0000-4000-8000-000000000001',
    'campaignMemberId', '93000000-0000-4000-8000-000000000001',
    'sourceSnapshotId', 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'stagedEntityId', '94000000-0000-4000-8000-000000000001',
    'timestamp', '2026-08-11T12:00:00.000Z'
  )
) ->> 'outcome';
select pg_sleep(2);
commit;
'@
  $claimSqlOne = $claimSqlTemplate.Replace('__CLAIM_TOKEN__', '95000000-0000-4000-8000-000000000001')
  $claimSqlTwo = $claimSqlTemplate.Replace('__CLAIM_TOKEN__', '95000000-0000-4000-8000-000000000002')
  $claimJobs = @(
    Start-Job -ScriptBlock {
      param($Name, $Sql)
      & docker exec $Name psql -X -A -t -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c $Sql
      if ($LASTEXITCODE -ne 0) { throw 'Concurrent claim session failed.' }
    } -ArgumentList $containerName, $claimSqlOne
    Start-Job -ScriptBlock {
      param($Name, $Sql)
      & docker exec $Name psql -X -A -t -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c $Sql
      if ($LASTEXITCODE -ne 0) { throw 'Concurrent claim session failed.' }
    } -ArgumentList $containerName, $claimSqlTwo
  )
  $claimJobs | Wait-Job | Out-Null
  $claimOutput = @($claimJobs | Receive-Job)
  $claimJobs | Remove-Job
  $claimOutcomes = @($claimOutput | Where-Object { $_ -in @('CLAIMED', 'IN_PROGRESS') } | Sort-Object)
  if (($claimOutcomes -join ',') -ne 'CLAIMED,IN_PROGRESS') {
    throw "Concurrent claim outcomes were unexpected: $($claimOutput -join ', ')"
  }
  $ledgerRows = Invoke-ScalarSql "select count(*) from public.product_bridge_write_requests where organization_id = '92000000-0000-4000-8000-000000000001' and idempotency_key = 'concurrent-equivalent-key';"
  if ($ledgerRows -ne '1') { throw "Concurrent claims produced $ledgerRows ledger rows." }
  Write-Output 'Concurrent equivalent claims=PASS outcomes=CLAIMED,IN_PROGRESS ledgerRows=1'

  Write-Output 'CRM-PBG-02A REAL POSTGRESQL PROOF=PASS'
}
finally {
  Pop-Location
  if ($containerStarted) {
    $resolved = & docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
    if ($resolved -eq $containerName) {
      & docker rm -f $containerName | Out-Null
    }
  }
}
