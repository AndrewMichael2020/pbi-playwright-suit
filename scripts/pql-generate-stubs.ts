/**
 * pql-generate-stubs — generate DAX test files for pql-test
 *
 * Reads enterprise.generated.json, queries each dataset's schema via the
 * Power BI executeQueries REST API and writes:
 *
 *   pql/<ReportName>.SemanticModel/DAXQueries/Schema.DEV.Tests.dax
 *     — PQL.Assert.Tbl.ShouldExist + PQL.Assert.Col.ShouldExist for every
 *       non-hidden table and column in the live model.
 *
 *   pql/<ReportName>.SemanticModel/DAXQueries/DataQuality.DEV.Tests.dax
 *     — PQL.Assert.Col.ShouldBeDistinct for every column marked IsKey=TRUE in
 *       the model metadata.  Fully auto-generated — no manual editing needed.
 *       If the model has no key columns the file is generated with a comment.
 *
 * Uses the same Bearer token already acquired by npm run setup — no separate
 * Python/pql-test auth required for this step.
 *
 * Usage:
 *   npm run pql:generate
 *
 * Prerequisites:
 *   npm run setup   (must have run first — writes enterprise.generated.json)
 */

import fs   from 'node:fs';
import path from 'node:path';
import {
  getAccessToken,
  getPowerBiEndpoints,
  readEnterpriseCredentialsFromEnv,
} from '../playwright/helper-functions/powerbi-enterprise';
import { loadEnterpriseConfigs } from '../playwright/helper-functions/enterprise-config';
import { loadEnvFile }           from '../playwright/helper-functions/env-loader';

loadEnvFile();

// ── colour helpers ────────────────────────────────────────────────────────────

const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ── types returned by executeQueries ─────────────────────────────────────────

interface ExecQueryResult {
  tables: { rows: Record<string, string | number | boolean | null>[] }[];
}

// ── Power BI executeQueries — runs a DAX query against a dataset ──────────────
// Uses the same REST API as PQL.Assert and Power Automate integration.

