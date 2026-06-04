#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
discover_upcc_v14_final.py

The "Gold Master" Metadata Exporter (v14).
- FIX: Reverted DMV queries to use TOP/ORDER BY (fixes "No storage data").
- FORMAT: Exact V8 style with V11 intelligence.
- LOGIC: Validated SQL/M extraction + Full DAX.
"""

import os
import sys
import json
import re
import traceback
from datetime import datetime

import msal
import clr
import requests

# ============================================================================
# CONFIGURATION
# ============================================================================
CLIENT_ID = "d3590ed6-52b3-4102-aeff-aad2292ab01c"
SCOPE = ["https://analysis.windows.net/powerbi/api/.default"]
CACHE_FILE = "token_cache.bin"

# Validated SSMS 21 DLLs
DLL_PATHS = {
    "CORE": r"C:\Program Files\Microsoft SQL Server Management Studio 21\Release\Common7\IDE\Microsoft.AnalysisServices.Core.dll",
    "TABULAR": r"C:\Program Files\Microsoft SQL Server Management Studio 21\Release\Common7\IDE\Microsoft.AnalysisServices.Tabular.dll",
    "ADOMD": r"C:\Program Files\Microsoft SQL Server Management Studio 21\Release\Common7\IDE\Microsoft.AnalysisServices.AdomdClient.dll"
}

# Limits
MAX_DMV_ROWS = 200000 
ANNOTATION_PREFIXES = ("PBI_", "__PBI_")

# ============================================================================
# UTILS
# ============================================================================
def utc_now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

class DebugLog:
    def __init__(self, enabled: bool, path: str | None):
        self.enabled = enabled
        self.path = path
        self._fh = None
        if self.enabled and self.path:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            self._fh = open(self.path, "w", encoding="utf-8")
            self.write(f"[DEBUG LOG START] {utc_now_str()}")

    def write(self, msg: str):
        ts = utc_now_str()
        line = f"[{ts}] {msg}"
        if self.enabled:
            print(line)
        if self._fh:
            self._fh.write(line + "\n")
            self._fh.flush()

    def close(self):
        if self._fh:
            self._fh.close()
            self._fh = None

def try_json_compact(value: str) -> str:
    if not isinstance(value, str): return str(value)
    s = value.strip()
    if not s: return ""
    if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
        try:
            return json.dumps(json.loads(s), ensure_ascii=False, separators=(",", ":"))
        except:
            return value
    return value

def ensure_dlls():
    for label, path in DLL_PATHS.items():
        if not os.path.exists(path):
            raise FileNotFoundError(f"Missing {label} DLL: {path}")

def safe_get_attr(obj, name: str, default=None):
    try: return getattr(obj, name)
    except: return default

def get_id(obj):
    """Safe ID extractor: tries .ID, .Id, then .Name"""
    try:
        return obj.ID
    except:
        pass
    try:
        return obj.Id
    except:
        pass
    try:
        return obj.Name
    except:
        return "Unknown_ID"

def get_distinct_id(obj):
    """Return object ID only when it is meaningfully different from Name."""
    name = safe_get_attr(obj, "Name", None)
    for attr in ("ID", "Id", "ObjectID"):
        try:
            value = getattr(obj, attr)
            if value is None:
                continue
            value = str(value)
            if not value:
                continue
            if name is not None and str(name) == value:
                continue
            return value
        except:
            pass
    return None

# ============================================================================
# PARSING LOGIC
# ============================================================================
def extract_sql_from_m(m_code: str):
    if not m_code: return None
    # Matches content inside Query="...", allowing for escaped "" pairs.
    sql_match = re.search(r'Query\s*=\s*"((?:[^"]|"")*)"', m_code, re.DOTALL)
    if sql_match:
        raw_sql = sql_match.group(1)
        clean_sql = raw_sql.replace('#(lf)', '\n') \
                           .replace('#(tab)', '\t') \
                           .replace('#(cr)', '\r') \
                           .replace('""', '"') \
                           .strip()
        return clean_sql
    return None

def extract_failure_info(refreshes):
    if not refreshes: return ("", "")
    failed = next((r for r in refreshes if r.get("status") == "Failed"), None)
    if not failed: return ("", "")

    def parse_error_payload(raw):
        if not raw: return (None, None)
        try:
            j = json.loads(raw)
            code = j.get("errorCode") or j.get("error", {}).get("code")
            desc_raw = j.get("errorDescription") or j.get("error", {}).get("message")
            desc = None
            try:
                inner = json.loads(desc_raw)
                if isinstance(inner, dict) and "error" in inner:
                    pbi = inner["error"].get("pbi.error") or inner["error"].get("pbiError") or {}
                    details = pbi.get("details") or []
                    if len(details) >= 2:
                        dv = details[1].get("detail", {}).get("value")
                        if dv: desc = dv
                    if not desc and details:
                        desc = details[0].get("message") or details[0].get("detail", {}).get("value")
            except:
                desc = desc_raw
            return (code, desc)
        except:
            return (None, None)

    top_raw = failed.get("serviceExceptionJson") or failed.get("serviceexceptionjson")
    code, msg = parse_error_payload(top_raw)
    if code or msg: return (code or "", msg or "")

    attempts = failed.get("refreshAttempts", []) or []
    for att in attempts:
        code, msg = parse_error_payload(att.get("serviceExceptionJson"))
        if code or msg: return (code or "", msg or "")

    if "error" in failed and isinstance(failed["error"], dict):
        return (failed["error"].get("code", "") or "", failed["error"].get("message", "") or "")
    return ("", "")

# ============================================================================
# AUTHENTICATION
# ============================================================================
def auth_token_interactive(debug: DebugLog) -> str:
    cache = msal.SerializableTokenCache()
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f: cache.deserialize(f.read())
        except: pass

    app = msal.PublicClientApplication(CLIENT_ID, authority="https://login.microsoftonline.com/common", token_cache=cache)
    accounts = app.get_accounts()
    result = app.acquire_token_silent(SCOPE, account=accounts[0]) if accounts else None

    if not result:
        debug.write("[AUTH] Interactive Device Flow...")
        flow = app.initiate_device_flow(scopes=SCOPE)
        if "message" in flow: print(flow["message"])
        result = app.acquire_token_by_device_flow(flow)

    if cache.has_state_changed:
        with open(CACHE_FILE, "w", encoding="utf-8") as f: f.write(cache.serialize())

    if result and "access_token" in result:
        debug.write("[AUTH] Success")
        return result["access_token"]
    raise RuntimeError("Authentication failed")

# ============================================================================
# XMLA & REST
# ============================================================================
def load_tom():
    ensure_dlls()
    clr.AddReference(DLL_PATHS["CORE"])
    clr.AddReference(DLL_PATHS["TABULAR"])
    from Microsoft.AnalysisServices.Tabular import Server
    return Server

def load_adomd():
    ensure_dlls()
    clr.AddReference(DLL_PATHS["ADOMD"])
    from Microsoft.AnalysisServices.AdomdClient import AdomdConnection
    return AdomdConnection

def rest_get_json(url: str, token: str, debug: DebugLog):
    hdrs = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    resp = requests.get(url, headers=hdrs, timeout=60)
    if resp.status_code >= 400:
        debug.write(f"[REST FAIL] {resp.status_code} {url}")
        resp.raise_for_status()
    return resp.json()

def execute_dmv(conn, query, debug: DebugLog):
    """
    Direct Execution with explicit SQL to restore v9 functionality.
    """
    if conn is None:
        debug.write(f"[DMV SKIP] No ADOMD connection for query: {query[:50]}...")
        return []
    cmd = conn.CreateCommand()
    cmd.CommandText = query
    
    out = []
    try:
        reader = cmd.ExecuteReader()
        cols = [reader.GetName(i) for i in range(reader.FieldCount)]
        while reader.Read():
            row = {}
            for i, c in enumerate(cols):
                v = reader.GetValue(i)
                row[c] = str(v) if v is not None else None
            out.append(row)
        reader.Close()
        print(f"  [DMV] Success. Fetched {len(out)} rows.")
    except Exception as e:
        msg = f"[DMV FAIL] Query: {query[:50]}... Error: {e}"
        print(f"  {msg}")
        debug.write(msg)
    return out


def sort_dmv_rows(rows, preferred_keys):
    if not rows:
        return rows

    available = set()
    for row in rows[:10]:
        available.update(row.keys())

    chosen = next((k for k in preferred_keys if k in available), None)
    if not chosen:
        return rows

    def to_num(v):
        try:
            return int(v)
        except Exception:
            try:
                return float(v)
            except Exception:
                return -1

    return sorted(rows, key=lambda r: to_num(r.get(chosen)), reverse=True)


def classify_exception(ex: Exception) -> str:
    msg = str(ex).lower()
    if "authentication failed for all authenticators" in msg:
        return "auth"
    return "other"

def refresh_token_and_server(server, xmla_url: str, debug: DebugLog):
    try:
        if server is not None:
            server.Disconnect()
    except:
        pass
    token = auth_token_interactive(debug)
    ServerCls = load_tom()
    server = ServerCls()
    server.Connect(f"DataSource={xmla_url};Password={token}")
    return token, server

def _to_int(v):
    try:
        return int(v)
    except Exception:
        try:
            return int(float(v))
        except Exception:
            return 0

def build_vertipaq_summary(storage_rows, column_rows, segment_rows):
    """
    Summarize raw DMV rows into:
      - one row per logical table
      - one row per logical column with aggregated segment sizes
    """
    table_map = {}
    for row in storage_rows or []:
        table_name = row.get("DIMENSION_NAME") or row.get("MEASURE_GROUP_NAME") or row.get("TABLE_ID") or "UNKNOWN"
        if table_name.startswith("LocalDateTable_") or table_name.startswith("DateTableTemplate_"):
            continue
        entry = table_map.setdefault(table_name, {
            "table_name": table_name,
            "rows_count_max": 0,
            "raw_object_count": 0,
            "dictionary_size": 0,
            "data_size": 0
        })
        entry["raw_object_count"] += 1
        entry["rows_count_max"] = max(entry["rows_count_max"], _to_int(row.get("ROWS_COUNT")))

    col_lookup = {}
    for row in column_rows or []:
        table_name = row.get("DIMENSION_NAME") or row.get("MEASURE_GROUP_NAME") or "UNKNOWN"
        if table_name.startswith("LocalDateTable_") or table_name.startswith("DateTableTemplate_"):
            continue
        table_id = row.get("TABLE_ID")
        column_id = row.get("COLUMN_ID")
        attribute_name = row.get("ATTRIBUTE_NAME") or column_id or "UNKNOWN_COLUMN"
        key = (table_id, column_id)
        entry = col_lookup.setdefault(key, {
            "table_name": table_name,
            "table_id": table_id,
            "column_id": column_id,
            "column_name": attribute_name,
            "dictionary_size": 0,
            "used_size": 0,
            "records_count_max": 0,
            "segment_count": 0
        })
        entry["dictionary_size"] = max(entry["dictionary_size"], _to_int(row.get("DICTIONARY_SIZE")))
        if not entry["column_name"] and attribute_name:
            entry["column_name"] = attribute_name

    for row in segment_rows or []:
        table_name = row.get("DIMENSION_NAME") or row.get("MEASURE_GROUP_NAME") or "UNKNOWN"
        if table_name.startswith("LocalDateTable_") or table_name.startswith("DateTableTemplate_"):
            continue
        table_id = row.get("TABLE_ID")
        column_id = row.get("COLUMN_ID")
        key = (table_id, column_id)
        entry = col_lookup.setdefault(key, {
            "table_name": table_name,
            "table_id": table_id,
            "column_id": column_id,
            "column_name": column_id or "UNKNOWN_COLUMN",
            "dictionary_size": 0,
            "used_size": 0,
            "records_count_max": 0,
            "segment_count": 0
        })
        entry["used_size"] += _to_int(row.get("USED_SIZE"))
        entry["records_count_max"] = max(entry["records_count_max"], _to_int(row.get("RECORDS_COUNT")))
        entry["segment_count"] += 1

    # roll column sizes up to logical tables
    for entry in col_lookup.values():
        table_entry = table_map.setdefault(entry["table_name"], {
            "table_name": entry["table_name"],
            "rows_count_max": 0,
            "raw_object_count": 0,
            "dictionary_size": 0,
            "data_size": 0
        })
        table_entry["dictionary_size"] += entry["dictionary_size"]
        table_entry["data_size"] += entry["used_size"]

    tables_summary = sorted(table_map.values(), key=lambda x: (x["data_size"], x["dictionary_size"], x["rows_count_max"]), reverse=True)
    columns_summary = sorted(col_lookup.values(), key=lambda x: (x["used_size"] + x["dictionary_size"], x["records_count_max"]), reverse=True)
    return tables_summary, columns_summary


def _is_falsey_text(v):
    return str(v).strip().lower() in ("false", "0", "no", "n")

def _format_bytes(n):
    n = _to_int(n)
    if n >= 1024 ** 3:
        return f"{n / (1024 ** 3):.2f} GB"
    if n >= 1024 ** 2:
        return f"{n / (1024 ** 2):.2f} MB"
    if n >= 1024:
        return f"{n / 1024:.2f} KB"
    return f"{n:,} bytes"

def _safe_ratio(numerator, denominator):
    numerator = _to_int(numerator)
    denominator = _to_int(denominator)
    if denominator <= 0:
        return None
    return numerator / denominator

def compute_model_health_signals(model_obj, rest_info, all_table_names):
    table_names = list(all_table_names or [])
    auto_date_tables = [n for n in table_names if n.startswith("LocalDateTable_") or n.startswith("DateTableTemplate_")]

    refresh_status = (rest_info.get("status") or "").strip() or "Unknown"
    refresh_bad_statuses = {"Failed", "Disabled", "Cancelled", "Unknown", "Error"}
    refresh_failed = refresh_status in refresh_bad_statuses

    rels = model_obj.get("relationships", [])
    inactive_relationships = sum(1 for r in rels if not bool(r.get("active", True)))
    bidirectional_relationships = sum(1 for r in rels if "both" in str(r.get("direction", "")).lower())
    many_to_many_relationships = sum(1 for r in rels if "many -> many" in str(r.get("cardinality", "")).lower())
    relationship_risk_score = inactive_relationships * 1 + bidirectional_relationships * 2 + many_to_many_relationships * 3

    segment_rows = model_obj.get("vertipaq", {}).get("storage_table_column_segments_raw", []) or []
    non_resident_segments = sum(1 for r in segment_rows if _is_falsey_text(r.get("ISRESIDENT")))
    non_resident_examples = []
    for r in segment_rows:
        if _is_falsey_text(r.get("ISRESIDENT")):
            tbl = r.get("DIMENSION_NAME") or r.get("MEASURE_GROUP_NAME") or "UNKNOWN_TABLE"
            col = r.get("COLUMN_ID") or "UNKNOWN_COLUMN"
            non_resident_examples.append(f"{tbl}.{col}")
            if len(non_resident_examples) >= 5:
                break

    raw_columns = model_obj.get("vertipaq", {}).get("storage_table_columns_raw", []) or []
    rel_dict_size = sum(_to_int(r.get("DICTIONARY_SIZE")) for r in raw_columns if str(r.get("TABLE_ID") or "").startswith("R$"))
    rel_used_size = sum(_to_int(r.get("USED_SIZE")) for r in segment_rows if str(r.get("TABLE_ID") or "").startswith("R$"))
    relationship_artifact_count = len({str(r.get("TABLE_ID")) for r in raw_columns + segment_rows if str(r.get("TABLE_ID") or "").startswith("R$")})
    relationship_artifacts_bytes = rel_dict_size + rel_used_size

    table_rows_lookup = {}
    for row in model_obj.get("vertipaq", {}).get("storage_tables", []) or []:
        table_rows_lookup[row.get("table_name")] = _to_int(row.get("rows_count_max"))

    flagged_columns = []
    for c in model_obj.get("vertipaq", {}).get("columns_stats", []) or []:
        table_name = c.get("table_name") or "UNKNOWN_TABLE"
        column_name = c.get("column_name") or c.get("column_id") or "UNKNOWN_COLUMN"
        if table_name.startswith("LocalDateTable_") or table_name.startswith("DateTableTemplate_"):
            continue
        col_id = str(c.get("column_id") or "")
        col_upper = column_name.upper()
        if col_id in ("POS_TO_ID", "ID_TO_POS") or col_upper.startswith("ROWNUMBER") or col_upper == "ROW_NUMBER":
            continue

        dict_size = _to_int(c.get("dictionary_size"))
        used_size = _to_int(c.get("used_size"))
        total_size = dict_size + used_size
        table_rows = table_rows_lookup.get(table_name, 0)
        ratio = _safe_ratio(dict_size, used_size)

        if table_rows < 5000:
            continue
        if total_size < 1048576:
            continue
        if ratio is None:
            continue
        if ratio < 3.0:
            continue

        flagged_columns.append({
            "table_name": table_name,
            "column_name": column_name,
            "dictionary_size": dict_size,
            "used_size": used_size,
            "total_size": total_size,
            "table_rows": table_rows,
            "ratio": ratio
        })

    flagged_columns.sort(key=lambda x: (x["ratio"], x["total_size"]), reverse=True)

    signals = {
        "refresh_health": {
            "id": "OP_003_REFRESH_HEALTH",
            "name": "Last Refresh Failure Detected",
            "description": "Checks the most recent refresh status returned by the Power BI REST API.",
            "why_it_matters": "A failed or unknown last refresh means model content may be stale, incomplete, or operationally unreliable for downstream reports.",
            "result": "FAIL" if refresh_failed else "PASS",
            "status_value": refresh_status,
            "bad_statuses": sorted(refresh_bad_statuses),
            "failure_code": rest_info.get("fail_code") or "",
            "failure_message": rest_info.get("fail_msg") or ""
        },
        "auto_date_time": {
            "id": "AG_001_AUTO_DATE_TIME",
            "name": "Redundant Date Table Pollution",
            "description": "Counts auto-generated local date tables and date table templates created by automatic date/time behavior.",
            "why_it_matters": "These hidden tables increase model clutter, consume memory, and often duplicate date logic that should live in one explicit calendar table.",
            "result": "FLAG" if len(auto_date_tables) > 0 else "PASS",
            "count": len(auto_date_tables),
            "threshold_count": 0,
            "examples": auto_date_tables[:10]
        },
        "dictionary_bloat": {
            "id": "SE_001_DICTIONARY_BLOAT",
            "name": "Dictionary Size Disproportion",
            "description": "Flags columns where dictionary storage is much larger than segment data storage.",
            "why_it_matters": "A large dictionary-to-data ratio often points to high-cardinality text or identifier columns that compress poorly and inflate memory use.",
            "result": "FLAG" if flagged_columns else "PASS",
            "numerator_name": "dictionary_size",
            "denominator_name": "used_size",
            "threshold_ratio": 3.0,
            "min_total_size_bytes": 1048576,
            "min_table_rows": 5000,
            "flagged_count": len(flagged_columns),
            "flagged_columns": flagged_columns[:25]
        },
        "non_resident_segments": {
            "id": "OP_001_NON_RESIDENT_SEGMENTS",
            "name": "Memory Paging Detected",
            "description": "Counts VertiPaq column segments whose DMV flag ISRESIDENT is False.",
            "why_it_matters": "Non-resident segments indicate storage structures that are not currently resident in memory, which can correlate with pressure, paging, or slower access paths.",
            "result": "FLAG" if non_resident_segments > 0 else "PASS",
            "count": non_resident_segments,
            "threshold_count": 0,
            "examples": non_resident_examples
        },
        "heavy_relationship_structures": {
            "id": "SE_002_HEAVY_RELATIONSHIP_STRUCTURES",
            "name": "Expensive Relationship Artifacts",
            "description": "Sums memory used by internal relationship-support artifacts whose TABLE_ID starts with R$.",
            "why_it_matters": "Large relationship-support structures can indicate costly relationship layouts, large bridge patterns, or model shapes that amplify storage overhead.",
            "result": "FLAG" if relationship_artifacts_bytes >= 50 * 1024 * 1024 else "PASS",
            "threshold_mb": 50.0,
            "artifact_count": relationship_artifact_count,
            "bytes": relationship_artifacts_bytes,
            "dict_bytes": rel_dict_size,
            "used_bytes": rel_used_size
        },
        "relationship_risk": {
            "id": "SE_003_RELATIONSHIP_RISK_COMPLEXITY",
            "name": "Relationship Complexity Risk",
            "description": "Computes a weighted score from inactive, bidirectional, and many-to-many relationships.",
            "why_it_matters": "These relationship patterns increase ambiguity risk, complicate filter propagation, and can make DAX behavior harder to reason about and validate.",
            "result": "FLAG" if relationship_risk_score >= 5 else "PASS",
            "score": relationship_risk_score,
            "warn_score": 5,
            "weights": {
                "inactive_relationship": 1,
                "bidirectional_relationship": 2,
                "many_to_many_relationship": 3
            },
            "counts": {
                "inactive_relationships": inactive_relationships,
                "bidirectional_relationships": bidirectional_relationships,
                "many_to_many_relationships": many_to_many_relationships
            }
        }
    }
    return signals

# ============================================================================
# MAIN
# ============================================================================

def connect_adomd(xmla_url: str, token: str, catalog: str, debug):
    AdomdConnection = load_adomd()
    conn_str = (
        f"Data Source={xmla_url};"
        f"Password={token};"
        f"Persist Security Info=True;"
        f"Initial Catalog={catalog}"
    )
    conn = AdomdConnection(conn_str)
    try:
        if debug:
            debug.write(f"[ADOMD] Opening connection. Catalog={catalog}")
    except Exception:
        pass
    conn.Open()
    try:
        conn.ChangeDatabase(catalog)
        try:
            if debug:
                debug.write(f"[CATALOG] ChangeDatabase OK -> {catalog}")
        except Exception:
            pass
    except Exception as ex:
        try:
            if debug:
                debug.write(f"[CATALOG] ChangeDatabase failed: {ex}")
        except Exception:
            pass
    return conn

def safe_get_model(db, model_name: str, debug=None):
    if db is None:
        msg = f"  [WARN] Database object is None for '{model_name}'."
        print(msg)
        try:
            if debug:
                debug.write(msg)
        except Exception:
            pass
        return None

    try:
        return db.Model
    except Exception as ex:
        msg = f"  [WARN] XMLA model unavailable for '{model_name}': {ex}"
        print(msg)
        try:
            if debug:
                debug.write(f"[XMLA] db.Model failed for '{model_name}': {ex}")
        except Exception:
            pass
        return None


def main():
    debug_enabled = input("Enable debug logging? (y/N): ").strip().lower() == "y"
    temp_debug = DebugLog(enabled=debug_enabled, path=None)

    token = auth_token_interactive(temp_debug)
    ServerCls = load_tom()

    # 1. Select Workspace
    temp_debug.write("Fetching Workspaces...")
    ws_data = rest_get_json("https://api.powerbi.com/v1.0/myorg/groups", token, temp_debug)
    workspaces = sorted(ws_data.get("value", []), key=lambda x: x['name'])
    
    if not workspaces:
        print("No workspaces found.")
        sys.exit(1)

    print("\nAvailable Workspaces:")
    for idx, w in enumerate(workspaces, 1):
        print(f"  {idx}. {w['name']}")

    while True:
        try:
            sel = int(input("\nSelect Workspace ID: ").strip()) - 1
            if 0 <= sel < len(workspaces):
                target_ws = workspaces[sel]
                break
        except: pass

    xmla_url = f"powerbi://api.powerbi.com/v1.0/myorg/{target_ws['name']}"
    
    # 2. Select Dataset
    ds_data = rest_get_json(f"https://api.powerbi.com/v1.0/myorg/groups/{target_ws['id']}/datasets", token, temp_debug)
    datasets = sorted(ds_data.get("value", []), key=lambda x: x['name'])
    
    print("\n[MODE] 1. Single Model  2. All Models")
    mode = input("Select: ").strip()
    
    if mode == "1":
        search = input("Search Model Name: ").lower()
        datasets = [d for d in datasets if search in d['name'].lower()]
        for i, d in enumerate(datasets, 1):
            print(f"  {i}. {d['name']}")
        try:
            s_ds = int(input("Select: ").strip()) - 1
            datasets = [datasets[s_ds]]
        except:
            sys.exit(1)

    # Setup Paths
    base_dir = os.path.join("results", f"{target_ws['name']}_{datetime.now().strftime('%Y-%m-%d')}")
    run_dir = os.path.join(base_dir, f"run_{datetime.now().strftime('%H%M%S')}")
    os.makedirs(run_dir, exist_ok=True)
    run_debug = DebugLog(enabled=debug_enabled, path=os.path.join(run_dir, "debug.log"))
    temp_debug.close()

    server = ServerCls()
    server.Connect(f"DataSource={xmla_url};Password={token}")
    
    canonical_data = {"workspace": target_ws['name'], "models": []}

    for ds in datasets:
        model_name = ds['name']
        print(f"Processing: {model_name}...")
        
        # REST Metadata
        rest_info = {
            "created_by": ds.get("configuredBy", ""),
            "last_refresh": "",
            "status": "",
            "last_failed": "",
            "fail_code": "",
            "fail_msg": ""
        }
        
        try:
            r_url = f"https://api.powerbi.com/v1.0/myorg/groups/{target_ws['id']}/datasets/{ds['id']}/refreshes?$top=20"
            ref_json = rest_get_json(r_url, token, run_debug)
            refreshes = ref_json.get("value", [])
            if refreshes:
                rest_info["last_refresh"] = refreshes[0].get("endTime", "")
                rest_info["status"] = refreshes[0].get("status", "")
                for r in refreshes:
                    if r.get("status") == "Failed":
                        rest_info["last_failed"] = r.get("endTime", "")
                        break
                code, msg = extract_failure_info(refreshes)
                rest_info["fail_code"] = code
                rest_info["fail_msg"] = msg
        except Exception as e:
            run_debug.write(f"REST Refresh Error: {e}")

        # TOM Metadata
        def find_db_by_name(server_obj, target_name):
            db_local = None
            try:
                db_local = server_obj.Databases.FindByName(target_name)
                if not db_local:
                    for d in server_obj.Databases:
                        if d.Name == target_name:
                            db_local = d
                            break
            except:
                pass
            return db_local

        db = find_db_by_name(server, model_name)
        if not db:
            print(f"  [WARN] Database not found via XMLA.")
            continue

        model_obj = {
            "name": model_name,
            "id": ds['id'],
            "tables": [],
            "relationships": [],
            "roles": [],
            "vertipaq": {},
            "warnings": []
        }

        model_meta = safe_get_model(db, model_name, run_debug if debug_enabled else None)
        if model_meta is None:
            try:
                err = "unknown"
                # safe_get_model swallowed the exception message into debug; retry once if this looks auth-related
                token, server = refresh_token_and_server(server, xmla_url, run_debug)
                db = find_db_by_name(server, model_name)
                model_meta = safe_get_model(db, model_name, run_debug if debug_enabled else None) if db else None
            except Exception as ex:
                run_debug.write(f"[RETRY AFTER MODEL AUTH FAIL] {ex}")
            if model_meta is None:
                continue

        all_table_names = [safe_get_attr(t, "Name", "") for t in model_meta.Tables]

        # TABLES
        for tbl in model_meta.Tables:
            if tbl.Name.startswith("RowNumber") or tbl.Name.startswith("LocalDateTable"):
                continue
            
            t_obj = {
                "name": tbl.Name,
                "id": get_distinct_id(tbl),
                "isHidden": tbl.IsHidden,
                "columns": [],
                "measures": [],
                "partitions": []
            }

            for c in tbl.Columns:
                t_obj["columns"].append({
                    "name": c.Name,
                    "id": get_distinct_id(c),
                    "type": str(c.DataType),
                    "hidden": c.IsHidden,
                    "format": safe_get_attr(c, "FormatString", "")
                })

            for m in tbl.Measures:
                t_obj["measures"].append({
                    "name": m.Name,
                    "id": get_distinct_id(m),
                    "expression": m.Expression,
                    "hidden": m.IsHidden
                })

            for part in tbl.Partitions:
                src = part.Source
                src_type = type(src).__name__ if src else "None"
                p_obj = {
                    "name": part.Name,
                    "id": get_distinct_id(part),
                    "mode": str(part.Mode),
                    "source_type": src_type,
                    "m_code": "",
                    "extracted_sql": None,
                    "calc_info": ""
                }
                
                if src_type == "MPartitionSource":
                    p_obj["m_code"] = src.Expression
                    p_obj["extracted_sql"] = extract_sql_from_m(src.Expression)
                elif src_type == "QueryPartitionSource":
                    p_obj["extracted_sql"] = src.Query
                    p_obj["m_code"] = "(Legacy Query Source)"
                elif src_type == "CalculatedPartitionSource":
                    p_obj["m_code"] = src.Expression
                    p_obj["calc_info"] = "Calculated Table"
                
                t_obj["partitions"].append(p_obj)
            model_obj["tables"].append(t_obj)

        # Relationships
        for rel in model_meta.Relationships:
            model_obj["relationships"].append({
                "id": get_id(rel),
                "from_table": rel.FromTable.Name,
                "from_col": rel.FromColumn.Name,
                "to_table": rel.ToTable.Name,
                "to_col": rel.ToColumn.Name,
                "active": rel.IsActive,
                "cardinality": str(rel.FromCardinality) + " -> " + str(rel.ToCardinality),
                "direction": str(rel.CrossFilteringBehavior),
                "security": str(safe_get_attr(rel, "SecurityFilteringBehavior", "None"))
            })
        
        # Roles
        for r in model_meta.Roles:
            r_obj = {"name": r.Name, "permissions": [], "members": []}
            for tp in r.TablePermissions:
                if tp.FilterExpression:
                    r_obj["permissions"].append({"table": tp.Table.Name, "filter": tp.FilterExpression})
            try:
                for m in r.Members: r_obj["members"].append(m.MemberName)
            except: pass
            model_obj["roles"].append(r_obj)

        # DMVs
        try:
            conn = None
            conn = connect_adomd(xmla_url, token, model_name, run_debug)

            q1 = f"SELECT TOP {MAX_DMV_ROWS} * FROM $SYSTEM.DISCOVER_STORAGE_TABLES"
            q2 = f"SELECT TOP {MAX_DMV_ROWS} * FROM $SYSTEM.DISCOVER_STORAGE_TABLE_COLUMNS"
            q3 = f"SELECT TOP {MAX_DMV_ROWS} * FROM $SYSTEM.DISCOVER_STORAGE_TABLE_COLUMN_SEGMENTS"

            raw_storage_tables = execute_dmv(conn, q1, run_debug)
            raw_storage_table_columns = execute_dmv(conn, q2, run_debug)
            raw_storage_table_column_segments = execute_dmv(conn, q3, run_debug)

            tables_summary, columns_summary = build_vertipaq_summary(
                raw_storage_tables,
                raw_storage_table_columns,
                raw_storage_table_column_segments
            )

            model_obj["vertipaq"]["storage_tables_raw"] = raw_storage_tables
            model_obj["vertipaq"]["storage_table_columns_raw"] = raw_storage_table_columns
            model_obj["vertipaq"]["storage_table_column_segments_raw"] = raw_storage_table_column_segments
            model_obj["vertipaq"]["storage_tables"] = tables_summary
            model_obj["vertipaq"]["columns_stats"] = columns_summary

            if conn is not None:
                conn.Close()
        except Exception as e:
            run_debug.write(f"DMV Connection Error: {e}")
            try:
                if conn is not None:
                    conn.Close()
            except:
                pass

        model_obj["health_signals"] = compute_model_health_signals(model_obj, rest_info, all_table_names)

        canonical_data["models"].append(model_obj)

        # --- OUTPUT GENERATION (TXT) ---
        out_file = os.path.join(run_dir, f"{model_name}.txt")
        with open(out_file, "w", encoding="utf-8") as f:
            f.write("=== WORKSPACE INFO ===\n")
            f.write(f"[NAME]             {target_ws['name']}\n")
            f.write(f"[WORKSPACE ID]     {target_ws['id']}\n\n")

            f.write("=== MODEL / DATASET INFO ===\n")
            f.write(f"[MODEL NAME]       {model_name}\n")
            f.write(f"[MODEL ID]         {ds['id']}\n")
            f.write(f"[CREATED BY]       {rest_info['created_by']}\n")
            f.write(f"[LAST REFRESH]     {rest_info['last_refresh']}\n")
            f.write(f"[REFRESH STATUS]   {rest_info['status']}\n")
            f.write(f"[LAST FAILED]      {rest_info['last_failed'] or '(none)'}\n")
            f.write(f"[FAILURE CODE]     {rest_info['fail_code']}\n")
            f.write(f"[FAILURE MESSAGE]  {rest_info['fail_msg']}\n")
            f.write(f"[COMPAT LEVEL]     {db.CompatibilityLevel}\n")
            f.write(f"[CULTURE]          {safe_get_attr(model_meta, 'Culture', 'Unknown')}\n\n")

            f.write("=== TABLES ===\n")
            for t in model_obj["tables"]:
                f.write("-" * 60 + "\n")
                f.write(f"[TABLE]          {t['name']}\n")
                if t.get('id'):
                    f.write(f"[TABLE ID]       {t['id']}\n")
                f.write(f"[IS HIDDEN]      {t['isHidden']}\n")
                f.write(f"[COLUMNS]        {len(t['columns'])}\n")
                f.write(f"[MEASURES]       {len(t['measures'])}\n\n")
                
                if t['columns']:
                    f.write("  === COLUMNS ===\n")
                    for c in t['columns']:
                        f.write(f"  [COLUMN]       {c['name']}\n")
                        if c.get('id'):
                            f.write(f"  [COLUMN ID]    {c['id']}\n")
                        f.write(f"  [DATA TYPE]    {c['type']}\n")
                        f.write(f"  [IS HIDDEN]    {c['hidden']}\n")
                        f.write(f"  [FORMAT]       {c['format']}\n\n")

                if t['measures']:
                    f.write("  === MEASURES ===\n")
                    for m in t['measures']:
                        hid = " (Hidden)" if m['hidden'] else ""
                        f.write(f"  [MEASURE]     {m['name']}{hid}\n")
                        if m.get('id'):
                            f.write(f"  [MEASURE ID]  {m['id']}\n")
                        f.write(f"  [EXPRESSION]  {m['expression']}\n\n")

                if t['partitions']:
                    f.write("  === PARTITIONS ===\n")
                    for p in t["partitions"]:
                        f.write(f"  [PARTITION]      {p['name']}\n")
                        if p.get('id'):
                            f.write(f"  [PARTITION ID]   {p['id']}\n")
                        f.write(f"  [MODE]           {p['mode']}\n")
                        f.write(f"  [SOURCE TYPE]    {p['source_type']}\n")
                        
                        if p['extracted_sql']:
                            f.write("  [SQL QUERY]\n")
                            indent_sql = "\n".join(["    " + l for l in p['extracted_sql'].splitlines()])
                            f.write(f"{indent_sql}\n\n")
                        
                        if p['m_code']:
                            f.write("  [M EXPRESSION]\n")
                            indent_m = "\n".join(["    " + l for l in p['m_code'].splitlines()])
                            f.write(f"{indent_m}\n\n")

            f.write("-" * 60 + "\n")
            f.write("=== RELATIONSHIPS ===\n")
            if not model_obj["relationships"]: f.write("(none)\n")
            for rel in model_obj["relationships"]:
                f.write("-" * 60 + "\n")
                f.write(f"[RELATIONSHIP]   {rel['id']}\n")
                f.write(f"[FROM TABLE]     {rel['from_table']}\n")
                f.write(f"[FROM COLUMN]    {rel['from_col']}\n")
                f.write(f"[TO TABLE]       {rel['to_table']}\n")
                f.write(f"[TO COLUMN]      {rel['to_col']}\n")
                f.write(f"[ACTIVE]         {rel['active']}\n")
                f.write(f"[CROSS FILTER]   {rel['direction']}\n")
                f.write(f"[SECURITY FLTR]  {rel['security']}\n")
                f.write(f"[CARDINALITY]    {rel['cardinality']}\n\n")

            f.write("=== ROLES (RLS + OLS) ===\n")
            if not model_obj["roles"]: f.write("(none)\n")
            for r in model_obj["roles"]:
                f.write("-" * 60 + "\n")
                f.write(f"[ROLE]           {r['name']}\n")
                if r['members']:
                    f.write(f"  [MEMBERS]      {len(r['members'])}\n")
                    for m in r['members']: f.write(f"    - {m}\n")
                for perm in r['permissions']:
                    f.write(f"  [RLS]          {perm['table']}: {perm['filter']}\n")
            f.write("\n")

            f.write("="*80 + "\n   VERTIPAQ STORAGE (Top Tables)\n" + "="*80 + "\n")
            st = model_obj["vertipaq"].get("storage_tables", [])
            if st:
                for s in st:
                    name = s.get('table_name') or s.get('DIMENSION_NAME') or s.get('TABLE_ID') or 'UNKNOWN'
                    rows = _to_int(s.get('rows_count_max', s.get('ROWS_COUNT', 0)))
                    d_size = _to_int(s.get('dictionary_size', s.get('DICTIONARY_SIZE', 0)))
                    data_size = _to_int(s.get('data_size', s.get('DATA_SIZE', 0)))
                    
                    f.write(f"{name:<50} | {rows:>15,} rows | Dict: {d_size:>10,} bytes | Data: {data_size:>10,} bytes\n")
            else:
                f.write("No storage data available.\n")
                
            f.write("\n" + "="*80 + "\n   VERTIPAQ TOP HEAVY COLUMNS (Size > 1MB)\n" + "="*80 + "\n")
            cols_stat = model_obj["vertipaq"].get("columns_stats", [])
            heavy_found = False
            if cols_stat:
                for c in cols_stat:
                    size = _to_int(c.get('used_size', c.get('USED_SIZE', 0))) + _to_int(c.get('dictionary_size', c.get('DICTIONARY_SIZE', 0)))
                    if size < 1000000:
                        continue
                    heavy_found = True
                    t_name = c.get('table_name') or c.get('DIMENSION_NAME') or c.get('TABLE_ID') or 'UNKNOWN_TABLE'
                    c_name = c.get('column_name') or c.get('ATTRIBUTE_NAME') or c.get('COLUMN_ID') or 'UNKNOWN_COLUMN'
                    f.write(f"{t_name}.{c_name:<50} : {size/1024/1024:.2f} MB\n")
            if not heavy_found:
                f.write("(none above 1 MB)\n")


            f.write("\n" + "="*80 + "\n   MODEL HEALTH SIGNALS\n" + "="*80 + "\n")
            hs = model_obj.get("health_signals", {})

            refresh_sig = hs.get("refresh_health", {})
            f.write(f"[{refresh_sig.get('id','')}] {refresh_sig.get('name','')}\n")
            f.write(f"Description: {refresh_sig.get('description','')}\n")
            f.write(f"Why it matters: {refresh_sig.get('why_it_matters','')}\n")
            f.write(f"Developer meaning: The latest refresh status is '{refresh_sig.get('status_value','Unknown')}'. Anything in {refresh_sig.get('bad_statuses', [])} means the last processing cycle should be treated as operationally unhealthy.\n")
            f.write(f"Result: {refresh_sig.get('result','UNKNOWN')} | Last refresh status = {refresh_sig.get('status_value','Unknown')}\n")
            if refresh_sig.get("failure_code") or refresh_sig.get("failure_message"):
                f.write(f"Failure detail: {refresh_sig.get('failure_code','')} {refresh_sig.get('failure_message','')}\n")
            f.write("\n")

            auto_sig = hs.get("auto_date_time", {})
            f.write(f"[{auto_sig.get('id','')}] {auto_sig.get('name','')}\n")
            f.write(f"Description: {auto_sig.get('description','')}\n")
            f.write(f"Why it matters: {auto_sig.get('why_it_matters','')}\n")
            f.write("Developer meaning: Auto date/time tables are hidden helper tables that Power BI creates for date columns. They are usually a sign that the model relies on automatic time intelligence instead of one deliberate calendar design.\n")
            f.write(f"Logic: count tables whose names match LocalDateTable_* or DateTableTemplate_*. Threshold = {auto_sig.get('threshold_count', 0)}.\n")
            f.write(f"Result: {auto_sig.get('result','UNKNOWN')} | Count = {auto_sig.get('count', 0)}\n")
            if auto_sig.get("examples"):
                f.write("Examples:\n")
                for ex in auto_sig.get("examples", []):
                    f.write(f"  - {ex}\n")
            f.write("\n")

            dict_sig = hs.get("dictionary_bloat", {})
            f.write(f"[{dict_sig.get('id','')}] {dict_sig.get('name','')}\n")
            f.write(f"Description: {dict_sig.get('description','')}\n")
            f.write(f"Why it matters: {dict_sig.get('why_it_matters','')}\n")
            f.write("Developer meaning: A flagged column is memory-expensive because its dictionary grows much faster than its segment data. This often happens with high-cardinality text, GUID-like keys, or identifiers stored as text.\n")
            f.write(f"Numerator: {dict_sig.get('numerator_name','dictionary_size')} = bytes from DISCOVER_STORAGE_TABLE_COLUMNS.DICTIONARY_SIZE\n")
            f.write(f"Denominator: {dict_sig.get('denominator_name','used_size')} = bytes from DISCOVER_STORAGE_TABLE_COLUMN_SEGMENTS.USED_SIZE\n")
            f.write(f"Logic: dictionary_size / used_size >= {dict_sig.get('threshold_ratio', 0)} and total_size >= {_format_bytes(dict_sig.get('min_total_size_bytes', 0))} and logical table rows >= {dict_sig.get('min_table_rows', 0):,}.\n")
            f.write(f"Result: {dict_sig.get('result','UNKNOWN')} | Flagged columns = {dict_sig.get('flagged_count', 0)}\n")
            f.write("\n")

            nonres_sig = hs.get("non_resident_segments", {})
            f.write(f"[{nonres_sig.get('id','')}] {nonres_sig.get('name','')}\n")
            f.write(f"Description: {nonres_sig.get('description','')}\n")
            f.write(f"Why it matters: {nonres_sig.get('why_it_matters','')}\n")
            f.write("Developer meaning: A non-resident segment means VertiPaq reports that a segment is not resident in memory at the time of inspection. This is an operational signal, not automatically a design bug, but it is worth tracking on large or busy models.\n")
            f.write(f"Logic: count rows in DISCOVER_STORAGE_TABLE_COLUMN_SEGMENTS where ISRESIDENT = False. Threshold = {nonres_sig.get('threshold_count', 0)}.\n")
            f.write(f"Result: {nonres_sig.get('result','UNKNOWN')} | Count = {nonres_sig.get('count', 0)}\n")
            if nonres_sig.get("examples"):
                f.write("Examples:\n")
                for ex in nonres_sig.get("examples", []):
                    f.write(f"  - {ex}\n")
            f.write("\n")

            relart_sig = hs.get("heavy_relationship_structures", {})
            f.write(f"[{relart_sig.get('id','')}] {relart_sig.get('name','')}\n")
            f.write(f"Description: {relart_sig.get('description','')}\n")
            f.write(f"Why it matters: {relart_sig.get('why_it_matters','')}\n")
            f.write("Developer meaning: Internal R$ artifacts are relationship-support storage structures. When they become large, relationship design itself is consuming substantial memory.\n")
            f.write(f"Logic: sum bytes for internal TABLE_ID values beginning with R$. Threshold = {relart_sig.get('threshold_mb', 0):.1f} MB.\n")
            f.write(f"Result: {relart_sig.get('result','UNKNOWN')} | Artifact count = {relart_sig.get('artifact_count', 0)} | Total = {_format_bytes(relart_sig.get('bytes', 0))} | Dict = {_format_bytes(relart_sig.get('dict_bytes', 0))} | Used = {_format_bytes(relart_sig.get('used_bytes', 0))}\n")
            f.write("\n")

            risk_sig = hs.get("relationship_risk", {})
            f.write(f"[{risk_sig.get('id','')}] {risk_sig.get('name','')}\n")
            f.write(f"Description: {risk_sig.get('description','')}\n")
            f.write(f"Why it matters: {risk_sig.get('why_it_matters','')}\n")
            f.write("Developer meaning: This is a weighted design-risk score, not a service error. Higher scores mean more relationship patterns that tend to complicate filter flow, model predictability, and DAX reasoning.\n")
            weights = risk_sig.get("weights", {})
            counts = risk_sig.get("counts", {})
            f.write(f"Logic: score = inactive_relationships * {weights.get('inactive_relationship', 0)} + bidirectional_relationships * {weights.get('bidirectional_relationship', 0)} + many_to_many_relationships * {weights.get('many_to_many_relationship', 0)}.\n")
            f.write(f"Components: inactive = {counts.get('inactive_relationships', 0)}, bidirectional = {counts.get('bidirectional_relationships', 0)}, many-to-many = {counts.get('many_to_many_relationships', 0)}.\n")
            f.write(f"Result: {risk_sig.get('result','UNKNOWN')} | Score = {risk_sig.get('score', 0)} | Warning threshold = {risk_sig.get('warn_score', 0)}\n")

            f.write("\n" + "="*80 + "\n   TOP FLAGGED COLUMNS\n" + "="*80 + "\n")
            f.write("What this section means: these are the columns flagged by the Dictionary Size Disproportion metric. They are shown because their dictionary storage is large relative to their segment data storage, which can point to expensive high-cardinality storage patterns.\n\n")
            flagged_cols = dict_sig.get("flagged_columns", [])
            if flagged_cols:
                for i, col in enumerate(flagged_cols, 1):
                    ratio_txt = f"{col['ratio']:.2f}x"
                    f.write(f"[{i}] {col['table_name']}.{col['column_name']}\n")
                    f.write(f"    Ratio (dictionary_size / used_size): {ratio_txt}\n")
                    f.write(f"    Numerator: dictionary_size = {_format_bytes(col['dictionary_size'])}\n")
                    f.write(f"    Denominator: used_size = {_format_bytes(col['used_size'])}\n")
                    f.write(f"    Total size: {_format_bytes(col['total_size'])}\n")
                    f.write(f"    Logical table rows: {col['table_rows']:,}\n\n")
            else:
                f.write("(none)\n")

            if model_obj.get("warnings"):
                f.write("\n=== WARNINGS ===\n")
                for w in model_obj["warnings"]: f.write(f"- {w}\n")

    server.Disconnect()
    print(f"\n[DONE] Results saved to: {run_dir}")

if __name__ == "__main__":
    main()