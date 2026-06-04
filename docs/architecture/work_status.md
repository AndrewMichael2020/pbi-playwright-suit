# Work Status

## Current objective

A lightweight Playwright-based Power BI quality suite that catches every signal that makes a report visual render wrong data, stale data, or no data — for any report in any workspace.

---

## Implemented and passing

### Metadata lane (47/47 tests, dry-run, no credentials required)

| Test file | What it covers |
|---|---|
| `fixture-contracts.spec.ts` | Refresh snapshot, schema baseline, and enterprise config shape contracts |
| `refresh-health.spec.ts` | Refresh history parsing, nested `serviceExceptionJson` normalization, pattern analysis |
| `schema-drift.spec.ts` | Schema signature generation and drift comparison (added/removed tables, columns, measures, relationships, SQL hash changes) |
| `source-extraction.spec.ts` | SQL extraction from M partition expressions, normalization |
| `duplicate-checks.spec.ts` | Duplicate table names, measure names, relationship edges, SQL signatures |
| `model-structure.spec.ts` | **MS-001** — unallowlisted Many-to-Many relationships against committed baseline |

### Enterprise lane (live Power BI, requires `npm run setup`)

| Test file | Checks |
|---|---|
| `dataset-health.spec.ts` | **RH-002** latest refresh status; **RH-003** data-integrity / credential error patterns in history |
| `report-pages.spec.ts` | **VS-NNN** visual smoke — Power BI SDK embed/render errors per report page |

Both enterprise test files auto-skip when `enterprise.generated.json` or credentials are absent.

---

## Signals in scope (only what breaks visuals)

| ID | Signal |
|---|---|
| RH-002 | Latest refresh `Failed`, `Disabled`, `Cancelled`, or `Unknown` |
| RH-003 | Any historical refresh entry matches data-integrity or credential error pattern |
| MS-001 | Unallowlisted Many-to-Many relationship in model baseline |
| VS-NNN | Power BI SDK visual error at render time |

Explicitly removed: RH-001 (history exists), DS-001 (datasource connections), MS-002 (bidirectional cross-filter), threshold-based staleness / consecutive failure checks, inactive relationship checks.

---

## Interactive setup workflow

`npm run setup` is the full enterprise configuration wizard:

1. Device-flow sign-in
2. Workspace selection (search or number)
3. Report selection (multi-select, search)
4. Page selection per report
5. **Focus menu** — 9 named options (e.g. "Broken refresh", "Duplicate PK / M:M", "Quick triage") that skip out-of-scope tests; persisted to `enterprise.focus.json`
6. Option to run tests immediately

---

## Key files

| File | Purpose |
|---|---|
| `scripts/setup.ts` | Interactive wizard — discovery + focus selection |
| `scripts/ingest-model-txt.ts` | Parse Python .txt model export → committed JSON baseline + drift detection |
| `playwright/helper-functions/focus.ts` | Focus menu definitions, routing matrix, `isInFocus()` |
| `playwright/helper-functions/refresh-health.ts` | `evaluateRefreshHealth()`, `scanForDataIntegrityErrors()` |
| `playwright/helper-functions/powerbi-enterprise.ts` | REST API auth, refresh history, embed token |
| `playwright/fixtures/snapshots/model-baseline/sample-model-baseline.json` | Generic mock baseline (6 tables, 5 relationships, 2 intentional M:M) |

---

## Commands

```bash
npm install          # install dependencies
npm run typecheck    # TypeScript check
npm test             # dry-run — 47 fixture-based tests, no credentials
npm run setup        # interactive enterprise configuration wizard
```

---

## Current limitations

- Live XMLA model capture not yet integrated (model baseline must be generated from a Python script export)
- Schema drift and source extraction checks run against committed mock fixtures only; live REST schema endpoint not available for regular datasets
- Token cache path is fixed; multi-tenant support not implemented
- SQL Server source schema changes are not yet directly detectable — only caught indirectly when they cause a refresh failure (RH-002/RH-003); see Phase 2 plan below

---

## Recommended next steps

1. Run `npm run setup` in the enterprise environment to select reports and focus
2. Run `npm test` to confirm enterprise tests execute against live Power BI
3. Commit `azure-pipelines.yml` or `.github/workflows/pbi-quality.yml` from `docs/architecture/ci_deployment_plan.md` for scheduled CI
4. For each report with a Python model export: run `npm run ingest:model-txt -- "MyReport.txt"` and commit the baseline JSON to enable MS-001
5. As the suite proves value, expand the model-baseline set to cover more reports in the workspace

---

## Phase 2 — Source SQL Server Schema Drift (Lane C)

> **Planned, not yet implemented.** See `playwright_test_strategy.md §8` for full architecture.

**Problem:** if a DBA renames or drops an MS SQL column before the Power BI model is updated, the current suite only catches it *after* the next nightly refresh fails.  Lane C would detect it *before* the refresh runs.

**Proposed signals:**

| ID | Signal |
|---|---|
| SSD-001 | Column dropped from source table |
| SSD-002 | Column type changed in source table |
| SSD-003 | Source table dropped or renamed |

**What needs to be built:**

| Item | Description |
|---|---|
| `scripts/ingest-sql-schema.ts` | Connects to SQL Server (read-only), snapshots `INFORMATION_SCHEMA.COLUMNS` for all tables referenced in any committed M expression |
| `playwright/helper-functions/sql-schema-watcher.ts` | Queries live `INFORMATION_SCHEMA` and returns a typed `SourceColumnMap` |
| `playwright/fixtures/snapshots/source-schema/<server>__<db>.json` | Committed baseline snapshot |
| `playwright/tests/metadata/source-schema-drift.spec.ts` | Dry-run (mock) + enterprise (live SQL) drift assertions |
| Focus menu option 10 | "Source schema drift" |
| `mssql` npm dependency | `npm install mssql @types/mssql` |
| Four new env vars | `PBI_SQL_SERVER`, `PBI_SQL_DATABASE`, `PBI_SQL_USER`, `PBI_SQL_PASSWORD` (or `PBI_SQL_TRUSTED_CONNECTION=true`) |

All SSD tests auto-skip if no snapshot file exists or `PBI_SQL_SERVER` is unset — fully backwards compatible with the current setup.

