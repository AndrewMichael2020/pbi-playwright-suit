import { expect, test } from '@playwright/test';
import { readJsonFile } from '../../helper-functions/file-reader';
import { compareSignatures } from '../../helper-functions/signature-diff';
import { ModelSignature } from '../../helper-functions/types';

test('SD-001 baseline signature fixture is structurally valid', async () => {
  const baseline = readJsonFile<ModelSignature>('playwright/fixtures/snapshots/model-signatures/upcc-model-signature.json');
  const facility = baseline.tables.find((table) => table.name === 'Facility');
  const measureTable = baseline.tables.find((table) => table.name === '_DimMeasure');

  expect(baseline.datasetName).toBe('UPCC Dashboard');
  expect(baseline.tables.length).toBeGreaterThan(0);
  expect(baseline.relationships.length).toBeGreaterThan(0);
  expect(facility?.columns.length).toBe(6);
  expect(facility?.partitions.length).toBe(1);
  expect(measureTable?.measures.length).toBeGreaterThan(10);
});

test('SD-002 through SD-010 current mock signature matches baseline mock signature', async () => {
  const currentSignature = readJsonFile<ModelSignature>('playwright/fixtures/snapshots/model-signatures/upcc-model-signature.current.json');
  const baseline = readJsonFile<ModelSignature>('playwright/fixtures/snapshots/model-signatures/upcc-model-signature.json');
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
