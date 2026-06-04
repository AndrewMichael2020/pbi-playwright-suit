import { expect, test } from '@playwright/test';
import { extractSqlFromM, normalizeSqlText } from '../../helper-functions/source-extraction';

test('SE-001 and SE-002 SQL block can be extracted and normalized from M', async () => {
  const mCode = `let
  Source = Sql.Database("server", "db", [Query="SELECT [A]#(lf)FROM [dbo].[T]#(lf)WHERE [B] = ""X""#(tab)"])
in
  Source`;

  const sql = extractSqlFromM(mCode);

  expect(sql).toContain('SELECT [A]');
  expect(sql).toContain('FROM [dbo].[T]');
  expect(sql).toContain('WHERE [B] = "X"');
});

test('SE-003 double-quoted M string escapes are unescaped in the extracted SQL', async () => {
  const mCode = `let Source = Sql.Database("srv", "db", [Query="SELECT col FROM t WHERE name = ""Alice"""]) in Source`;

  const sql = extractSqlFromM(mCode);

  expect(sql).not.toBeNull();
  expect(sql).toContain('"Alice"');
  expect(sql).not.toContain('""Alice""');
});

test('SE-004 missing SQL block returns null cleanly', async () => {
  expect(extractSqlFromM('let Source = Table.FromRows({}) in Source')).toBeNull();
});

test('SE-005 SQL normalization trims cosmetic whitespace only', async () => {
  const normalized = normalizeSqlText('SELECT 1  \r\nFROM x \r\n');
  expect(normalized).toBe('SELECT 1\nFROM x');
});
