/**
 * Parses the structured .txt output produced by a Python Power BI metadata
 * discovery script into a committed JSON model baseline.
 *
 * Usage:
 *   npm run ingest:model-txt -- "MyReport.txt"
 *   npm run ingest:model-txt -- "MyReport.txt" --out playwright/fixtures/snapshots/model-baseline/my-report.json
 *
 * When a baseline already exists the script prints a drift summary and exits
 * with code 1 if structural changes are detected (new M:M, removed tables,
 * cardinality changes, new bidirectional cross-filters).
 */

import * as fs   from 'fs';
import * as path from 'path';

// ─── types ───────────────────────────────────────────────────────────────────

interface BaselineColumn {
  name: string;
  dataType: string;
  hidden: boolean;
}

interface BaselineTable {
  name: string;
  hidden: boolean;
  columnCount: number;
  measureCount: number;
  columns: BaselineColumn[];
}

interface BaselineRelationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  active: boolean;
  crossFilter: string;
  cardinality: string;
}

interface ModelBaseline {
  modelName: string;
  workspaceName: string;
  capturedAt: string;
  lastRefreshStatus: string;
  lastFailureCode: string;
  tables: BaselineTable[];
  relationships: BaselineRelationship[];
  /** Keys that are intentionally Many→Many — will not flag in model-structure tests. */
  intentionalManyToMany: string[];
  /** Keys that are intentionally bidirectional — will not flag in model-structure tests. */
  intentionalBidirectional: string[];
}

// ─── relationship key helper ──────────────────────────────────────────────────

function relKey(r: BaselineRelationship): string {
  return `${r.fromTable}::${r.fromColumn} → ${r.toTable}::${r.toColumn}`;
}

// ─── parser ───────────────────────────────────────────────────────────────────

