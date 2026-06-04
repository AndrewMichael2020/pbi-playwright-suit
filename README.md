# pbi-playwright-suit

Lightweight Playwright-based Power BI quality suite.  
Catches the signals that break report visuals **before users notice them**.

---

## The Cost of Waiting for Customers to Tell You Your Reports Are Broken

*On proactive quality, the economics of reactive analytics operations, and what a lightweight test harness actually buys a modern data team.*

It begins with an email. A director, perhaps, or an operations manager who has been staring at a dashboard all morning, growing quietly uneasy. The numbers look wrong. The chart on the front page of the weekly performance report is blank. The total is frozen at last Tuesday's figure. She writes to the analytics team: *"Is the report working? The data doesn't seem right."* That email is not merely a support ticket. It is the sound of trust eroding.

In large enterprise analytics environments — organisations that have invested millions in Power BI licensing, data engineering pipelines, and the people who build and maintain them — this scenario plays out dozens of times a week. Not because the teams are careless. Because the tools, until recently, offered no systematic way to *know* that something was wrong before a user discovered it.

Consider the arithmetic of reactive operations. A team of one hundred analysts, developers, and data engineers is responsible for a portfolio of a thousand Power BI reports across a complex organisational workspace. Each report draws from one or more datasets. Each dataset refreshes on a schedule — nightly, hourly, sometimes continuously. At any given moment, a refresh may have failed silently, a source column may have been renamed by an upstream system, a gateway credential may have expired, or a relationship in the data model may have quietly admitted duplicate keys that now distort every visual that relies on it.

The team does not find out until a user does.

The investigation that follows is expensive in ways that compound. A senior developer — billing at the industry benchmark of two hundred dollars per hour — receives the email, opens the service, navigates to the dataset, inspects the refresh history, and begins the archaeology of finding where the failure originated. On average, diagnosis alone consumes between one and three hours, depending on the complexity of the model and the opacity of the error message. Resolution — patching the credential, coordinating with the source system owner, re-running the refresh, validating that the affected reports now render correctly — adds another two to four hours. A single incident, end to end, can consume six hours of senior developer time. At two hundred dollars an hour, that is twelve hundred dollars per incident.

In a portfolio of a thousand reports, if even five percent experience a silent failure in a given month — a conservative estimate, given that credential expirations alone affect a statistically significant share of enterprise datasets — the organisation absorbs fifty incidents. Fifty incidents at twelve hundred dollars each is sixty thousand dollars of unplanned remediation spend, per month, for a single workspace. Annualised, that figure approaches three-quarters of a million dollars. And that calculation accounts only for the developer time. It does not price the trust deficit — the senior stakeholder who quietly stops relying on the dashboard and defaults to spreadsheets — nor the compounding cost of decisions made on stale or wrong data.

The conventional response to this problem has been monitoring dashboards, scheduled email alerts from the Power BI Admin Portal, and informal "did you check the refresh?" culture. These are retrospective instruments. They tell a team what broke after it broke. They are structurally incapable of shifting the cost curve.

What shifts the cost curve is *continuous integration applied to analytical assets*.

The principle is not new in software engineering. A code change that breaks a unit test in a CI pipeline is caught in seconds — before it reaches production, before a user experiences a failure, before a support ticket is filed. The cost of that catch is effectively zero: a few seconds of compute, a notification, a fix. The cost of the same defect reaching production is an order of magnitude higher in every dimension — time, money, reputation, and cognitive burden on the team. The ratio is not two-to-one or five-to-one. Industry research consistently places it at twenty-to-one or higher.

This suite applies that same principle to a Power BI portfolio. It runs automatically — in a CI pipeline, on a schedule, or on demand before a deployment — and inspects every configured report and dataset for the specific, well-understood signals that cause visuals to fail. It does not attempt to be exhaustive. It targets the failure modes that account for the overwhelming majority of user-reported incidents: refresh failures that leave visuals serving stale data, data-integrity errors buried in historical refresh logs, model structural issues where duplicate key values cause wrong aggregations, and live render failures that the Power BI SDK itself surfaces when a page is embedded.