async function executeQuery(
  token: string,
  workspaceId: string,
  datasetId: string,
  dax: string,
  apiBase: string,
): Promise<Record<string, string | number | boolean | null>[]> {
  const url = `${apiBase}/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      queries: [{ query: dax }],
      serializerSettings: { includeNulls: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`executeQueries failed (${res.status}): ${body}`);
  }
  const data = await res.json() as { results: ExecQueryResult[] };
  return data.results?.[0]?.tables?.[0]?.rows ?? [];
}

// ── schema fetchers using INFO DAX functions ──────────────────────────────────

interface TableMeta     { name: string; isHidden: boolean }
interface ColumnMeta    { tableName: string; name: string; dataType: string; isHidden: boolean }
interface KeyColumnMeta { tableName: string; columnName: string }

async function fetchTables(
  token: string,
  workspaceId: string,
  datasetId: string,
  apiBase: string,
): Promise<TableMeta[]> {
  const rows = await executeQuery(
    token, workspaceId, datasetId,
    'EVALUATE SELECTCOLUMNS(INFO.VIEW.TABLES(), "Name", [Name], "IsHidden", [IsHidden])',
    apiBase,
  );
  return rows.map((r) => ({
    name:     String(r['Name'] ?? r['[Name]'] ?? ''),
    isHidden: Boolean(r['IsHidden'] ?? r['[IsHidden]']),
  })).filter((t) => t.name);
}

async function fetchColumns(
  token: string,
  workspaceId: string,
  datasetId: string,
  apiBase: string,
): Promise<ColumnMeta[]> {
  const rows = await executeQuery(
    token, workspaceId, datasetId,
    'EVALUATE SELECTCOLUMNS(INFO.VIEW.COLUMNS(), "Table", [TableName], "Column", [Name], "DataType", [DataType], "IsHidden", [IsHidden])',
    apiBase,
  );
  return rows.map((r) => ({
    tableName: String(r['Table'] ?? r['[Table]'] ?? ''),
    name:      String(r['Column'] ?? r['[Column]'] ?? ''),
    dataType:  String(r['DataType'] ?? r['[DataType]'] ?? ''),
    isHidden:  Boolean(r['IsHidden'] ?? r['[IsHidden]']),
  })).filter((c) => c.tableName && c.name);
}

/**
 * Fetches columns marked IsKey=TRUE from INFO.COLUMNS().
 * INFO.COLUMNS() exposes the lower-level TOM metadata including IsKey.
 * We join with INFO.TABLES() via ADDCOLUMNS+LOOKUPVALUE to get table names.
 * Returns empty array on failure (graceful degradation).
 */
async function fetchKeyColumns(
  token: string,
  workspaceId: string,
  datasetId: string,
  apiBase: string,
): Promise<KeyColumnMeta[]> {
  const dax = [
    'EVALUATE',
    'SELECTCOLUMNS(',
    '  FILTER(',
    '    ADDCOLUMNS(',
    '      INFO.COLUMNS(),',
    '      "TableName", LOOKUPVALUE(INFO.TABLES()[Name], INFO.TABLES()[ID], [TableID])',
    '    ),',
    '    [IsKey] = TRUE',
    '  ),',
    '  "TableName", [TableName],',
    '  "Column", [ExplicitName]',
    ')',
  ].join('\n');

  try {
    const rows = await executeQuery(token, workspaceId, datasetId, dax, apiBase);
    return rows
      .map((r) => ({
        tableName:  String(r['TableName']  ?? r['[TableName]']  ?? ''),
        columnName: String(r['Column']     ?? r['[Column]']     ?? ''),
      }))
      .filter((k) => k.tableName && k.columnName);
  } catch (keyErr) {
    throw keyErr; // let caller handle and log
  }
}

// ── DAX file generators ───────────────────────────────────────────────────────

function generateSchemaFile(
  reportName: string,
  tables: TableMeta[],
  columns: ColumnMeta[],
): string {
  const visibleTables  = tables.filter((t) => !t.isHidden);
  const visibleColumns = columns.filter((c) => !c.isHidden);

  const assertions: string[] = [];

  for (const tbl of visibleTables) {
    const safe = tbl.name.replace(/"/g, '\\"');
    assertions.push(`    PQL.Assert.Tbl.ShouldExist("Schema: ${safe} table exists", "${safe}")`);
  }
  for (const col of visibleColumns) {
    const tSafe = col.tableName.replace(/"/g, '\\"');
    const cSafe = col.name.replace(/"/g, '\\"');
    assertions.push(`    PQL.Assert.Col.ShouldExist("Schema: ${tSafe}[${cSafe}] exists", "${tSafe}", "${cSafe}")`);
  }

  return [
    `// Schema drift tests for: ${reportName}`,
    `// Auto-generated by npm run pql:generate — review and trim before committing.`,
    `// Remove tables/columns that are volatile, calculated, or not relevant for drift detection.`,
    ``,
    `DEFINE`,
    `FUNCTION Schema.DEV.Tests = () =>`,
    `  UNION(`,
    assertions.join(',\n'),
    `  )`,
    ``,
    `EVALUATE Schema.DEV.Tests()`,
    ``,
  ].join('\n');
}

