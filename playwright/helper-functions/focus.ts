/**
 * Check focus — controls which test suites run in a given session.
 *
 * Written by `npm run setup` to playwright/config/enterprise.focus.json.
 * Each test spec reads it and skips itself when its category is not selected.
 *
 * Focus values and what they include:
 *
 *   broken-visuals   — report-pages.spec only (VS-NNN)
 *   refresh-failures — latest refresh status check (RH-002)
 *   credential-errors— auth / OAuth / unbound-datasource errors in refresh history (RH-003)
 *   refresh-health   — all refresh checks: RH-002 + RH-003
 *   quick-triage     — broken-visuals + refresh-failures (fastest for large workspaces)
 *   all              — complete live suite (model integrity auto-skips until baselines exist)
 *
 * TBD — require committed model baselines (MS-001), not yet available:
 *   duplicate-pk     — M:M relationships outside allowlist (MS-001)
 *   data-integrity   — RH-003 + MS-001 together
 *   model-integrity  — model structural checks: MS-001
 */

import fs   from 'node:fs';
import path from 'node:path';

export type CheckFocus =
  | 'all'
  | 'broken-visuals'
  | 'refresh-failures'
  | 'credential-errors'
  | 'duplicate-pk'
  | 'data-integrity'
  | 'refresh-health'
  | 'model-integrity'
  | 'quick-triage';

export interface FocusOptions {
  /** Stable machine-readable key */
  value: CheckFocus;
  /** Short label shown in the menu */
  label: string;
  /** One-line description (business language for PBI developers) */
  description: string;
  /**
   * When true the option is shown in the menu but cannot be selected —
   * it depends on MS-001 model baselines that are not yet implemented.
   */
  tbd?: true;
}

export const FOCUS_MENU: FocusOptions[] = [
  // ── Live checks (selectable) ───────────────────────────────────────────────
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
    description: 'Every live signal — visual, refresh, credential (model integrity coming soon)',
  },
  // ── TBD — require committed model baselines (MS-001 not yet implemented) ──
  {
    value: 'duplicate-pk',
    label: 'Duplicate PK / M:M relationships',
    description: 'Dimension tables that lost key uniqueness — wrong totals in every visual',
    tbd: true,
  },
  {
    value: 'data-integrity',
    label: 'Data integrity errors',
    description: 'Constraint violations + credential errors combined',
    tbd: true,
  },
  {
    value: 'model-integrity',
    label: 'Model integrity',
    description: 'Full M:M relationship audit — structural model health',
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

// ─── routing — maps focus value to which spec categories are active ───────────

/** Returns true when the given spec category should run under the selected focus. */
export function isInFocus(focus: CheckFocus, spec: 'visuals' | 'rh-002' | 'rh-003' | 'ms-001'): boolean {
  const matrix: Record<CheckFocus, Record<string, boolean>> = {
    'all':              { visuals: true,  'rh-002': true,  'rh-003': true,  'ms-001': true  },
    'broken-visuals':   { visuals: true,  'rh-002': false, 'rh-003': false, 'ms-001': false },
    'refresh-failures': { visuals: false, 'rh-002': true,  'rh-003': false, 'ms-001': false },
    'credential-errors':{ visuals: false, 'rh-002': false, 'rh-003': true,  'ms-001': false },
    'duplicate-pk':     { visuals: false, 'rh-002': false, 'rh-003': false, 'ms-001': true  },
    'data-integrity':   { visuals: false, 'rh-002': false, 'rh-003': true,  'ms-001': true  },
    'refresh-health':   { visuals: false, 'rh-002': true,  'rh-003': true,  'ms-001': false },
    'model-integrity':  { visuals: false, 'rh-002': false, 'rh-003': false, 'ms-001': true  },
    'quick-triage':     { visuals: true,  'rh-002': true,  'rh-003': false, 'ms-001': false },
  };
  return matrix[focus]?.[spec] ?? true;
}
