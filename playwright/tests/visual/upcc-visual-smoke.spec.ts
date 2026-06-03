import { expect, test } from '@playwright/test';
import { readCsv } from '../../helper-functions/file-reader';

test.describe('UPCC visual smoke', () => {
  test.skip(true, 'Enable in enterprise execution once report_id and page_id are supplied.');

  test('VS-001 through VS-005 UPCC report visual smoke scaffold', async () => {
    const [record] = readCsv('playwright/test-cases/reports.csv');

    expect(record.report_name).toBe('UPCC Dashboard');
    expect(record.enabled).toBe('false');
  });
});
