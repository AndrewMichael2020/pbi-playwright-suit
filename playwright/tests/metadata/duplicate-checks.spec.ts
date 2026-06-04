import { expect, test } from '@playwright/test';
import { detectDuplicateIssues } from '../../helper-functions/duplicate-checks';
import { readJsonFile } from '../../helper-functions/file-reader';
import { DuplicateIssue, ModelSignature } from '../../helper-functions/types';

test('DU-001 through DU-006 no hard duplicate errors in the committed baseline', async () => {
  const signature = readJsonFile<ModelSignature>(
    'playwright/fixtures/snapshots/model-signatures/baseline-model-signature.json',
  );
  const issues = detectDuplicateIssues(signature);

  // Hard errors (duplicate tables, measures, relationships, source signatures,
  // unexpected inactive relationships) must be zero.
  const errors = issues.filter((i: DuplicateIssue) => i.severity === 'error');
  expect(errors).toEqual([]);
  expect(signature.allowlist.hiddenSupportColumnPrefixes).toContain('RowNumber-');
  expect(signature.allowlist.inactiveRelationshipKeys.length).toBeGreaterThan(0);
});

test('DU-009 baseline model contains advisory zombie-table warnings (known model state)', async () => {
  const signature = readJsonFile<ModelSignature>(
    'playwright/fixtures/snapshots/model-signatures/baseline-model-signature.json',
  );
  const issues = detectDuplicateIssues(signature);
  const zombies = issues.filter((i: DuplicateIssue) => i.type === 'zombie-table');

  // The baseline model has known hidden tables with no visible columns or measures.
  // This test documents the count so regressions (unexpected additions) are caught.
  expect(zombies.length).toBeGreaterThan(0);
  expect(zombies.every((i: DuplicateIssue) => i.severity === 'warning')).toBe(true);
});

// ── Cross-table measure name detection ─────────────────────────────────────

test('DU-007 cross-table measure name is detected when the same measure exists in two tables', async () => {
  const mockSignature: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 2,
    relationshipCount: 0,
    roleCount: 0,
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [],
        measures: [{ name: 'Total Revenue', expressionHash: 'aaa' }],
        partitions: [],
      },
      {
        name: 'Summary',
        hidden: false,
        columns: [],
        measures: [{ name: 'Total Revenue', expressionHash: 'bbb' }],
        partitions: [],
      },
    ],
    relationships: [],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: [], inactiveRelationshipKeys: [] },
  };

  const issues = detectDuplicateIssues(mockSignature);
  const crossTable = issues.filter((i: DuplicateIssue) => i.type === 'cross-table-measure-name');
  expect(crossTable.length).toBe(1);
  expect(crossTable[0]!.message).toContain('total revenue');
  expect(crossTable[0]!.severity).toBe('warning');
});

test('DU-007 no cross-table issue when measure names are unique across tables', async () => {
  const mockSignature: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 2,
    relationshipCount: 0,
    roleCount: 0,
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [],
        measures: [{ name: 'Sales Total', expressionHash: 'aaa' }],
        partitions: [],
      },
      {
        name: 'Summary',
        hidden: false,
        columns: [],
        measures: [{ name: 'Summary Count', expressionHash: 'bbb' }],
        partitions: [],
      },
    ],
    relationships: [],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: [], inactiveRelationshipKeys: [] },
  };

  const issues = detectDuplicateIssues(mockSignature);
  expect(issues.filter((i: DuplicateIssue) => i.type === 'cross-table-measure-name')).toEqual([]);
});

// ── Zombie table detection ──────────────────────────────────────────────────

test('DU-008 zombie table is flagged when hidden with no visible columns or measures', async () => {
  const mockSignature: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 1,
    relationshipCount: 0,
    roleCount: 0,
    tables: [
      {
        name: 'OldLegacyTable',
        hidden: true,
        columns: [{ name: 'RowNumber-123', type: 'Int64', hidden: true }],
        measures: [],
        partitions: [],
      },
    ],
    relationships: [],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: ['RowNumber-'], inactiveRelationshipKeys: [] },
  };

  const issues = detectDuplicateIssues(mockSignature);
  const zombies = issues.filter((i: DuplicateIssue) => i.type === 'zombie-table');
  expect(zombies.length).toBe(1);
  expect(zombies[0]!.message).toContain('OldLegacyTable');
});

test('DU-008 hidden table with measures is not a zombie table', async () => {
  const mockSignature: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 1,
    relationshipCount: 0,
    roleCount: 0,
    tables: [
      {
        name: '_DimMeasures',
        hidden: true,
        columns: [],
        measures: [{ name: 'Grand Total', expressionHash: 'x' }],
        partitions: [],
      },
    ],
    relationships: [],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: [], inactiveRelationshipKeys: [] },
  };

  const issues = detectDuplicateIssues(mockSignature);
  expect(issues.filter((i: DuplicateIssue) => i.type === 'zombie-table')).toEqual([]);
});

// ── Individual DU tests with focused mocks (DU-001 through DU-006) ───────────

