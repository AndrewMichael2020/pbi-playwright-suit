# RLS Source Discovery Service — Plan

**Goal:** A standalone Python CLI (`scripts/discover_rls_sources.py`) that scans
every semantic model in a Power BI workspace and produces a **manifest file** —
one row per report/role — recording exactly where each report's user-access source
file lives, what format it is in, and which column holds the user principal names
or group names.  The manifest is the configuration input for downstream RLS
validation tests.

---

## The problem this solves

You have ~500 reports.  ~100 of them enforce Row-Level Security using custom flat
files — some `.xlsx` on SharePoint, some `.csv` on a network share, some an
embedded Power Query table.  Each was built independently:

- Report A calls its column `UserPrincipalName`
- Report B calls its column `CorporateUPN`
- Report C calls its column `LoginName`
- Report D uses a group-name lookup with a column called `ADGroup`

There is no central registry.  Without this tool you find them by opening each
semantic model by hand.  With this tool you run one command and get a manifest
that tells every downstream test exactly where to look and what to read.

---

## Primary deliverable: the manifest

The manifest is a **single YAML file committed to the repository**:

```
rls_sources_manifest.yaml
```

YAML is chosen over JSON because it is human-readable at a glance, supports
inline comments (e.g., to flag a row that needs manual review), and is
natively parseable by both Python (`pyyaml`) and most CI tooling.

> The manifest is **gitignored** — it contains internal SharePoint paths and file
> locations.  Run the script on your machine, use the output locally, and re-run
> when reports change.

### Sample manifest entry

```yaml
- workspace_name: Finance Analytics
  workspace_id: a1b2c3d4-0000-0000-0000-000000000000
  dataset_name: Sales Pipeline
  dataset_id: d4e5f6a7-0000-0000-0000-000000000000
  role_name: Region Manager
  rls_table: UserAccess
  dax_filter: "[Email] = USERPRINCIPALNAME()"
  upn_column: Email          # column in the source file that holds UPNs
  source:
    path: https://contoso.sharepoint.com/sites/Finance/Shared%20Documents/UserAccess.xlsx
    file: UserAccess.xlsx
    format: xlsx             # xlsx | csv | embedded | unknown
    sheet: Sheet1            # null if csv or not determinable
  discovery_method: xmla     # xmla | rest
  scan_timestamp: "2026-06-14T06:00:00Z"
  notes: ""                  # free-text; set by script or manually after review
```

The `source.path` field is the full URL or file-system path to the source file —
this is what makes the manifest actionable.

**Every row answers these questions for one report/role pair:**

| Question | YAML key | Example value |
|---|---|---|
| Which workspace? | `workspace_name` | `Finance Analytics` |
| Which dataset/model? | `dataset_name` | `Sales Pipeline` |
| Which RLS role? | `role_name` | `Region Manager` |
| What table is filtered? | `rls_table` | `UserAccess` |
| What is the full DAX filter? | `dax_filter` | `[Email] = USERPRINCIPALNAME()` |
| Which column holds UPNs/groups? | `upn_column` | `Email` |
| Full path to the source file? | `source.path` | `https://contoso.sharepoint.com/…/UserAccess.xlsx` |
| File name only? | `source.file` | `UserAccess.xlsx` |
| What file format? | `source.format` | `xlsx` / `csv` / `embedded` / `unknown` |
| Which sheet/tab? _(xlsx only)_ | `source.sheet` | `Sheet1` |
| How was this discovered? | `discovery_method` | `xmla` / `rest` / `manual` |
| Any caveats? | `notes` | `XMLA unavailable — path from REST datasource` |
| When was this scanned? | `scan_timestamp` | `2026-06-14T06:00:00Z` |

> `upn_column` is the key field for downstream testing: it tells the test script
> which column to open in the file and compare against Active Directory or the
> expected user list.  Because each report uses a different column name, the
> manifest is the only place this is normalised.

---

## What the manifest enables downstream

The manifest becomes the configuration input for a future `validate_rls.py` test
script.  Without the manifest, writing that script requires knowing all 100 column
names in advance.  With the manifest:

```
For each entry in rls_sources_manifest.yaml:
  1. Open entry.source.path  (SharePoint / file share / embedded)
  2. Read column entry.upn_column from sheet entry.source.sheet
  3. Validate each value against Active Directory (or expected list)
  4. Report which users are missing / stale / wrong format
```

The test script is generic and data-driven.  The manifest is what makes it
possible without 100 custom scripts.

