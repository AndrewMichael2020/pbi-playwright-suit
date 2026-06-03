import { createHash } from 'node:crypto';
import {
  ModelSignature,
  ParsedColumn,
  ParsedMeasure,
  ParsedPartition,
  ParsedRelationship,
  ParsedRole,
  ParsedTable,
  ParsedUpccMetadata,
} from './types';
import { extractSqlFromM } from './source-extraction';

const MARKER_PATTERN =
  /^\s*\[(NAME|WORKSPACE ID|MODEL NAME|MODEL ID|LAST REFRESH|REFRESH STATUS|LAST FAILED|FAILURE CODE|FAILURE MESSAGE|TABLE|IS HIDDEN|COLUMN|DATA TYPE|FORMAT|MEASURE|EXPRESSION|PARTITION|MODE|SOURCE TYPE|SQL QUERY|M EXPRESSION|RELATIONSHIP|FROM TABLE|FROM COLUMN|TO TABLE|TO COLUMN|ACTIVE|CROSS FILTER|SECURITY FLTR|CARDINALITY|ROLE|MEMBERS|RLS)\]/;

function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseMarker(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
  if (!match) {
    return null;
  }

  return {
    key: match[1].trim(),
    value: match[2].trim(),
  };
}

function finalizeColumn(currentColumn: ParsedColumn | null, table: ParsedTable | null): ParsedColumn | null {
  if (currentColumn && table) {
    table.columns.push(currentColumn);
  }

  return null;
}

function finalizeMeasure(currentMeasure: ParsedMeasure | null, table: ParsedTable | null): ParsedMeasure | null {
  if (currentMeasure && table) {
    table.measures.push({
      name: currentMeasure.name,
      expression: currentMeasure.expression.trim(),
    });
  }

  return null;
}

function finalizePartition(currentPartition: ParsedPartition | null, table: ParsedTable | null): ParsedPartition | null {
  if (currentPartition && table) {
    table.partitions.push({
      ...currentPartition,
      sqlQuery: currentPartition.sqlQuery?.trim(),
      mExpression: currentPartition.mExpression?.trim(),
    });
  }

  return null;
}

function finalizeTable(
  currentTable: ParsedTable | null,
  tables: ParsedTable[],
  currentColumn: ParsedColumn | null,
  currentMeasure: ParsedMeasure | null,
  currentPartition: ParsedPartition | null,
): void {
  if (!currentTable) {
    return;
  }

  if (currentColumn) {
    currentTable.columns.push(currentColumn);
  }

  if (currentMeasure) {
    currentTable.measures.push({
      name: currentMeasure.name,
      expression: currentMeasure.expression.trim(),
    });
  }

  if (currentPartition) {
    currentTable.partitions.push({
      ...currentPartition,
      sqlQuery: currentPartition.sqlQuery?.trim(),
      mExpression: currentPartition.mExpression?.trim(),
    });
  }

  tables.push(currentTable);
}

function finalizeRelationship(currentRelationship: ParsedRelationship | null, relationships: ParsedRelationship[]): ParsedRelationship | null {
  if (currentRelationship) {
    relationships.push(currentRelationship);
  }

  return null;
}

function finalizeRole(currentRole: ParsedRole | null, roles: ParsedRole[]): ParsedRole | null {
  if (currentRole) {
    roles.push(currentRole);
  }

  return null;
}