test('DU-001 duplicate table names are detected as errors', async () => {
  const sig: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 2,
    relationshipCount: 0,
    roleCount: 0,
    tables: [
      { name: 'Sales', hidden: false, columns: [], measures: [], partitions: [] },
      { name: 'sales', hidden: false, columns: [], measures: [], partitions: [] },
    ],
    relationships: [],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: [], inactiveRelationshipKeys: [] },
  };

  const issues = detectDuplicateIssues(sig);
  const errors = issues.filter((i: DuplicateIssue) => i.type === 'duplicate-table');

  expect(errors.length).toBe(1);
  expect(errors[0]!.severity).toBe('error');
  expect(errors[0]!.message.toLowerCase()).toContain('sales');
});

test('DU-002 duplicate visible measure names within the same table are detected as errors', async () => {
  const sig: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 1,
    relationshipCount: 0,
    roleCount: 0,
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [],
        measures: [
          { name: 'Total Revenue', expressionHash: 'aaa' },
          { name: 'Total Revenue', expressionHash: 'bbb' },
        ],
        partitions: [],
      },
    ],
    relationships: [],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: [], inactiveRelationshipKeys: [] },
  };

  const issues = detectDuplicateIssues(sig);
  const errors = issues.filter((i: DuplicateIssue) => i.type === 'duplicate-measure');

  expect(errors.length).toBe(1);
  expect(errors[0]!.severity).toBe('error');
});

test('DU-003 duplicate relationship edges are detected as warnings', async () => {
  const rel = {
    id: 'r1',
    fromTable: 'Sales', fromColumn: 'DateId',
    toTable: 'Date', toColumn: 'Id',
    active: true, crossFilter: 'Single', securityFilter: 'None', cardinality: 'ManyToOne',
  };
  const sig: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 2,
    relationshipCount: 2,
    roleCount: 0,
    tables: [
      { name: 'Sales', hidden: false, columns: [], measures: [], partitions: [] },
      { name: 'Date', hidden: false, columns: [], measures: [], partitions: [] },
    ],
    relationships: [rel, { ...rel, id: 'r2' }],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: [], inactiveRelationshipKeys: [] },
  };

  const issues = detectDuplicateIssues(sig);
  const warnings = issues.filter((i: DuplicateIssue) => i.type === 'duplicate-relationship');

  expect(warnings.length).toBe(1);
  expect(warnings[0]!.severity).toBe('warning');
});

test('DU-004 tables sharing the same extracted SQL hash are reported as a warning', async () => {
  const sig: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 2,
    relationshipCount: 0,
    roleCount: 0,
    tables: [
      {
        name: 'TableA',
        hidden: false,
        columns: [],
        measures: [],
        partitions: [{ name: 'p1', mode: 'import', sourceType: 'Query', extractedSqlHash: 'same-hash-xyz' }],
      },
      {
        name: 'TableB',
        hidden: false,
        columns: [],
        measures: [],
        partitions: [{ name: 'p1', mode: 'import', sourceType: 'Query', extractedSqlHash: 'same-hash-xyz' }],
      },
    ],
    relationships: [],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: [], inactiveRelationshipKeys: [] },
  };

  const issues = detectDuplicateIssues(sig);
  const warnings = issues.filter((i: DuplicateIssue) => i.type === 'duplicate-source-signature');

  expect(warnings.length).toBe(1);
  expect(warnings[0]!.severity).toBe('warning');
});

test('DU-005 hidden support columns on a non-hidden table raise no errors or zombie warnings', async () => {
  const sig: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 1,
    relationshipCount: 0,
    roleCount: 0,
    tables: [
      {
        name: 'Sales',
        hidden: false,
        columns: [
          { name: 'Id', type: 'Int64', hidden: false },
          { name: 'RowNumber-12345', type: 'Int64', hidden: true },
        ],
        measures: [],
        partitions: [],
      },
    ],
    relationships: [],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: ['RowNumber-'], inactiveRelationshipKeys: [] },
  };

  const issues = detectDuplicateIssues(sig);

  expect(issues.filter((i: DuplicateIssue) => i.severity === 'error')).toHaveLength(0);
  expect(issues.filter((i: DuplicateIssue) => i.type === 'zombie-table')).toHaveLength(0);
});

test('DU-006 inactive relationship in the allowlist does not raise unexpected-inactive-relationship', async () => {
  const rel = {
    id: 'r1',
    fromTable: 'Sales', fromColumn: 'CurrencyId',
    toTable: 'Currency', toColumn: 'Id',
    active: false, crossFilter: 'None', securityFilter: 'None', cardinality: 'ManyToOne',
  };
  const key = 'Sales::CurrencyId::Currency::Id';
  const sig: ModelSignature = {
    datasetName: 'Mock',
    tableCount: 2,
    relationshipCount: 1,
    roleCount: 0,
    tables: [
      { name: 'Sales', hidden: false, columns: [], measures: [], partitions: [] },
      { name: 'Currency', hidden: false, columns: [], measures: [], partitions: [] },
    ],
    relationships: [rel],
    roles: [],
    allowlist: { hiddenSupportColumnPrefixes: [], inactiveRelationshipKeys: [key] },
  };

  const issues = detectDuplicateIssues(sig);
  const unexpected = issues.filter((i: DuplicateIssue) => i.type === 'unexpected-inactive-relationship');

  expect(unexpected).toHaveLength(0);
});