For the team of one hundred managing a thousand reports, the operational impact is direct. A pipeline that runs this suite nightly — a run that completes in minutes, not hours — surfaces the morning's broken reports as a clean, organised signal: *three datasets failed their refresh, one with a credential error that matches a known OAuth expiry pattern, one with a data-integrity violation that will corrupt the totals on four report pages.* That signal arrives before the director sends the email. A junior engineer triages it in fifteen minutes. The fix is targeted, not archaeological. The incident that would have cost twelve hundred dollars costs thirty.

If that shift — from six-hour reactive investigations to thirty-minute proactive resolutions — applies to even half the incidents in a month, the annualised savings for the team of one hundred exceed three hundred thousand dollars in developer time alone. That figure assumes no improvement in stakeholder trust, no reduction in decisions made on wrong data, no acceleration in the feedback loops that make a data team strategically valuable rather than operationally defensive. It assumes only that engineers spend less time hunting for fires that an automated system could have flagged before the smoke appeared.

The return on that investment is not marginal. It is structural. And it compounds.

---

Two run modes:

| Mode | When to use |
|---|---|
| **Dry run** | Validates suite logic against committed mock fixtures. No credentials, no browser. Runs anywhere — CI, Codespaces, local. |
| **Enterprise run** | Connects to a live Power BI tenant, interrogates refresh history and model structure via REST API, and smoke-tests rendered report pages via Playwright. |

---

## What the suite checks

The suite focuses exclusively on signals that cause Power BI visuals to render **wrong data, stale data, or no data at all**.

| ID | Signal | Why it matters |
|---|---|---|
| **RH-002** | Latest dataset refresh status is `Failed`, `Disabled`, `Cancelled`, or `Unknown` | Visuals are serving data from the last successful refresh — potentially days or weeks stale |
| **RH-003** | Any historical refresh entry contains a data-integrity or credential error pattern | Patterns like `MonikerWithUnboundDataSources`, `OAuth`, `duplicate key`, `primary key`, `RowValueConflict` indicate broken data or auth that causes wrong or empty visuals |
| **MS-001** | A Many-to-Many relationship is not in the intentional allowlist | The "dimension" table has non-unique key values — Power BI resolves M:M internally but filter propagation changes, causing wrong visual totals |
| **VS-NNN** | A report page embed raises a Power BI SDK visual error | Broken measures, missing fields, unconstrained joins, or credential failures detected at render time |

Checks **not** in scope: RLS scenarios, inactive relationships, datasource connection details, bidirectional cross-filter warnings, threshold-based staleness timers.

---

## Quick start — dry run (no credentials, no browser)

```powershell
git clone https://github.com/AndrewMichael2020/pbi-playwright-suit
cd pbi-playwright-suit
npm install
npm test
```

All 47 fixture-based tests run and pass.  Visual enterprise tests auto-skip when no enterprise config is present.

---

## Enterprise run (live Power BI, Windows)

### Prerequisites

- Node 18+ (Node 20+ recommended)
- Google Chrome or Microsoft Edge installed (no download required)
- An organisational account with at least **Viewer** access to the target workspace

### 1 — Connect and configure

```powershell
npm run setup
```

`setup` runs an interactive wizard:

1. Signs you in via **device-flow** (browser opens `https://login.microsoft.com/device`)
2. Lists your workspaces — enter a number or type to search
3. Lists reports in that workspace — select one or more
4. Lists pages in each report — select all or specific pages
5. Asks **what to check** — shows a focus menu so you can skip unrelated tests on large workspaces:

```
  What do you want to check?  (12 test config(s) queued)

   [ 1]  All signals                   — run every check
   [ 2]  Broken visuals only           — render errors, SDK failures
   [ 3]  Broken refresh (latest)       — latest refresh status is not Completed
   [ 4]  Credential / auth errors      — OAuth, unbound data source, login failure
   [ 5]  Duplicate PK / M:M errors     — unallowlisted Many-to-Many relationships
   [ 6]  Data-integrity errors          — duplicate key, RowValueConflict in history
   [ 7]  Refresh health (all signals)  — RH-002 + RH-003 combined
   [ 8]  Model integrity               — MS-001 only
   [ 9]  Quick triage                  — RH-002 + MS-001, fast scan of breakage

  Enter number (1–10):
```

