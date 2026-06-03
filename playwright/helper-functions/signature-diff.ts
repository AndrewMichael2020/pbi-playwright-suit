import { ModelSignature, SignatureDrift } from './types';

function tableSignature(table: ModelSignature['tables'][number]): string {
  return JSON.stringify(table);
}

function relationshipSignature(relationship: ModelSignature['relationships'][number]): string {
  return JSON.stringify(relationship);
}

export function compareSignatures(current: ModelSignature, baseline: ModelSignature): SignatureDrift {
  const currentTables = new Map(current.tables.map((table) => [table.name, table]));
  const baselineTables = new Map(baseline.tables.map((table) => [table.name, table]));

  const addedTables = [...currentTables.keys()].filter((name) => !baselineTables.has(name)).sort();
  const removedTables = [...baselineTables.keys()].filter((name) => !currentTables.has(name)).sort();
  const changedTables = [...currentTables.keys()]
    .filter((name) => baselineTables.has(name) && tableSignature(currentTables.get(name)!) !== tableSignature(baselineTables.get(name)!))
    .sort();

  const currentRelationships = new Set(current.relationships.map(relationshipSignature));
  const baselineRelationships = new Set(baseline.relationships.map(relationshipSignature));
  const changedRelationships = [
    ...[...currentRelationships].filter((value) => !baselineRelationships.has(value)),
    ...[...baselineRelationships].filter((value) => !currentRelationships.has(value)),
  ].sort();

  return {
    addedTables,
    removedTables,
    changedTables,
    changedRelationships,
  };
}
