# CI Deployment Plan — Validate Now, Unattended Enterprise Later

## Purpose

Run the Playwright Power BI quality suite automatically on a schedule, publish results as artifacts, and keep the documentation honest about what is and is not automated yet.

**Current reality:** the codebase supports **device-flow auth with an MSAL token cache**. That is enough for local enterprise runs and some trusted self-hosted scenarios, but it is **not** the same as unattended client-secret/service-principal CI. The validate stage is ready today; unattended enterprise CI is a planned next step.

---

## Architecture overview

```
Pipeline (scheduled — daily or on-demand)
  │
  ├─ Stage 1: validate   (current — no credentials, fast, catches suite regressions)
  └─ Stage 2: enterprise (planned — unattended live Power BI checks once confidential auth exists)
       │
       └─ Artifacts
            ├─ playwright-report/  (HTML — visual diff, annotations, traces)
            ├─ test-results/       (JUnit XML + screenshots)
            └─ pbi-export/         (JSON → optional Power BI push dataset)
```

---

## Option A — GitHub Actions (recommended for GitHub-hosted repos)

### Current working setup

The GitHub-hosted path that works today is the **validate** job only.

### `.github/workflows/pbi-quality.yml`

```yaml
name: PBI Quality Suite

on:
  schedule:
    - cron: '0 6 * * *'    # 06:00 UTC daily
  workflow_dispatch:
    inputs:
      workspace_name:
        description: 'Override workspace name (leave blank for configured default)'
        required: false
      report_name:
        description: 'Override report name (leave blank for all configured)'
        required: false

jobs:
  validate:
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
          name: validate-report
          path: playwright-report/
```

### Upcoming: unattended enterprise stage

Planned, not yet implemented in code:

1. Add confidential-client auth to the runtime
2. Read CI credentials directly from secrets/variables
3. Restore a second `enterprise` job that runs live Power BI checks headlessly

---

## Option B — Azure DevOps (on-prem, self-hosted agent)

### Current working setup

| Step | Who | What |
|---|---|---|
| 1 | IT / server admin | Install ADO self-hosted agent on the always-on server |
| 2 | IT | Install Node.js 20 LTS on that server |
| 3 | IT | Confirm Google Chrome or Edge is installed (no download needed) |
| 4 | IT | Agent runs as a service account with network access to Power BI service |

Agent install is a ZIP + `config.cmd` — no elevated rights needed after the first service registration.

Use Azure DevOps today for the **validate** stage, or for trusted/self-hosted experimentation where you manage the token cache outside the repo.

### `azure-pipelines.yml`

```yaml
trigger: none

schedules:
  - cron: '0 6 * * *'
    displayName: Daily quality run
    branches:
      include: [ main ]
    always: true

variables:
  - name: NODE_VERSION
    value: '20.x'

pool:
  name: Default

stages:
  - stage: Validate
    displayName: Validate suite
    jobs:
      - job: ValidateTests
        steps:
          - task: NodeTool@0
            inputs: { versionSpec: $(NODE_VERSION) }
          - script: npm ci
            displayName: Install dependencies
          - script: npm run typecheck
            displayName: Type check
          - script: npm test
            displayName: Run validate tests
          - task: PublishTestResults@2
            condition: always()
            inputs:
              testResultsFormat: JUnit
              testResultsFiles: test-results/results.xml
              testRunTitle: Validate
          - task: PublishPipelineArtifact@1
            condition: always()
            inputs:
              targetPath: playwright-report
              artifact: validate-report
```

### Upcoming: unattended enterprise stage

When confidential-client auth is implemented, store these in an ADO Variable Group named `pbi-suite-credentials`:

| Variable | Value |
|---|---|
| `TENANT_ID` | Azure AD tenant ID |
| `CLIENT_ID` | App registration client ID |
| `CLIENT_SECRET` | App registration secret (**mark as secret**) |
| `PBI_ENVIRONMENT` | `Public` (or `USGov`, `USGovHigh`, `USGovDoD`, `Germany`, `China`) |

---

## CI selection mode — no interactive prompts

Commit `playwright/config/enterprise.generated.json` from a local `npm run setup` run, or drive report/page selection via env vars. The suite reads `PBI_WORKSPACE_NAME` and `PBI_REPORT_NAME` and skips the selection prompts.

This controls **what** to test. It does not change the current auth model, which remains device-flow plus cached tokens. Fully non-interactive execution still requires a valid `PBI_TOKEN_CACHE_FILE`.

On-demand override: pass pipeline parameters / `workflow_dispatch` inputs to target a specific workspace and report without editing files.

---

## Optional: structured JSON export for Power BI

After each enterprise run, publish `test-results/results.xml` to a Power BI push dataset or SharePoint folder for trend dashboards:

```json
[
  {
    "runId": "2026-06-04T06:00:00Z",
    "testId": "VS-001",
    "workspace": "Analytics Workspace",
    "report": "Regional Metrics",
    "page": "Executive Summary",
    "status": "passed",
    "durationMs": 4120,
    "errorCode": null
  },
  {
    "runId": "2026-06-04T06:00:00Z",
    "testId": "RH-002",
    "workspace": "Analytics Workspace",
    "report": "Regional Metrics",
    "page": null,
    "status": "failed",
    "durationMs": 890,
    "errorCode": "Failed"
  }
]
```

**Option A — Push dataset via REST API:** call `POST /v1.0/myorg/groups/{id}/datasets/{id}/rows` after each run.  
**Option B — SharePoint / Blob drop:** publish JSON to a SharePoint folder; Power BI dataflow refreshes from that path on a schedule.

Recommended: start with Option B.

---

## Configuration reference

| What to change | Where |
|---|---|
| Which reports to test by default | Commit `playwright/config/enterprise.generated.json` from `npm run setup` |
| Focus (which signals to check) | Commit `playwright/config/enterprise.focus.json` from `npm run setup` |
| Schedule (cron) | `azure-pipelines.yml` or `pbi-quality.yml` → `schedules.cron` |
| Per-test timeout | `playwright.config.ts` → `enterprise` project `timeout` |
| Power BI environment (`Public`, `USGov`, `USGovHigh`, `USGovDoD`, `Germany`, `China`) | `PBI_ENVIRONMENT` secret / variable |
