# pbi-playwright-suit

Lightweight Playwright-based Power BI quality suite for the **UPCC Dashboard** report.

Two test lanes:

1. **Metadata lane** — refresh health, schema drift, SQL extraction from M, duplicate heuristics. Runs entirely offline using committed mock fixtures.
2. **Visual lane** — enterprise Power BI visual smoke test driven by a live discovery CLI.

## Quick start (Windows — Google Chrome already installed)

```powershell
git pull              # always pull first to get the latest fixes
npm install
npm run discover:enterprise-upcc   # sign in via browser when prompted
npm run test:visual
```

> **Do NOT run `npm run install:browsers` on Windows.**
> The visual lane uses your existing Chrome installation. Running `install:browsers`
> will print a harmless DLL warning and is not needed.

## Quick start (metadata only — no browser, no credentials)

```powershell
git pull
npm install
npm test              # runs metadata lane + skips visual (no config present)
```

Or metadata only:

```powershell
npm run test:metadata
```

## Prerequisites

- Node 18+ (Node 20+ recommended)
- npm
- **Windows visual lane**: Google Chrome (system-installed). No browser download needed.
- **Linux / CI visual lane**: run `npm run install:browsers` once to download bundled Chromium.

## Install

```powershell
npm install
```

No Python virtual environment is required.
No `.env.example` file is required.
No browser download is required on Windows.

## Do I need `npm run install:browsers`?

| Environment | Need it? |
|---|---|
| Windows + Chrome installed | **No — skip it** |
| Windows + Edge installed | No — set `$env:PBI_BROWSER_CHANNEL = "msedge"` and skip it |
| Linux / CI (no system browser) | Yes — run it once |

If you ran it and saw this warning, **ignore it and move on**:

```
Playwright Host validation warning: Host system is missing dependencies!
    api-ms-win-core-apiquery-l2-1-0.dll
```

That warning is produced when Playwright validates its own bundled Chromium on Windows.
It does not affect your system Chrome.

## Enterprise discovery CLI

```powershell
npm run discover:enterprise-upcc
```

What it does:

- authenticates via interactive MSAL device-flow (token cached for subsequent runs)
- finds workspace `FHA-ADAR-BI-UAT`, report and dataset `UPCC Dashboard`
- selects the first report page (or `UPCC_PAGE_NAME` if set)
- writes `playwright/config/upcc-enterprise.generated.json`

**First run:** the terminal will print a URL and a code:

```
To sign in, use a web browser to open the page https://login.microsoft.com/device
and enter the code XXXXXXXX to authenticate.
```

Open that URL in your browser, enter the code, sign in with your organisational account,
then **re-run** `npm run discover:enterprise-upcc`. Subsequent runs reuse the cached token.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `CLIENT_ID` | built-in public client | AAD app registration |
| `TENANT_ID` | — | restrict to a specific tenant |
| `UPCC_WORKSPACE_NAME` | `FHA-ADAR-BI-UAT` | workspace display name |
| `UPCC_REPORT_NAME` | `UPCC Dashboard` | report display name |
| `UPCC_DATASET_NAME` | `UPCC Dashboard` | dataset display name |
| `UPCC_PAGE_NAME` | first page | specific page display name |
| `PBI_ENVIRONMENT` | `Public` | Azure cloud (`Public`, `USGov`, …) |
| `PBI_TOKEN_CACHE_FILE` | auto | path to MSAL token cache file |
| `PBI_BROWSER_CHANNEL` | `chrome` | `chrome` or `msedge` |

## Repository layout

```text
playwright/
  config/upcc-enterprise.generated.json   # written by discovery, gitignored
  fixtures/snapshots/                     # committed mock fixtures
  helper-functions/
  tests/metadata/
  tests/visual/
scripts/
  discover-upcc-enterprise.ts
```

## Troubleshooting

### ENOENT on `upcc-enterprise.generated.json` during discovery

```
ENOENT: no such file or directory, open '...\playwright\config\upcc-enterprise.generated.json'
```

You are on an older commit. Pull the fix and retry:

```powershell
git pull
npm run discover:enterprise-upcc
```

---

### Discovery prints a code and then the terminal returns (does not wait)

This is expected. It printed the device-flow sign-in code. You must:

1. Open `https://login.microsoft.com/device` in your browser
2. Enter the code shown in the terminal
3. Sign in with your organisational account
4. Re-run `npm run discover:enterprise-upcc`

---

### `uuid@8.3.2` deprecation warning during `npm install`

Fixed. The repo now uses `@azure/msal-node@^5.2.2` which drops `uuid`. Pull and reinstall:

```powershell
git pull
npm install
```

---

### Cannot find module `@azure/msal-node`

```powershell
npm install
```

---

## Refreshing node_modules (Windows PowerShell)

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

## How to debug enterprise failures

1. Run metadata first — if metadata fails, fix that before touching the browser.
2. Inspect the generated config: `playwright/config/upcc-enterprise.generated.json`
3. Run `npm run test:visual` in isolation.
4. Check Playwright artifacts after failures:
   - HTML report: `playwright-report/` → open with `npx playwright show-report`
   - JUnit XML: `test-results/results.xml`

## Current limitations

- visual smoke depends on enterprise discovery and interactive user auth
- live REST/XMLA snapshot refresh is not wired into the normal workflow
- local metadata verification uses the committed mock fixtures only
- this v1 is intentionally single-report focused

## Next recommended step

Run `npm run discover:enterprise-upcc` in the connected environment and verify the generated config
contains the expected workspace, dataset, report, and page. Then run `npm run test:visual`.