function generateDataQualityFile(reportName: string, keyColumns: KeyColumnMeta[]): string {
  const header = [
    `// Key duplication tests for: ${reportName}`,
    `// Auto-generated by npm run pql:generate — commit as-is.`,
    `// Assertions cover every column marked IsKey=TRUE in the model metadata.`,
    ``,
  ];

  if (keyColumns.length === 0) {
    return [
      ...header,
      `// No columns marked as primary keys were found in the model metadata.`,
      `// If the model has key columns, ensure they are marked via the IsKey property`,
      `// in Power BI Desktop (Table view → Mark as date table, or relationship key setting).`,
      ``,
      `DEFINE`,
      `FUNCTION DataQuality.DEV.Tests = () =>`,
      `  ROW("Note", "No key columns detected — skipped")`,
      ``,
      `EVALUATE DataQuality.DEV.Tests()`,
      ``,
    ].join('\n');
  }

  const assertions = keyColumns.map((k) => {
    const tSafe = k.tableName.replace(/'/g, "\\'");
    const cSafe = k.columnName.replace(/'/g, "\\'");
    return `    PQL.Assert.Col.ShouldBeDistinct("DQ: ${tSafe}[${cSafe}] is unique", '${tSafe}'[${cSafe}])`;
  });

  return [
    ...header,
    `DEFINE`,
    `FUNCTION DataQuality.DEV.Tests = () =>`,
    `  UNION(`,
    assertions.join(',\n'),
    `  )`,
    ``,
    `EVALUATE DataQuality.DEV.Tests()`,
    ``,
  ].join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${bold('⚡ pql-test stub generator')}\n`);

  const configs = loadEnterpriseConfigs();
  if (!configs || configs.length === 0) {
    console.error(red('✖ No enterprise.generated.json found. Run npm run setup first.'));
    process.exit(1);
  }

  const credentials = readEnterpriseCredentialsFromEnv();
  if (!credentials) throw new Error('Unable to build enterprise auth settings.');

  const endpoints   = getPowerBiEndpoints(credentials.environment);
  console.log(dim('  Authenticating…'));
  const accessToken = await getAccessToken(credentials, endpoints);
  console.log(green('  ✓ Authenticated\n'));

  // Deduplicate by datasetId — one API call per dataset, not per page
  const seen     = new Set<string>();
  const datasets: { reportName: string; workspaceId: string; datasetId: string }[] = [];
  for (const c of configs) {
    if (!seen.has(c.datasetId)) {
      seen.add(c.datasetId);
      datasets.push({ reportName: c.reportName, workspaceId: c.workspaceId, datasetId: c.datasetId });
    }
  }

  let generated = 0;
  let skipped   = 0;

  for (const ds of datasets) {
    console.log(dim(`  Querying schema: ${ds.reportName}…`));

    let tables:  TableMeta[]  = [];
    let columns: ColumnMeta[] = [];

    try {
      [tables, columns] = await Promise.all([
        fetchTables(accessToken, ds.workspaceId, ds.datasetId, endpoints.apiPrefix),
        fetchColumns(accessToken, ds.workspaceId, ds.datasetId, endpoints.apiPrefix),
      ]);
    } catch (err) {
      console.log(yellow(`  ⚠  Schema query failed for "${ds.reportName}": ${(err as Error).message}`));
      skipped++;
      continue;
    }

    if (tables.length === 0) {
      console.log(yellow(`  ⚠  No tables returned for "${ds.reportName}" — skipping.`));
      skipped++;
      continue;
    }

    const daxDir = path.join(process.cwd(), 'pql', `${ds.reportName}.SemanticModel`, 'DAXQueries');
    fs.mkdirSync(daxDir, { recursive: true });

    const schemaFile = path.join(daxDir, 'Schema.DEV.Tests.dax');
    const dqFile     = path.join(daxDir, 'DataQuality.DEV.Tests.dax');

    // Key columns: separate fetch — graceful on failure (INFO.COLUMNS may not
    // be available on all service tiers; errors are reported but non-fatal)
    let keyColumns: KeyColumnMeta[] = [];
    try {
      keyColumns = await fetchKeyColumns(accessToken, ds.workspaceId, ds.datasetId, endpoints.apiPrefix);
    } catch (keyErr) {
      console.log(yellow(
        `  ⚠  Key-column discovery failed for "${ds.reportName}" — DataQuality file will note no keys detected.\n` +
        `     Error: ${(keyErr as Error).message}\n` +
        `     Report this error for diagnosis if unexpected.`,
      ));
    }

    fs.writeFileSync(schemaFile, generateSchemaFile(ds.reportName, tables, columns));
    const visibleCount = tables.filter((t) => !t.isHidden).length;
    const colCount     = columns.filter((c) => !c.isHidden).length;
    console.log(
      green(`  ✓ Schema.DEV.Tests.dax`) +
      dim(` — ${visibleCount} tables, ${colCount} columns`),
    );

    if (!fs.existsSync(dqFile)) {
      fs.writeFileSync(dqFile, generateDataQualityFile(ds.reportName, keyColumns));
      const keyNote = keyColumns.length > 0
        ? dim(` — ${keyColumns.length} key column(s) auto-discovered`)
        : yellow(` — no key columns found in model metadata`);
      console.log(green(`  ✓ DataQuality.DEV.Tests.dax`) + keyNote);
    } else {
      console.log(dim(`  → DataQuality.DEV.Tests.dax already exists — not overwritten`));
    }

    generated++;
    console.log();
  }

  console.log(
    bold('Done.') + '  ' +
    green(`${generated} report(s) generated`) +
    (skipped > 0 ? `  ${yellow(`${skipped} skipped`)}` : ''),
  );

  if (generated > 0) {
    console.log(dim('\n  Next steps:'));
    console.log(dim('  1. Review Schema.DEV.Tests.dax — remove volatile/calculated tables if needed'));
    console.log(dim('  2. Commit the pql/ directory'));
    console.log(dim('  3. pql-test auth login  (one-time, if not already done)'));
    console.log(dim('  4. npm run setup → choose [7] or [8] in the focus menu\n'));
  }
}

void main().catch((err: unknown) => {
  console.error(red('\n✖ Generator failed:'), err instanceof Error ? err.message : String(err));
  process.exit(1);
});

