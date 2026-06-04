# pbi-playwright-suit

Lightweight Playwright-based Power BI quality suite.

Two run modes:

1. **Dry run** — validates suite logic against committed mock fixtures. No credentials, no browser, runs anywhere.
2. **Enterprise run** — connects to live Power BI, picks workspace + reports interactively, then runs visual health checks against published reports.

## Quick start

### Enterprise run (live Power BI, Windows — Chrome already installed)

```powershell
git pull
npm install
npm run setup
```

`npm run setup` signs you in via browser (device-flow), lets you pick a workspace, reports, and pages, then **offers to run visual checks immediately** — no separate command needed.

> **Do NOT run `npm run install:browsers` on Windows.**
> The enterprise run uses your existing Chrome installation.

### Dry run (no credentials, no browser)

```powershell
git pull
npm install
npm test
```

Runs all fixture-based checks. Visual checks are automatically skipped when no enterprise config is present.

## Prerequisites

- Node 18+ (Node 20+ recommended)
- npm
- **Enterprise run on Windows**: Google Chrome (system-installed). No browser download needed.
- **Enterprise run on Linux / CI**: run `npm run install:browsers` once to download bundled Chromium.

## Install

```powershell
npm install
```

No Python virtual environment is required.
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

## Connecting to Power BI

### Interactive (recommended)

```powershell
npm run setup
```

Shows your workspaces and reports sorted alphabetically (top 20 first). Enter a **number** to select, or **type any text** to search by name:

```
  Workspaces (3 total)
    [  1] Analytics-Workspace-A
    [  2] Analytics-Workspace-B
    [  3] Analytics-Workspace-C

  type to search · Enter number (1–3): 1

  Reports (showing 20 of 47)
    [  1] Quarterly Summary
    [  2] Regional Metrics
    ...
    [ 20] Workforce Overview

  type to search · Enter to show all 47
  Enter number(s) — 1  1,3,5  2-6  all
  > regional

  Reports (2 total)
    [  1] Regional Metrics
    [  2] Regional Drill-Through

  > 1

  Pages — Regional Metrics (5 total)
    [  1] Executive Summary
    ...
    [  5] Data Quality

  > 1,5

✅ 2 report page(s) queued

Run tests now? [Y/n]:
```

After you answer **Y**, enterprise checks run immediately.

### Non-interactive (CI / env-var driven)

```powershell
npm run setup
```

Requires `PBI_WORKSPACE_NAME` and `PBI_REPORT_NAME` to be set in `.env`.
Optional: `PBI_DATASET_NAME`, `PBI_PAGE_NAME`.

### What it writes

`npm run setup` writes `playwright/config/enterprise.generated.json` (gitignored).
No environment variables are written. The file is read automatically when running tests.

**First run:** the terminal prints a sign-in code:

```
To sign in, use a web browser to open the page https://login.microsoft.com/device
and enter the code XXXXXXXX to authenticate.
```

Open that URL, enter the code, sign in with your organisational account, then **re-run** the command.
Subsequent runs reuse the cached token.

## Understanding test results

| Test outcome | Meaning |
|---|---|
| ✅ passed | All visuals on that page rendered without SDK errors |
| ❌ `error: InvalidUnconstrainedJoin` | A visual has an unconstrained join — data model fix needed |
| ❌ `error: QueryUserError` | A DAX query failed — measure or relationship issue |
| ❌ `error: Missing_References` | A visual references a field that no longer exists |
| ⏭ skipped (XMLA permissions) | Dataset XMLA endpoint is disabled — enable in Power BI Admin Portal |

Videos are kept for every failed test. Screenshots capture the visual state 3 s after the error
fires, so charts that partially loaded will be visible.

## Optional environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CLIENT_ID` | built-in public client | AAD app registration |
| `TENANT_ID` | — | restrict to a specific tenant |
| `PBI_WORKSPACE_NAME` | *(required for non-interactive)* | workspace name |
| `PBI_REPORT_NAME` | *(required for non-interactive)* | report name |
| `PBI_DATASET_NAME` | same as report name | dataset name |
| `PBI_PAGE_NAME` | first page | page display name |
| `PBI_ENVIRONMENT` | `Public` | Azure cloud (`Public`, `USGov`, …) |
| `PBI_TOKEN_CACHE_FILE` | auto | path to MSAL token cache file |
| `PBI_BROWSER_CHANNEL` | `chrome` | `chrome` or `msedge` |

## Repository layout

```text
playwright/
  config/enterprise.generated.json       # written by npm run setup, gitignored
  fixtures/snapshots/                     # committed mock fixtures for dry run
  helper-functions/
  tests/metadata/                         # dry-run checks (fixtures only)
  tests/visual/                           # enterprise checks (live Power BI)
scripts/
  setup.ts                                # Power BI connection setup (interactive & CI)
```

## Troubleshooting

### ENOENT on `enterprise.generated.json`

Run `npm run setup` first to connect to Power BI and select your report targets.

---

### Sign-in code appears and the terminal returns immediately

This is expected. Open `https://login.microsoft.com/device`, enter the code, sign in, then re-run.

---

### `uuid@8.3.2` deprecation warning during `npm install`

Fixed. The repo now uses `@azure/msal-node@^5.2.2`. Pull and reinstall:

```powershell
git pull && npm install
```

---

### Test skipped with "XMLA permissions"

Your Power BI admin needs to enable the XMLA endpoint on that dataset:
**Power BI Admin Portal → Workspaces → (workspace) → Dataset settings → XMLA endpoint → Read**.

---

## Refreshing node_modules (Windows PowerShell)

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

## How to debug visual failures

1. Open the HTML report: `npx playwright show-report`
2. Each failing test has a **screenshot**, **video**, and **trace** attached.
3. The video captures the full render timeline — even if the screenshot shows a loading state,
   the video will show what actually rendered before the error fired.
4. For trace analysis: `npx playwright show-trace test-results/<test-folder>/trace.zip`