---

## How the discovery works (two-tier)

The script tries two APIs for each dataset and uses whichever gives more detail.

```
┌──────────────────────────────────────────────────────┐
│  Tier 1 — Power BI REST API  (always available)       │
│                                                       │
│  GET /datasets/{id}/datasources                       │
│  → returns: datasource type + connection path         │
│  → tells us: file is at this SharePoint URL           │
│  → does NOT tell us: which column, which role         │
│  → discovery_method = "rest"                          │
└───────────────────────┬──────────────────────────────┘
                        │ enriched by, when available:
                        ▼
┌──────────────────────────────────────────────────────┐
│  Tier 2 — XMLA endpoint  (Premium / Fabric SKUs only) │
│                                                       │
│  Reads the Tabular Object Model (TOM):                │
│  • RLS role definitions + DAX filterExpression        │
│    → tells us: which column → upn_column              │
│  • M/Power Query partition expressions                │
│    → tells us: exact file path, sheet name, format    │
│  → discovery_method = "xmla"                          │
└──────────────────────────────────────────────────────┘
```

A row written from Tier 1 alone will have `upn_column = "(requires XMLA)"` and
`discovery_method = "rest"`.  That flags it for manual follow-up or a later run
on a machine with XMLA access.

---

## Source format detection

The M expression pattern determines `source_format`:

| M expression pattern | `source_format` |
|---|---|
| `Excel.Workbook(File.Contents(…))` | `xlsx` |
| `Csv.Document(File.Contents(…))` | `csv` |
| `SharePoint.Files(…)` + `.xlsx` extension | `xlsx` |
| `SharePoint.Files(…)` + `.csv` extension | `csv` |
| In-model table with no external source | `embedded` |
| Source detected but pattern unrecognised | `unknown` |

`source_sheet` is extracted from the `[Item="…"]` selector in the Excel M
expression where present.

---

## Authentication

The script shares the MSAL token cache that `npm run setup` already writes to
`playwright/.auth/msal-device-token-cache.json`.

- If that cache exists and the token is valid: no login prompt — start immediately.
- If the cache is absent or expired: initiate a device-flow challenge (same
  browser-open flow as `npm run setup`), write the refreshed cache, continue.
- Client ID used: `d3590ed6-52b3-4102-aeff-aad2292ab01c` (same public client as
  the main suite, no secrets required).
- Scope: `https://analysis.windows.net/powerbi/api/.default`

---

## CLI design (mirrors `npm run setup`)

The script uses the same interactive UX conventions as `setup.ts`:

- Coloured, timestamped terminal output
- Number-to-pick + `/search` filter for workspace selection
- `[1] All workspaces` or `[2] Pick one` scope choice
- Live progress line per dataset as it is scanned
- Summary at end: `N datasets • M roles with UPN filter • K file sources`
- Prints a short results table to terminal; full detail in the output files

**Command-line flags:**

| Flag | Effect |
|---|---|
| _(none)_ | Interactive workspace picker |
| `--all` | Scan all workspaces without prompting |
| `--workspace <name or id>` | Skip picker; scan named workspace |
| `--output <dir>` | Write manifest files to this directory instead of project root |
| `--no-xmla` | Tier 1 only (faster; useful on non-Premium tenants) |
| `--verbose` | Print all rows to terminal (default: first 50) |

---

## File layout

```
scripts/
  discover_rls_sources.py      ← CLI entry point (to be built)
  requirements_rls.txt         ← Python dependencies (to be built)

playwright/.auth/
  msal-device-token-cache.json ← shared auth cache (already exists)

rls_sources_manifest.yaml      ← generated manifest — gitignored
```

The manifest is intentionally **not committed**.  It contains internal SharePoint
paths and file locations.  Re-run the script on your machine when reports change.

---

## Python dependencies (`requirements_rls.txt`)

| Package | Why |
|---|---|
| `msal>=1.29` | Device-flow auth — same flow as `@azure/msal-node` |
| `requests>=2.32` | REST API calls |
| `python-dotenv>=1.0` | Reads `.env` for optional `CLIENT_ID` / `TENANT_ID` overrides |
| `pyyaml>=6.0` | Write and read the YAML manifest |
| `pyadomd>=0.1` _(optional)_ | XMLA/ADOMD.NET bridge for Tier 2 on Windows |

`pyadomd` is optional.  If it cannot be imported (non-Windows, or ADOMD not
installed) the script silently falls back to Tier 1 and flags rows accordingly.
On non-Windows machines with Mono + `pythonnet` available, Tier 2 can also work
via `pythonnet`; this is noted in the install docs but not required.

