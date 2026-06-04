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
  generate-upcc-fixtures.ts
```

## Prerequisites

1. Node 20+ recommended
2. npm
3. For enterprise visual execution: Playwright browser dependencies available in the target environment
4. For enterprise discovery/visual execution:
   - `CLIENT_ID`
   - `CLIENT_SECRET`
   - `TENANT_ID`
   - optional `PBI_ENVIRONMENT` (defaults to `Public`)
5. For service-principal visual smoke:
   - the service principal must be a member of the target workspace
   - the workspace must be on Premium/Fabric capacity for embed-token generation

## Install

```bash
npm install
```

No Python dependency installation is required for the current implementation.

## Local / Codespaces workflow

### 1. Type-check

```bash
npm run typecheck
```

### 2. Run metadata tests only

```bash
npm run test:metadata
```

### 3. Run the full suite

This currently runs:

- metadata tests against committed mock fixtures
- the visual smoke test, which auto-skips unless enterprise discovery + credentials exist

```bash
npm test
```

## What the current tests validate

### Metadata lane

- report/test-case fixture contract validity
- refresh history parsing and normalization
- 7-day refresh-health evaluation
- nested `serviceExceptionJson` parsing
- schema signature comparison against committed UPCC snapshots
- drift comparison against the committed UPCC baseline
- SQL extraction and normalization from M expressions
- duplicate/suspicious-structure heuristics with allowlists for known model patterns

### Visual lane

The visual test now uses:

- `scripts/discover-upcc-enterprise.ts`
- `playwright/config/upcc-enterprise.generated.json`
- `playwright/tests/visual/upcc-visual-smoke.spec.ts`

It does not require manual CSV editing for the UPCC enterprise path.

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
2. discover the real UPCC workspace/report/page via CLI
3. run the visual smoke test

```bash
npm install
npm run discover:enterprise-upcc
npm run test:visual
```

If Playwright browsers are not installed in the enterprise runner:

```bash
npx playwright install
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

- gets an access token using the service principal
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

Optional environment variables:

- `UPCC_WORKSPACE_NAME`
- `UPCC_REPORT_NAME`
- `UPCC_DATASET_NAME`
- `UPCC_PAGE_NAME`

Notes:

- `UPCC_PAGE_NAME` is recommended when the report has multiple pages
- the discovered config file is **generated** and **gitignored**
- this command is the enterprise replacement for manual ID editing

## What to watch for in enterprise

### Visual lane risks

- discovery cannot find the workspace because the service principal is not a workspace member
- embed token generation fails because the workspace is not on Premium/Fabric capacity
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
3. confirm the service principal can list the workspace and access the report
4. confirm the workspace is on Premium/Fabric capacity
5. confirm the failure is a Power BI report issue, not just a token/discovery/setup problem

### 6. Common first checks for schema-drift failures

1. decide whether the model really changed
2. inspect the changed snapshot files under:

- `playwright/fixtures/snapshots/model-signatures/`
- `playwright/fixtures/snapshots/refresh-history/`

3. only refresh baselines deliberately after confirming the change is intentional
4. fixture regeneration is a maintenance task, not part of the normal run flow

## Current limitations

- visual smoke depends on enterprise discovery and service-principal access
- live REST/XMLA snapshot refresh is not wired into the normal workflow
- fixture regeneration exists for maintenance, not routine execution
- this v1 is intentionally single-report focused

## Next recommended step

Run the enterprise discovery CLI in the connected environment and verify that it produces the expected UPCC page config. Then run `npm run test:visual` to validate the real report render path.
