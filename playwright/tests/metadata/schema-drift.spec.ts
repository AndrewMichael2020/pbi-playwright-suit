import { expect, test } from '@playwright/test';
import { readJsonFile, readTextFile } from '../../helper-functions/file-reader';
import { compareSignatures } from '../../helper-functions/signature-diff';
import { buildModelSignature, parseUpccMetadata } from '../../helper-functions/upcc-metadata-parser';
import { ModelSignature } from '../../helper-functions/types';

test('SD-001 parsed UPCC metadata produces a structured signature', async () => {
  const metadata = readTextFile('UPCC Dashboard.txt');
  const parsed = parseUpccMetadata(metadata);
  const facility = parsed.tables.find((table) => table.name === 'Facility');
  const measureTable = parsed.tables.find((table) => table.name === '_DimMeasure');

  expect(parsed.datasetName).toBe('UPCC Dashboard');
  expect(parsed.workspaceName).toBe('FHA-ADAR-BI-UAT');
  expect(parsed.tables.length).toBeGreaterThan(0);
  expect(parsed.relationships.length).toBeGreaterThan(0);
  expect(facility?.columns.length).toBe(6);
  expect(facility?.partitions.length).toBe(1);
  expect(measureTable?.measures.length).toBeGreaterThan(10);
});

test('SD-002 through SD-010 baseline signature matches current parsed metadata', async () => {
  const metadata = readTextFile('UPCC Dashboard.txt');
  const currentSignature = buildModelSignature(parseUpccMetadata(metadata));
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
