# CI Deployment Plan — Scheduled Power BI Quality Suite

## Purpose

Run the Playwright Power BI quality suite automatically on a schedule, in a clean isolated environment, with results published as Power BI-consumable assets — no human interaction required after initial setup.

---

## Target architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  On-prem Azure DevOps Server                                    │
│                                                                 │
│  Pipeline (scheduled — daily or on demand)                      │
│    │                                                            │
│    ├─ Stage 1: dry-run   (no credentials, fast, always runs)   │
│    └─ Stage 2: enterprise (service principal, live PBI checks)  │
│         │                                                       │
│         └─ Artifacts published to pipeline run                  │
│              ├─ playwright-report/  (HTML)                      │
│              ├─ test-results/       (JUnit XML + screenshots)   │
│              └─ pbi-export/         (JSON → Power BI dataset)   │
└─────────────────────────────────────────────────────────────────┘
         │
         └─ Power BI dataflow or REST push dataset
              └─ Dashboard / report built on test result history
```

---

## Phase 1 — Self-hosted ADO agent (one-time, IT does this once)

| Step | Who | What |
|---|---|---|
| 1 | IT / server admin | Install ADO self-hosted agent on the always-on server |
| 2 | IT | Install Node.js 20 LTS on that server |
| 3 | IT | Confirm Google Chrome or Edge is installed (no download needed) |
| 4 | IT | Agent runs as a service account with network access to Power BI service |

Agent install is a ZIP + `config.cmd` — no elevated rights needed after the first service registration.

---

## Phase 2 — Service principal (one-time, Power BI admin does this once)

A service principal (Azure App Registration) allows the pipeline to authenticate without a human.

### App registration steps

1. In Azure AD: create an app registration, note `Client ID` and `Tenant ID`
2. Generate a client secret (set expiry to 1–2 years, add a calendar reminder to rotate)
3. In Power BI Admin Portal → Tenant settings → **Enable service principals to use Power BI APIs**
4. Add the service principal as **Member** to each workspace the suite should test

### ADO secret variables

Store these in an ADO Variable Group named `pbi-suite-credentials`:

| Variable | Value |
|---|---|
| `PBI_TENANT_ID` | Azure AD tenant ID |
| `PBI_CLIENT_ID` | App registration client ID |
| `PBI_CLIENT_SECRET` | App registration secret (**mark as secret**) |
| `PBI_ENVIRONMENT` | `Public` (or `GCC`, `China`, etc.) |

These map directly to the env vars the suite already reads (`readEnterpriseCredentialsFromEnv`).

---

## Phase 3 — Pipeline YAML

Add `azure-pipelines.yml` at the repository root.

### Key design decisions

- **Two stages** — dry-run always runs (catches suite regressions); enterprise runs only when credentials are available.
- **On-demand trigger** — a pipeline variable `REPORT_TARGET` lets a user override which workspace/report to test without editing the YAML.
- **Config-as-code** — `playwright/config/enterprise.generated.json` is committed for the target workspace/reports. The pipeline uses it directly (CI mode — no interactive CLI needed).
- **Artifacts** — HTML report, JUnit XML, screenshots, and a structured JSON export are all published.

### `azure-pipelines.yml` (to be created)

```yaml
trigger: none   # manual + schedule only

schedules:
  - cron: '0 6 * * *'        # 06:00 UTC daily (adjust to business hours)
    displayName: Daily quality run
    branches:
      include: [ main ]
    always: true              # run even if no code changes

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
  name: Default              # name of your self-hosted agent pool

stages:

  - stage: DryRun
    displayName: Dry run — fixture validation
    jobs:
      - job: DryRunTests
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: $(NODE_VERSION)
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
            inputs:
              versionSpec: $(NODE_VERSION)
          - script: npm ci
            displayName: Install dependencies
          - script: npm run test:enterprise
            displayName: Run enterprise tests
            env:
              PBI_TENANT_ID:        $(PBI_TENANT_ID)
              PBI_CLIENT_ID:        $(PBI_CLIENT_ID)
              PBI_CLIENT_SECRET:    $(PBI_CLIENT_SECRET)
              PBI_ENVIRONMENT:      $(PBI_ENVIRONMENT)
              PBI_WORKSPACE_NAME:   ${{ parameters.workspaceName }}
              PBI_REPORT_NAME:      ${{ parameters.reportName }}
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
          - task: PublishPipelineArtifact@1
            condition: always()
            inputs:
              targetPath: pbi-export
              artifact: pbi-export
