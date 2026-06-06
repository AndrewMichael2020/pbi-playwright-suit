/**
 * Check focus - controls which test suites run in a given session.
 *
 * Written by `npm run setup` to playwright/config/enterprise.focus.json.
 * Each test spec reads it and skips itself when its category is not selected.
 *
 * Focus values:
 *   broken-visuals      - report-pages.spec only (VS-NNN)
 *   refresh-failures    - latest refresh status check (RH-002)
 *   credential-errors   - auth / OAuth / unbound-datasource errors in history (RH-003)
 *   refresh-health      - all refresh checks: RH-002 + RH-003
 *   quick-triage        - broken-visuals + refresh-failures (fastest for large workspaces)
 *   all                 - complete live suite (visual + refresh)
 *
 * TBD - not yet implemented:
 *   source-schema-drift - column/table changes in source SQL queries (planned)
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
  | 'source-schema-drift';

export interface FocusOptions {
  /** Stable machine-readable key */
  value: CheckFocus;
  /** Short label shown in the menu */
  label: string;
  /** One-line description (business language for PBI developers) */
  description: string;
  /**
   * When true the option is shown in the menu but cannot be selected -
   * the underlying checks are not yet implemented.
   */
  tbd?: true;
}

export const FOCUS_MENU: FocusOptions[] = [
  {
    value: 'broken-visuals',
    label: 'Broken visuals',
    description: 'Report pages that fail to render or show error tiles',
  },
  {
    value: 'refresh-failures',
    label: 'Dataset refresh failures',
    description: 'Latest refresh did not complete - visuals showing stale data',
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
    description: 'Visuals + latest refresh - fastest check for large workspaces',
  },
  {
    value: 'all',
    label: 'All checks',
    description: 'Every live signal - visual, refresh, credential errors',
  },
  // TBD - not yet implemented
  {
    value: 'source-schema-drift',
    label: 'Source data schema drift',
    description: 'Column / table changes in source SQL queries detected against committed baseline',
    tbd: true,
  },
];

// persistence

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

// routing - maps focus value to which spec categories are active

/** Returns true when the given spec category should run under the selected focus. */
export function isInFocus(focus: CheckFocus, spec: 'visuals' | 'rh-002' | 'rh-003'): boolean {
  const matrix: Record<CheckFocus, Record<string, boolean>> = {
    'all':                  { visuals: true,  'rh-002': true,  'rh-003': true  },
    'broken-visuals':       { visuals: true,  'rh-002': false, 'rh-003': false },
    'refresh-failures':     { visuals: false, 'rh-002': true,  'rh-003': false },
    'credential-errors':    { visuals: false, 'rh-002': false, 'rh-003': true  },
    'refresh-health':       { visuals: false, 'rh-002': true,  'rh-003': true  },
    'quick-triage':         { visuals: true,  'rh-002': true,  'rh-003': false },
    'source-schema-drift':  { visuals: false, 'rh-002': false, 'rh-003': false },
  };
  return matrix[focus]?.[spec] ?? true;
}
