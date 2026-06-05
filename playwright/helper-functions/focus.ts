/**
 * Check focus — controls which test suites run in a given session.
 *
 * Written by `npm run setup` to playwright/config/enterprise.focus.json.
 * Each test spec reads it and skips itself when its category is not selected.
 *
 * Live focus values and what they include:
 *
 *   broken-visuals      — report-pages.spec only (VS-NNN)
 *   refresh-failures    — latest refresh status check (RH-002)
 *   credential-errors   — auth / OAuth / unbound-datasource errors in history (RH-003)
 *   refresh-health      — all refresh checks: RH-002 + RH-003
 *   quick-triage        — broken-visuals + refresh-failures (fastest for large workspaces)
 *   all                 — complete live suite (visual + refresh; does NOT include pql checks)
 *
 * pql-test focus values (separate Playwright project, require pql-test installed + authed):
 *   pql-schema-drift    — column/table existence checks via XMLA (pql-schema.spec.ts)
 *   pql-key-duplication — PK uniqueness assertions via DAX (pql-dataquality.spec.ts)
 *
 * TBD — not yet implemented:
 *   source-schema-drift — column/table changes in source SQL queries (planned)
 */

import fs   from 'node:fs';
import path from 'node:path';

export type CheckFocus =
  | 'all'
  | 'broken-visuals'
  | 'refresh-failures'
  | 'credential-errors'
  | 'refresh-health'
  | 'quick-triage'
  | 'pql-schema-drift'
  | 'pql-key-duplication'
  | 'source-schema-drift';

export interface FocusOptions {
  /** Stable machine-readable key */
  value: CheckFocus;
  /** Short label shown in the menu */
  label: string;
  /** One-line description (business language for PBI developers) */
  description: string;
  /**
   * When true the option is shown in the menu but cannot be selected —
   * the underlying checks are not yet implemented.
   */
  tbd?: true;
  /**
   * When true this option runs the pql Playwright project (pql-test XMLA),
   * not the standard enterprise project.
   */
  pql?: true;
}

export const FOCUS_MENU: FocusOptions[] = [
  // ── Live checks — enterprise project ──────────────────────────────────────
  {
    value: 'broken-visuals',
    label: 'Broken visuals',
    description: 'Report pages that fail to render or show error tiles',
  },
  {
    value: 'refresh-failures',
    label: 'Dataset refresh failures',
    description: 'Latest refresh did not complete — visuals showing stale data',
  },
  {
    value: 'credential-errors',
    label: 'Credential / gateway errors',
    description: 'OAuth, gateway auth, or unbound datasource blocking refresh',
  },
  {
    value: 'refresh-health',
    label: 'Refresh health',
    description: 'All refresh signals combined: failures + credential errors',
  },
  {
    value: 'quick-triage',
    label: 'Quick triage',
    description: 'Visuals + latest refresh — fastest check for large workspaces',
  },
  {
    value: 'all',
    label: 'All checks',
    description: 'Every live signal — visual, refresh, credential errors',
  },
  // ── pql-test checks — separate project (require pql-test + XMLA) ──────────
  {
    value: 'pql-schema-drift',
    label: 'Schema drift  (pql-test)',
    description: 'Deleted / renamed columns or tables detected via XMLA — requires pql-test',
    pql: true,
  },
  {
    value: 'pql-key-duplication',
    label: 'Key duplication  (pql-test)',
    description: 'Dimension primary-key uniqueness via DAX assertion — requires pql-test',
    pql: true,
  },
  // ── TBD — not yet implemented ──────────────────────────────────────────────
  {
    value: 'source-schema-drift',
    label: 'Source data schema drift',
    description: 'Column / table changes in source SQL queries detected against committed baseline',
    tbd: true,
  },
];

// ─── persistence ──────────────────────────────────────────────────────────────

const FOCUS_PATH = path.join(process.cwd(), 'playwright', 'config', 'enterprise.focus.json');

export function saveFocus(focus: CheckFocus): void {
  fs.mkdirSync(path.dirname(FOCUS_PATH), { recursive: true });
  fs.writeFileSync(FOCUS_PATH, JSON.stringify({ focus }, null, 2) + '\n');
}

export function loadFocus(): CheckFocus {
  if (!fs.existsSync(FOCUS_PATH)) return 'all';
  try {
    const raw = JSON.parse(fs.readFileSync(FOCUS_PATH, 'utf-8')) as { focus?: string };
    return (raw.focus ?? 'all') as CheckFocus;
  } catch {
    return 'all';
  }
}

/** Returns true when a focus value belongs to the pql-test project. */
export function isPqlFocus(focus: CheckFocus): boolean {
  return focus === 'pql-schema-drift' || focus === 'pql-key-duplication';
}

// ─── routing — maps focus value to which spec categories are active ───────────

/** Returns true when the given spec category should run under the selected focus. */
export function isInFocus(focus: CheckFocus, spec: 'visuals' | 'rh-002' | 'rh-003' | 'pql-schema' | 'pql-dq'): boolean {
  const matrix: Record<CheckFocus, Record<string, boolean>> = {
    'all':                  { visuals: true,  'rh-002': true,  'rh-003': true,  'pql-schema': false, 'pql-dq': false },
    'broken-visuals':       { visuals: true,  'rh-002': false, 'rh-003': false, 'pql-schema': false, 'pql-dq': false },
    'refresh-failures':     { visuals: false, 'rh-002': true,  'rh-003': false, 'pql-schema': false, 'pql-dq': false },
    'credential-errors':    { visuals: false, 'rh-002': false, 'rh-003': true,  'pql-schema': false, 'pql-dq': false },
    'refresh-health':       { visuals: false, 'rh-002': true,  'rh-003': true,  'pql-schema': false, 'pql-dq': false },
    'quick-triage':         { visuals: true,  'rh-002': true,  'rh-003': false, 'pql-schema': false, 'pql-dq': false },
    'pql-schema-drift':     { visuals: false, 'rh-002': false, 'rh-003': false, 'pql-schema': true,  'pql-dq': false },
    'pql-key-duplication':  { visuals: false, 'rh-002': false, 'rh-003': false, 'pql-schema': false, 'pql-dq': true  },
    'source-schema-drift':  { visuals: false, 'rh-002': false, 'rh-003': false, 'pql-schema': false, 'pql-dq': false },
  };
  return matrix[focus]?.[spec] ?? true;
}
