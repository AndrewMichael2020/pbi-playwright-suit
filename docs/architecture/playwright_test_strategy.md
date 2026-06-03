# Power BI Workspace Test Strategy

## 1. Refined objective

This strategy is intentionally reset to match the current priority:

- **Build a simple, reusable suite for any Power BI report in the workspace**
- **Start with basic but valuable checks**
- **Focus on refresh health, schema drift, and broken visuals**
- **Do not overinvest in RLS-heavy or highly bespoke report behavior yet**

The suite should be easy to move from Codespaces into an enterprise pipeline with minimal change.

---

## 2. What changed from the earlier direction

The first draft leaned too far toward report-specific UI behavior and persona concerns. That is not the right starting point now.

The refined starting point is:

1. **workspace-wide visual smoke coverage**
2. **refresh-history health checks**
3. **semantic-model schema signature checks**
4. **duplicate/error-pattern checks**

This still uses Playwright as the main automation harness, but the suite must include **metadata assertions** in addition to browser assertions.

---

## 3. Inputs used for this strategy

### 3.1 Current repository artifacts

- `UPCC Dashboard.pbip`
- `UPCC Dashboard.txt`
- `legacy_discover_upcc_v14_fixed_v5.py`
- `legacy_concept_powerbi_meta.md`

### 3.2 Reference baseline

The repository `kerski/pbi-dataops-visual-error-testing` is the best starting reference for the harness shape.

Useful elements from that reference:

- Playwright as the execution engine
- a simple config + global setup model
- generated test-case records
- service-principal-based live execution
- broken visual detection through report embed/render checks

What to keep from it:

- **simple harness shape**
- **test-case driven execution**
- **workspace/report/page level coverage**
- **CI-friendly packaging**

What not to copy blindly:

- highly report-page-specific assumptions
- treating visual render success as the only quality signal
- relying only on live service execution when Codespaces is isolated

### 3.3 PBIP observation

The dropped PBIP file confirms the project anchor:

- report path: `UPCC Dashboard.Report`

At the moment, only the `.pbip` manifest is present in the repo, not the report folder contents. That means the current plan can use PBIP as **project context**, but not yet as a full source of page and visual definitions.

---

## 4. Suite scope

The suite should cover a Power BI workspace through two lanes.

### 4.1 Lane A: Visual smoke lane

Purpose:

- confirm that reports/pages render
- detect broken visuals or embed failures
- provide a thin browser-level quality gate

This is where Playwright is the primary engine.

### 4.2 Lane B: Model health lane

Purpose:

- detect refresh failures
- inspect refresh history over a recent window such as 7 days
- detect schema drift
- detect fragile source-extraction changes
- detect duplicate or suspicious model structures

This lane can be implemented in TypeScript helpers and, where pragmatic, PowerShell/XMLA-assisted generation inspired by the reference repo.

### 4.3 Why both lanes are needed

A report can render and still be unhealthy:

- refresh may have failed yesterday
- source columns may have changed
- table/column definitions may have drifted
- M/SQL extraction may have changed unexpectedly
- duplicate model objects may introduce ambiguity or broken visuals later

So the suite should not be “only Playwright pages”. It should be a **Power BI report quality suite** with Playwright as the execution backbone.

---

## 5. Recommended starting architecture

## 5.1 Keep the harness light

Use the kerski structure as the baseline, then extend only where needed.

Recommended top-level structure:

```text
docs/
  architecture/
    playwright_test_strategy.md

playwright/
  config/
    environments/
      sandbox.json
      enterprise-uat.json
  fixtures/
    snapshots/
      workspace/
      refresh-history/
      model-signatures/
  helper-functions/
    auth/
    powerbi-rest/
    powerbi-xmla/
    signatures/
    comparisons/
    logging/
  test-cases/
    reports.csv
    workspace-models.json
  tests/
    visual/
      workspace-visual-smoke.spec.ts
    metadata/
      refresh-health.spec.ts
      schema-drift.spec.ts
      duplicate-checks.spec.ts
  global/
    global-setup.ts
playwright.config.ts
package.json
```

This is deliberately flatter than a large enterprise UI framework.

---

