# Work Status

## Current objective

Build a lightweight Playwright-based Power BI quality suite, starting with the **UPCC Dashboard** report.

The suite is intentionally focused on:

- broken visual smoke coverage
- refresh history health
- schema drift detection
- fragile source extraction checks
- duplicate/suspicious structure checks

It is intentionally **not** focused on advanced RLS or heavy report-specific UI automation yet.

## Progress recorded from this chat

### Architecture and planning

- Reviewed the current repository artifacts:
  - `UPCC Dashboard.txt`
  - `UPCC Dashboard.pbip`
  - `legacy_discover_upcc_v14_fixed_v5.py`
  - `legacy_concept_powerbi_meta.md`
- Reviewed the reference baseline:
  - `kerski/pbi-dataops-visual-error-testing`
- Reworked the architecture away from RLS-heavy/report-specific design and toward a lighter **visual smoke + model health** approach
- Wrote and refined:
  - `docs/architecture/playwright_test_strategy.md`

### Documentation

- Added `README.md` with:
  - local setup and run instructions
  - enterprise bring-up sequence
  - what to watch for
  - debugging guidance
- Added this `work_status.md`
- Added `.github/copilot-instructions.md`

### Implementation completed

- Initialized a TypeScript + Playwright project
- Added:
  - `playwright.config.ts`
  - `tsconfig.json`
  - `package.json`
- Created the first suite structure under:
  - `playwright/config/`
  - `playwright/fixtures/`
  - `playwright/helper-functions/`
  - `playwright/test-cases/`
  - `playwright/tests/`
  - `playwright/global/`
  - `scripts/`

### Metadata lane implemented

- Added parsing and helper logic for:
  - refresh-history normalization
  - nested `serviceExceptionJson` parsing
  - SQL extraction from M expressions
  - UPCC metadata parsing from `UPCC Dashboard.txt`
  - schema-signature generation
  - signature drift comparison
  - duplicate heuristics with allowlists
- Added fixture generation:
  - `scripts/generate-upcc-fixtures.ts`
- Generated committed UPCC snapshots:
  - `playwright/fixtures/snapshots/model-signatures/upcc-model-signature.json`
  - `playwright/fixtures/snapshots/refresh-history/upcc-refresh-history.json`
  - `playwright/fixtures/snapshots/refresh-history/upcc-refresh-health.json`

### Tests implemented

- Metadata tests:
  - fixture contract tests
  - source extraction tests
  - refresh health tests
  - schema drift tests
  - duplicate-check tests
- Visual tests:
  - scaffolded UPCC visual smoke test, currently skipped until enterprise values and access are available

## Current result

- **Metadata lane is runnable and passing locally**
- **Visual lane exists as a scaffold but is not enabled yet**

Current validated commands:

```bash
npm run generate:fixtures
npm run typecheck
npm test
```

## Current limitations

- The visual smoke implementation is not live yet
- `report_id` and `page_id` are still placeholders in:
  - `playwright/test-cases/reports.csv`
- Enterprise runtime configuration is still minimal
- Live REST/XMLA capture has not yet replaced the committed local fixtures

## Recommended next steps

1. Copy the suite into the enterprise-connected environment.
2. Supply the real UPCC `report_id` and `page_id`.
3. Update enterprise configuration in `playwright/config/environments/enterprise-uat.json`.
4. Unskip and implement the real visual smoke test in `playwright/tests/visual/upcc-visual-smoke.spec.ts`.
5. Run:
   - `npm run test:metadata`
   - `npm run test:visual`
   - `npm test`
6. Decide whether to add live refresh/XMLA capture to regenerate snapshots automatically in enterprise.
