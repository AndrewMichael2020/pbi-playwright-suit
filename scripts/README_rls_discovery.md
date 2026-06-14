# RLS Source Discovery Service

Scans every semantic model in a Power BI workspace and produces
`rls_discovery/rls_sources_manifest.yaml` — a machine-readable record of every
dataset, role, and source file that participates in Row-Level Security.

The manifest is the configuration input for downstream RLS validation tests.

---

## What it does

| Lane | What is detected |
|---|---|
| **Tier 2 — XMLA** | Role name · RLS table · DAX filter expression · UPN column · M partition source (file path or Dataverse) |
| **Tier 1 — REST fallback** | Source file path and format · UPN column sniffed from file headers |

For each dataset the script:

1. Connects via XMLA (if SSMS 21 DLLs are available) using `AdomdConnection` directly, and queries `TMSCHEMA_ROLES`, `TMSCHEMA_TABLE_PERMISSIONS`, and `TMSCHEMA_PARTITIONS`
2. Extracts all roles whose DAX filter contains `USERPRINCIPALNAME()`
3. Reads the M partition expression to locate the source file (SharePoint, UNC share, Dataverse, etc.)
4. Attempts to identify the UPN column by:
   - Keyword matching on column headers (`email`, `upn`, `fh email`, `loginname`, …)
   - Parsing `Table.RenameColumns` steps in the M expression
   - Sampling data rows for `@`-containing values
   - Skipping derived/downstream tables (`Source = #"..."`) that inherit from a parent

If XMLA is unavailable, the script falls back to the Power BI REST datasource API (Tier 1), opens accessible XLSX/CSV files directly, and records what it finds.

---

## Quick start

```powershell
# Install dependencies (once)
pip install -r scripts/requirements_rls.txt

# Run interactively — pick workspace and dataset
python scripts/discover_rls_sources.py

# Scan a specific workspace + dataset non-interactively
python scripts/discover_rls_sources.py --workspace "FHA-ADAR-BI-UAT" --dataset "UPCC Dashboard"

# Scan all workspaces (slow — 50+ workspaces)
python scripts/discover_rls_sources.py --all
```

Output is written to **`rls_discovery/rls_sources_manifest.yaml`** in the project root.

---

## CLI flags

| Flag | Description |
|---|---|
| `--workspace NAME` | Target a specific workspace by name (exact or fuzzy) |
| `--dataset NAME` | Target a specific dataset/model by name |
| `--all` | Scan every workspace without prompting |
| `--no-xmla` | Tier 1 REST only — skip XMLA even if pyadomd is installed |
| `--output DIR` | Write manifest to a custom directory |
| `--verbose` | Print all result rows (default: first 50) |
| `--debug` | Print full diagnostic output for every API call and query |

---

## Authentication

Reuses the MSAL token cache written by `npm run setup`.  
If absent or expired, initiates an interactive **device-flow** sign-in:

```
To sign in, open https://login.microsoft.com/device and enter the code XXXXXXXX
```

Token is cached at `playwright/.auth/msal-device-token-cache.json` for subsequent runs.

---

## Enabling XMLA (Tier 2)

XMLA provides full role/table/filter detail that the REST API cannot return.

**Requirements:**
- Power BI Premium or Fabric capacity (XMLA endpoint must be enabled)
- SSMS 21 installed at the default path:  
  `C:\Program Files\Microsoft SQL Server Management Studio 21\Release\Common7\IDE\`
- `pythonnet` (`clr`) — typically installed as a dependency of pyadomd, or install directly:

```powershell
pip install pythonnet
```

The script uses `AdomdConnection` directly from the SSMS DLLs via `pythonnet/clr` —
**pyadomd is no longer required**. It falls back to Tier 1 silently if the DLLs are absent.

To enable the XMLA endpoint:  
**Power BI Admin Portal → Workspaces → (workspace) → Dataset settings → XMLA endpoint → Read**

---

## Diagnosing XMLA connectivity

Run these PowerShell commands to verify everything is in place before filing a bug.

### 1 — Check DLLs exist

```powershell
$base = "C:\Program Files\Microsoft SQL Server Management Studio 21\Release\Common7\IDE"
"Microsoft.AnalysisServices.Core.dll",
"Microsoft.AnalysisServices.Tabular.dll",
"Microsoft.AnalysisServices.AdomdClient.dll" | ForEach-Object {
    $p = Join-Path $base $_
    [PSCustomObject]@{ File = $_; Exists = (Test-Path $p) }
}
```

Expected: all three rows show `Exists = True`.

### 2 — Load DLL and open an XMLA connection

```powershell
$token = Get-Content "playwright\.auth\msal-device-token-cache.json" |
    ConvertFrom-Json |
    Select-Object -ExpandProperty AccessToken |
    Select-Object -First 1