function parseTxt(content: string): ModelBaseline {
  const lines = content.split('\n');

  let section = '';
  let modelName = '';
  let workspaceName = '';
  let capturedAt = '';
  let lastRefreshStatus = '';
  let lastFailureCode = '';

  const tables: BaselineTable[] = [];
  const relationships: BaselineRelationship[] = [];

  let currentTable: BaselineTable | null = null;
  let inColumnsBlock = false;
  let currentColumn: Partial<BaselineColumn> | null = null;

  let currentRel: Partial<BaselineRelationship> | null = null;

  function flushColumn() {
    if (currentColumn?.name && currentTable) {
      currentTable.columns.push({
        name: currentColumn.name,
        dataType: currentColumn.dataType ?? '',
        hidden: currentColumn.hidden ?? false,
      });
    }
    currentColumn = null;
  }

  function flushTable() {
    flushColumn();
    if (currentTable) tables.push(currentTable);
    currentTable = null;
    inColumnsBlock = false;
  }

  function flushRel() {
    if (currentRel?.id) {
      relationships.push({
        id: currentRel.id,
        fromTable:   currentRel.fromTable   ?? '',
        fromColumn:  currentRel.fromColumn  ?? '',
        toTable:     currentRel.toTable     ?? '',
        toColumn:    currentRel.toColumn    ?? '',
        active:      currentRel.active      ?? true,
        crossFilter: currentRel.crossFilter ?? 'OneDirection',
        cardinality: currentRel.cardinality ?? '',
      });
    }
    currentRel = null;
  }

  function field(line: string): [string, string] | null {
    const m = line.match(/^\s*\[([^\]]+)\]\s+(.*)/);
    if (!m) return null;
    return [m[1].trim(), m[2].trim()];
  }

  for (const raw of lines) {
    const line = raw.trimEnd();

    // ── section headers ──
    if (/^=== WORKSPACE INFO ===/.test(line))    { section = 'WORKSPACE'; continue; }
    if (/^=== MODEL \/ DATASET INFO ===/.test(line)) { section = 'MODEL'; continue; }
    if (/^=== TABLES ===/.test(line))            { flushTable(); section = 'TABLES'; continue; }
    if (/^=== RELATIONSHIPS ===/.test(line))     { flushTable(); flushRel(); section = 'RELATIONSHIPS'; continue; }
    if (/^===/.test(line))                       { flushTable(); flushRel(); section = 'OTHER'; continue; }

    // ── separator lines ──
    if (/^-{20,}/.test(line.trim())) {
      if (section === 'TABLES')         { flushTable(); }
      if (section === 'RELATIONSHIPS')  { flushRel(); }
      continue;
    }

    const kv = field(line);
    if (!kv) continue;
    const [key, value] = kv;

    // ── workspace / model header ──
    if (section === 'WORKSPACE') {
      if (key === 'NAME')         workspaceName = value;
      continue;
    }
    if (section === 'MODEL') {
      if (key === 'MODEL NAME')     modelName = value;
      if (key === 'LAST REFRESH')   capturedAt = value;
      if (key === 'REFRESH STATUS') lastRefreshStatus = value;
      if (key === 'FAILURE CODE')   lastFailureCode = value;
      continue;
    }

    // ── tables ──
    if (section === 'TABLES') {
      // Top-level table field vs indented column field
      const isIndented = /^\s{2,}/.test(raw);

      if (!isIndented) {
        // New top-level field
        if (key === 'TABLE') {
          flushTable();
          currentTable = { name: value, hidden: false, columnCount: 0, measureCount: 0, columns: [] };
          inColumnsBlock = false;
        } else if (currentTable) {
          if (key === 'IS HIDDEN')  currentTable.hidden = value === 'True';
          if (key === 'COLUMNS')    currentTable.columnCount = parseInt(value, 10) || 0;
          if (key === 'MEASURES')   currentTable.measureCount = parseInt(value, 10) || 0;
        }
      } else {
        // Indented — inside === COLUMNS === sub-block or a column entry
        if (key === 'COLUMN') {
          flushColumn();
          currentColumn = { name: value };
          inColumnsBlock = true;
        } else if (inColumnsBlock && currentColumn) {
          if (key === 'DATA TYPE') currentColumn.dataType = value;
          if (key === 'IS HIDDEN') currentColumn.hidden   = value === 'True';
        }
      }
      continue;
    }

    // ── relationships ──
    if (section === 'RELATIONSHIPS') {
      if (key === 'RELATIONSHIP') { flushRel(); currentRel = { id: value }; }
      else if (currentRel) {
        if (key === 'FROM TABLE')  currentRel.fromTable   = value;
        if (key === 'FROM COLUMN') currentRel.fromColumn  = value;
        if (key === 'TO TABLE')    currentRel.toTable     = value;
        if (key === 'TO COLUMN')   currentRel.toColumn    = value;
        if (key === 'ACTIVE')      currentRel.active      = value === 'True';
        if (key === 'CROSS FILTER') currentRel.crossFilter = value;
        if (key === 'CARDINALITY') currentRel.cardinality = value;
      }
      continue;
    }
  }

  flushTable();
  flushRel();

  // Populate intentional lists: every M:M and every bidirectional relationship
  // that exists in the FIRST parse becomes "intentional by current design."
  // Operators update the allowlists manually when they deliberately change
  // cardinality; anything NEW appearing outside the allowlist fails the test.
  const intentionalManyToMany = relationships
    .filter((r) => r.cardinality === 'Many -> Many')
    .map(relKey);

  const intentionalBidirectional = relationships
    .filter((r) => r.crossFilter === 'BothDirections')
    .map(relKey);

  return {
    modelName,
    workspaceName,
    capturedAt,
    lastRefreshStatus,
    lastFailureCode,
    tables,
    relationships,
    intentionalManyToMany,
    intentionalBidirectional,
  };
}

// ─── drift detection ──────────────────────────────────────────────────────────

interface DriftReport {
  addedTables: string[];
  removedTables: string[];
  cardinalityChanges: Array<{ key: string; was: string; now: string }>;
  newManyToMany: string[];
  newBidirectional: string[];
}

function detectDrift(committed: ModelBaseline, fresh: ModelBaseline): DriftReport {
  const committedTableNames = new Set(committed.tables.map((t) => t.name));
  const freshTableNames     = new Set(fresh.tables.map((t) => t.name));

  const addedTables   = [...freshTableNames].filter((n) => !committedTableNames.has(n));
  const removedTables = [...committedTableNames].filter((n) => !freshTableNames.has(n));

  // Map relationship key → cardinality for both baselines
  const committedCard = new Map(committed.relationships.map((r) => [relKey(r), r.cardinality]));
  const freshCard     = new Map(fresh.relationships.map((r) => [relKey(r), r.cardinality]));

  const cardinalityChanges: DriftReport['cardinalityChanges'] = [];
  for (const [key, nowCard] of freshCard) {
    const wasCard = committedCard.get(key);
    if (wasCard && wasCard !== nowCard) {
      cardinalityChanges.push({ key, was: wasCard, now: nowCard });
    }
  }

  const committedMM = new Set(committed.intentionalManyToMany);
  const freshMM     = fresh.relationships.filter((r) => r.cardinality === 'Many -> Many').map(relKey);
  const newManyToMany = freshMM.filter((k) => !committedMM.has(k));

  const committedBidi = new Set(committed.intentionalBidirectional);
  const freshBidi     = fresh.relationships.filter((r) => r.crossFilter === 'BothDirections').map(relKey);
  const newBidirectional = freshBidi.filter((k) => !committedBidi.has(k));

  return { addedTables, removedTables, cardinalityChanges, newManyToMany, newBidirectional };
}