```

---

## Phase 4 — Structured JSON export for Power BI

After each enterprise run, a script (`scripts/export-results.ts`) reads the JUnit XML and screenshots index, then writes `pbi-export/run-results.json` with one row per test:

```json
[
  {
    "runId": "2025-05-13T06:00:00Z",
    "testId": "VS-001",
    "workspace": "Analytics-Workspace-A",
    "report": "Regional Metrics",
    "page": "Executive Summary",
    "status": "passed",
    "durationMs": 4120,
    "errorCode": null,
    "refreshHealth": null
  },
  {
    "runId": "2025-05-13T06:00:00Z",
    "testId": "VS-022",
    "workspace": "Analytics-Workspace-A",
    "report": "Clear Triage Report",
    "page": "Clear Triage",
    "status": "failed",
    "durationMs": 8340,
    "errorCode": "Missing_References",
    "refreshHealth": "latest: Failed @ 2025-05-13 · failures in window: 3"
  }
]
```

### Getting this into Power BI (two options)

**Option A — Push dataset via REST API (fully automated)**
The export script calls `POST /v1.0/myorg/groups/{id}/datasets/{id}/rows` to append today's run to a streaming dataset. The Power BI dashboard updates immediately after the pipeline finishes. Requires the service principal to have write access to one dedicated dataset.

**Option B — Dataflow / SharePoint drop (simpler, no push API needed)**
The pipeline publishes `pbi-export/run-results.json` to a SharePoint folder or Azure Blob Storage. A Power BI dataflow refreshes from that path on a schedule. Lower complexity, slightly delayed (dataflow refresh lag).

**Recommendation:** start with Option B. Add Option A once the dashboard shape is stable.

---

## Phase 5 — Power BI dashboard on test results

Suggested measures once data is in Power BI:

| Visual | Measure |
|---|---|
| Pass rate over time (line) | `DIVIDE(COUNTROWS(FILTER(Results, [status]="passed")), COUNTROWS(Results))` |
| Failures by report (bar) | `COUNTROWS(FILTER(Results, [status]="failed"))` grouped by `[report]` |
| Error code breakdown (donut) | `COUNTROWS` grouped by `[errorCode]` |
| Refresh health heatmap | `[refreshHealth]` text column, conditional formatting |
| Latest run summary card | `MAX([runId])` → pass/fail count |

---

## On-demand override

Any team member can trigger a pipeline run manually in ADO and override `workspaceName` / `reportName` parameters to test a specific report without changing config files.

---

## Configuration reference

| What to change | Where |
|---|---|
| Which reports to test by default | `playwright/config/enterprise.generated.json` (run `npm run setup` locally first) |
| Schedule (cron) | `azure-pipelines.yml` → `schedules.cron` |
| Timeout per test | `playwright.config.ts` → `enterprise` project `timeout` |
| How many past refreshes to check | `report-pages.spec.ts` → `getRefreshHistory(..., N)` |
| Power BI environment (GCC, etc.) | `pbi-suite-credentials` variable group → `PBI_ENVIRONMENT` |

---

## Rollout sequence

1. IT installs ADO agent + Node on the server *(~2 hours, one-time)*
2. Power BI admin creates app registration + workspace membership *(~30 min, one-time)*
3. Developer commits `azure-pipelines.yml`, sets up variable group, runs first manual pipeline *(~1 hour)*
4. Developer builds SharePoint/Blob drop + Power BI dataflow for results *(~2 hours)*
5. Enable the daily schedule, confirm first overnight run *(15 min)*
6. Build the results dashboard in Power BI *(ongoing)*