## 6. Baseline from the kerski repository

The kerski repository is a good template because it already proves:

- Power BI tests can be **test-case driven**
- Playwright works well as the runner
- report embed/render validation is a useful smoke gate
- CI packaging can stay small

### 6.1 What to adopt directly

1. **Playwright configuration pattern**
2. **global setup entry point**
3. **helper-functions split**
4. **test-case driven execution**
5. **pipeline-friendly outputs**

### 6.2 What to extend

Add new helper areas for:

- refresh-history retrieval
- semantic-model signature capture
- drift comparison against a stored baseline
- duplicate detection rules
- source extraction comparison from partitions/M/SQL

### 6.3 What to postpone

Do not start with:

- large Page Object Model hierarchies
- deep persona libraries
- RLS-specific scenario matrices
- custom UI interaction libraries for every report type

Those can come later if the suite proves useful.

---

## 7. Core checks for the first usable version

The first version should answer basic operational questions for **any report in the workspace**.

### 7.1 Visual smoke checks

For each report/page test case:

- can the report be embedded or opened?
- does the page render?
- does the render emit known visual error states?
- does the page show a common Power BI error banner/modal/text pattern?

This follows the kerski model closely.

### 7.2 Refresh health checks

Use Power BI REST refresh history to inspect at least the last 7 days.

Minimum checks:

- latest refresh status
- whether any refresh failed in the last 7 days
- failure code and normalized failure message
- count of failures in the inspection window
- timestamp of last successful refresh

This directly aligns to the existing legacy logic that parses `serviceExceptionJson` and nested failure payloads.

### 7.3 Schema drift checks

Capture a baseline signature for each semantic model and compare it on future runs.

Minimum signature surface:

- tables
- columns
- measures
- partitions
- relationships
- roles if present, but only as metadata, not as primary test focus

For partitions and source definitions, capture:

- source type
- M expression when visible
- extracted SQL when visible

This is especially important because the legacy extraction is fragile and should be tested rather than assumed.

### 7.4 Duplicate and suspicious structure checks

Add simple checks for:

- duplicate table names
- duplicate measure names in unexpected scopes
- duplicate extracted source patterns where one definition appears copied or drifted
- duplicate relationship patterns
- excessive auto-date style artifacts or duplicate date logic when detectable

These should begin as **warnings/fail-fast rules** only where the signal is clear.

---

## 8. Live mode and sandbox mode

The suite should still support both sandbox and enterprise execution, but in a simpler form than the earlier draft.

## 8.1 Enterprise live mode

This is the primary target mode.

Use:

- service principal
- Power BI REST
- XMLA endpoint where allowed
- generated or curated report test cases

This matches both the reference repo and your legacy extraction workflow.

## 8.2 Sandbox mode

Because Codespaces is isolated, sandbox mode should not attempt to fully recreate real Power BI browser behavior at first.

Instead, sandbox mode should focus on:

- validating the harness wiring
- validating parsers and comparison logic
- validating stored snapshot comparisons
- validating mock refresh history parsing
- validating failure normalization rules

For the browser layer, sandbox mode can use a small set of canned/mock payloads later, but that is **not** the first priority.

### 8.3 Important simplification

Do not spend early effort building a full fake Power BI shell.

The first useful sandbox value is in:

- metadata parser tests
- diff logic tests
- refresh-history rule tests

That is much cheaper and better aligned to the current goal.

---

## 9. Data contracts

The suite should be driven by a few compact artifacts.

### 9.1 Report case file

For visual tests:

```csv
workspace_id,report_id,report_name,page_id,page_name,dataset_id,enabled
```

This mirrors the kerski approach and keeps report coverage generic.

### 9.2 Workspace model inventory file

For metadata checks:

```json
{
  "workspaceId": "<guid>",
  "workspaceName": "FHA-ADAR-BI-UAT",
  "models": [
    {
      "datasetId": "<guid>",
      "datasetName": "UPCC Dashboard"
    }
  ]
}
```

### 9.3 Refresh signature file

Per model:

