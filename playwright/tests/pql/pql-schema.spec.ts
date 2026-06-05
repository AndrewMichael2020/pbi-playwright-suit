/**
 * PQL-001 — Schema drift detection via pql-test XMLA
 *
 * For each report in enterprise.generated.json that has a committed
 * pql/<report>.SemanticModel/DAXQueries/Schema.DEV.Tests.dax file,
 * this spec spawns `pql-test run-tests` and surfaces pass/fail results
 * as standard Playwright test assertions.
 *
 * Auto-skips when:
 *   - focus is not pql-schema-drift
 *   - pql-test is not on PATH
 *   - no Schema.DEV.Tests.dax exists for the report
 *
 * Run via: npm run setup → focus option [7] Schema drift (pql-test)
 */

import { test, expect } from '@playwright/test';
import { spawnSync }    from 'node:child_process';
import fs               from 'node:fs';
import path             from 'node:path';
import { loadEnterpriseConfigs } from '../../helper-functions/enterprise-config';
import { loadFocus, isInFocus }  from '../../helper-functions/focus';
import { loadEnvFile }           from '../../helper-functions/env-loader';

loadEnvFile();

// ── pql-test availability check (done once at module load) ────────────────────

function pqlTestOnPath(): boolean {
  const probe = spawnSync('pql-test', ['--version'], { encoding: 'utf-8', shell: true });
  return probe.status === 0;
}

const PQL_AVAILABLE = pqlTestOnPath();

// ── deduplicate configs by reportName (one pql run per report, not per page) ──

interface ReportRef {
  reportName:    string;
  workspaceId:   string;
  workspaceName: string;
  datasetId:     string;
}

function uniqueReports(configs: ReturnType<typeof loadEnterpriseConfigs>): ReportRef[] {
  if (!configs) return [];
  const seen = new Set<string>();
  const out: ReportRef[] = [];
  for (const c of configs) {
    if (!seen.has(c.reportName)) {
      seen.add(c.reportName);
      out.push({
        reportName:    c.reportName,
        workspaceId:   c.workspaceId,
        workspaceName: c.workspaceName,
        datasetId:     c.datasetId,
      });
    }
  }
  return out;
}

// ── spec ──────────────────────────────────────────────────────────────────────

const allConfigs = loadEnterpriseConfigs();
const focus      = loadFocus();
const reports    = uniqueReports(allConfigs);

if (!allConfigs) {
  test('pql schema drift — no enterprise config', () => {
    test.skip(true, 'Run npm run setup first to discover reports.');
  });
} else {
  for (const report of reports) {
    const daxDir  = path.join(process.cwd(), 'pql', `${report.reportName}.SemanticModel`, 'DAXQueries');
    const daxFile = path.join(daxDir, 'Schema.DEV.Tests.dax');
    const hasFile = fs.existsSync(daxFile);

    test(`PQL-001 schema drift — ${report.reportName}`, async ({}, testInfo) => {
      // Skip reasons (checked in priority order)
      if (!isInFocus(focus, 'pql-schema')) {
        test.skip(true, `Focus is "${focus}" — select [7] Schema drift (pql-test) to run this check.`);
      }
      if (!PQL_AVAILABLE) {
        test.skip(
          true,
          'pql-test is not installed. Run: pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ "pql-test==0.1.9"',
        );
      }
      if (!hasFile) {
        test.skip(
          true,
          `No Schema.DEV.Tests.dax for "${report.reportName}". Run: npm run pql:generate`,
        );
      }

      const outputFile = path.join(
        testInfo.outputDir,
        `pql-schema-${report.reportName.replace(/[^a-z0-9]/gi, '_')}.json`,
      );

      const modelPath = path.join(process.cwd(), 'pql', `${report.reportName}.SemanticModel`);

      const result = spawnSync(
        'pql-test',
        [
          'run-tests', modelPath,
          '--test',    'Schema.DEV.Tests',
          '--output',  outputFile,
          '--workspace-id', report.workspaceId,
          '--dataset-id',   report.datasetId,
        ],
        { encoding: 'utf-8', shell: true, timeout: 300_000 },
      );

      // Attach raw stdout/stderr for the HTML report regardless of outcome
      if (result.stdout) testInfo.attach('pql-test output', { body: result.stdout, contentType: 'text/plain' });
      if (result.stderr) testInfo.attach('pql-test stderr', { body: result.stderr, contentType: 'text/plain' });

      // Spawn-level failure (executable not found, permission denied, etc.)
      if (result.error) {
        throw new Error(
          `pql-test process failed to start for "${report.reportName}" ` +
          `(workspace: ${report.workspaceName}, dataset-id: ${report.datasetId}).\n` +
          `Spawn error: ${result.error.message}\n` +
          `Ensure pql-test is installed and on PATH, and pql-test auth login has been run.`,
        );
      }

      // Killed by signal or timed out (status is null)
      if (result.status === null) {
        throw new Error(
          `pql-test was killed before completing for "${report.reportName}" ` +
          `(workspace: ${report.workspaceName}, dataset-id: ${report.datasetId}).\n` +
          `This usually means an XMLA connection timeout or network interruption.\n` +
          `stdout: ${result.stdout || '(empty)'}\nstderr: ${result.stderr || '(empty)'}`,
        );
      }

      // Parse JSON results for per-assertion annotations
      if (fs.existsSync(outputFile)) {
        let json: { passed: number; failed: number; total: number; results: { test_name: string; passed: boolean; message?: string }[] };
        try {
          json = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
        } catch (parseErr) {
          throw new Error(
            `pql-test produced malformed JSON output for "${report.reportName}".\n` +
            `Output file: ${outputFile}\nParse error: ${String(parseErr)}\n` +
            `Raw stdout: ${result.stdout || '(empty)'}`,
          );
        }

        testInfo.attach('pql-test results JSON', { path: outputFile, contentType: 'application/json' });

        for (const r of json.results.filter((r) => !r.passed)) {
          testInfo.annotations.push({ type: 'Schema failure', description: `${r.test_name}: ${r.message ?? 'failed'}` });
        }

        expect(
          json.failed,
          `${json.failed} schema assertion(s) failed for "${report.reportName}". ` +
          `See annotations for details.`,
        ).toBe(0);
      } else {
        // No JSON output — pql-test crashed before writing results
        throw new Error(
          `pql-test exited with code ${result.status} but wrote no output file for "${report.reportName}" ` +
          `(workspace: ${report.workspaceName}, dataset-id: ${report.datasetId}).\n` +
          `stdout: ${result.stdout || '(empty)'}\nstderr: ${result.stderr || '(empty)'}`,
        );
      }
    });
  }
}
