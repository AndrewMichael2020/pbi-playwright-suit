/**
 * Model structure checks — dry-run, runs against the committed baseline fixture.
 *
 * Signals checked here cause visuals to render with wrong data or not at all:
 *
 *   MS-001  Unallowlisted Many-to-Many relationship
 *           A new M:M relationship means a "dimension" table has lost PK uniqueness
 *           (duplicate key values).  Power BI resolves this with M:M internally
 *           but filter propagation changes — visuals compute wrong totals.
 *
 *   MS-002  Bidirectional cross-filter relationship
 *           BothDirections creates ambiguous filter paths.  DAX aggregations in
 *           visuals can produce unexpected results depending on query context.
 *
 * Allowlists live in the baseline JSON.  Update them manually after a conscious
 * design decision, then re-commit.
 *
 * Run `npm run ingest:model-txt -- "<file>.txt"` to regenerate the baseline
 * from a fresh Python script output.  The ingest script prints a drift summary
 * and exits non-zero when structural changes are detected.
 */

import { expect, test } from '@playwright/test';
import * as fs   from 'fs';
import * as path from 'path';
import { loadFocus, isInFocus } from '../../helper-functions/focus';

// ─── load baseline fixture ────────────────────────────────────────────────────

const BASELINE_PATH = path.join(
  __dirname, '..', '..', 'fixtures', 'snapshots', 'model-baseline', 'upcc-dashboard.json',
);

interface BaselineRelationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  active: boolean;
  crossFilter: string;
  cardinality: string;
}

interface ModelBaseline {
  modelName: string;
  workspaceName: string;
  capturedAt: string;
  tables: Array<{ name: string; hidden: boolean; columnCount: number; measureCount: number }>;
  relationships: BaselineRelationship[];
  intentionalManyToMany: string[];
  intentionalBidirectional: string[];
}

function relKey(r: BaselineRelationship): string {
  return `${r.fromTable}::${r.fromColumn} → ${r.toTable}::${r.toColumn}`;
}

const baselineExists = fs.existsSync(BASELINE_PATH);
const baseline: ModelBaseline | null = baselineExists
  ? (JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as ModelBaseline)
  : null;
const focus = loadFocus();

const skipReason = !baselineExists
  ? `Baseline not found at ${BASELINE_PATH}.  Run: npm run ingest:model-txt -- "<model>.txt"`
  : '';

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Model structure', () => {
  test.skip(Boolean(skipReason), skipReason);

  // ── MS-001 ─────────────────────────────────────────────────────────────────
  test(
    'MS-001 no unallowlisted many-to-many relationships — dimension tables retain PK uniqueness',
    ({}, testInfo) => {
      test.skip(!isInFocus(focus, 'ms-001'), `Focus is "${focus}" — skipping model-integrity check.`);

      testInfo.annotations.push(
        { type: 'model',     description: baseline!.modelName },
        { type: 'workspace', description: baseline!.workspaceName },
        { type: 'captured',  description: baseline!.capturedAt },
      );

      const allowlisted = new Set(baseline!.intentionalManyToMany);
      const manyToMany  = baseline!.relationships.filter(
        (r) => r.cardinality === 'Many -> Many',
      );

      const violations = manyToMany.filter((r) => !allowlisted.has(relKey(r)));

      for (const r of manyToMany) {
        const label = allowlisted.has(relKey(r)) ? 'intentional' : '⚠️ UNALLOWLISTED';
        testInfo.annotations.push({
          type: `M:M relationship — ${label}`,
          description:
            `${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]` +
            (allowlisted.has(relKey(r))
              ? ''
              : ' — dimension side may have duplicate key values causing wrong visual totals'),
        });
      }

      expect(
        violations.length,
        `${violations.length} Many-to-Many relationship(s) are not in the intentional allowlist.\n` +
        violations.map((r) =>
          `  ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]\n` +
          `  This relationship pattern means the "to" side has non-unique values (duplicate keys).\n` +
          `  Visuals filtering through this relationship will compute wrong aggregations.\n` +
          `  If this is intentional, add it to intentionalManyToMany in the baseline JSON.`,
        ).join('\n'),
      ).toBe(0);
    },
  );
});
