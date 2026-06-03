# pbi-playwright-suit

Lightweight Playwright-based Power BI quality suite for the **UPCC Dashboard** report.

It currently covers two lanes:

1. **Metadata lane**: refresh health, schema drift, SQL extraction from M, duplicate heuristics
2. **Visual lane**: scaffolded Power BI visual smoke path, intended to be enabled in the enterprise environment

## Current state

- The **metadata lane is runnable now** in the isolated Codespace
- The **visual smoke lane is scaffolded but intentionally skipped**
- Baseline fixtures are generated from `UPCC Dashboard.txt`
- The architecture and test catalog live in `docs/architecture/playwright_test_strategy.md`

## Repository layout

```text
playwright/
  config/environments/
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
4. For future live metadata capture: approved Power BI REST/XMLA access in the enterprise environment

## Install

```bash
npm install
```

## Local / Codespaces workflow

### 1. Regenerate committed fixtures

This rebuilds the UPCC baseline snapshots from `UPCC Dashboard.txt`.

```bash
npm run generate:fixtures
```

### 2. Type-check

```bash
npm run typecheck
```

### 3. Run metadata tests only

```bash
npm run test:metadata
```

### 4. Run the full suite

This currently runs:

- metadata tests
- the visual scaffold, which is skipped by design

```bash
npm test
```

## What the current tests validate

### Metadata lane

- report/test-case fixture contract validity
- refresh history parsing and normalization
- 7-day refresh-health evaluation
- nested `serviceExceptionJson` parsing
- schema signature generation from `UPCC Dashboard.txt`
- drift comparison against the committed UPCC baseline
- SQL extraction and normalization from M expressions
- duplicate/suspicious-structure heuristics with allowlists for known model patterns

### Visual lane

Right now it only verifies the test scaffold exists.

File:

- `playwright/tests/visual/upcc-visual-smoke.spec.ts`

Reason it is skipped:

- real `report_id` and `page_id` are still placeholders
- the isolated environment cannot validate the real Power BI browser path

## How to enable the visual lane in enterprise

### 1. Update the report case file

Edit:

- `playwright/test-cases/reports.csv`

Replace:

- `report_id=TO_BE_SUPPLIED`
- `page_id=TO_BE_SUPPLIED`
- `enabled=false`

with real enterprise values for the UPCC report/page.

### 2. Update the enterprise environment manifest

Edit:

- `playwright/config/environments/enterprise-uat.json`

Set the real base URL and any environment-specific values you want to externalize there.

### 3. Unskip the visual test

Edit:

- `playwright/tests/visual/upcc-visual-smoke.spec.ts`

Remove or replace:

```ts
test.skip(true, 'Enable in enterprise execution once report_id and page_id are supplied.');
```

### 4. Add the real visual implementation

The current visual spec is only a scaffold. In enterprise, the next implementation step is:

1. read the UPCC record from `reports.csv`
2. build the real report URL or embed target
3. navigate with Playwright
4. wait for render completion
5. assert absence of known Power BI error text/modal patterns

### 5. Install Playwright browsers if needed

```bash
npx playwright install
```

## Recommended enterprise bring-up order

1. `npm install`
2. `npm run generate:fixtures`
3. `npm run typecheck`
4. `npm run test:metadata`
5. wire report/page IDs and environment config
6. enable the visual smoke test
7. run `npm run test:visual`
8. then run `npm test`

## What to watch for in enterprise

### Visual lane risks

- invalid or missing `report_id` / `page_id`
- authentication or tenant routing issues
- Power BI permission failures
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

### 2. Run visual only

Run:

```bash
npm run test:visual
```

This isolates browser issues from metadata issues.

### 3. Inspect Playwright artifacts

After failures:

- HTML report: `playwright-report/`
- JUnit XML: `test-results/results.xml`
- retained traces for failed tests

Useful command:

```bash
npx playwright show-report
```

If a test retained a trace, Playwright will print the trace path in the failure output.

### 4. Common first checks for visual failures

1. confirm the CSV has the correct report/page IDs
2. confirm the environment manifest points to the right tenant/base URL
3. confirm the enterprise identity can open the UPCC report manually
4. confirm the failure is a Power BI report issue, not just a test harness navigation problem

### 5. Common first checks for schema-drift failures

1. decide whether the model really changed
2. if the change is expected, regenerate and review fixtures:

```bash
npm run generate:fixtures
```

3. inspect the changed snapshot files under:

- `playwright/fixtures/snapshots/model-signatures/`
- `playwright/fixtures/snapshots/refresh-history/`

4. only accept the new baseline after confirming the change is intentional

## Current limitations

- visual smoke is not implemented beyond the scaffold yet
- live REST/XMLA capture is not wired yet
- fixtures are currently derived from the committed UPCC metadata export
- this v1 is intentionally single-report focused

## Next recommended step

Move the suite into the enterprise-connected environment and enable the live visual smoke path for UPCC there. The local metadata lane is already useful; the highest-value unknown now is the real report render path.