export function parseUpccMetadata(text: string): ParsedUpccMetadata {
  const lines = text.split(/\r?\n/);

  let workspaceName = '';
  let workspaceId = '';
  let datasetName = '';
  let datasetId = '';
  let lastRefresh = '';
  let refreshStatus = '';
  let lastFailed = '';
  let failureCode = '';
  let failureMessage = '';

  let section: 'header' | 'tables' | 'relationships' | 'roles' | 'other' = 'header';
  let subsection: 'none' | 'columns' | 'measures' | 'partitions' = 'none';
  let collectField: 'expression' | 'sqlQuery' | 'mExpression' | null = null;

  const tables: ParsedTable[] = [];
  const relationships: ParsedRelationship[] = [];
  const roles: ParsedRole[] = [];

  let currentTable: ParsedTable | null = null;
  let currentColumn: ParsedColumn | null = null;
  let currentMeasure: ParsedMeasure | null = null;
  let currentPartition: ParsedPartition | null = null;
  let currentRelationship: ParsedRelationship | null = null;
  let currentRole: ParsedRole | null = null;

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    if (collectField && (MARKER_PATTERN.test(line) || trimmed.startsWith('===') || /^[-=]{10,}$/.test(trimmed))) {
      collectField = null;
    }

    if (collectField) {
      if (collectField === 'expression' && currentMeasure) {
        currentMeasure.expression += `${currentMeasure.expression ? '\n' : ''}${line.trimEnd()}`;
      } else if (collectField === 'sqlQuery' && currentPartition) {
        currentPartition.sqlQuery = `${currentPartition.sqlQuery ? `${currentPartition.sqlQuery}\n` : ''}${line.trimEnd()}`;
      } else if (collectField === 'mExpression' && currentPartition) {
        currentPartition.mExpression = `${currentPartition.mExpression ? `${currentPartition.mExpression}\n` : ''}${line.trimEnd()}`;
      }
      continue;
    }

    if (trimmed === '=== TABLES ===') {
      section = 'tables';
      subsection = 'none';
      continue;
    }

    if (trimmed === '=== RELATIONSHIPS ===') {
      section = 'relationships';
      subsection = 'none';
      currentColumn = finalizeColumn(currentColumn, currentTable);
      currentMeasure = finalizeMeasure(currentMeasure, currentTable);
      currentPartition = finalizePartition(currentPartition, currentTable);
      finalizeTable(currentTable, tables, null, null, null);
      currentTable = null;
      continue;
    }

    if (trimmed === '=== ROLES (RLS + OLS) ===') {
      section = 'roles';
      currentRelationship = finalizeRelationship(currentRelationship, relationships);
      continue;
    }

    if (/^[-=]{10,}$/.test(trimmed)) {
      continue;
    }

    if (section === 'tables') {
      if (trimmed === '=== COLUMNS ===') {
        subsection = 'columns';
        continue;
      }

      if (trimmed === '=== MEASURES ===') {
        subsection = 'measures';
        continue;
      }

      if (trimmed === '=== PARTITIONS ===') {
        subsection = 'partitions';
        continue;
      }
    }

    const marker = parseMarker(line);

    if (!marker) {
      if (section === 'roles' && trimmed.startsWith('- ') && currentRole) {
        currentRole.members.push(trimmed.slice(2).trim());
      }
      continue;
    }

    switch (section) {
      case 'header': {
        if (marker.key === 'NAME') workspaceName = marker.value;
        if (marker.key === 'WORKSPACE ID') workspaceId = marker.value;
        if (marker.key === 'MODEL NAME') datasetName = marker.value;
        if (marker.key === 'MODEL ID') datasetId = marker.value;
        if (marker.key === 'LAST REFRESH') lastRefresh = marker.value;
        if (marker.key === 'REFRESH STATUS') refreshStatus = marker.value;
        if (marker.key === 'LAST FAILED') lastFailed = marker.value;
        if (marker.key === 'FAILURE CODE') failureCode = marker.value;
        if (marker.key === 'FAILURE MESSAGE') failureMessage = marker.value;
        break;
      }
      case 'tables': {
        if (marker.key === 'TABLE') {
          currentColumn = finalizeColumn(currentColumn, currentTable);
          currentMeasure = finalizeMeasure(currentMeasure, currentTable);
          currentPartition = finalizePartition(currentPartition, currentTable);
          finalizeTable(currentTable, tables, null, null, null);

          currentTable = {
            name: marker.value,
            hidden: false,
            columns: [],
            measures: [],
            partitions: [],
          };
          subsection = 'none';
          continue;
        }

        if (!currentTable) {
          continue;
        }

        if (marker.key === 'IS HIDDEN' && subsection === 'none') {
          currentTable.hidden = marker.value === 'True';
          continue;
        }

        if (subsection === 'columns') {
          if (marker.key === 'COLUMN') {
            currentColumn = finalizeColumn(currentColumn, currentTable);
            currentColumn = { name: marker.value, type: '', hidden: false };
          } else if (marker.key === 'DATA TYPE' && currentColumn) {
            currentColumn.type = marker.value;
          } else if (marker.key === 'IS HIDDEN' && currentColumn) {
            currentColumn.hidden = marker.value === 'True';
          }
          continue;
        }

        if (subsection === 'measures') {
          if (marker.key === 'MEASURE') {
            currentMeasure = finalizeMeasure(currentMeasure, currentTable);
            currentMeasure = { name: marker.value, expression: '' };
          } else if (marker.key === 'EXPRESSION' && currentMeasure) {
            currentMeasure.expression = marker.value;
            collectField = 'expression';
          }
          continue;
        }

        if (subsection === 'partitions') {
          if (marker.key === 'PARTITION') {
            currentPartition = finalizePartition(currentPartition, currentTable);
            currentPartition = { name: marker.value, mode: '', sourceType: '' };
          } else if (marker.key === 'MODE' && currentPartition) {
            currentPartition.mode = marker.value;
          } else if (marker.key === 'SOURCE TYPE' && currentPartition) {
            currentPartition.sourceType = marker.value;
          } else if (marker.key === 'SQL QUERY' && currentPartition) {
            currentPartition.sqlQuery = marker.value;
            collectField = 'sqlQuery';
          } else if (marker.key === 'M EXPRESSION' && currentPartition) {
            currentPartition.mExpression = marker.value;
            collectField = 'mExpression';
          }
        }
        break;
      }
      case 'relationships': {
        if (marker.key === 'RELATIONSHIP') {
          currentRelationship = finalizeRelationship(currentRelationship, relationships);
          currentRelationship = {
            id: marker.value,
            fromTable: '',
            fromColumn: '',
            toTable: '',
            toColumn: '',
            active: false,
            crossFilter: '',
            securityFilter: '',
            cardinality: '',
          };
          continue;
        }

        if (!currentRelationship) {
          continue;
        }

        if (marker.key === 'FROM TABLE') currentRelationship.fromTable = marker.value;
        if (marker.key === 'FROM COLUMN') currentRelationship.fromColumn = marker.value;
        if (marker.key === 'TO TABLE') currentRelationship.toTable = marker.value;
        if (marker.key === 'TO COLUMN') currentRelationship.toColumn = marker.value;
        if (marker.key === 'ACTIVE') currentRelationship.active = marker.value === 'True';
        if (marker.key === 'CROSS FILTER') currentRelationship.crossFilter = marker.value;
        if (marker.key === 'SECURITY FLTR') currentRelationship.securityFilter = marker.value;
        if (marker.key === 'CARDINALITY') currentRelationship.cardinality = marker.value;
        break;
      }
      case 'roles': {
        if (marker.key === 'ROLE') {
          currentRole = finalizeRole(currentRole, roles);
          currentRole = { name: marker.value, members: [], filters: [] };
          continue;
        }

        if (!currentRole) {
          continue;
        }

        if (marker.key === 'RLS') {
          const separatorIndex = marker.value.indexOf(':');
          currentRole.filters.push({
            table: marker.value.slice(0, separatorIndex).trim(),
            filter: marker.value.slice(separatorIndex + 1).trim(),
          });
        }
        break;
      }
      default:
        break;
    }
  }

  currentColumn = finalizeColumn(currentColumn, currentTable);
  currentMeasure = finalizeMeasure(currentMeasure, currentTable);
  currentPartition = finalizePartition(currentPartition, currentTable);
  finalizeTable(currentTable, tables, null, null, null);
  finalizeRelationship(currentRelationship, relationships);
  finalizeRole(currentRole, roles);

  return {
    workspaceName,
    workspaceId,
    datasetName,
    datasetId,
    lastRefresh,
    refreshStatus,
    lastFailed,
    failureCode,
    failureMessage,
    tables,
    relationships,
    roles,
  };
}