```json
{
  "datasetId": "<guid>",
  "windowDays": 7,
  "latestStatus": "Completed",
  "lastSuccessTime": "2026-05-10T18:06:34.967Z",
  "failureCount": 1,
  "failures": [
    {
      "time": "2026-03-11T18:21:51.45Z",
      "code": "ModelRefresh_ShortMessage_ProcessingError",
      "message": "Failed to get OAuth resource id, please make sure the OAuth is supported"
    }
  ]
}
```

### 9.4 Model signature file

Per dataset/model:

```json
{
  "datasetId": "<guid>",
  "datasetName": "UPCC Dashboard",
  "tables": [],
  "relationships": [],
  "partitions": [],
  "measures": [],
  "sourceSignatures": []
}
```

These files become the transfer-friendly contract between environments.

---

## 10. How to use the legacy script experience

The legacy script is valuable mainly as a **source of tested extraction logic**, not as the runtime architecture itself.

### 10.1 Keep these ideas

1. refresh history parsing and nested error extraction
2. XMLA/TOM for semantic-model structure
3. ADOMD/DMVs where storage or model internals matter
4. M-to-SQL extraction for visible source logic
5. explicit handling of fragile/nullable metadata access

### 10.2 Convert them into suite checks

Instead of only producing a text dump, the new suite should:

- collect signatures
- compare signatures to baseline snapshots
- fail or warn when differences exceed defined rules

### 10.3 Suggested first comparison rules

- new table added
- table removed
- column added
- column removed
- data type changed
- measure expression changed
- relationship changed
- partition source type changed
- extracted SQL changed
- refresh failed within inspection window

This is more useful than a static export alone.

---

## 11. Duplicate detection strategy

The duplicate checks should stay simple at first.

Recommended starting rules:

1. duplicate logical table names
2. duplicate visible measure names within the same table
3. duplicate extracted SQL blocks across partitions where duplication is unexpected
4. suspicious duplicate relationship edges between the same table-column pairs
5. repeated local date artifacts or duplicate calendar-like structures

Output should distinguish:

- **error**: likely invalid or breaking
- **warning**: likely technical debt or drift
- **info**: interesting but not yet actionable

---

## 12. Recommended test lanes in Playwright

Even metadata checks can still live in Playwright tests for consistency.

### 12.1 `tests/visual/workspace-visual-smoke.spec.ts`

Responsibilities:

- iterate report/page test cases
- obtain embed/open target
- verify render success
- detect known visual error patterns

### 12.2 `tests/metadata/refresh-health.spec.ts`

Responsibilities:

- query refresh history
- normalize failure payloads
- enforce rules for latest status and 7-day history

### 12.3 `tests/metadata/schema-drift.spec.ts`

Responsibilities:

- capture current semantic-model signature
- compare to baseline snapshot
- emit diffs clearly

### 12.4 `tests/metadata/duplicate-checks.spec.ts`

Responsibilities:

- run duplicate heuristics
- classify issues

This keeps the suite unified while still separating concerns cleanly.

---

## 13. Authentication and environment handling

### 13.1 Live mode

Use the reference approach:

- service principal
- tenant-aware endpoint resolution
- REST for workspace/report/dataset/refresh calls
- XMLA for model structure access

### 13.2 Sandbox mode

Use stored snapshots and mock payloads for:

- refresh history
- model signatures
- diff test cases

Do not require enterprise login for local parser and drift-validation work.

### 13.3 Keep environment binding outside tests

Environment values must stay in:

- `.env`
- environment manifests
- pipeline secrets

Never hardcode:

- workspace IDs
- report IDs
- dataset IDs
- tenant IDs

---

## 14. Transferability mechanics

To keep the solution drag-and-drop friendly:

1. keep the suite driven by CSV/JSON inputs
2. keep auth/environment data external
3. keep schema snapshots as plain JSON
4. keep helper functions small and composable
5. keep report-specific logic out of the base harness

The ideal enterprise move should require only:

- copying the package
- supplying secrets/manifests
- generating or curating test-case files
- running Playwright in CI

---

## 15. What not to overengineer now

Avoid these in the first implementation:

- full workspace-wide POM catalog
- complicated locator abstraction layers
- advanced persona/RLS orchestration
- a complete offline clone of Power BI Service
- speculative visual interaction libraries before there are real use cases

