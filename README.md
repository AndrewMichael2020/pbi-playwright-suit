# pbi-playwright-suit

Lightweight Playwright-based Power BI quality suite for the **UPCC Dashboard** report.

This is currently a **Node/TypeScript + Playwright** project. It does **not** require a `requirements.txt` file or a Python virtual environment for the implemented suite.

It currently covers two lanes:

1. **Metadata lane**: refresh health, schema drift, SQL extraction from M, duplicate heuristics
2. **Visual lane**: enterprise Power BI visual smoke for the UPCC report, driven by a discovery CLI

## Current state

- The **metadata lane is runnable now** in the isolated Codespace
- The **visual smoke lane auto-skips locally unless enterprise discovery + credentials are present**
- Committed mock fixtures already exist in the repo
- The architecture and test catalog live in `docs/architecture/playwright_test_strategy.md`

## Repository layout

```text
playwright/
  config/environments/
  config/upcc-enterprise.generated.json   # generated at discovery time, gitignored
  fixtures/snapshots/
  helper-functions/
  test-cases/
  tests/metadata/
  tests/visual/
scripts/
  discover-upcc-enterprise.ts
```

## Prerequisites

1. Node 18+ required, Node 20+ recommended
2. npm
3. For enterprise visual execution: Playwright browser dependencies available in the target environment
4. For enterprise discovery/visual execution:
   - optional `TENANT_ID`
   - optional `PBI_ENVIRONMENT` (defaults to `Public`, meaning Azure Public cloud endpoints)
5. Enterprise auth currently follows the legacy pattern:
   - interactive MSAL device flow
   - token cache reuse between runs
   - your own user access, not a service principal
   - default public client app ID matches the legacy script if `CLIENT_ID` is not supplied

## Install

### Required npm packages

These are installed automatically by `npm install`:

- `@playwright/test`
- `typescript`
- `tsx`
- `@types/node`
- `@azure/msal-node` (pinned to a Node 18-compatible release)

### First-time install

```bash
npm install
```

No Python dependency installation is required for the current implementation.

For enterprise auth, the intended path is the same legacy-style MSAL device flow you were already using. No `.env.example` file is required.

### Browser install for visual tests

If you will run the enterprise visual lane, also install Playwright browsers:

```bash
npm run install:browsers
```

> **Windows users — missing DLL warning:**
> If you see:
> ```
> Playwright Host validation warning: Host system is missing dependencies!
>     api-ms-win-core-apiquery-l2-1-0.dll
> ```
> Install the [Microsoft Visual C++ Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe),
> then re-run `npm run install:browsers`. The browsers are still downloaded even if the warning
> appears — it is a host-validation notice, not a fatal download error. Visual tests may still
> work on recent Windows 10 / Windows 11 builds despite the warning.

## Before running anything

Use this order on a fresh clone or after pulling new changes:

```bash
npm install
npm run typecheck
npm test
```

If you plan to run enterprise visual smoke:

```bash
npm install
npm run install:browsers
npm run discover:enterprise-upcc
npm run test:visual
```

If you see:

```text
Cannot find module '@azure/msal-node'
```

then the repo dependencies are not fully installed in that clone yet. Run:

```bash
npm install
```

again before retrying discovery.

## Refreshing npm install

If you want to refresh a specific package install:

```bash
npm uninstall @azure/msal-node
npm install
```

If you want to refresh the full dependency install:

```bash
rm -rf node_modules package-lock.json
npm install
```

On Windows PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

## Simple workflows

### Local / mock-data workflow

This uses the committed fixtures already in the repo.

```bash
npm install
npm test
```

If you only want the metadata lane:

```bash
npm run test:metadata
```

### Enterprise UPCC workflow

1. install dependencies
2. install Playwright browsers
3. discover the real UPCC workspace/report/page via CLI
4. run the visual smoke test

```bash
npm install
npm run install:browsers
npm run discover:enterprise-upcc
npm run test:visual
```

Then run the whole suite if needed:

```bash
npm test
```

## Enterprise discovery CLI

Command:

```bash
npm run discover:enterprise-upcc
```

What it does:

- gets an access token using interactive device flow with token cache reuse
- lists accessible workspaces
- finds workspace `FHA-ADAR-BI-UAT`
- finds report `UPCC Dashboard`
- finds dataset `UPCC Dashboard`
- gets report pages
- selects:
  - `UPCC_PAGE_NAME` if supplied
  - otherwise the first page returned after sorting by API order
- writes:
  - `playwright/config/upcc-enterprise.generated.json`

Required / optional environment variables:

- `CLIENT_ID`
- `TENANT_ID`
- `UPCC_WORKSPACE_NAME`
- `UPCC_REPORT_NAME`
- `UPCC_DATASET_NAME`
- `UPCC_PAGE_NAME`
- `PBI_ENVIRONMENT`
- `PBI_TOKEN_CACHE_FILE`

Notes:

