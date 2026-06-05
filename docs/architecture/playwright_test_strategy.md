# Power BI Playwright Quality Suite — Test Strategy

## 1. Objective

Build a **simple, configuration-driven suite** that catches every signal that can make a Power BI report visual render wrong data, stale data, or no data at all — for **any report in any workspace**, without requiring report-specific automation code.

The suite is not a general UI test harness. It is a **Power BI health monitor** that uses Playwright as its execution backbone.

---

## 2. The signals that break visuals

These are the only signals the suite asserts on. Everything else is noise.

| ID | Signal | Root cause |
|---|---|---|
| **RH-002** | Latest dataset refresh is `Failed`, `Disabled`, `Cancelled`, or `Unknown` | Visuals are reading from a stale or empty dataset |
| **RH-003** | Any entry in refresh history matches a credential or data-integrity error pattern | Broken auth, gateway failures, or duplicate key values in source causing bad aggregations |
| **VS-NNN** | A report page embed raises a Power BI SDK visual error | Broken measure, missing field, unconstrained join, or credential failure at render time |

---

## 3. Two-lane architecture

### Lane A — Visual smoke (enterprise only)

- Playwright embeds the report page using a per-report embed token
- The Power BI JavaScript SDK fires `rendered` or `error` events
- Any SDK error code is treated as a test failure
- One Playwright test per report page (`VS-001`, `VS-002`, ...)

### Lane B — Dataset health (enterprise + dry-run)

- **RH-002 / RH-003**: call the Power BI REST refresh history endpoint; analyse status codes and error messages in-process (no browser needed)
- One Playwright "test" per dataset (deduplicated across pages) for the health checks

The dataset health lane can run anywhere — CI, Codespaces, local — because it uses only the REST API, not a browser.

---

## 4. Suite structure

```text
playwright/
  config/
    enterprise.generated.json   # runtime — gitignored
    enterprise.focus.json       # runtime — gitignored
  fixtures/snapshots/
    refresh-history/            # committed — mock fixtures for dry-run
    enterprise-config/          # committed — sample shape for reference
  helper-functions/
    powerbi-enterprise.ts       # REST API: auth, refresh history, embed token
    refresh-health.ts           # refresh history analysis + credential/integrity error scanning
    enterprise-config.ts        # load/save enterprise.generated.json
    focus.ts                    # focus menu: 6 live options + 1 TBD + routing matrix
    source-extraction.ts        # SQL extraction from M partition expressions
    types.ts                    # shared TypeScript types
    env-loader.ts               # .env loading
    file-reader.ts              # fixture file helpers
  tests/
    metadata/                   # dry-run (no credentials, no browser)
      fixture-contracts.spec.ts
      refresh-health.spec.ts
      source-extraction.spec.ts
    visual/                     # enterprise (live Power BI)
      dataset-health.spec.ts    # RH-002, RH-003
      report-pages.spec.ts      # VS-NNN visual smoke
  global/global-setup.ts
scripts/
  setup.ts                      # interactive setup wizard (focus menu + config + run loop)
```

---

## 5. Focus system

`npm run setup` ends with a **focus selection menu** that lets the developer skip unrelated checks when running across large workspaces:

| # | Focus | VS-NNN | RH-002 | RH-003 | Best for |
|---|---|:---:|:---:|:---:|---|
| 1 | Broken visuals | YES | — | — | Visual smoke only |
| 2 | Dataset refresh failures | — | YES | — | Is the data fresh? |
| 3 | Credential / gateway errors | — | — | YES | OAuth / gateway auth failures |
| 4 | Refresh health | — | YES | YES | All refresh signals combined |
| 5 | Quick triage | YES | YES | — | Fastest check for large workspaces |
| 6 | All checks | YES | YES | YES | Every live signal |
| [TBD] | Source data schema drift | — | — | — | Column / table changes in source SQL |

Focus is persisted to `playwright/config/enterprise.focus.json` (gitignored). Each spec reads this at start time and calls `test.skip()` for out-of-scope tests.

