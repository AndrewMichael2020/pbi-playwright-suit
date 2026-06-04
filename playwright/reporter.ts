/**
 * Custom CLI reporter for the PBI quality suite.
 *
 * Failures are expected outcomes — they mean "a problem was detected in a
 * Power BI report", not "the test suite is broken".  This reporter presents
 * them as caught signals rather than errors, without stack traces or code
 * context.
 *
 * Full details (trace, screenshot, code context) remain available in the
 * HTML report: npx playwright show-report
 */

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY ?? false;
const a = (code: string, text: string) => (isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const green  = (s: string) => a('32',    s);
const yellow = (s: string) => a('33',    s);
const dim    = (s: string) => a('2',     s);
const bold   = (s: string) => a('1',     s);
const cyan   = (s: string) => a('36',    s);

// ── timing helpers ────────────────────────────────────────────────────────────

function wallClock(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function durLabel(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── reporter ──────────────────────────────────────────────────────────────────

class PbiReporter implements Reporter {
  private passed  = 0;
  private failed  = 0;
  private skipped = 0;
  private total   = 0;
  private startMs = 0;

  onBegin(_config: FullConfig, suite: Suite): void {
    this.total   = suite.allTests().length;
    this.startMs = Date.now();
    process.stdout.write(`\n${dim(`Running ${this.total} test(s)`)}  ${dim('—')}  ${dim(`started ${wallClock()}`)}\n\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent?.project()?.name ?? '';
    const label   = project ? dim(`[${project}] `) : '';
    const title   = test.titlePath().slice(1).join(` ${dim('›')} `);
    const dur     = dim(durLabel(result.duration));

    if (result.status === 'skipped') {
      this.skipped++;
      const reason = this.skipReason(result);
      process.stdout.write(
        `  ${dim('↷')}  ${label}${dim(title)}${reason ? dim(`  — ${reason}`) : ''}\n`,
      );
      return;
    }

    if (result.status === 'passed') {
      this.passed++;
      process.stdout.write(`  ${green('✓')}  ${label}${title}  ${dur}\n`);
      return;
    }

    // Failed / timed-out — present as a caught signal, not a crash
    this.failed++;
    const msg = this.extractMessage(result);
    process.stdout.write(`  ${yellow('⚑')}  ${label}${yellow(title)}  ${dur}\n`);
    if (msg) {
      process.stdout.write(`       ${dim('↳')} ${msg}\n`);
    }
  }

  onEnd(result: FullResult): void {
    const elapsedS = ((Date.now() - this.startMs) / 1000).toFixed(1);
    const status   = result.status;

    process.stdout.write('\n');

    if (this.failed > 0) {
      const issueWord = this.failed === 1 ? 'issue' : 'issues';
      process.stdout.write(
        `  ${yellow(bold(`${this.failed} ${issueWord} caught`))}` +
        `  ${dim('·')}  ${green(`${this.passed} passed`)}` +
        (this.skipped ? `  ${dim('·')}  ${dim(`${this.skipped} skipped`)}` : '') +
        `  ${dim('·')}  ${dim(elapsedS + 's')}\n`,
      );
      process.stdout.write(
        `\n  ${dim('Full details:')}  ${cyan('npx playwright show-report')}\n`,
      );
    } else if (status === 'passed') {
      process.stdout.write(
        `  ${green(bold(`All ${this.passed} test(s) passed`))}` +
        (this.skipped ? `  ${dim('·')}  ${dim(`${this.skipped} skipped`)}` : '') +
        `  ${dim('·')}  ${dim(elapsedS + 's')}\n`,
      );
    } else {
      process.stdout.write(
        `  ${this.passed} passed` +
        (this.skipped ? `  ·  ${this.skipped} skipped` : '') +
        `  ·  ${elapsedS}s\n`,
      );
    }

    process.stdout.write('\n');
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private extractMessage(result: TestResult): string {
    const raw = result.error?.message ?? '';
    if (!raw) return '';
    // Strip leading "Error: " prefix, take only the first non-empty line
    // (which is the human-readable message we wrote in the expect() call).
    // Everything after the first blank line is expect() internals or stack.
    const firstMeaningfulLine = raw
      .replace(/^Error:\s*/,  '')
      .split('\n')
      .find((l) => l.trim().length > 0) ?? '';
    return firstMeaningfulLine.trim();
  }

  private skipReason(result: TestResult): string {
    // Playwright puts the skip reason in error.message for test.skip(cond, reason)
    const raw = result.error?.message ?? '';
    if (!raw) return '';
    return raw.replace(/^Error:\s*/, '').split('\n')[0]?.trim() ?? '';
  }
}

export default PbiReporter;
