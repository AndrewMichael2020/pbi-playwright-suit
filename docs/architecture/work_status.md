# Work Status

## Current objective

A lightweight Playwright-based Power BI quality suite that catches every signal that makes a report visual render wrong data, stale data, or no data — for any report in any workspace.

---

## Implemented and passing

### Metadata lane (29/29 tests, dry-run, no credentials required)

| Test file | What it covers |
|---|---|
| `fixture-contracts.spec.ts` | Refresh snapshot and enterprise config shape contracts |
| `refresh-health.spec.ts` | Refresh history parsing, nested `serviceExceptionJson` normalization, pattern analysis, `isBadRefreshStatus()` (RS-001/RS-002) |
| `source-extraction.spec.ts` | SQL extraction from M partition expressions, normalization |
| `errors.spec.ts` | Typed `PowerBiError` boundary — status→kind mapping, structured context, cause preservation (ER-001..004) |

### Enterprise lane (live Power BI, requires `npm run setup`)

| Test file | Checks |
|---|---|
| `dataset-health.spec.ts` | **RH-002** latest refresh status; **RH-003** credential / data-integrity error patterns in history |
| `report-pages.spec.ts` | **VS-NNN** visual smoke — Power BI SDK embed/render errors per report page |

Both enterprise test files auto-skip when `enterprise.generated.json` or credentials are absent.

---

## Signals in scope (only what breaks visuals)

| ID | Signal |
|---|---|
| RH-002 | Latest refresh `Failed`, `Disabled`, `Cancelled`, or `Unknown` |
| RH-003 | Any historical refresh entry matches a credential or data-integrity error pattern |
| VS-NNN | Power BI SDK visual error at render time |

Explicitly removed: RH-001 (history exists), DS-001 (datasource connections), MS-001 (M:M relationships / model baselines), MS-002 (bidirectional cross-filter), threshold-based staleness / consecutive failure checks, inactive relationship checks.

---

## Interactive setup workflow

`npm run setup` is the full enterprise configuration wizard:

1. Device-flow sign-in (once per session — auth is reused across multiple runs)
2. Workspace selection (search or number)
3. Report selection (multi-select, search)
4. Page selection per report
5. **Focus menu** — 6 live options + 2 experimental pql-test options + 1 [TBD] placeholder (source schema drift) — skips out-of-scope tests; persisted to `enterprise.focus.json`. The two pql-test options (schema drift, key duplication) are **experimental and not yet verified** — they await more stable `pql-test` releases.
6. Option to run tests immediately
7. After closing the HTML report viewer: **"Run another test? [Y/n]"** — loops back to workspace selection without re-authenticating

---

## Key files

| File | Purpose |
|---|---|
| `scripts/setup.ts` | Interactive wizard — discovery, focus selection, run loop |
| `playwright/helper-functions/focus.ts` | Focus menu definitions, routing matrix, `isInFocus()` |
| `playwright/helper-functions/refresh-health.ts` | `evaluateRefreshHealth()`, `scanForDataIntegrityErrors()`, `isBadRefreshStatus()` + `RefreshStatus` enum |
| `playwright/helper-functions/powerbi-enterprise.ts` | REST API auth, refresh history, embed token |
| `playwright/helper-functions/errors.ts` | Typed `PowerBiError` domain error + `classifyHttpError()` for the REST boundary |

---

## Boundary hardening (2026-06)

Tracked in [`audit_2026-06.md`](audit_2026-06.md). Shipped:

- **Typed REST errors** — `errors.ts` translates every non-2xx Power BI response into a named `PowerBiError` with a closed `kind` discriminant (`auth` / `notFound` / `throttled` / `service`) and a preserved transport `cause`.
- **Closed refresh-status enum** — `RefreshStatus` + single `isBadRefreshStatus()` predicate replaces the duplicated `BAD_STATUSES` set that previously lived inside `dataset-health.spec.ts`.

Deferred by design (acceptable for on-demand analyst runs; revisit only if enterprise CI is introduced): injectable env loader, import-time I/O containment.

---

## Commands

```bash
npm install          # install dependencies
npm run typecheck    # TypeScript check
npm test             # dry-run — 29 fixture-based tests, no credentials
npm run setup        # interactive enterprise configuration wizard
```

---

## Current limitations

- Source data schema drift not yet implemented — only caught indirectly when a refresh fails (RH-002/RH-003)
- Token cache path is fixed; multi-tenant support not implemented
- Unattended CI auth (client secret / service principal) not yet implemented — enterprise runs use device-flow with a cached MSAL token

