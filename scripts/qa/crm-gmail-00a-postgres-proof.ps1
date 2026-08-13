param(
  [ValidateRange(1024, 65535)]
  [int]$DatabasePort = 54523,
  [switch]$GenerateTypes
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$containerName = 'sprintcrm-gmail00a-proof'
$postgresImage = 'public.ecr.aws/supabase/postgres@sha256:178f0976b54a39237096bfa310c1a352dbc82fb1b08dda45cdb8acb5d40c1426'
$expectedSupabaseCliVersion = '2.108.0'
$containerStarted = $false

function Invoke-TrackedSql {
  param(
    [Parameter(Mandatory)][AllowEmptyString()][string[]]$SqlLines,
    [Parameter(Mandatory)][string]$Label,
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
  if ($existing) { throw "Refusing to reuse or delete an existing container named $containerName." }
  if (Get-NetTCPConnection -LocalPort $DatabasePort -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $DatabasePort is already in use."
  }

  & docker run --rm -d --name $containerName -e POSTGRES_PASSWORD=postgres `
    -p "127.0.0.1:${DatabasePort}:5432" $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL.' }
  $containerStarted = $true

  $initialized = $false
  for ($attempt = 0; $attempt -lt 240; $attempt++) {
    $startupLog = (& { $ErrorActionPreference = 'SilentlyContinue'; & docker logs $containerName 2>&1 }) -join "`n"
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
  if ($serverVersion -ne '17.6') { throw "Expected PostgreSQL 17.6, received $serverVersion." }
  Write-Output "PostgreSQL server=$serverVersion port=$DatabasePort"

  # Compose the accepted pre-PBG state exactly as the existing CRM-PBG-02A
  # proof does. Historical migrations remain immutable.
  $schemaLines = Get-Content 'supabase/schema.sql'
  $domainMarker = '-- 9) OutreachOps minimal campaign domain (OUTREACH-01R)'
  $pbgMarker = '-- 17) Product Bridge transactional staging seam (CRM-PBG-02A)'
  $domainIndex = [Array]::IndexOf($schemaLines, $domainMarker)
  $pbgIndex = [Array]::IndexOf($schemaLines, $pbgMarker)
  if ($domainIndex -lt 0 -or $pbgIndex -le $domainIndex) { throw 'Accepted baseline markers are unavailable.' }

  Invoke-TrackedSql -SqlLines $schemaLines[0..($domainIndex - 1)] -Label 'Foundation schema slice' | Out-Null
  Invoke-TrackedSql -SqlLines (Get-Content 'supabase/migrations/20260222_org_ready_hardening_patch.sql') `
    -Label 'Accepted organization hardening dependency' | Out-Null
  Invoke-TrackedSql -SqlLines (Get-Content 'supabase/migrations/20260427000001_ai_outreach_foundation.sql') `
    -Label 'Accepted AI foundation dependency' | Out-Null
  Invoke-TrackedSql -SqlLines $schemaLines[$domainIndex..($pbgIndex - 1)] `
    -Label 'Accepted Outreach schema slice' | Out-Null

  $aiRuntimeMigrations = Get-ChildItem 'supabase/migrations/202608010000*.sql' | Sort-Object Name
  if ($aiRuntimeMigrations.Count -ne 10) {
    throw "Expected ten accepted 20260801 AI runtime migrations, found $($aiRuntimeMigrations.Count)."
  }
  foreach ($aiMigration in $aiRuntimeMigrations) {
    Invoke-TrackedSql -SqlLines (Get-Content $aiMigration.FullName) `
      -Label "Accepted AI runtime migration $($aiMigration.Name)" | Out-Null
  }
  Invoke-TrackedSql -SqlLines (Get-Content 'supabase/migrations/20260810000001_product_bridge_transactional_staging.sql') `
    -Label 'Accepted Product Bridge migration' | Out-Null
  Write-Output 'Accepted pre-Gmail baseline=PASS'

  Invoke-TrackedSql `
    -SqlLines (Get-Content 'supabase/migrations/20260812000001_gmail_account_communication_foundation.sql') `
    -Label 'CRM-GMAIL-00A migration' | Out-Null
  Write-Output 'CRM-GMAIL-00A migration=PASS'

  $tableCount = Invoke-ScalarSql @'
select count(*) from information_schema.tables
where (table_schema, table_name) in (
  ('public','mailbox_accounts'), ('private','gmail_oauth_requests'),
  ('private','mailbox_account_credentials'), ('public','communication_threads'),
  ('public','communication_links'), ('public','external_messages'),
  ('public','email_send_requests')
);
'@
  if ($tableCount -ne '7') { throw "Expected seven Gmail foundation tables, found $tableCount." }

  $vaultVersion = Invoke-ScalarSql "select extversion from pg_extension where extname = 'supabase_vault';"
  if ($vaultVersion -ne '0.3.1') { throw "Expected Supabase Vault 0.3.1, received $vaultVersion." }

  $functionCount = Invoke-ScalarSql @'
select count(*) from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = any(array[
    'create_gmail_oauth_request', 'claim_gmail_oauth_callback',
    'fail_gmail_oauth_request', 'complete_gmail_account_connection',
    'get_gmail_refresh_credential', 'mark_gmail_reauthorization_required',
    'complete_gmail_account_disconnect'
  ]);
'@
  if ($functionCount -ne '7') { throw "Expected seven Gmail OAuth lifecycle functions, found $functionCount." }

  $tapOutput = Invoke-TrackedSql `
    -SqlLines (Get-Content 'supabase/tests/gmail_account_communication_foundation.test.sql') `
    -Label 'CRM-GMAIL-00A pgTAP suite' -TuplesOnly
  $tapOutput | Write-Output
  $tapText = $tapOutput -join "`n"
  $passedAssertions = [regex]::Matches($tapText, '(?m)^ok [0-9]+ -').Count
  if ($tapText -notmatch '(?m)^1\.\.37$' -or $passedAssertions -ne 37 -or $tapText -match '(?m)^not ok ') {
    throw "Expected 37/37 pgTAP assertions, observed $passedAssertions passing assertions."
  }

  Write-Output 'CRM-GMAIL-00A pgTAP=PASS assertions=37/37'

  if ($GenerateTypes) {
    $supabaseCliVersion = (& npx --yes "supabase@$expectedSupabaseCliVersion" --version | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or $supabaseCliVersion -ne $expectedSupabaseCliVersion) {
      throw "Expected Supabase CLI $expectedSupabaseCliVersion for canonical type generation, received $supabaseCliVersion."
    }
    $databaseUrl = "postgresql://postgres:postgres@127.0.0.1:${DatabasePort}/postgres"
    $generatedTypes = @(& npx --yes "supabase@$expectedSupabaseCliVersion" gen types typescript --db-url $databaseUrl --schema public)
    if ($LASTEXITCODE -ne 0 -or -not $generatedTypes) {
      throw 'Supabase database type generation failed against disposable PostgreSQL.'
    }
    $typesPath = Join-Path $repositoryRoot 'src\lib\supabase\database.types.ts'
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $generatedText = (($generatedTypes -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine)
    [System.IO.File]::WriteAllText(
      $typesPath,
      $generatedText,
      $utf8NoBom
    )
    & node scripts/qa/normalize-database-types.mjs $typesPath
    if ($LASTEXITCODE -ne 0) { throw 'Generated database type normalization failed.' }
    Write-Output 'Generated database types=PASS source=disposable PostgreSQL'
  }

  Write-Output 'CRM-GMAIL-00A REAL POSTGRESQL PROOF=PASS'
}
finally {
  Pop-Location
  if ($containerStarted) {
    $resolved = & docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
    if ($resolved -eq $containerName) { & docker rm -f $containerName | Out-Null }
  }
}
