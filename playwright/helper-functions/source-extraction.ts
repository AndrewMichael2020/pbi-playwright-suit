export function extractSqlFromM(mCode: string): string | null {
  if (!mCode) {
    return null;
  }

  const sqlMatch = /Query\s*=\s*"((?:[^"]|"")*)"/s.exec(mCode);
  if (!sqlMatch) {
    return null;
  }

  return normalizeSqlText(
    sqlMatch[1]
      .replace(/#\(lf\)/g, '\n')
      .replace(/#\(tab\)/g, '\t')
      .replace(/#\(cr\)/g, '\r')
      .replace(/""/g, '"'),
  );
}

export function normalizeSqlText(sql: string): string {
  return sql
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}
