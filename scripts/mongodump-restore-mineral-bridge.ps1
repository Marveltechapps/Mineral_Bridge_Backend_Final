# Method 1: mongodump -> mongorestore for database "mineral_bridge" (matches config/db.js).
#
# Prerequisite: MongoDB Database Tools (mongodump, mongorestore) on PATH.
#   https://www.mongodb.com/try/download/database-tools
#
# Atlas: allow your current IP on BOTH clusters (Network Access).
#
# Usage (PowerShell from repo root or backend):
#   $env:SOURCE_MONGO_URI = "mongodb+srv://OLD_USER:OLD_PASS@oldcluster.mongodb.net/?retryWrites=true&w=majority"
#   $env:TARGET_MONGO_URI = "mongodb+srv://NEW_USER:NEW_PASS@newcluster.mongodb.net/?retryWrites=true&w=majority"
#   cd backend\scripts
#   .\mongodump-restore-mineral-bridge.ps1
#
# Or set only SOURCE_MONGO_URI; TARGET defaults to MONGO_URI from backend\.env

$ErrorActionPreference = "Stop"
$DbName = "mineral_bridge"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendRoot = Split-Path -Parent $ScriptDir
$DumpRoot = Join-Path $BackendRoot "mongo-dump-mineral-bridge"
$DumpDbPath = Join-Path $DumpRoot $DbName

$source = $env:SOURCE_MONGO_URI
if (-not $source) {
  Write-Error "Set SOURCE_MONGO_URI to your OLD cluster connection string."
}

$target = $env:TARGET_MONGO_URI
if (-not $target) {
  $envPath = Join-Path $BackendRoot ".env"
  if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
      if ($line -match '^\s*MONGO_URI=(.+)$') {
        $target = $Matches[1].Trim().Trim('"').Trim("'")
        break
      }
    }
  }
}
if (-not $target) {
  Write-Error "Set TARGET_MONGO_URI or define MONGO_URI in backend\.env (new cluster)."
}

$dumpExe = Get-Command mongodump -ErrorAction SilentlyContinue
$restoreExe = Get-Command mongorestore -ErrorAction SilentlyContinue
if (-not $dumpExe -or -not $restoreExe) {
  Write-Error "mongodump/mongorestore not found. Install MongoDB Database Tools and add them to PATH."
}

if (Test-Path $DumpRoot) {
  Remove-Item -Recurse -Force $DumpRoot
}
New-Item -ItemType Directory -Path $DumpRoot -Force | Out-Null

Write-Host "Dumping $DbName from SOURCE …"
& mongodump --uri="$source" --db=$DbName --out=$DumpRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path $DumpDbPath)) {
  Write-Warning "No folder $DumpDbPath — source may have no $DbName DB. Check Atlas / database name."
  exit 1
}

Write-Host "Restoring $DbName to TARGET …"
& mongorestore --uri="$target" --db=$DbName --drop $DumpDbPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Optional: remove $DumpRoot (contains a local copy of your data)."
Write-Host "Set MONGO_URI in .env to the NEW cluster and restart the API."