Add-Type -Path "C:\Program Files\Microsoft SQL Server Management Studio 21\Release\Common7\IDE\Microsoft.AnalysisServices.AdomdClient.dll"

$ws   = "FHA-ADAR-BI-UAT"    # replace with your workspace
$ds   = "UPCC Dashboard"      # replace with your dataset
$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection(
    "Provider=MSOLAP;Data Source=powerbi://api.powerbi.com/v1.0/myorg/$ws;Initial Catalog=$ds;User ID=;Password=$token;"
)
$conn.Open()
Write-Host "State: $($conn.State)"   # should print "State: Open"
$conn.Close()
```

### 3 — Run a TMSCHEMA query

```powershell
# (after step 2, before $conn.Close())
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT * FROM `$SYSTEM.TMSCHEMA_ROLES"
$reader = $cmd.ExecuteReader()
while ($reader.Read()) {
    Write-Host "Role: $($reader.GetValue(1))"   # column 1 = Name
}
$reader.Close()
```

### 4 — Confirm pythonnet sees the DLLs

```powershell
python -c "
import clr
clr.AddReference(r'C:\Program Files\Microsoft SQL Server Management Studio 21\Release\Common7\IDE\Microsoft.AnalysisServices.AdomdClient.dll')
from Microsoft.AnalysisServices.AdomdClient import AdomdConnection
print('OK — AdomdConnection loaded')
"
```

### Common errors

| Error | Likely cause | Fix |
|---|---|---|
| `FileNotFoundException: AdomdClient` | DLL path wrong or SSMS 21 not installed | Verify path in step 1 |
| `The specified column was not found` | TMSCHEMA column name case mismatch | Script uses `SELECT *` to avoid this — update the script |
| `Unexpected end of URI` | Workspace name contains special chars | URL-encode or use `--workspace-id` flag |
| `XMLA unavailable` warning | Not a Premium/Fabric workspace | Check capacity assignment in Power BI Admin Portal |
| `400 BadRequest` on XMLA connect | XMLA endpoint not enabled | Enable in Admin Portal → Workspaces → Settings |

---

## Manifest format

```yaml
- workspace_name: FHA-ADAR-BI-UAT
  workspace_id: 61912f81-...
  dataset_name: UPCC Dashboard
  dataset_id: cb211aef-...
  role_name: Restricted          # null for Tier 1 REST results
  rls_table: User Access
  dax_filter: "[email] = USERPRINCIPALNAME()"
  upn_column: email              # null if not resolved
  source:
    path: \\server\share\user-access.xlsx
    file: user-access.xlsx
    format: xlsx                 # xlsx | csv | dataverse | active_directory | embedded
    sheet: null
  discovery_method: xmla         # xmla | rest
  scan_timestamp: '2026-06-14T06:44:07Z'
  notes: ''
```

`role_name`, `rls_table`, `dax_filter` are `null` for Tier 1 REST results — they
require XMLA to resolve.  
`upn_column` is `null` when the column could not be auto-detected; the `notes`
field will list the file's actual column headers to help manual review.

---

## Source classification

| `format` | Meaning |
|---|---|
| `xlsx` / `csv` | Local or UNC network file — script attempts to open and read headers |
| `dataverse` | Dynamics 365 / Common Data Service source |
| `active_directory` | On-prem AD / LDAP source |
| `embedded` | Table embedded directly in the model (no M partition) |
| `non-file` | Other non-file source resolved via M expression |
| `unknown` | Source type not recognised |

---

## Output location

Manifests are written to `rls_discovery/` and excluded from git (`.gitignore`).  
The folder itself is tracked so it always exists after a fresh clone.

---

## Dependencies

| Package | Purpose |
|---|---|
| `msal` | MSAL device-flow authentication |
| `requests` | Power BI REST API calls |
| `pyyaml` | Manifest serialisation |
| `python-dotenv` | `.env` support for `TENANT_ID` etc. |
| `colorama` | Colour output in Windows PowerShell |
| `pythonnet` | CLR bridge — loads SSMS DLLs so `AdomdConnection` is available in Python |
| `openpyxl` | Reading xlsx/xlsm files to sniff UPN column |
| `pyadomd` *(no longer required)* | Previously used as XMLA bridge; replaced by direct `AdomdConnection` via pythonnet |
