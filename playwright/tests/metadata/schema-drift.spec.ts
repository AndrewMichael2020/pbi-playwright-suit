import { expect, test } from '@playwright/test';
import { readJsonFile } from '../../helper-functions/file-reader';
import { compareSignatures } from '../../helper-functions/signature-diff';
import { ModelSignature } from '../../helper-functions/types';

test('SD-001 baseline signature fixture is structurally valid', async () => {
  const baseline = readJsonFile<ModelSignature>(
    'playwright/fixtures/snapshots/model-signatures/baseline-model-signature.json',
  );
  const facility = baseline.tables.find((table) => table.name === 'Facility');
  const measureTable = baseline.tables.find((table) => table.name === '_DimMeasure');

  expect(typeof baseline.datasetName).toBe('string');
  expect(baseline.datasetName.length).toBeGreaterThan(0);
  expect(baseline.tables.length).toBeGreaterThan(0);
  expect(baseline.relationships.length).toBeGreaterThan(0);
  expect(facility?.columns.length).toBe(6);
  expect(facility?.partitions.length).toBe(1);
  expect(measureTable?.measures.length).toBeGreaterThan(10);
});

test('SD-002 through SD-010 current mock signature matches baseline mock signature', async () => {
  const currentSignature = readJsonFile<ModelSignature>(
    'playwright/fixtures/snapshots/model-signatures/baseline-model-signature.current.json',
  );
  const baseline = readJsonFile<ModelSignature>(
    'playwright/fixtures/snapshots/model-signatures/baseline-model-signature.json',
  );
  const drift = compareSignatures(currentSignature, baseline);

  expect(currentSignature.tableCount).toBe(baseline.tableCount);
  expect(currentSignature.relationshipCount).toBe(baseline.relationshipCount);
  expect(drift).toEqual({
    addedTables: [],
    removedTables: [],
    changedTables: [],
    changedRelationships: [],
  });
});

// ── Individual SD tests using inline mock signatures ─────────────────────────

function makeMinSig(override: Partial<ModelSignature> = {}): ModelSignature {
  return {
    datasetName: 'Test Dataset',
    tableCount: 1,
    relationshipCount: 0,
    roleCount: 0,
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [{ name: 'Id', type: 'Int64', hidden: false }],
        measures: [],
        partitions: [{ name: 'Partition', mode: 'import', sourceType: 'M' }],
      },
    ],
    relationships: [],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: ['RowNumber-'], inactiveRelationshipKeys: [] },
    ...override,
  };
}

test('SD-003 added table is reported in addedTables', async () => {
  const baseline = makeMinSig();
  const current = makeMinSig({
    tableCount: 2,
    tables: [
      ...makeMinSig().tables,
      { name: 'NewTable', hidden: false, columns: [], measures: [], partitions: [] },
    ],
  });
  const drift = compareSignatures(current, baseline);

  expect(drift.addedTables).toContain('NewTable');
  expect(drift.removedTables).toHaveLength(0);
});

test('SD-004 column change in a table is reported in changedTables', async () => {
  const baseline = makeMinSig();
  const current = makeMinSig({
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [{ name: 'RenamedId', type: 'Int64', hidden: false }],
        measures: [],
        partitions: [{ name: 'Partition', mode: 'import', sourceType: 'M' }],
      },
    ],
  });
  const drift = compareSignatures(current, baseline);

  expect(drift.changedTables).toContain('Sales');
});

test('SD-005 measure change in a table is reported in changedTables', async () => {
  const baseline = makeMinSig({
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [],
        measures: [{ name: 'Total', expressionHash: 'aaa' }],
        partitions: [],
      },
    ],
  });
  const current = makeMinSig({
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [],
        measures: [{ name: 'Total', expressionHash: 'zzz' }],
        partitions: [],
      },
    ],
  });
  const drift = compareSignatures(current, baseline);

  expect(drift.changedTables).toContain('Sales');
});

test('SD-006 changed relationship edge is reported in changedRelationships', async () => {
  const rel = {
    id: 'r1',
    fromTable: 'Sales', fromColumn: 'DateId',
    toTable: 'Date', toColumn: 'Id',
    active: true, crossFilter: 'Single', securityFilter: 'None', cardinality: 'ManyToOne',
  };
  const baseline = makeMinSig({ relationshipCount: 1, relationships: [rel] });
  const current = makeMinSig({
    relationshipCount: 1,
    relationships: [{ ...rel, cardinality: 'OneToMany' }],
  });
  const drift = compareSignatures(current, baseline);

  expect(drift.changedRelationships.length).toBeGreaterThan(0);
});

test('SD-007 partition sourceType change is reported in changedTables', async () => {
  const baseline = makeMinSig({
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [],
        measures: [],
        partitions: [{ name: 'Partition', mode: 'import', sourceType: 'M' }],
      },
    ],
  });
  const current = makeMinSig({
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [],
        measures: [],
        partitions: [{ name: 'Partition', mode: 'import', sourceType: 'Query' }],
      },
    ],
  });
  const drift = compareSignatures(current, baseline);

  expect(drift.changedTables).toContain('Sales');
});

test('SD-008 extracted SQL hash change is reported in changedTables', async () => {
  const baseline = makeMinSig({
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [],
        measures: [],
        partitions: [{ name: 'Partition', mode: 'import', sourceType: 'Query', extractedSqlHash: 'hash-a' }],
      },
    ],
  });
  const current = makeMinSig({
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [],
        measures: [],
        partitions: [{ name: 'Partition', mode: 'import', sourceType: 'Query', extractedSqlHash: 'hash-b' }],
      },
    ],
  });
  const drift = compareSignatures(current, baseline);

  expect(drift.changedTables).toContain('Sales');
});

test('SD-009 auto-date table identical in both signatures does not appear as drift', async () => {
  const autoDateTable = {
    name: 'LocalDateTable_abc123',
    hidden: true,
    columns: [{ name: 'Date', type: 'DateTime', hidden: false }],
    measures: [],
    partitions: [{ name: 'Partition', mode: 'import', sourceType: 'Calculated' }],
  };
  const baseline = makeMinSig({
    tableCount: 2,
    tables: [...makeMinSig().tables, autoDateTable],
  });
  const current = makeMinSig({
    tableCount: 2,
    tables: [...makeMinSig().tables, autoDateTable],
  });
  const drift = compareSignatures(current, baseline);

  expect(drift.addedTables).not.toContain('LocalDateTable_abc123');
  expect(drift.changedTables).not.toContain('LocalDateTable_abc123');
});

test('SD-010 drift output exposes human-readable string-array keys', async () => {
  const drift = compareSignatures(makeMinSig(), makeMinSig());

  expect(Array.isArray(drift.addedTables)).toBe(true);
  expect(Array.isArray(drift.removedTables)).toBe(true);
  expect(Array.isArray(drift.changedTables)).toBe(true);
  expect(Array.isArray(drift.changedRelationships)).toBe(true);
});