The suite should earn complexity only after the first checks prove useful.

---

## 16. Suggested phased implementation

### Phase 1: harness bootstrap

- initialize Playwright project
- lift the simple kerski-style structure
- add environment and logging helpers

### Phase 2: workspace visual smoke

- create report/page test cases
- implement render/broken-visual checks
- produce CI-friendly HTML/JUnit output

### Phase 3: refresh health

- add REST refresh-history retrieval
- normalize failure messages using the legacy logic pattern
- add 7-day failure window assertions

### Phase 4: schema signatures

- capture tables, columns, measures, partitions, relationships
- capture visible M and extracted SQL
- save baseline snapshots

### Phase 5: drift and duplicate rules

- compare current snapshots to baseline
- add duplicate heuristics
- classify warnings vs failures

### Phase 6: optional report-specific behavior later

- only after the generic suite is valuable
- only for reports that justify deeper UI testing

---

## 17. Immediate recommendation

Build the suite as a **small Power BI workspace quality harness**:

- **Playwright for visual smoke**
- **REST/XMLA helpers for refresh and schema checks**
- **CSV/JSON-driven inputs**
- **snapshot comparison for drift**
- **kerski repo as the structural baseline**
- **legacy extraction logic reused only where it adds hard-won value**

That is the right “basic to start with” architecture: broad enough for any report in the workspace, useful for fragile schema and refresh concerns, and still compact enough for enterprise transfer.

---

## 18. Comprehensive UPCC test catalog

The first implementation is scoped to the **UPCC Dashboard** report only, but the tests should still be written in a way that can later generalize to other reports in the workspace.

### 18.1 Test lane A: visual smoke

These tests are intentionally thin and generic.

| Test ID | Name | Goal | Mode | Initial status |
|---|---|---|---|---|
| VS-001 | UPCC report target resolves | Confirm the configured UPCC report target can be constructed from test case inputs | sandbox + live | implement now |
| VS-002 | UPCC page case file is valid | Validate report/page test case structure and required fields | sandbox + live | implement now |
| VS-003 | UPCC report page renders without known visual error patterns | Detect broken visuals, error banners, permission modals, resource-limit messages, and common Power BI error text | live first | scaffold now, enable later |
| VS-004 | UPCC report page emits rendered state | Confirm render lifecycle completes for an embedded/opened report page | live first | scaffold now, enable later |
| VS-005 | UPCC report page has no known field/relationship error text | Catch classic broken-visual failures caused by missing fields or relationship ambiguity | live first | scaffold now, enable later |

### 18.2 Test lane B: refresh health

These tests are the first high-value metadata checks.

| Test ID | Name | Goal | Mode | Initial status |
|---|---|---|---|---|
| RH-001 | Refresh history fixture or payload parses | Prove refresh-history input can be parsed into normalized structure | sandbox + live | implement now |
| RH-002 | Latest refresh status is present | Ensure the latest refresh status is available and non-empty | sandbox + live | implement now |
| RH-003 | Latest refresh status is operationally acceptable | Fail when latest status is in a blocked state such as Failed or Disabled | sandbox + live | implement now |
| RH-004 | Seven-day refresh history window is evaluated | Ensure the rule engine inspects the configured lookback window, default 7 days | sandbox + live | implement now |
| RH-005 | Refresh failures are counted correctly | Verify failure count over the inspection window | sandbox + live | implement now |
| RH-006 | Nested serviceExceptionJson is normalized | Extract stable failure code/message from nested refresh error payloads | sandbox + live | implement now |
| RH-007 | Last successful refresh timestamp is retained | Preserve operational recovery signal even when there are historical failures | sandbox + live | implement now |
| RH-008 | Historical failure message remains detectable | Ensure known UPCC failure patterns remain visible after normalization | sandbox + live | implement now |

### 18.3 Test lane C: schema signature and drift

These tests create the baseline discipline for fragile model changes.

