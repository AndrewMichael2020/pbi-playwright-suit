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
 * Allowlists live in the baseline JSON.  Update them manually after a conscious
 * design decision, then re-commit.
 *
 * Run `npm run ingest:model-txt -- "<file>.txt"` to regenerate the baseline
 * from a Python script .txt export.  The ingest script prints a drift summary
 * and exits non-zero when structural changes are detected.
 */

import { expect, test } from '@playwright/test';
import * as fs   from 'fs';
import * as path from 'path';
import { loadFocus, isInFocus } from '../../helper-functions/focus';

// ─── load baseline fixture ────────────────────────────────────────────────────

const BASELINE_PATH = path.join(
  __dirname, '..', '..', 'fixtures', 'snapshots', 'model-baseline', 'sample-model-baseline.json',
);

const VIOLATION_BASELINE_PATH = path.join(
  __dirname, '..', '..', 'fixtures', 'snapshots', 'model-baseline', 'sample-model-baseline-violation.json',
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

// ─── MS-001 detection logic — negative / violation test ──────────────────────
//
// Verifies that the M:M detection logic correctly surfaces violations when a
// relationship is Many→Many but absent from intentionalManyToMany.  Uses a
// dedicated violation fixture that intentionally omits one allowlist entry.

test.describe('Model structure — detection logic (negative test)', () => {
  test(
    'MS-001 detection logic flags an unallowlisted M:M relationship in the violation fixture',
    () => {
      const raw = fs.readFileSync(VIOLATION_BASELINE_PATH, 'utf-8');
      const fixture = JSON.parse(raw) as ModelBaseline;

      const allowlisted = new Set(fixture.intentionalManyToMany);
      const violations  = fixture.relationships
        .filter((r) => r.cardinality === 'Many -> Many')
        .filter((r) => !allowlisted.has(relKey(r)));

      expect(
        violations.length,
        'The violation fixture must contain at least one unallowlisted M:M relationship ' +
        'so the detection logic is proven to catch it.',
      ).toBeGreaterThan(0);

      // Confirm the specific relationship that was left off the allowlist is the one caught.
      const keys = violations.map(relKey);
      expect(keys).toContain('Date::DateKey → Calendar Bridge::DateKey');
    },
  );
});
