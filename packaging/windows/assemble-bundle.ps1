# Add pinned Node and portable Postgres to an existing standalone server.
# The Next.js server is built once on Linux and must already be at
# dist/bundle/erp/server.js. Prepare the target-native Go decoder and prune
# build-only image addons without replacing Next's shared dependency graph.
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

$nodeVersion = "22.21.1"
$nodeSha = "3c624e9fbe07e3217552ec52a0f84e2bdc2e6ffa7348f3fdfb9fbf8f42e23fcf"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip"

$dist = Join-Path $root "dist\bundle"
$server = Join-Path $dist "erp\server.js"
if (-not (Test-Path -LiteralPath $server)) {
  throw "standalone server.js missing at $server"
}
if (Test-Path -LiteralPath (Join-Path $dist "node.exe")) {
  Remove-Item -LiteralPath (Join-Path $dist "node.exe") -Force
}
if (Test-Path -LiteralPath (Join-Path $dist "postgres")) {
  Remove-Item -LiteralPath (Join-Path $dist "postgres") -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$tmp = Join-Path $env:TEMP ("bbn-assemble-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  function Assert-Sha256([string]$Path, [string]$Expected) {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLower()
    if ($actual -ne $Expected) {
      throw "sha256 mismatch for ${Path}: $actual"
    }
  }

  $nodeZip = Join-Path $tmp "node.zip"
  curl.exe -fsSL -o $nodeZip $nodeUrl
  Assert-Sha256 $nodeZip $nodeSha
  $nodeExtract = Join-Path $tmp "node"
  Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtract
  $nodeHome = Join-Path $nodeExtract "node-v$nodeVersion-win-x64"
  $nodeExe = Join-Path $nodeHome "node.exe"
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    Get-ChildItem -Recurse $nodeExtract | Select-Object -ExpandProperty FullName
    throw "node.exe missing in $nodeHome"
  }
  Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $dist "node.exe")
  Copy-Item -LiteralPath (Join-Path $nodeHome "LICENSE") -Destination (Join-Path $dist "NODE_LICENSE")

  $pgRoot = Join-Path $dist "postgres"
  $pgSource = Join-Path $root "dist\postgres-server"
  if (-not (Test-Path -LiteralPath (Join-Path $pgSource "SERVER_PROVENANCE.json") -PathType Leaf)) {
    throw "source-owned PostgreSQL 16.15 missing; run assemble-server.sh in native MINGW64 first"
  }
  Copy-Item -LiteralPath $pgSource -Destination $pgRoot -Recurse
  foreach ($name in @("initdb.exe", "pg_ctl.exe", "postgres.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $pgRoot "bin\$name"))) {
      throw "missing postgres\bin\$name"
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $pgRoot "share\postgresql.conf.sample"))) {
    throw "windows postgres share/ layout is missing"
  }
  Copy-Item -LiteralPath (Join-Path $root "packaging\postgres\prelude-after-auth.sql") -Destination (Join-Path $pgRoot "prelude-after-auth.sql")
  $migrations = Join-Path $pgRoot "migrations"
  New-Item -ItemType Directory -Force -Path $migrations | Out-Null
  Copy-Item -Path (Join-Path $root "supabase\migrations\*.sql") -Destination $migrations
  # Source PostgREST and these matching clients share our exact pinned static
  # libpq/zlib inputs. No foreign DLLs may enter the private server runtime.
  $postgrestBuild = Join-Path $root "dist\postgrest-build"
  $clients = Join-Path $postgrestBuild "clients"
  foreach ($name in @("psql.exe", "pg_dump.exe", "pg_restore.exe")) {
    $client = Join-Path $clients "bin\$name"
    if (-not (Test-Path -LiteralPath $client -PathType Leaf)) { throw "source-built client missing: $client" }
    Copy-Item -LiteralPath $client -Destination (Join-Path $pgRoot "bin\$name")
  }
  foreach ($name in @("CLIENT_PROVENANCE", "POSTGRESQL_CLIENT_LICENSE.txt", "ZLIB_LICENSE.txt")) {
    Copy-Item -LiteralPath (Join-Path $clients $name) -Destination (Join-Path $pgRoot $name)
  }
  Copy-Item -LiteralPath (Join-Path $root "packaging\postgres\assemble-clients.sh") -Destination (Join-Path $pgRoot "build-provenance\assemble-clients.sh")

  $authSrc = $null
  foreach ($candidate in @(
    (Join-Path $root "dist\auth-windows"),
    (Join-Path $root "dist\auth-windows\auth-windows")
  )) {
    if (Test-Path -LiteralPath (Join-Path $candidate "auth.exe")) { $authSrc = $candidate; break }
  }
  if (-not $authSrc) { throw "windows auth.exe missing; it is built from Auth commit 4eee58f296d9698a1c2c0ae14d7a0b379c7622d3" }
  $authDest = Join-Path $dist "auth"
  if (Test-Path -LiteralPath $authDest) { Remove-Item -LiteralPath $authDest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $authDest | Out-Null
  Copy-Item -LiteralPath (Join-Path $authSrc "auth.exe") -Destination (Join-Path $authDest "auth.exe")
  Copy-Item -LiteralPath (Join-Path $authSrc "migrations") -Destination (Join-Path $authDest "migrations") -Recurse
  Copy-Item -LiteralPath (Join-Path $root "packaging\auth\AUTH_LICENSE.txt") -Destination (Join-Path $authDest "AUTH_LICENSE.txt")
  Copy-Item -LiteralPath (Join-Path $authSrc "build-provenance.json") -Destination (Join-Path $authDest "build-provenance.json")
  Copy-Item -LiteralPath (Join-Path $authSrc "third-party-notices") -Destination (Join-Path $authDest "third-party-notices") -Recurse
  if (-not (Test-Path -LiteralPath (Join-Path $authDest "migrations\00_init_auth_schema.up.sql"))) {
    throw "auth migrations were not copied"
  }

  $pgrestExe = Join-Path $postgrestBuild "artifact\postgrest.exe"
  if (-not (Test-Path -LiteralPath $pgrestExe -PathType Leaf)) { throw "native source-built PostgREST 16.5 missing" }
  $pgrestDest = Join-Path $dist "postgrest"
  if (Test-Path -LiteralPath $pgrestDest) { Remove-Item -LiteralPath $pgrestDest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $pgrestDest | Out-Null
  Copy-Item -LiteralPath $pgrestExe -Destination (Join-Path $pgrestDest "postgrest.exe")
  Copy-Item -LiteralPath (Join-Path $root "packaging\postgrest\POSTGREST_LICENSE.txt") -Destination (Join-Path $pgrestDest "POSTGREST_LICENSE.txt")

  $ollamaVersion = "0.40.11"
  $ollamaSha = "bda4a493ba8a7c24d57263cd843cd68cee84f44aed4299eeed532acad7eda12a"
  $ollamaUrl = "https://github.com/ollama/ollama/releases/download/v$ollamaVersion/ollama-windows-amd64.zip"
  $ollamaLicenseSha = "5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226"
  $license = Join-Path $root "packaging\ollama\OLLAMA_LICENSE.txt"
  # Git may check the text out with CRLF. The pinned hash is the LF file.
  $licenseBytes = [System.IO.File]::ReadAllBytes($license)
  $licenseText = [System.Text.Encoding]::UTF8.GetString($licenseBytes) -replace "`r`n", "`n" -replace "`r", "`n"
  $licenseNorm = [System.Text.Encoding]::UTF8.GetBytes($licenseText)
  $licenseActual = ([System.Security.Cryptography.SHA256]::Create().ComputeHash($licenseNorm) | ForEach-Object { $_.ToString("x2") }) -join ""
  if ($licenseActual -ne $ollamaLicenseSha) { throw "sha256 mismatch for ${license}: $licenseActual" }
  $ollamaZip = Join-Path $tmp "ollama.zip"
  curl.exe -fsSL -o $ollamaZip $ollamaUrl
  Assert-Sha256 $ollamaZip $ollamaSha
  $ollamaSrc = Join-Path $tmp "ollama-src"
  New-Item -ItemType Directory -Force -Path $ollamaSrc | Out-Null
  & (Join-Path $env:SystemRoot "System32\tar.exe") -xf $ollamaZip -C $ollamaSrc
  $ollamaDest = Join-Path $dist "ollama"
  if (Test-Path -LiteralPath $ollamaDest) { Remove-Item -LiteralPath $ollamaDest -Recurse -Force }
  $stageOut = @(python packaging/ollama/stage.py $ollamaSrc $ollamaDest $license)
  $stageText = $stageOut -join "`n"
  Write-Host $stageText
  if ($stageText -notlike "*omitted=cuda_v12,cuda_v13*") { throw "windows ollama staging did not omit the CUDA runners" }
  foreach ($cuda in @("cuda_v12", "cuda_v13")) {
    if (Test-Path -LiteralPath (Join-Path $ollamaDest "lib\ollama\$cuda")) { throw "cuda runner was packed" }
  }
  $ollamaExe = Join-Path $ollamaDest "ollama.exe"
  if (-not (Test-Path -LiteralPath $ollamaExe)) { throw "ollama.exe missing after staging" }
  $version = & $ollamaExe --version 2>&1 | Out-String
  if ($version -notmatch [regex]::Escape($ollamaVersion)) { throw "ollama --version did not report $ollamaVersion" }

  @(
    "platform=windows-amd64"
    "node=v$nodeVersion"
    "node_url=$nodeUrl"
    "node_sha256=$nodeSha"
    "node_license=MIT core and bundled third-party terms (NODE_LICENSE)"
    "postgres=16.15"
    "postgres_provenance=postgres/SERVER_PROVENANCE.json"
    "openssl=3.5.9"
    "postgres_license=postgres/POSTGRESQL_LICENSE.txt and postgres/third-party-notices/index.json"
    "erp=linux-built Next.js standalone server.js"
    "auth=v2.197.0"
    "auth_commit=4eee58f296d9698a1c2c0ae14d7a0b379c7622d3"
    "auth_note=built for windows/amd64 because upstream publishes no Windows archive"
    "auth_license=auth/AUTH_LICENSE.txt and auth/third-party-notices/index.json"
    "postgrest=v16.5 (source build)"
    "postgrest_source_commit=798523c910c09dc56d92ba2c42bcb78e5f59ecb3"
    "postgrest_provenance=postgrest/third-party-notices/index.json"
    "postgrest_license=postgrest/POSTGREST_LICENSE.txt and postgrest/third-party-notices/index.json"
    "ollama=v$ollamaVersion"
    "ollama_url=$ollamaUrl"
    "ollama_sha256=$ollamaSha"
    "ollama_license=MIT (ollama/OLLAMA_LICENSE.txt)"
    "ollama_omitted=cuda_v12,cuda_v13"
    "ollama_note=CUDA runners are omitted so the installer stays under the 2 GiB GitHub asset limit. CPU and Vulkan runners stay. The model is not packed."
  ) | Set-Content -LiteralPath (Join-Path $dist "PROVENANCE") -Encoding ascii
  & (Join-Path $dist "node.exe") packaging/erp-dependencies.mjs hydrate (Join-Path $dist "erp") win32-x64
  if ($LASTEXITCODE -ne 0) { throw "target raster/runtime preparation failed: $LASTEXITCODE" }
  & (Join-Path $dist "node.exe") packaging/collect-notices.mjs runtime $dist $postgrestBuild
  if ($LASTEXITCODE -ne 0) { throw "native component source/notice collection failed: $LASTEXITCODE" }
  & (Join-Path $dist "node.exe") packaging/collect-notices.mjs bundle $dist
  if ($LASTEXITCODE -ne 0) { throw "redistribution notice stage proof failed: $LASTEXITCODE" }
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "wrote $dist"