| Test ID | Name | Goal | Mode | Initial status |
|---|---|---|---|---|
| SD-001 | UPCC metadata file parses into model signature | Convert `UPCC Dashboard.txt` into structured signature data | sandbox | implement now |
| SD-002 | Baseline model signature file is valid | Ensure committed signature JSON is structurally sound | sandbox + live | implement now |
| SD-003 | Table inventory matches baseline | Detect added/removed tables | sandbox + live | implement now |
| SD-004 | Column inventory matches baseline | Detect added/removed columns | sandbox + live | implement now |
| SD-005 | Measure inventory matches baseline | Detect added/removed measures | sandbox + live | implement now |
| SD-006 | Relationship inventory matches baseline | Detect changed relationship edges, cardinality, activity, or direction | sandbox + live | implement now |
| SD-007 | Partition source types match baseline | Detect changes between M/query/calculated partition sources | sandbox + live | implement now |
| SD-008 | Extracted SQL signatures match baseline | Detect changes in visible source SQL after normalization | sandbox + live | implement now |
| SD-009 | Auto-date and hidden support artifacts are classified, not mistaken for drift | Avoid false alarms for known internal patterns | sandbox + live | implement now |
| SD-010 | Drift output is human-readable | Ensure diffs are grouped into added, removed, and changed sets | sandbox + live | implement now |

### 18.4 Test lane D: SQL and source extraction reliability

These tests protect the most fragile extraction logic inherited from the legacy script.

| Test ID | Name | Goal | Mode | Initial status |
|---|---|---|---|---|
| SE-001 | `Query=\"...\"` SQL block can be extracted from M | Reproduce the legacy extraction seam in TypeScript | sandbox | implement now |
| SE-002 | Power BI line-feed and tab escapes are normalized | Convert `#(lf)`, `#(tab)`, `#(cr)` into stable SQL text | sandbox | implement now |
| SE-003 | Double-quoted M escapes are normalized | Convert `\"\"` semantics into stable SQL text | sandbox | implement now |
| SE-004 | Missing SQL block returns null cleanly | Avoid false positives when M has no native SQL query | sandbox | implement now |
| SE-005 | SQL normalization is stable for large UPCC partition queries | Prevent whitespace-only drift noise | sandbox + live | implement now |

### 18.5 Test lane E: duplicate and suspicious-structure checks

These tests should begin as low-noise heuristics, not aggressive failures.

| Test ID | Name | Goal | Mode | Initial status |
|---|---|---|---|---|
| DU-001 | Duplicate logical table names are detected | Catch invalid repeated table identities | sandbox + live | implement now |
| DU-002 | Duplicate visible measure names per table are detected | Catch ambiguous repeated measures | sandbox + live | implement now |
| DU-003 | Duplicate relationship edges are detected | Catch repeated from/to table-column pairs | sandbox + live | implement now |
| DU-004 | Duplicate extracted SQL signatures are reported | Surface copied or unexpectedly repeated source definitions | sandbox + live | implement now |
| DU-005 | Known internal support-column patterns are allowlisted | Avoid false positives for Power BI hidden row-number columns | sandbox + live | implement now |
| DU-006 | Known intentionally inactive relationships are allowlisted | Avoid false positives where inactive relationships are part of model design | sandbox + live | implement now |

### 18.6 Fixture and contract validation tests

These keep the suite maintainable.

| Test ID | Name | Goal | Mode | Initial status |
|---|---|---|---|---|
| FX-001 | UPCC report case file is parseable | Prevent broken CSV/JSON test case inputs | sandbox + live | implement now |
| FX-002 | UPCC refresh snapshot matches contract | Prevent malformed refresh fixture files | sandbox + live | implement now |
| FX-003 | UPCC model signature snapshot matches contract | Prevent malformed schema baseline files | sandbox + live | implement now |
| FX-004 | Environment manifest parses cleanly | Keep configuration external and validated | sandbox + live | implement now |

### 18.7 Execution order for the first build

Build and enable the first set of executable tests in this order:

1. `FX-*` contract tests
2. `SE-*` source extraction tests
3. `RH-*` refresh health tests
4. `SD-*` schema signature and drift tests
5. `DU-*` duplicate-check tests
6. `VS-*` visual smoke scaffolding, initially skipped outside enterprise execution

This order maximizes immediate value in the isolated Codespaces environment while preserving the path to live visual testing later.