// ─── entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log('Usage: npm run ingest:model-txt -- "<file>.txt" [--out <output.json>]');
  process.exit(0);
}

const inputPath = args[0];
const outIdx    = args.indexOf('--out');
const outputPath = outIdx !== -1
  ? args[outIdx + 1]
  : path.join('playwright', 'fixtures', 'snapshots', 'model-baseline',
      path.basename(inputPath, '.txt').toLowerCase().replace(/\s+/g, '-') + '.json');

if (!fs.existsSync(inputPath)) {
  console.error(`Error: file not found: ${inputPath}`);
  process.exit(1);
}

const content = fs.readFileSync(inputPath, 'utf-8');
const fresh   = parseTxt(content);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

// If a committed baseline already exists, run drift detection before overwriting.
let driftFound = false;
if (fs.existsSync(outputPath)) {
  const committed = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as ModelBaseline;
  const drift = detectDrift(committed, fresh);

  const anyDrift =
    drift.addedTables.length > 0     ||
    drift.removedTables.length > 0   ||
    drift.cardinalityChanges.length > 0 ||
    drift.newManyToMany.length > 0   ||
    drift.newBidirectional.length > 0;

  if (anyDrift) {
    driftFound = true;
    console.log('\n⚠️  SCHEMA DRIFT DETECTED\n');

    if (drift.removedTables.length)
      console.log('REMOVED TABLES (measures that reference these will break visuals):');
    for (const t of drift.removedTables) console.log(`  - ${t}`);

    if (drift.addedTables.length)
      console.log('\nADDED TABLES:');
    for (const t of drift.addedTables) console.log(`  + ${t}`);

    if (drift.cardinalityChanges.length)
      console.log('\nCARDINALITY CHANGES (filter propagation changed — visuals may compute wrong totals):');
    for (const c of drift.cardinalityChanges)
      console.log(`  ${c.key}\n    was: ${c.was}  →  now: ${c.now}`);

    if (drift.newManyToMany.length)
      console.log('\nNEW MANY-TO-MANY RELATIONSHIPS (PK duplicate proxy — dimension table lost uniqueness):');
    for (const k of drift.newManyToMany) console.log(`  ⚠️  ${k}`);

    if (drift.newBidirectional.length)
      console.log('\nNEW BIDIRECTIONAL CROSS-FILTERS (ambiguous filter path introduced):');
    for (const k of drift.newBidirectional) console.log(`  ⚠️  ${k}`);

    console.log('\nUpdate the baseline by committing the newly written JSON, then re-run tests.');
  } else {
    console.log('✅  No structural drift detected.');
  }
} else {
  console.log(`Creating new baseline: ${outputPath}`);
}

// Preserve the allowlists from the committed baseline so that human-approved
// intentional patterns are not wiped on re-ingestion.
if (fs.existsSync(outputPath)) {
  const committed = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as ModelBaseline;
  // Merge: keep old allowlist entries, add any new M:M/bidi that appeared
  // but DO NOT silently approve new entries that weren't there before.
  // New entries appear in the drift report above so the developer consciously
  // decides whether to add them to the allowlist.
  fresh.intentionalManyToMany    = committed.intentionalManyToMany;
  fresh.intentionalBidirectional = committed.intentionalBidirectional;
}

fs.writeFileSync(outputPath, JSON.stringify(fresh, null, 2));
console.log(`\nBaseline written to: ${outputPath}`);
console.log(`  Tables:        ${fresh.tables.length}`);
console.log(`  Relationships: ${fresh.relationships.length}`);
console.log(`  M:M allowlist: ${fresh.intentionalManyToMany.length}`);
console.log(`  Bidi allowlist: ${fresh.intentionalBidirectional.length}`);

if (driftFound) process.exit(1);
