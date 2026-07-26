<#
.SYNOPSIS
  Restarts all three local dev servers for this repo: frontend (3000),
  backend (4000), analysis-service (8000).

.DESCRIPTION
  Stops whatever is currently listening on ports 3000/4000/8000 (by port,
  not by process name — never touches unrelated Node/Python processes
  elsewhere on the machine), then starts all three fresh in the background.
  Output from each goes to scripts/logs/*.log (gitignored via the repo's
  root *.log rule).

.EXAMPLE
  .\scripts\dev-restart.ps1
#>

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$services = @(
    @{ Name = "frontend"; Port = 3000 },
    @{ Name = "backend"; Port = 4000 },
    @{ Name = "analysis-service"; Port = 8000 }
)

Write-Host "Stopping any process on ports 3000/4000/8000..."
foreach ($svc in $services) {
    $conns = Get-NetTCPConnection -LocalPort $svc.Port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        try {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop
            Write-Host "  stopped PID $($conn.OwningProcess) on port $($svc.Port) ($($svc.Name))"
        } catch {
            Write-Host "  could not stop PID $($conn.OwningProcess) on port $($svc.Port): $_"
        }
    }
}

Start-Sleep -Seconds 1

# Poetry is installed via `pip install --user poetry` on this machine, not
# always on PATH — fall back to its known location if `poetry` isn't found.
$poetryCmd = Get-Command poetry -ErrorAction SilentlyContinue
if ($poetryCmd) {
    $poetry = $poetryCmd.Source
} else {
    $fallback = Join-Path $env:APPDATA "Python\Python314\Scripts\poetry.exe"
    if (Test-Path $fallback) { $poetry = $fallback } else { $poetry = "poetry" }
}

Write-Host "`nStarting analysis-service (port 8000)..."
Start-Process -FilePath $poetry -ArgumentList "run", "uvicorn", "app.main:app", "--port", "8000" `
    -WorkingDirectory (Join-Path $repoRoot "analysis-service") `
    -RedirectStandardOutput (Join-Path $logDir "analysis-service.log") `
    -RedirectStandardError (Join-Path $logDir "analysis-service.err.log") `
    -WindowStyle Hidden

Write-Host "Starting backend (port 4000)..."
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" `
    -WorkingDirectory (Join-Path $repoRoot "backend") `
    -RedirectStandardOutput (Join-Path $logDir "backend.log") `
    -RedirectStandardError (Join-Path $logDir "backend.err.log") `
    -WindowStyle Hidden

Write-Host "Starting frontend (port 3000)..."
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" `
    -WorkingDirectory (Join-Path $repoRoot "frontend") `
    -RedirectStandardOutput (Join-Path $logDir "frontend.log") `
    -RedirectStandardError (Join-Path $logDir "frontend.err.log") `
    -WindowStyle Hidden

Write-Host "`nAll three starting up. Logs in $logDir"
Write-Host "  Frontend:          http://localhost:3000"
Write-Host "  Backend:           http://localhost:4000"
Write-Host "  Analysis-service:  http://localhost:8000/docs"
Write-Host "`nGive them a few seconds to boot, then check the logs above if something didn't come up."