---

## Recommended next steps

1. Run `npm run setup` to select reports and focus
2. Run `npm test` to confirm the 29 dry-run tests pass
3. Run enterprise checks via `npm run setup` — select reports — run
4. Commit `azure-pipelines.yml` or `.github/workflows/pbi-quality.yml` from `docs/architecture/ci_deployment_plan.md` for scheduled CI

---

## Phase 2 — Source SQL Server Schema Drift

> **Planned, not yet implemented.**

**Problem:** if a DBA renames or drops an MS SQL column before the Power BI model is updated, the current suite only catches it *after* the next nightly refresh fails. This phase would detect it *before* the refresh runs.

**Proposed signals:**

| ID | Signal |
|---|---|
| SSD-001 | Column dropped from source table |
| SSD-002 | Column type changed in source table |
| SSD-003 | Source table dropped or renamed |

**What needs to be built:**

| Item | Description |
|---|---|
| `scripts/ingest-sql-schema.ts` | Connects to SQL Server (read-only), snapshots `INFORMATION_SCHEMA.COLUMNS` for all tables referenced in committed M expressions |
| `playwright/helper-functions/sql-schema-watcher.ts` | Queries live `INFORMATION_SCHEMA`, returns a typed `SourceColumnMap` |
| `playwright/fixtures/snapshots/source-schema/<server>__<db>.json` | Committed baseline snapshot |
| `playwright/tests/metadata/source-schema-drift.spec.ts` | Dry-run (mock) + enterprise (live SQL) drift assertions |
| `mssql` npm dependency | `npm install mssql @types/mssql` |
| Four new env vars | `PBI_SQL_SERVER`, `PBI_SQL_DATABASE`, `PBI_SQL_USER`, `PBI_SQL_PASSWORD` (or `PBI_SQL_TRUSTED_CONNECTION=true`) |

All SSD tests auto-skip if no snapshot file exists or `PBI_SQL_SERVER` is unset.

---

## Microsoft Fabric SKU consumption

### What this suite does and does not consume

| Operation | CU impact | Notes |
|---|---|---|
| REST API calls (list workspaces, reports, pages, datasets, refresh history) | **Zero** | Runs on Microsoft shared metadata infrastructure |
| `GenerateToken` (embed token) | **Negligible** | One token per report page; ~0 CU-seconds |
| Report page rendering via Power BI JS SDK | **Non-zero** | DAX queries fire per visual; this is the only real CU cost |
| Dataset refresh | **Not triggered** | Suite reads history only — never triggers a refresh |
| Metadata lane (`npm test`, all 29 fixture tests) | **Zero** | No browser, no embed, no DAX queries |

The suite is a **read-only consumer** equivalent to a single analyst manually opening each report page.

---

### How rendering consumes CUs

When the visual smoke lane embeds a report page, the Power BI SDK fires one DAX query per visual. Each query runs on-capacity and consumes Fabric CUs for its duration.

**Estimated CU-seconds per page render:**

| Report complexity | Visuals / page | Est. CU-seconds per page |
|---|---|---|
| Simple (KPI tiles, cards) | 3–5 | 0.05 – 0.2 |
| Medium (bar charts, tables, slicers) | 8–15 | 0.2 – 1.0 |
| Complex (matrix, DAX-heavy measures, large datasets) | 15–25 | 1.0 – 5.0 |
| Timed out (render > 90s, large dataset cold-start) | — | 2.0 – 8.0 |

---

### SKU reference

| Fabric SKU | CUs | 5-min allocation | Recommended suite scenario |
|---|---|---|---|
| F2 | 2 | 600 CU-s | Metadata-only or <= 200 pages visual |
| F4 | 4 | 1,200 CU-s | Up to 500 pages visual (nightly CI) |
| F8 | 8 | 2,400 CU-s | Up to 1,500 pages visual |
| F16 | 16 | 4,800 CU-s | Up to 3,000 pages visual |
| P1 (~= F8) | 8 | 2,400 CU-s | Same as F8 |

---

### Practical guidance

- Run **metadata-only** (`npm test`) in any environment — zero capacity cost.
- For **nightly CI** on a real workspace: F4 is the safe floor for up to 500 report pages.
- **Schedule the visual run off-peak** (e.g. 02:00–04:00) to avoid competing with business-hours report usage.
- Use **focus mode** to reduce run time and total CU draw.
- The `--workers=1` flag (edit `playwright.config.ts`) halves parallelism and smooths CU draw if throttling is observed.
