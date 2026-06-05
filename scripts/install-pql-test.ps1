<#
.SYNOPSIS
    Installs pql-test from test.pypi.org into the project's .venv and
    runs the one-time auth login.

.DESCRIPTION
    pql-test is published on the Test PyPI index (not the main PyPI).
    This script:
      1. Creates .venv in the repo root if it does not exist
      2. Upgrades pip
      3. Installs pql-test and all dependencies
      4. Runs pql-test check-prereqs  (verifies ADOMD.NET driver)
      5. Prompts you to run pql-test auth login

    Run once per machine.  After this, npm run setup will detect pql-test
    and unlock focus options [7] and [8].

.EXAMPLE
    .\scripts\install-pql-test.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent
$VenvDir  = Join-Path $RepoRoot '.venv'
$PqlVer   = '0.1.9'

function Write-Step([string]$msg) {
    Write-Host "`n  $msg" -ForegroundColor Cyan
}
function Write-Ok([string]$msg) {
    Write-Host "  ✓ $msg" -ForegroundColor Green
}
function Write-Warn([string]$msg) {
    Write-Host "  ⚠  $msg" -ForegroundColor Yellow
}

Write-Host "`n⚡ pql-test installer  (v$PqlVer from test.pypi.org)`n" -ForegroundColor Magenta

# ── 1. Python ──────────────────────────────────────────────────────────────────
Write-Step "Checking Python…"
try {
    $pyVer = python --version 2>&1
    Write-Ok $pyVer
} catch {
    Write-Error "Python not found on PATH.  Install Python 3.9+ and re-run."
}

# ── 2. Virtual environment ─────────────────────────────────────────────────────
Write-Step "Virtual environment…"
if (-not (Test-Path $VenvDir)) {
    Write-Host "  Creating .venv…" -ForegroundColor DarkGray
    python -m venv $VenvDir
    Write-Ok "Created $VenvDir"
} else {
    Write-Ok "Already exists: $VenvDir"
}

$pip    = Join-Path $VenvDir 'Scripts\pip.exe'
$python = Join-Path $VenvDir 'Scripts\python.exe'
$pql    = Join-Path $VenvDir 'Scripts\pql-test.exe'

if (-not (Test-Path $pip)) {
    Write-Error "pip not found in venv — venv may be corrupt.  Delete .venv and re-run."
}

# ── 3. Upgrade pip ─────────────────────────────────────────────────────────────
Write-Step "Upgrading pip…"
& $python -m pip install --quiet --upgrade pip
Write-Ok "pip up to date"

# ── 4. Install pql-test ────────────────────────────────────────────────────────
Write-Step "Installing pql-test==$PqlVer from test.pypi.org…"
Write-Host "  (dependencies come from regular pypi.org)" -ForegroundColor DarkGray

& $pip install `
    --index-url         https://test.pypi.org/simple/ `
    --extra-index-url   https://pypi.org/simple/ `
    "pql-test==$PqlVer"

if ($LASTEXITCODE -ne 0) {
    Write-Error "pip install failed (exit $LASTEXITCODE).  See output above."
}
Write-Ok "pql-test installed"

# ── 5. Verify installation ─────────────────────────────────────────────────────
Write-Step "Verifying installation…"
$verOut = & $pql --version 2>&1
Write-Ok "pql-test $verOut"

# ── 6. check-prereqs (ADOMD.NET driver) ───────────────────────────────────────
Write-Step "Checking ADOMD.NET prerequisites…"
Write-Host "  (pql-test will download the driver if missing — this may take a moment)" -ForegroundColor DarkGray
& $pql check-prereqs
if ($LASTEXITCODE -ne 0) {
    Write-Warn "check-prereqs reported an issue.  See output above."
    Write-Warn "You may need to install Microsoft.AnalysisServices.AdomdClient manually."
} else {
    Write-Ok "ADOMD.NET driver ready"
}

# ── 7. Add venv to PATH hint ───────────────────────────────────────────────────
$venvScripts = Join-Path $VenvDir 'Scripts'
$inPath = $env:PATH -split ';' | Where-Object { $_ -eq $venvScripts }
if (-not $inPath) {
    Write-Host "`n  ℹ  Add .venv to your PATH so 'pql-test' is found by npm run setup:" -ForegroundColor Yellow
    Write-Host "     `$env:PATH = `"$venvScripts;`$env:PATH`"" -ForegroundColor DarkGray
    Write-Host "     Or activate the venv first:  .\.venv\Scripts\Activate.ps1" -ForegroundColor DarkGray
}

# ── 8. Auth login ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ─────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  One-time authentication required.  Run:" -ForegroundColor White
Write-Host "    .\.venv\Scripts\pql-test.exe auth login" -ForegroundColor Cyan
Write-Host "  A browser window will open — sign in with your Power BI account." -ForegroundColor DarkGray
Write-Host "  Credentials are stored in Windows Credential Manager." -ForegroundColor DarkGray
Write-Host "  ─────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

$doLogin = Read-Host "  Run pql-test auth login now? [Y/n]"
if ($doLogin -eq '' -or $doLogin -match '^[Yy]') {
    & $pql auth login
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Authenticated.  npm run setup will now unlock [7] Schema drift and [8] Key duplication."
    } else {
        Write-Warn "Auth login exited with code $LASTEXITCODE.  Re-run: .\.venv\Scripts\pql-test.exe auth login"
    }
} else {
    Write-Host "  Skipped.  Run later:  .\.venv\Scripts\pql-test.exe auth login" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Next: npm run pql:generate  →  npm run setup  →  pick [7] or [8]" -ForegroundColor Green
Write-Host ""
