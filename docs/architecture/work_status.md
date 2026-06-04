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
  - UPCC project context
  - legacy Power BI discovery/auth approach
  - prior metadata/export notes for architectural ideas only
- Reviewed the reference baseline:
  - `kerski/pbi-dataops-visual-error-testing`
- Reworked the architecture away from RLS-heavy/report-specific design and toward a lighter **visual smoke + model health** approach
- Wrote and refined:
  - `docs/architecture/playwright_test_strategy.md`

### Documentation

- Added `README.md` with:
  - local setup and run instructions
  - simplified enterprise bring-up sequence
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
- Refactored the normal local workflow so it uses committed mock fixtures already in the repo
- Added enterprise discovery CLI:
  - `scripts/discover-enterprise.ts` (non-interactive, env-driven)
  - `scripts/discover-interactive.ts` (interactive, menu-driven)
- Added generated enterprise config support:
  - `playwright/config/enterprise.generated.json` (gitignored)
  - `playwright/.auth/msal-device-token-cache.json` (gitignored)

### Metadata lane implemented

- Added parsing and helper logic for:
  - refresh-history normalization
  - nested `serviceExceptionJson` parsing
  - SQL extraction from M expressions
  - schema-signature generation
  - signature drift comparison
  - duplicate heuristics with allowlists
- Generated committed baseline snapshots:
  - `playwright/fixtures/snapshots/model-signatures/baseline-model-signature.json`
  - `playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json`
  - `playwright/fixtures/snapshots/refresh-history/baseline-refresh-health.json`

### Tests implemented

- Metadata tests:
  - fixture contract tests
  - source extraction tests
  - refresh health tests
  - schema drift tests
  - duplicate-check tests
- Visual tests:
  - enterprise visual smoke implementation that auto-skips until `enterprise.generated.json` and credentials are available

## Current result

- **Metadata lane is runnable and passing locally**
- **Visual lane runs against enterprise when credentials and discovery output are present**

Current validated local commands:

```bash
npm run typecheck
npm test
```

## Current limitations

- Live REST/XMLA capture has not yet replaced the committed local fixtures
- Token cache path is fixed; multi-tenant support not implemented

## Recommended next steps

1. Copy the suite into the enterprise-connected environment.
2. Set `CLIENT_ID` and optionally `TENANT_ID` in `.env`, then run:
   - `npm run discover:interactive`
3. Confirm the generated file at `playwright/config/enterprise.generated.json`.
4. Run `npm run test:visual` to smoke-test selected reports.
5. Run `npm test` to validate the full suite.
6. Decide later whether to add live refresh/XMLA capture in enterprise, without changing the default local fixture-based workflow.