---

## Build phases

### Phase 0 — Scaffold

- Create `scripts/discover_rls_sources.py` with arg parser, colour helpers,
  and timestamp logger matching the style of `setup.ts`.
- Create `scripts/requirements_rls.txt`.
- Add `rls_sources_manifest.yaml` to `.gitignore`.
- Verify `python scripts/discover_rls_sources.py --help` exits cleanly.

### Phase 1 — Auth

- Read `playwright/.auth/msal-device-token-cache.json`; attempt silent token
  acquisition.
- If silent fails: device-flow challenge, write refreshed cache.
- Smoke-test token against `GET /v1.0/myorg/` before proceeding.

### Phase 2 — REST scan (Tier 1)

- `list_workspaces(token)` → workspace list.
- `list_datasets(token, workspace_id)` → dataset list.
- `list_datasources(token, workspace_id, dataset_id)` → datasource list.
- For each dataset: filter datasources to file-bearing types (`SharePointOnline`,
  `SharePoint`, `File`, `Web`).
- Emit a Tier 1 row per datasource: populate `source_path`, `source_file`,
  `source_format` (inferred from extension); set `upn_column = "(requires XMLA)"`,
  `discovery_method = "rest"`.

### Phase 3 — XMLA scan (Tier 2)

- Attempt `import pyadomd`; if unavailable set `xmla_available = False`.
- For each dataset with `xmla_available`:
  - Connect via XMLA connection string using bearer token.
  - Read all RLS roles and their `filterExpression` values.
  - For each role whose expression contains `USERPRINCIPALNAME()`:
    - Extract `upn_column` from the expression via regex.
    - Read M partition expressions for the filtered table.
    - Extract `source_path`, `source_file`, `source_format`, `source_sheet`.
  - Merge into or replace the Tier 1 row; set `discovery_method = "xmla"`.

### Phase 4 — Manifest output

- Deduplicate entries by `(dataset_id, role_name, source.path)`.
- Sort by `workspace_name`, `dataset_name`, `role_name`.
- Write `rls_sources_manifest.yaml` (`pyyaml`, `allow_unicode=True`,
  `default_flow_style=False`, `sort_keys=False`).
- Print terminal summary: `N datasets • M roles with UPN filter • K file sources`.
- Print first-50-entry results table; full output with `--verbose`.
- Print the output path: `→ rls_sources_manifest.yaml`.

### Phase 5 — Hardening

- 429 throttling: exponential back-off with jitter (same pattern as main suite).
- 403 on a dataset: skip with a warning; do not abort the whole scan.
- Document the `--admin` flag path (requires Power BI admin role; broader
  coverage; not implemented by default).
- Add a short "RLS Source Discovery" section to `README.md`.

---

## Acceptance criteria

| # | Criterion |
|---|---|
| AC-1 | `python scripts/discover_rls_sources.py --help` exits 0 and prints usage. |
| AC-2 | After a scan, `rls_sources_manifest.yaml` contains one entry per (dataset × role × source) with `workspace_name`, `dataset_name`, `role_name`, `upn_column`, `source.path`, `source.file`, `source.format` populated. |
| AC-3 | Datasets with no RLS role referencing `USERPRINCIPALNAME()` produce no row. |
| AC-4 | A Tier 2 (XMLA) row has `upn_column` set to the actual column name; a Tier 1-only row has `upn_column = "(requires XMLA)"` and `discovery_method = "rest"`. |
| AC-5 | Scanning 500 reports in Tier 1 mode completes in under 15 minutes. |
| AC-6 | If `playwright/.auth/msal-device-token-cache.json` is valid, no login prompt appears. |
| AC-7 | The manifest YAML is parseable by a downstream Python script with `yaml.safe_load()` and iterable as a list of dicts. |

---

## Security

- Output files **contain internal SharePoint URLs and file paths** — they are
  gitignored and should not be shared outside your machine.
- The script never writes credentials; it only reads the existing MSAL token
  cache written by `npm run setup`.
- No credentials, tokens, or UPN values are written to the manifest.

---

## Relationship to main suite

`discover_rls_sources.py` is a standalone scouting tool.  It produces the manifest
that a future `validate_rls.py` test script will read as its configuration.  It
does not depend on Node.js, does not affect `npm test` or `npm run setup`, and
produces no Playwright tests of its own.
