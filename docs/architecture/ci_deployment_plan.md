# CI Deployment Plan — Scheduled Power BI Quality Suite

## Purpose

Run the Playwright Power BI quality suite automatically on a schedule, in a clean isolated environment, with results published as artifacts — no human interaction required after initial setup.

---

## Architecture overview

```
Pipeline (scheduled — daily or on-demand)
  │
  ├─ Stage 1: dry-run   (no credentials, fast, always green — catches suite regressions)
  └─ Stage 2: enterprise (service principal, live PBI checks)
       │
       └─ Artifacts
            ├─ playwright-report/  (HTML — visual diff, annotations, traces)
            ├─ test-results/       (JUnit XML + screenshots)
            └─ pbi-export/         (JSON → optional Power BI push dataset)
```

---

## Option A — GitHub Actions (recommended for GitHub-hosted repos)

### One-time setup

1. Create an Azure AD app registration; note `Client ID` and `Tenant ID`
2. Generate a client secret
3. Enable "Service principals can use Power BI APIs" in Power BI Admin Portal → Tenant settings
4. Add the service principal as **Member** to each workspace the suite should test
5. Store secrets in a GitHub environment named `power-bi-prod`:
   - `PBI_TENANT_ID`
   - `PBI_CLIENT_ID`
   - `PBI_CLIENT_SECRET`

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
    environment: power-bi-prod
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install chromium --with-deps
      - run: npm test
        env:
          PBI_TENANT_ID:      ${{ secrets.PBI_TENANT_ID }}
          PBI_CLIENT_ID:      ${{ secrets.PBI_CLIENT_ID }}
          PBI_CLIENT_SECRET:  ${{ secrets.PBI_CLIENT_SECRET }}
          PBI_ENVIRONMENT:    Public
          PBI_WORKSPACE_NAME: ${{ inputs.workspace_name }}
          PBI_REPORT_NAME:    ${{ inputs.report_name }}
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

---

## Option B — Azure DevOps (on-prem, self-hosted agent)

### One-time setup

| Step | Who | What |
|---|---|---|
| 1 | IT / server admin | Install ADO self-hosted agent on the always-on server |
| 2 | IT | Install Node.js 20 LTS on that server |
| 3 | IT | Confirm Google Chrome or Edge is installed (no download needed) |
| 4 | IT | Agent runs as a service account with network access to Power BI service |

Agent install is a ZIP + `config.cmd` — no elevated rights needed after the first service registration.

Store these in an ADO Variable Group named `pbi-suite-credentials`:

| Variable | Value |
|---|---|
| `PBI_TENANT_ID` | Azure AD tenant ID |
| `PBI_CLIENT_ID` | App registration client ID |
| `PBI_CLIENT_SECRET` | App registration secret (**mark as secret**) |
| `PBI_ENVIRONMENT` | `Public` (or `GCC`, `China`, etc.) |

### `azure-pipelines.yml`

```yaml
trigger: none

schedules:
  - cron: '0 6 * * *'
    displayName: Daily quality run
    branches:
      include: [ main ]
    always: true

parameters:
  - name: workspaceName
    displayName: Override workspace (leave blank for default)
    type: string
    default: ''
  - name: reportName
    displayName: Override report name (leave blank for all configured)
    type: string
    default: ''

variables:
  - group: pbi-suite-credentials
  - name: NODE_VERSION
    value: '20.x'

pool:
  name: Default    # name of your self-hosted agent pool

stages:

  - stage: DryRun
    displayName: Dry run — fixture validation
    jobs:
      - job: DryRunTests
        steps:
          - task: NodeTool@0
            inputs: { versionSpec: $(NODE_VERSION) }
          - script: npm ci
            displayName: Install dependencies
          - script: npm run typecheck
            displayName: Type check
          - script: npm test
            displayName: Run dry-run tests
          - task: PublishTestResults@2
            condition: always()
            inputs:
              testResultsFormat: JUnit
              testResultsFiles: test-results/results.xml
              testRunTitle: Dry run
          - task: PublishPipelineArtifact@1
            condition: always()
            inputs:
              targetPath: playwright-report
              artifact: dry-run-report

  - stage: Enterprise
    displayName: Enterprise run — live Power BI checks
    dependsOn: DryRun
    condition: succeeded()
    jobs:
      - job: EnterpriseTests
        timeoutInMinutes: 60
        steps:
          - task: NodeTool@0
            inputs: { versionSpec: $(NODE_VERSION) }
          - script: npm ci
            displayName: Install dependencies
          - script: npm test
            displayName: Run enterprise tests
            env:
              PBI_TENANT_ID:      $(PBI_TENANT_ID)
              PBI_CLIENT_ID:      $(PBI_CLIENT_ID)
              PBI_CLIENT_SECRET:  $(PBI_CLIENT_SECRET)
              PBI_ENVIRONMENT:    $(PBI_ENVIRONMENT)
              PBI_WORKSPACE_NAME: ${{ parameters.workspaceName }}
              PBI_REPORT_NAME:    ${{ parameters.reportName }}
          - task: PublishTestResults@2
            condition: always()
            inputs:
              testResultsFormat: JUnit
              testResultsFiles: test-results/results.xml
              testRunTitle: Enterprise run
          - task: PublishPipelineArtifact@1
            condition: always()
            inputs:
              targetPath: playwright-report
              artifact: enterprise-report
          - task: PublishPipelineArtifact@1
            condition: always()
            inputs:
              targetPath: test-results
              artifact: test-results
```

---

## CI mode — no interactive setup needed

Commit `playwright/config/enterprise.generated.json` from a local `npm run setup` run, or drive it entirely via env vars.  The suite reads `PBI_WORKSPACE_NAME` and `PBI_REPORT_NAME` in non-interactive mode and skips all prompts.

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
| Power BI environment (GCC, etc.) | `PBI_ENVIRONMENT` secret / variable |

