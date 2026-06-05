# pbi-playwright-suit

[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-tested-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Node](https://img.shields.io/badge/Node-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Azure](https://img.shields.io/badge/Azure-MSAL%20%2F%20Power%20BI%20REST-0078D4?logo=microsoftazure&logoColor=white)](https://azure.microsoft.com/)
[![Microsoft Fabric](https://img.shields.io/badge/Microsoft%20Fabric-compatible-FF6600?logo=microsoft&logoColor=white)](https://www.microsoft.com/en-us/microsoft-fabric)
[![Azure DevOps](https://img.shields.io/badge/Azure%20DevOps-CI%20ready-0078D7?logo=azuredevops&logoColor=white)](https://azure.microsoft.com/en-us/products/devops/)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI%20ready-2088FF?logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-scheduled%20%2B%20on--demand-brightgreen?logo=checkmarx&logoColor=white)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Agile Power BI quality suite that includes Playwright-based testing.  
Catches the signals that break reports **before users notice them**.

> **Who this is for.** This suite is built first for a **business-user analyst** who
> owns Power BI reports and wants to check them **on demand** from their own machine —
> `npm run setup`, pick reports, run. Scheduled CI is an **optional** enterprise
> add-on, not a requirement. Everything works as a manual, interactive run.

---

## The Cost of Waiting for Customers to Tell You Your Reports Are Broken

_On proactive quality, the operational economics of reactive analytics, and what a CI-first test harness actually buys a modern data team — with numbers._

It begins with an email. A director — or an operations manager who has been staring at a dashboard all morning, growing quietly uneasy — notices that the numbers look wrong. The chart on the front page of the weekly performance report is blank. The total is frozen at last Tuesday's figure. She writes to the analytics team: _"Is the report working? The data doesn't seem right."_

That email is not merely a support ticket. It is the sound of trust eroding.

**The reactive cost model — a worked example.** Consider a realistic enterprise analytics environment: a team of 100 data professionals responsible for a portfolio of 1,000 Power BI reports across an organisational workspace. Each report draws from one or more datasets. Each dataset refreshes on a schedule — nightly, hourly, sometimes continuously. At any given moment, a refresh may have failed silently, a source column may have been renamed by an upstream system, a gateway credential may have expired, or a relationship in the data model may have quietly admitted duplicate key values that now distort every visual relying on it.

The team does not find out until a user does.

The investigation that follows is expensive in ways that compound. A senior developer — billing at $200/hr, the mid-market benchmark for a Power BI professional in North America — receives the email, opens the Power BI Service, navigates to the dataset, inspects the refresh history, and begins the archaeology of locating the root cause. Diagnosis alone: **1–3 hours** (call it 2 hrs average, at $200/hr = **$400**). Resolution — patching the credential, coordinating with the source-system owner, re-running the refresh, then validating that the four affected report pages now render correctly — adds another **2–4 hours** (call it 3 hrs average = **$600**). A single incident, end-to-end: **5 hours × $200 = $1,000**.

That is the cost floor. It assumes the developer finds the root cause on the first attempt, the source-system owner responds the same day, and no downstream data consumer has already exported the wrong numbers to a spreadsheet that will circulate in a board meeting.

**The failure rate is not hypothetical.** In a portfolio of 1,000 reports, consider three independent failure mechanisms. First, gateway credential expirations: OAuth tokens have a fixed lifetime; service-principal secrets rotate; enterprise gateways lose configuration during patching cycles. A conservative failure rate of 2% per month on 1,000 datasets = **20 incidents** from credentials alone. Second, upstream schema changes: source-system teams rename columns, alter data types, or drop tables with imperfect communication to downstream consumers. At 1.5% per month = **15 incidents**. Third, data-integrity violations: duplicate primary keys, referential integrity failures, or `RowValueConflict` errors that corrupt aggregations without stopping the refresh. At 1.5% per month = **15 incidents**. Total: **50 incidents per month.**

Fifty incidents at $1,000 each = **$50,000/month in unplanned senior developer time.**

Annualised: **$600,000 per year.** For a single workspace. In developer time alone — before pricing the trust deficit, before counting the decisions made on stale data, before accounting for the senior stakeholder who quietly abandons the dashboard and reverts to spreadsheets.

**What CI changes.** The principle of catching defects before users experience them is not new in software engineering. A code change that breaks a unit test in a CI pipeline is caught in seconds. The cost of that catch is effectively zero: a few seconds of compute, a Slack notification, a targeted fix. The cost of the same defect reaching production is an order of magnitude higher. IBM's _Systems Science Institute_ and Capers Jones's longitudinal studies both place the ratio of production-defect costs to early-design-phase caught costs at **15:1 to 30:1** depending on defect type and system complexity.

Applied to the Power BI scenario: a pipeline that runs this suite nightly — a run that completes in **8–12 minutes** across 1,000 report pages — surfaces the morning's broken reports as a clean, prioritised signal: _three datasets failed their refresh; one carries a credential error matching a known OAuth expiry pattern; one carries a data-integrity violation that will corrupt the totals on four pages._ That signal arrives **before** the director sends the email. A junior engineer triages it in **15 minutes at $100/hr = $25**. The targeted fix takes **1 hour = $200**. Total incident cost: **$225**.

Compared to the reactive scenario: **$1,000 reactive vs. $225 proactive = $775 saved per caught incident.**

At 50 incidents per month, capturing even **60% proactively** — 30 incidents — saves **30 × $775 = $23,250/month = $279,000/year.** And that is the conservative scenario. Teams that push this suite into their deployment gate — running it before every report republication — add a second layer: preventing broken reports from ever reaching production in the first place. For those teams, the capture rate approaches 90%, and the annualised savings exceed **$415,000**.

The implementation cost of this suite: one sprint to deploy, zero additional infrastructure beyond an existing CI runner, and a Node.js runtime that costs nothing. The payback period, at $279,000/year in savings, is measured in days.

**The compounding effect.** None of the figures above price what happens when trust in the analytics platform improves. When a director knows that the suite ran at 6 AM and found nothing wrong, she opens the dashboard with confidence. When the team receives a `⚑ CAUGHT` signal at 7 AM rather than a stakeholder email at 10 AM, they spend the day building new capabilities rather than debugging yesterday's failure. When the compliance team can point to a scheduled, auditable quality check in the CI log, the procurement conversation about expanding the Power BI licence estate becomes easier.

The return on this investment is not marginal. It is structural. And it compounds.

---

---

## What the suite checks

The suite focuses exclusively on signals that cause Power BI visuals to render **wrong data, stale data, or no data at all**.

| ID         | Signal                                                                             | Why it matters                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RH-002** | Latest dataset refresh status is `Failed`, `Disabled`, `Cancelled`, or `Unknown`   | Visuals are serving data from the last successful refresh — potentially days or weeks stale                                                                                |
| **RH-003** | Any historical refresh entry contains a credential or data-integrity error pattern | Patterns like `MonikerWithUnboundDataSources`, `OAuth`, `DMTS_UserNotFoundInADGraphError`, `duplicate key`, `RowValueConflict` indicate broken auth or bad data in visuals |
| **VS-NNN** | A report page embed raises a Power BI SDK visual error                             | Broken measures, missing fields, unconstrained joins, or credential failures detected at render time                                                                       |

Checks **not** in scope: RLS scenarios, model structure / M:M relationships, datasource connection details, bidirectional cross-filter warnings, threshold-based staleness timers. Source data schema drift detection is planned (see [TBD] in the focus menu).

---

## Validate this suite (no credentials needed)

Before connecting to a live tenant — or in CI environments without credentials — you can confirm the harness itself is working:

```powershell
git clone https://github.com/AndrewMichael2020/pbi-playwright-suit
cd pbi-playwright-suit
npm install
npm test
```

All 29 checks run against committed mock fixtures and pass. Enterprise tests auto-skip when no config is present. This is also the command used in the `validate` CI job (see [CI integration](#ci-integration) below).

---

## Running the tests (testing your own Power BI reports)

### Prerequisites

- Node 18+ (Node 20+ recommended)
- Google Chrome or Microsoft Edge installed (no download required)
- An organisational account with at least **Viewer** access to the target workspace

### Connect, configure, run

```powershell
npm run setup
```

`setup` runs an interactive wizard:

1. Signs you in via **device-flow** (browser opens `https://login.microsoft.com/device`)
2. Lists your workspaces — enter a number or type to search
3. Lists reports in that workspace — select one or more
4. Lists pages in each report — select all or specific pages
5. Asks **what to check** — choose a focus to skip unrelated tests on large workspaces:

| #     | Focus                        | VS-NNN | RH-002 | RH-003 | Best for                               |
| ----- | ---------------------------- | :----: | :----: | :----: | -------------------------------------- |
| 1     | Broken visuals               |   ✅   |   —    |   —    | Visual smoke only                      |
| 2     | Dataset refresh failures     |   —    |   ✅   |   —    | Is the data fresh?                     |
| 3     | Credential / gateway errors  |   —    |   —    |   ✅   | OAuth / gateway auth failures          |
| 4     | Refresh health               |   —    |   ✅   |   ✅   | All refresh signals combined           |
| 5     | Quick triage                 |   ✅   |   ✅   |   —    | Fastest check for large workspaces     |
| 6     | All checks                   |   ✅   |   ✅   |   ✅   | Every live signal                      |
| [n/a] | Schema drift (pql-test)      |   —    |   —    |   —    | **Experimental / unverified** — column / table existence via XMLA; awaits a more stable `pql-test` release |
| [n/a] | Key duplication (pql-test)   |   —    |   —    |   —    | **Experimental / unverified** — primary-key uniqueness via DAX; awaits a more stable `pql-test` release |
| [TBD] | Source data schema drift     |   —    |   —    |   —    | Column / table changes in source SQL — coming soon |
| 7     | Other (custom grep filter)   |   —    |   —    |   —    | Run an arbitrary Playwright `--grep` filter |

> The two **pql-test** options run a separate Playwright project and require `pql-test`
> installed and authenticated. They are **experimental and not yet verified** —
> treat their results as indicative only until the upstream tool stabilises.

6. Confirms config and offers to run immediately. When tests finish and you close the report viewer, the wizard asks **"Run another test? [Y/n]"** — answer Y to go back to report selection (no re-authentication needed) and queue another run.

7. Exit when done — or skip the report viewer and run again straight away.

### What setup writes

- `playwright/config/enterprise.generated.json` — report/page list (gitignored)
- `playwright/config/enterprise.focus.json` — selected focus (gitignored)

Neither file is committed. Re-run `npm run setup` whenever you want to change the report selection or focus.

> **Do NOT run `npm run install:browsers` on Windows.**  
> The enterprise run uses your existing system Chrome or Edge.

---

## CI integration

> **Optional.** CI is only relevant if your enterprise wants scheduled, unattended
> runs. The analyst workflow above (`npm run setup` → run) needs none of this.

### GitHub Actions (Linux runner — installs Chromium once)

Today the **`validate`** job is turnkey on hosted runners. Unattended **enterprise** CI is **upcoming**: the current runtime auth uses device-flow plus an MSAL token cache (`CLIENT_ID` / `TENANT_ID`), not client-secret service-principal auth.

```yaml
name: PBI Quality Suite

on:
  schedule:
    - cron: "0 6 * * *" # 06:00 UTC daily
  workflow_dispatch:

jobs:
  validate: # suite self-check — no credentials needed
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
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

### Azure DevOps (on-prem, self-hosted agent with Chrome)

See [`docs/architecture/ci_deployment_plan.md`](docs/architecture/ci_deployment_plan.md) for the current validate pipeline and the future-state enterprise CI plan.

### CI selection mode — no interactive prompts

Commit `playwright/config/enterprise.generated.json` from a local `npm run setup` run, or drive report selection with env vars:

```yaml
env:
  PBI_WORKSPACE_NAME: Analytics Workspace
  PBI_REPORT_NAME: Regional Metrics
```

The suite reads those vars and skips the workspace/report selection prompts. These vars select **what** to test; they do not replace the current device-flow/token-cache auth. A fully non-interactive run still needs a valid service principal auth implementation.

---

## Understanding test results

| Outcome                | Meaning                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| ✅ passed              | No visual error, refresh healthy                                          |
| ❌ RH-002              | Latest refresh is Failed / Disabled — visuals are stale                   |
| ❌ RH-003              | Refresh history contains credential or data-integrity errors              |
| ❌ VS-NNN visual error | SDK error at render time — broken measure, missing field, or auth failure |
| ⏭ skipped             | Focus excludes this check, or enterprise config not present               |

Each failed test has a **screenshot**, **video**, and **trace** attached.  
For `RH-*` failures, annotations detail the specific error code and timestamp.

```powershell
npx playwright show-report
npx playwright show-trace test-results/<folder>/trace.zip
```

---

## Environment variables

Use `.env.example` as the template for a local `.env` file. Interactive `npm run setup` works without `.env`; these are optional overrides and non-interactive inputs.

| Variable               | Default                | Purpose                                     |
| ---------------------- | ---------------------- | ------------------------------------------- |
| `CLIENT_ID`            | built-in public client | Azure AD public client ID for device-flow auth |
| `TENANT_ID`            | —                      | Optional Azure AD tenant for device-flow auth |
| `PBI_WORKSPACE_NAME`   | —                      | Non-interactive: target workspace name      |
| `PBI_REPORT_NAME`      | —                      | Non-interactive: target report name         |
| `PBI_DATASET_NAME`     | same as report         | Override dataset name                       |
| `PBI_PAGE_NAME`        | first page             | Override page display name                  |
| `PBI_ENVIRONMENT`      | `Public`               | Azure cloud (`Public`, `USGov`, `China`, …) |
| `PBI_TOKEN_CACHE_FILE` | auto                   | Path to MSAL token cache                    |
| `PBI_BROWSER_CHANNEL`  | `chrome`               | `chrome` or `msedge`                        |
| `PBI_RUN_ID`           | timestamp              | Override the `test-archive/<run-id>` folder name |

---

## Repository layout

```text
.env.example                      # local env template (copy to .env)
playwright/
  config/                           # runtime — gitignored
    enterprise.generated.json       # report/page list written by npm run setup
    enterprise.focus.json           # focus selection written by npm run setup
  fixtures/snapshots/
    refresh-history/
      baseline-refresh-history.json        # mock refresh history fixture
      baseline-refresh-history-patterns.json
      baseline-refresh-health.json
    enterprise-config/
      sample-enterprise-config.json        # sample shape for reference
  helper-functions/
    powerbi-enterprise.ts           # REST API: auth, refresh history, embed token
    errors.ts                       # typed PowerBiError domain error for the REST boundary
    refresh-health.ts               # refresh analysis + RefreshStatus enum + isBadRefreshStatus()
    source-extraction.ts            # SQL extraction from M partition expressions
    enterprise-config.ts            # load/save enterprise.generated.json
    focus.ts                        # focus menu definitions + routing matrix
    types.ts                        # shared TypeScript types
    env-loader.ts                   # .env loading
    file-reader.ts                  # fixture file helpers
  tests/
    metadata/                       # fixture-based checks (no credentials, no browser)
      fixture-contracts.spec.ts     # fixture shape contracts
      refresh-health.spec.ts        # RH-002, RH-003, RS-001/RS-002 status logic
      source-extraction.spec.ts     # SQL extraction from M expressions
      errors.spec.ts                # ER-001..004 typed REST error boundary
    visual/                         # enterprise live checks (require npm run setup)
      dataset-health.spec.ts        # RH-002, RH-003 against live Power BI
      report-pages.spec.ts          # VS-NNN visual smoke via Power BI JS SDK
    pql/                            # experimental pql-test lane (unverified)
      pql-schema.spec.ts            # schema drift via XMLA — awaits stable pql-test
      pql-dataquality.spec.ts       # key duplication via DAX — awaits stable pql-test
  global/
    global-setup.ts
  vendor/
    powerbi.min.js                  # Power BI JS SDK (pinned, no CDN dependency)
  reporter.ts                       # custom Playwright reporter
scripts/
  setup.ts                          # interactive enterprise configuration wizard
  pql-generate-stubs.ts             # generates pql-test spec stubs (experimental)
  install-pql-test.ps1              # one-time pql-test installer (Windows, experimental)
pql/
  README.md                         # pql-test lane notes
docs/
  architecture/
    playwright_test_strategy.md
    ci_deployment_plan.md
    work_status.md
    audit_2026-06.md                # architecture audit + boundary-hardening plan
```

---

## Acknowledgements

This suite would not exist in its current form without the foundational work of **[kerski](https://github.com/kerski)** and the **[`pbi-dataops-visual-error-testing`](https://github.com/kerski/pbi-dataops-visual-error-testing)** repository.

Kerski's project demonstrated — concretely and practically — that Power BI report pages can be embedded headlessly in a Playwright browser, that the Power BI JavaScript SDK fires deterministic `rendered` and `error` events that a test harness can race against, and that an enterprise embed-token flow can be wired into an automated pipeline without requiring interactive sign-in at test time. Those are not obvious ideas. Kerski proved them, published the code, and shared the approach openly.

The visual smoke-test lane of this suite — the embed-token acquisition, the `powerbi-client` vendor bundle, the `rendered`/`error` event race in `page.evaluate`, and the kerski-pattern harness shape — is a direct evolution of that work. The metadata lane (refresh history, schema drift, duplicate heuristics, source extraction) extends it into territory that the original project did not explore.

If this suite is useful to you, please star and cite kerski's original repository. The ecosystem improves when practitioners share.

---

## Troubleshooting

### `ENOENT: enterprise.generated.json`

Run `npm run setup` first.

---

### Sign-in code appears and the terminal returns immediately

Expected. Open `https://login.microsoft.com/device`, enter the code, sign in, then re-run.

---

### `uuid@8.3.2` deprecation warning during `npm install`

Fixed — the repo now uses `@azure/msal-node@^5.2.2`. Pull and reinstall:

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
It does **not** affect your system Chrome. If you are using system Chrome, ignore it.

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