- `UPCC_PAGE_NAME` is recommended when the report has multiple pages
- the discovered config file is **generated** and **gitignored**
- this command is the enterprise replacement for manual ID editing
- on the first run, device flow will print a sign-in code and URL
- later runs should reuse the cached token until it expires or is invalidated
- if `CLIENT_ID` is omitted, the suite uses the same public client ID as the legacy script
- `PBI_ENVIRONMENT=Public` means the Azure Public cloud endpoint set, not public/unauthenticated Power BI access

## What to watch for in enterprise

### Visual lane risks

- discovery cannot find the workspace because your user account cannot access it
- cached token may expire or become stale and require a fresh device-flow login
- authentication or tenant routing issues
- Power BI permission failures
- the first discovered page is not the page you actually want to smoke-test
- broken visuals caused by:
  - missing fields
  - relationship ambiguity
  - resource exhaustion
  - disabled visuals
  - embed/render failures

### Metadata lane risks

- refresh history returns a failed status in the last 7 days
- normalized failure message changes shape unexpectedly
- tables/columns/measures/relationships drift from the committed baseline
- visible source SQL changes after M extraction normalization
- duplicate heuristics begin surfacing new issues not in the current allowlist

## How to debug in enterprise

### 1. Start with metadata first

Run:

```bash
npm run test:metadata
```

If this fails, fix metadata or fixture drift before touching browser automation.

### 2. Run discovery first

```bash
npm run discover:enterprise-upcc
```

Inspect the generated file:

- `playwright/config/upcc-enterprise.generated.json`

Confirm it contains the expected:

- workspace
- dataset
- report
- page

### 3. Run visual only

Run:

```bash
npm run test:visual
```

This isolates browser issues from metadata issues.

### 4. Inspect Playwright artifacts

After failures:

- HTML report: `playwright-report/`
- JUnit XML: `test-results/results.xml`
- retained traces for failed tests

Useful command:

```bash
npx playwright show-report
```

If a test retained a trace, Playwright will print the trace path in the failure output.

### 5. Common first checks for visual failures

1. confirm `playwright/config/upcc-enterprise.generated.json` was created
2. confirm the discovered page is the one you intended to test
3. confirm your user account can list the workspace and access the report
4. if prompted again, complete device-flow sign-in and rerun
5. confirm the failure is a Power BI report issue, not just a token/discovery/setup problem

### 6. Common first checks for schema-drift failures

1. decide whether the model really changed
2. inspect the changed snapshot files under:

- `playwright/fixtures/snapshots/model-signatures/`
- `playwright/fixtures/snapshots/refresh-history/`

3. only refresh baselines deliberately after confirming the change is intentional
4. local metadata tests should continue to use the committed mock fixtures

## Troubleshooting

### `uuid@8.3.2` deprecation warning during `npm install`

The warning looks like:

```
WARN deprecated uuid@8.3.2: uuid@10 and below is no longer supported.
```

This came from `@azure/msal-node` ≤ 3.x depending on `uuid@8`. The repo now pins
`@azure/msal-node@^5.2.2`, which drops the `uuid` dependency entirely. Run:

```bash
npm install
```

on a fresh clone to get the fixed version. If you previously ran `npm audit fix --force` on an
older clone, your `node_modules` may already be on 5.x — a fresh `npm install` will confirm.

---

### `api-ms-win-core-apiquery-l2-1-0.dll` missing on Windows

Full error:

```
Playwright Host validation warning: Host system is missing dependencies!
    api-ms-win-core-apiquery-l2-1-0.dll
```

**Fix:**

1. Download and install [Microsoft Visual C++ Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe)
2. Re-run:

```powershell
npm run install:browsers
```

The DLL is part of the Windows C Runtime API set. It is present on Windows 10 / 11 with
up-to-date Visual C++ Redistributables. If the warning persists after installing the
redistributable, your browsers are likely still downloaded and functional — run
`npm run test:visual` to confirm and only investigate further if tests actually fail.

---

### Discovery fails with `ENOENT` on `upcc-enterprise.generated.json`

The `playwright/config/` directory is gitignored and is created on first discovery run.
If the script exits with:

```
ENOENT: no such file or directory, open '...\playwright\config\upcc-enterprise.generated.json'
```

this was a bug fixed in the current codebase — `saveUpccEnterpriseConfig` now creates the
directory automatically. Pull the latest commit and retry:

```bash
git pull
npm run discover:enterprise-upcc
```

---

### Discovery prints a device-flow code and then exits

This is expected on first run (and after token expiry). Open a browser, go to:

```
https://login.microsoft.com/device
```

Enter the code printed in the terminal, sign in with your organisational account, then
**re-run** `npm run discover:enterprise-upcc`. The token is cached for subsequent runs.

## Current limitations

- visual smoke depends on enterprise discovery and interactive user auth
- live REST/XMLA snapshot refresh is not wired into the normal workflow
- local metadata verification uses the committed mock fixtures only
- this v1 is intentionally single-report focused

## Next recommended step

Run the enterprise discovery CLI in the connected environment and verify that it produces the expected UPCC page config. Then run `npm run test:visual` to validate the real report render path.
