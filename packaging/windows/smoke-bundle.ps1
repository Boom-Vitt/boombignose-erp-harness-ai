# Boot the Windows bundle and require GET http://127.0.0.1:3100/api/health.
# This uses the harness serve command, not a click of the installer.
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

$bundle = $env:BOOMBIGNOSE_SMOKE_BUNDLE
if (-not $bundle) { $bundle = Join-Path $root "dist\bundle" }
foreach ($rel in @(
  "node.exe",
  "erp\server.js",
  "postgres\bin\postgres.exe",
  "postgres\prelude-after-auth.sql",
  "auth\auth.exe",
  "auth\migrations\00_init_auth_schema.up.sql",
  "postgrest\postgrest.exe",
  "ollama\ollama.exe",
  "ollama\OLLAMA_LICENSE.txt"
)) {
  $path = Join-Path $bundle $rel
  if (-not (Test-Path -LiteralPath $path)) {
    throw "missing $path"
  }
}
foreach ($cuda in @("cuda_v12", "cuda_v13")) {
  if (Test-Path -LiteralPath (Join-Path $bundle "ollama\lib\ollama\$cuda")) {
    throw "cuda runner was packed"
  }
}
& (Join-Path $bundle "node.exe") (Join-Path $root "packaging\erp-dependencies.mjs") smoke (Join-Path $bundle "erp") win32-x64
if ($LASTEXITCODE -ne 0) { throw "bundled Go raster decode/corruption smoke failed: $LASTEXITCODE" }
foreach ($tool in @("psql", "pg_dump", "pg_restore")) {
  $client = Join-Path $bundle "postgres\bin\$tool.exe"
  if (-not (Test-Path -LiteralPath $client -PathType Leaf)) { throw "shipped client missing: $client" }
  $version = & $client --version
  if ($LASTEXITCODE -ne 0 -or $version -notmatch '\(PostgreSQL\) 16\.15(?:\s|$)') {
    throw "matching shipped PostgreSQL client failed: $tool"
  }
}

function Assert-PortFree([int]$Port) {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try {
    $listener.Start()
  } catch {
    throw "127.0.0.1:${Port} is already in use"
  } finally {
    $listener.Stop()
  }
}

function Test-PortClosed([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(200)
    if (-not $ok) { return $true }
    $client.EndConnect($iar)
    return $false
  } catch {
    return $true
  } finally {
    $client.Close()
  }
}

Assert-PortFree 3100
$pgPort = 54329
Assert-PortFree $pgPort
foreach ($extra in @(54321, 54323, 54324)) { Assert-PortFree $extra }

$data = Join-Path "C:\" ("bbn-smoke-" + [guid]::NewGuid().ToString("n"))
if ($data -match " ") { throw "data path contains a space: $data" }
$pgdata = Join-Path $data "pg"
New-Item -ItemType Directory -Force -Path $data | Out-Null

foreach ($name in @(
  "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "RESEND_API_KEY", "OPENROUTER_MODEL", "LD_LIBRARY_PATH"
)) {
  Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}
$env:BOOMBIGNOSE_BUNDLE = $bundle
$env:BOOMBIGNOSE_DATA = $pgdata
$env:BOOMBIGNOSE_PG_PORT = "$pgPort"
$env:BOOMBIGNOSE_ERP_URL = "http://127.0.0.1:3100"
$env:BOOMBIGNOSE_ALLOW_SIGNUP = "1"
Remove-Item Env:BOOMBIGNOSE_PUBLIC_ORIGIN -ErrorAction SilentlyContinue
if (-not $env:NEXT_PUBLIC_SUPABASE_URL) {
  $env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"
}
if (-not $env:NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "local-anon-not-a-secret"
}

$exe = Join-Path $data "boombignose.exe"
Push-Location (Join-Path $root "boombignose")
try {
  go build -o $exe ./cmd/boombignose
} finally {
  Pop-Location
}

$stdout = Join-Path $data "serve.log"
$stderr = Join-Path $data "serve.err"
$proc = Start-Process -FilePath $exe -ArgumentList "serve" -WorkingDirectory $data `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden

function Show-Logs {
  foreach ($log in @($stdout, $stderr)) {
    if (Test-Path -LiteralPath $log) {
      Write-Host "----- $log -----"
      Get-Content -LiteralPath $log -ErrorAction SilentlyContinue
    }
  }
}

try {
  $ok = $false
  for ($i = 0; $i -lt 150; $i++) {
    if ($proc.HasExited) {
      Show-Logs
      throw "serve exited before the health check"
    }
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:3100/api/health" -UseBasicParsing -TimeoutSec 2
      if ($resp.Content -match '"ok"\s*:\s*true') {
        $ok = $true
        break
      }
    } catch {
    }
    Start-Sleep -Seconds 2
  }
  if (-not $ok) {
    Show-Logs
    throw "health check failed"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $pgdata "PG_VERSION"))) {
    Show-Logs
    throw "PG_VERSION missing"
  }
  Write-Host "health ok"
  $serveText = ""
  foreach ($log in @($stdout, $stderr)) {
    if (Test-Path -LiteralPath $log) { $serveText += Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue }
  }
  if ($serveText -match "pull qwen2.5") { throw "serve pulled a model" }
  $anon = (Get-Content -LiteralPath (Join-Path $pgdata "anon.key") -Raw).Trim()
  $email = "smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@example.com"
  $body = @{ email = $email; password = "SmokeTest1a" } | ConvertTo-Json
  $headers = @{ apikey = $anon; Authorization = "Bearer $anon" }
  $signup = Invoke-WebRequest -Uri "http://127.0.0.1:54321/auth/v1/signup" -Method POST -Headers $headers -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 20
  if ($signup.Content -notmatch '"access_token"') {
    Show-Logs
    throw "signup failed"
  }
  Write-Host "signup ok"
  $signin = Invoke-WebRequest -Uri "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -Method POST -Headers $headers -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 20
  if ($signin.Content -notmatch '"access_token"') {
    Show-Logs
    throw "signin failed"
  }
  Write-Host "signin ok"

  $PSNativeCommandUseErrorActionPreference = $false
  & $exe stop
  $stopCode = $LASTEXITCODE
  $PSNativeCommandUseErrorActionPreference = $true
  if ($stopCode -ne 0) {
    Write-Host "boombignose stop exit $stopCode"
  }
  $closed = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-PortClosed $pgPort) {
      $closed = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $closed) {
    Show-Logs
    throw "postgres stayed up on 127.0.0.1:$pgPort"
  }
  Write-Host "postgres stopped"
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $proc.WaitForExit(15000) | Out-Null
  }
  Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue
}
