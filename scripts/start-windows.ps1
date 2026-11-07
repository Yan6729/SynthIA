# Lance Manager sur Windows (PowerShell). Utilisé par start-windows.bat.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Test-Node {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { return $false }
  return ([int](node -p "process.versions.node.split('.')[0]")) -ge 22
}

if (-not (Test-Node)) {
  Write-Host 'Node 22 ou plus est introuvable.'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $a = Read-Host "L'installer avec winget (OpenJS.NodeJS.LTS) ? [o/N]"
    if ($a -match '^[oOyY]') {
      winget install -e --id OpenJS.NodeJS.LTS
      Write-Host 'Node est installé. Ferme cette fenêtre et relance start-windows.bat (le PATH doit se rafraîchir).'
      exit 0
    }
  }
  Write-Host 'Installe Node 22+ depuis https://nodejs.org puis relance.'
  exit 1
}

node scripts/setup.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Manager démarre sur http://localhost:3000 (Ctrl+C pour arrêter)'
Start-Job { Start-Sleep 2; Start-Process 'http://localhost:3000' } | Out-Null
node server/index.js
