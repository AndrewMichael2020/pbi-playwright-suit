<#
.SYNOPSIS
    Installs pql-test from test.pypi.org into the project .venv and runs
    the one-time auth login.

.DESCRIPTION
    pql-test is published on Test PyPI (not the main PyPI index).
    This script:
      1. Creates .venv in the repo root if it does not exist
      2. Upgrades pip
      3. Installs pql-test and all dependencies
      4. Runs pql-test check-prereqs  (verifies ADOMD.NET driver)
      5. Prompts to run pql-test auth login

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

function Write-Step { param([string]$msg); Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg); Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg); Write-Host "  WARN  $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  pql-test installer  (v$PqlVer from test.pypi.org)" -ForegroundColor Magenta
Write-Host ""

# 1. Python
Write-Step "Checking Python..."
try {
    $pyVer = python --version 2>&1
    Write-Ok "$pyVer"
} catch {
    Write-Error "Python not found on PATH.  Install Python 3.9+ and re-run."
    exit 1
}

# 2. Virtual environment
Write-Step "Virtual environment..."

$pip    = $null
$python = $null
$pql    = $null

if ($env:VIRTUAL_ENV) {
    # Already inside an active venv -- use it as-is
    Write-Ok "Active venv detected: $env:VIRTUAL_ENV"
    $pip    = Join-Path $env:VIRTUAL_ENV 'Scripts\pip.exe'
    $python = Join-Path $env:VIRTUAL_ENV 'Scripts\python.exe'
    $pql    = Join-Path $env:VIRTUAL_ENV 'Scripts\pql-test.exe'
} elseif (Test-Path $VenvDir) {
    Write-Ok "Found .venv: $VenvDir"
    $pip    = Join-Path $VenvDir 'Scripts\pip.exe'
    $python = Join-Path $VenvDir 'Scripts\python.exe'
    $pql    = Join-Path $VenvDir 'Scripts\pql-test.exe'
} else {
    Write-Host "  Creating .venv..." -ForegroundColor DarkGray
    python -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create venv.  Activate an existing venv first and re-run."
        exit 1
    }
    Write-Ok "Created $VenvDir"
    $pip    = Join-Path $VenvDir 'Scripts\pip.exe'
    $python = Join-Path $VenvDir 'Scripts\python.exe'
    $pql    = Join-Path $VenvDir 'Scripts\pql-test.exe'
}

if (-not (Test-Path $pip)) {
    Write-Error "pip not found at $pip -- activate your venv and re-run."
    exit 1
}

# 3. Upgrade pip
Write-Step "Upgrading pip..."
& $python -m pip install --quiet --upgrade pip
Write-Ok "pip up to date"

# 4. Install pql-test
Write-Step "Installing pql-test==$PqlVer from test.pypi.org..."
Write-Host "  (dependencies fetched from regular pypi.org)" -ForegroundColor DarkGray

$installArgs = @(
    'install',
    '--index-url', 'https://test.pypi.org/simple/',
    '--extra-index-url', 'https://pypi.org/simple/',
    "pql-test==$PqlVer"
)
& $pip @installArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "pip install failed (exit $LASTEXITCODE).  See output above."
    exit 1
}
Write-Ok "pql-test installed"

# 5. Verify
Write-Step "Verifying..."
$null = & $pql --version 2>$null
Write-Ok "pql-test is on PATH and executable"

# 6. check-prereqs
Write-Step "Checking ADOMD.NET prerequisites..."
Write-Host "  (may download driver if missing)" -ForegroundColor DarkGray
& $pql check-prereqs 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "check-prereqs reported an issue -- re-run manually: pql-test check-prereqs"
} else {
    Write-Ok "ADOMD.NET driver ready"
}

# 7. PATH hint (only relevant if not already in an active venv)
if (-not $env:VIRTUAL_ENV) {
    $venvScripts = Join-Path $VenvDir 'Scripts'
    $inPath = ($env:PATH -split ';') -contains $venvScripts
    if (-not $inPath) {
        Write-Host ""
        Write-Host "  NOTE: Add .venv to your PATH so npm run setup can detect pql-test:" -ForegroundColor Yellow
        Write-Host "    `$env:PATH = `"$venvScripts;`$env:PATH`"" -ForegroundColor DarkGray
        Write-Host "  Or activate the venv first:  .\.venv\Scripts\Activate.ps1" -ForegroundColor DarkGray
    }
}

# 8. Auth login
Write-Host ""
Write-Host "  One-time authentication required." -ForegroundColor White
Write-Host "  A browser will open -- sign in with your Power BI account." -ForegroundColor DarkGray
Write-Host "  Credentials are stored in Windows Credential Manager." -ForegroundColor DarkGray
Write-Host ""

$doLogin = Read-Host "  Run pql-test auth login now? [Y/n]"
if ($doLogin -eq '' -or $doLogin -match '^[Yy]') {
    & $pql auth login
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Authenticated.  npm run setup will now unlock [7] and [8]."
    } else {
        Write-Warn "Auth login exited $LASTEXITCODE.  Re-run: .\.venv\Scripts\pql-test.exe auth login"
    }
} else {
    Write-Host "  Skipped.  Run later: .\.venv\Scripts\pql-test.exe auth login" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Next: npm run pql:generate  then  npm run setup  then pick [7] or [8]" -ForegroundColor Green
Write-Host ""