function relationshipKey(relationship: ParsedRelationship): string {
  return [
    relationship.fromTable,
    relationship.fromColumn,
    relationship.toTable,
    relationship.toColumn,
  ].join('::');
}

export function buildModelSignature(parsed: ParsedUpccMetadata): ModelSignature {
  const tables = parsed.tables.map((table) => ({
    name: table.name,
    hidden: table.hidden,
    columns: table.columns
      .map((column) => ({
        name: column.name,
        type: column.type,
        hidden: column.hidden,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    measures: table.measures
      .map((measure) => ({
        name: measure.name,
        expressionHash: hashContent(measure.expression),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    partitions: table.partitions
      .map((partition) => ({
        name: partition.name,
        mode: partition.mode,
        sourceType: partition.sourceType,
        extractedSqlHash: extractSqlFromM(partition.mExpression ?? '') ? hashContent(extractSqlFromM(partition.mExpression ?? '') ?? '') : undefined,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  }));

  const relationships = [...parsed.relationships].sort((left, right) => relationshipKey(left).localeCompare(relationshipKey(right)));

  return {
    datasetName: parsed.datasetName,
    tableCount: parsed.tables.length,
    relationshipCount: parsed.relationships.length,
    roleCount: parsed.roles.length,
    tables: tables.sort((left, right) => left.name.localeCompare(right.name)),
    relationships,
    roles: parsed.roles.map((role) => ({
      name: role.name,
      memberCount: role.members.length,
      filterCount: role.filters.length,
    })),
    allowlist: {
      hiddenSupportColumnPrefixes: ['RowNumber-'],
      inactiveRelationshipKeys: relationships.filter((relationship) => !relationship.active).map((relationship) => relationshipKey(relationship)),
    },
  };
}
