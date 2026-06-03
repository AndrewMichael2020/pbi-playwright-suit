import { expect, test } from '@playwright/test';
import { detectDuplicateIssues } from '../../helper-functions/duplicate-checks';
import { readJsonFile } from '../../helper-functions/file-reader';
import { ModelSignature } from '../../helper-functions/types';

test('DU-001 through DU-006 duplicate heuristics stay quiet for the committed UPCC baseline', async () => {
  const signature = readJsonFile<ModelSignature>('playwright/fixtures/snapshots/model-signatures/upcc-model-signature.json');
  const issues = detectDuplicateIssues(signature);

  expect(issues).toEqual([]);
  expect(signature.allowlist.hiddenSupportColumnPrefixes).toContain('RowNumber-');
  expect(signature.allowlist.inactiveRelationshipKeys.length).toBeGreaterThan(0);
});