6. Confirms config and optionally runs tests immediately

### 2 — Run tests

```powershell
npm test
```

Or, if you chose "Run now?" in setup, tests run automatically.

### What setup writes

- `playwright/config/enterprise.generated.json` — report/page list (gitignored)
- `playwright/config/enterprise.focus.json` — selected focus (gitignored)

Neither file is committed.  Pull and re-run `npm run setup` after a `git pull` that adds new reports.

> **Do NOT run `npm run install:browsers` on Windows.**  
> The enterprise run uses your existing system Chrome or Edge.

---

## Model baseline workflow

The MS-001 check compares the live model structure against a committed JSON baseline.  
Generating and maintaining the baseline is a one-time step per report.

### 1 — Export model metadata

Use a Python metadata script (or the Power BI REST API) to export a `.txt` file describing the model's tables, columns, and relationships.

### 2 — Ingest into a baseline

```powershell
npm run ingest:model-txt -- "MyReport.txt"
```

This writes `playwright/fixtures/snapshots/model-baseline/my-report.json` and commits it.

On subsequent runs, if the model has changed (new M:M relationship, removed table, cardinality change), the script prints a drift report and exits `1`.

### 3 — Review and allowlist intentional changes

Open the baseline JSON and add any intentional M:M relationships to `intentionalManyToMany`:

```json
"intentionalManyToMany": [
  "Date::DateKey → Calendar Bridge::DateKey",
  "User Access::Region → Customer::Region"
]
```

Commit the updated baseline.  The test will pass on the next run.

---

## CI integration

### GitHub Actions (Linux runner — installs Chromium once)

```yaml
name: PBI Quality Suite

on:
  schedule:
    - cron: '0 6 * * *'   # 06:00 UTC daily
  workflow_dispatch:

jobs:
  dry-run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install chromium --with-deps
      - run: npm run typecheck
      - run: npm test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: dry-run-report
          path: playwright-report/

  enterprise:
    needs: dry-run
    runs-on: ubuntu-latest
    environment: power-bi-prod       # store secrets here
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install chromium --with-deps
      - run: npm test
        env:
          PBI_TENANT_ID:     ${{ secrets.PBI_TENANT_ID }}
          PBI_CLIENT_ID:     ${{ secrets.PBI_CLIENT_ID }}
          PBI_CLIENT_SECRET: ${{ secrets.PBI_CLIENT_SECRET }}
          PBI_ENVIRONMENT:   Public
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: enterprise-report
          path: playwright-report/
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: test-results/
```

### Azure DevOps (on-prem, self-hosted agent with Chrome)

See [`docs/architecture/ci_deployment_plan.md`](docs/architecture/ci_deployment_plan.md) for the full ADO pipeline YAML with service-principal auth and artifact publishing.

### CI mode — no interactive setup needed

Commit `playwright/config/enterprise.generated.json` from a local `npm run setup` run, or generate it in CI with env vars:

```yaml
env:
  PBI_WORKSPACE_NAME: Analytics Workspace
  PBI_REPORT_NAME:    Regional Metrics
```

The suite reads those vars in non-interactive mode and skips the interactive prompts.

---

## Understanding test results

| Outcome | Meaning |
|---|---|
| ✅ passed | No visual error, refresh healthy, model structure clean |
| ❌ RH-002 | Latest refresh is Failed / Disabled — visuals are stale |
| ❌ RH-003 | Refresh history contains data-integrity or credential errors |
| ❌ MS-001 | Unallowlisted Many-to-Many — possible duplicate PK data |
| ❌ VS-NNN visual error | SDK error at render time — broken measure, missing field, or auth failure |
| ⏭ skipped | Focus excludes this check, or enterprise config not present |

