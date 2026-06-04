import { DuplicateIssue, ModelSignature } from './types';

function countDuplicates(values: string[]): string[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

export function detectDuplicateIssues(signature: ModelSignature): DuplicateIssue[] {
  const issues: DuplicateIssue[] = [];

  for (const tableName of countDuplicates(signature.tables.map((table) => table.name.toLowerCase()))) {
    issues.push({
      severity: 'error',
      type: 'duplicate-table',
      message: `Duplicate logical table detected: ${tableName}`,
    });
  }

  for (const table of signature.tables) {
    for (const measureName of countDuplicates(table.measures.map((measure) => measure.name.toLowerCase()))) {
      issues.push({
        severity: 'error',
        type: 'duplicate-measure',
        message: `Duplicate measure detected in table ${table.name}: ${measureName}`,
      });
    }
  }

  const relationshipKeys = signature.relationships.map((relationship) =>
    [relationship.fromTable, relationship.fromColumn, relationship.toTable, relationship.toColumn].join('::'),
  );

  for (const relationshipKey of countDuplicates(relationshipKeys)) {
    issues.push({
      severity: 'warning',
      type: 'duplicate-relationship',
      message: `Duplicate relationship edge detected: ${relationshipKey}`,
    });
  }

  const sourceHashes = signature.tables.flatMap((table) =>
    table.partitions
      .filter((partition) => partition.extractedSqlHash)
      .map((partition) => partition.extractedSqlHash as string),
  );

  for (const sourceHash of countDuplicates(sourceHashes)) {
    issues.push({
      severity: 'warning',
      type: 'duplicate-source-signature',
      message: `Duplicate extracted SQL signature detected: ${sourceHash}`,
    });
  }

  for (const relationship of signature.relationships) {
    if (relationship.active) {
      continue;
    }

    const key = [relationship.fromTable, relationship.fromColumn, relationship.toTable, relationship.toColumn].join('::');
    if (!signature.allowlist.inactiveRelationshipKeys.includes(key)) {
      issues.push({
        severity: 'warning',
        type: 'unexpected-inactive-relationship',
        message: `Inactive relationship not in allowlist: ${key}`,
      });
    }
  }

  // Cross-table: the same measure name defined in more than one table.
  const measureToTables = new Map<string, string[]>();
  for (const table of signature.tables) {
    for (const measure of table.measures) {
      const key = measure.name.toLowerCase();
      const existing = measureToTables.get(key) ?? [];
      existing.push(table.name);
      measureToTables.set(key, existing);
    }
  }
  for (const [measureName, tables] of measureToTables.entries()) {
    if (tables.length > 1) {
      issues.push({
        severity: 'warning',
        type: 'cross-table-measure-name',
        message: `Measure "${measureName}" defined in multiple tables: ${tables.join(', ')}`,
      });
    }
  }

  // Zombie tables: hidden AND have no non-hidden columns AND no measures.
  for (const table of signature.tables) {
    if (!table.hidden) continue;
    const visibleColumns = table.columns.filter((col) => !col.hidden);
    if (visibleColumns.length === 0 && table.measures.length === 0) {
      issues.push({
        severity: 'warning',
        type: 'zombie-table',
        message: `Hidden table "${table.name}" has no visible columns and no measures`,
      });
    }
  }

  return issues;
}