---

## 6. Design decisions and constraints

| Decision | Rationale |
|---|---|
| No threshold env vars for staleness or failure count | Every broken refresh is a signal; thresholds produced false negatives |
| RH-001 (refresh history exists) removed | Not a visual breakage signal |
| DS-001 (datasource connection details) removed | REST endpoint unreliable across dataset types; RH-003 catches credential failures via history |
| MS-001 / MS-002 (model structure checks) removed | M:M relationships and bidirectional cross-filter are not direct visual breakage signals for this suite's scope |
| `tsx/cjs` require hook instead of `tsx` direct | Node 18 ESM loader crashes on Windows mapped network drives (`M:`) due to URL scheme parsing |
| One test per dataset for health checks | Avoids duplicate API calls when a report has many pages |
| Auth token reused across runs | `npm run setup` authenticates once; the `while(true)` run loop reuses the token for subsequent runs in the same session |

---

## 7. Planned — Phase 2: Source SQL Server Schema Drift (Lane C)

> **Status: planned, not yet implemented.**
> Lane C closes a gap: detecting SQL Server field changes **before** the next refresh runs.

### The gap Lane C closes

| Scenario | Currently detected? | How |
|---|---|---|
| Refresh fails because source column was dropped | YES — after the fact | RH-002 / RH-003 |
| DBA renames or drops a column; Power BI model not yet updated | NO — not until next refresh | Lane C will catch this |
| DBA changes a column type that silently corrupts numerics | NO — not until visuals show wrong totals | Lane C will catch this |

### Proposed signals

| ID | Signal | Description |
|---|---|---|
| **SSD-001** | Column dropped from source table | Column present in committed baseline but absent from live `INFORMATION_SCHEMA.COLUMNS` |
| **SSD-002** | Column type changed in source table | `DATA_TYPE` / `CHARACTER_MAXIMUM_LENGTH` / `NUMERIC_PRECISION` differs from baseline |
| **SSD-003** | Source table dropped or renamed | Table referenced in baseline M expression not found in live schema |

### Architecture

```text
scripts/
  ingest-sql-schema.ts           # new — connects to SQL Server, snapshots INFORMATION_SCHEMA
playwright/
  helper-functions/
    sql-schema-watcher.ts        # new — queries INFORMATION_SCHEMA, returns SourceColumnMap
  fixtures/snapshots/
    source-schema/               # new — committed JSON snapshots, one per data source
      <server>__<database>.json
  tests/
    metadata/
      source-schema-drift.spec.ts  # new — dry-run: mock; enterprise: live SQL Server query
```

### New environment variables required

```
PBI_SQL_SERVER=<hostname or IP>
PBI_SQL_DATABASE=<database name>
PBI_SQL_USER=<read-only service account>
PBI_SQL_PASSWORD=<password>
# or, on Windows domain machines: PBI_SQL_TRUSTED_CONNECTION=true
```

### Design constraints

- Read-only SQL Server credentials only; the script never writes to the source database.
- One snapshot file per `server__database` pair — not per report.
- Dry-run mode uses committed mock snapshots (no SQL Server connection needed), identical to how `refresh-health.spec.ts` works today.
- All SSD tests skip gracefully if `PBI_SQL_SERVER` is absent.

---

## 8. What is deliberately out of scope

- Large Page Object Model hierarchies
- Deep persona / RLS scenario matrices
- Custom UI interaction libraries per report type
- Offline Power BI browser simulation
- XMLA TOM scripting inside the test runner
- Any assertion that requires knowing report-specific visual names or layout
- Writing to or modifying any source database (Lane C is read-only)

---

## 9. Reference baseline

The kerski `pbi-dataops-visual-error-testing` repository provided the harness shape:

- Playwright as the execution engine
- config + global setup model
- test-case driven execution with VS-NNN IDs
- service-principal-based live execution
- broken visual detection via embed/render SDK events

This suite adopts those patterns and extends them with the dataset health lane.
