# Power BI Playwright Quality Suite — Test Strategy

## 1. Objective

Build a **simple, configuration-driven suite** that catches every signal that can make a Power BI report visual render wrong data, stale data, or no data at all — for **any report in any workspace**, without requiring report-specific automation code.

The suite is not a general UI test harness.  It is a **Power BI health monitor** that uses Playwright as its execution backbone.

---

## 2. The three signals that break visuals

These are the only signals the suite asserts on.  Everything else is noise.

| ID | Signal | Root cause |
|---|---|---|
| **RH-002** | Latest dataset refresh is `Failed`, `Disabled`, `Cancelled`, or `Unknown` | Visuals are reading from a stale or empty dataset |
| **RH-003** | Any entry in refresh history matches a data-integrity or credential error pattern | Broken data, broken auth, or duplicate key values in source causing bad aggregations |
| **MS-001** | A Many-to-Many relationship is not in the intentional allowlist | A dimension table has non-unique key values; filter propagation changes; visual totals are wrong |
| **VS-NNN** | A report page embed raises a Power BI SDK visual error | Broken measure, missing field, unconstrained join, or credential failure at render time |

---

## 3. Two-lane architecture

### Lane A — Visual smoke (enterprise only)

- Playwright embeds the report page using a per-report embed token
- The Power BI JavaScript SDK fires `rendered` or `error` events
- Any SDK error code is treated as a test failure
- One Playwright test per report page (`VS-001`, `VS-002`, …)

### Lane B — Dataset health (enterprise + dry-run)

- **RH-002 / RH-003**: call the Power BI REST refresh history endpoint; analyse status codes and error messages in-process (no browser needed)
- **MS-001**: compare the committed model baseline JSON against the live model; detect new unallowlisted M:M relationships
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
    model-baseline/             # committed — one JSON per report model
    model-signatures/           # committed — schema drift baselines
    refresh-history/            # committed — mock fixtures for dry-run
    enterprise-config/          # committed — sample shape for reference
  helper-functions/
    powerbi-enterprise.ts       # REST API: auth, refresh history, embed token, datasources
    refresh-health.ts           # refresh history analysis + data-integrity error scanning
    enterprise-config.ts        # load/save enterprise.generated.json
    focus.ts                    # focus menu: 9 named options + routing matrix
    signature-diff.ts           # schema drift comparison
    source-extraction.ts        # SQL extraction from M partition expressions
    duplicate-checks.ts         # duplicate heuristic helpers
    types.ts                    # shared TypeScript types
    env-loader.ts               # .env loading
    file-reader.ts              # fixture file helpers
  tests/
    metadata/                   # dry-run (no credentials, no browser)
      fixture-contracts.spec.ts
      refresh-health.spec.ts
      schema-drift.spec.ts
      source-extraction.spec.ts
      duplicate-checks.spec.ts
      model-structure.spec.ts   # MS-001 against committed baseline
    visual/                     # enterprise (live Power BI)
      dataset-health.spec.ts    # RH-002, RH-003
      report-pages.spec.ts      # VS-NNN visual smoke
  global/global-setup.ts
scripts/
  setup.ts                      # interactive setup wizard (focus menu + config)
  ingest-model-txt.ts           # .txt export → JSON baseline + drift detection
```

---

## 5. Focus system

`npm run setup` ends with a **focus selection menu** — 9 named options that let the developer skip unrelated checks when running across large workspaces:

| Focus | Runs |
|---|---|
| All signals | RH-002, RH-003, MS-001, VS-NNN |
| Broken visuals only | VS-NNN |
| Broken refresh (latest) | RH-002 |
| Credential / auth errors | RH-003 (credential patterns only) |
| Duplicate PK / M:M errors | MS-001 |
| Data-integrity errors | RH-003 (data-integrity patterns only) |
| Refresh health (all signals) | RH-002 + RH-003 |
| Model integrity | MS-001 |
| Quick triage | RH-002 + MS-001 |

Focus is persisted to `playwright/config/enterprise.focus.json` (gitignored).  Each spec reads this at start time and calls `test.skip()` for out-of-scope tests.

---

## 6. Model baseline workflow

The MS-001 check requires a committed JSON baseline per report model.

1. Export model metadata to a `.txt` file (via Python REST/XMLA script or manual export)
2. Run `npm run ingest:model-txt -- "MyReport.txt"` to parse and write the baseline JSON
3. On re-run, the ingest script compares the new export against the committed baseline and exits 1 with a drift report if structural changes are found
4. Review the drift report; if the change is intentional, add the relationship key to `intentionalManyToMany` in the baseline JSON and commit
5. The test passes on the next run

The baseline fixture ships with a generic `sample-model-baseline.json` demonstrating the shape.

---

## 7. Design decisions and constraints

| Decision | Rationale |
|---|---|
| No threshold env vars for staleness or failure count | Every broken refresh is a signal; thresholds produced false negatives |
| RH-001 (refresh history exists) removed | Not a visual breakage signal |
| DS-001 (datasource connection details) removed | REST endpoint unreliable across dataset types; RH-003 catches credential failures via history |
| MS-002 (bidirectional cross-filter) removed | Performance concern, not a direct visual breakage signal |
| Inactive relationships ignored | Not a visual breakage signal |
| `tsx/cjs` require hook instead of `tsx` direct | Node 18 ESM loader crashes on Windows mapped network drives (`M:`) due to URL scheme parsing |
| Model baseline is committed JSON, not live XMLA | Allows dry-run in isolated environments; XMLA requires enterprise connectivity |
| One test per dataset for health checks | Avoids duplicate API calls when a report has many pages |

---

## 8. What is deliberately out of scope

- Large Page Object Model hierarchies
- Deep persona / RLS scenario matrices
- Custom UI interaction libraries per report type
- Offline Power BI browser simulation
- XMLA TOM scripting **inside the test runner** — model metadata is imported from an external script output (`.txt → JSON baseline`) via `npm run ingest:model-txt`, not executed in-process
- Any assertion that requires knowing report-specific visual names or layout

---

## 9. Reference baseline

The kerski `pbi-dataops-visual-error-testing` repository provided the harness shape:

- Playwright as the execution engine
- config + global setup model
- test-case driven execution with VS-NNN IDs
- service-principal-based live execution
- broken visual detection via embed/render SDK events

This suite adopts those patterns and extends them with the dataset health lane.