Each failed test has a **screenshot**, **video**, and **trace** attached.  
For `RH-*` and `MS-*` failures, annotations detail the specific error code and relationship key.

```powershell
npx playwright show-report
npx playwright show-trace test-results/<folder>/trace.zip
```

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CLIENT_ID` | built-in public client | AAD app registration client ID |
| `TENANT_ID` | — | Restrict to a specific Azure AD tenant |
| `PBI_CLIENT_SECRET` | — | Client secret for service principal (CI) |
| `PBI_WORKSPACE_NAME` | — | Non-interactive: target workspace name |
| `PBI_REPORT_NAME` | — | Non-interactive: target report name |
| `PBI_DATASET_NAME` | same as report | Override dataset name |
| `PBI_PAGE_NAME` | first page | Override page display name |
| `PBI_ENVIRONMENT` | `Public` | Azure cloud (`Public`, `USGov`, `China`, …) |
| `PBI_TOKEN_CACHE_FILE` | auto | Path to MSAL token cache |
| `PBI_BROWSER_CHANNEL` | `chrome` | `chrome` or `msedge` |

---

## Repository layout

```text
playwright/
  config/
    enterprise.generated.json     # written by npm run setup — gitignored
    enterprise.focus.json         # written by npm run setup — gitignored
    environments/                 # environment endpoint maps
  fixtures/snapshots/
    model-baseline/               # committed model structure baselines (JSON)
    model-signatures/             # committed schema drift baselines (JSON)
    refresh-history/              # mock refresh fixtures for dry-run tests
    enterprise-config/            # sample enterprise config shape (reference only)
  helper-functions/
    enterprise-config.ts          # load/save enterprise.generated.json
    focus.ts                      # focus menu definitions + routing matrix
    powerbi-enterprise.ts         # REST API helpers (auth, refresh history, embed token)
    refresh-health.ts             # refresh history analysis + data-integrity scanning
    signature-diff.ts             # schema drift comparison
    source-extraction.ts          # SQL extraction from M expressions
    duplicate-checks.ts           # duplicate heuristic helpers
    types.ts                      # shared TypeScript types
  tests/
    metadata/                     # dry-run fixture-based tests
      fixture-contracts.spec.ts
      refresh-health.spec.ts
      schema-drift.spec.ts
      source-extraction.spec.ts
      duplicate-checks.spec.ts
      model-structure.spec.ts     # MS-001 against committed baseline
    visual/                       # enterprise live tests
      dataset-health.spec.ts      # RH-002, RH-003
      report-pages.spec.ts        # VS-NNN visual smoke
  global/global-setup.ts
scripts/
  setup.ts                        # interactive setup wizard
  ingest-model-txt.ts             # model .txt → JSON baseline + drift detection
docs/
  architecture/
    playwright_test_strategy.md
    ci_deployment_plan.md
    work_status.md
```

---

## Troubleshooting

### `ENOENT: enterprise.generated.json`

Run `npm run setup` first.

---

### Sign-in code appears and the terminal returns immediately

Expected.  Open `https://login.microsoft.com/device`, enter the code, sign in, then re-run.

---

### `uuid@8.3.2` deprecation warning during `npm install`

Fixed — the repo now uses `@azure/msal-node@^5.2.2`.  Pull and reinstall:

```powershell
git pull && npm install
```

---

### `ERR_UNSUPPORTED_ESM_URL_SCHEME` on Windows mapped network drives

This crashes when running scripts on a network path like `M:\`.  
Fix: clone or copy the repo to a **local drive** (`C:\`, `D:\`, etc.) before running.

---

### `Playwright Host validation warning: api-ms-win-core-apiquery-l2-1-0.dll`

This warning appears when Playwright validates its bundled Chromium on Windows.  
It does **not** affect your system Chrome.  If you are using system Chrome, ignore it.

---

### Test skipped with "XMLA permissions"

Your Power BI admin needs to enable the XMLA endpoint:  
**Power BI Admin Portal → Workspaces → (workspace) → Dataset settings → XMLA endpoint → Read**.

---

## Refreshing node_modules (Windows PowerShell)

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

