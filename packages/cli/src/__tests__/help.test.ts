import { describe, expect, it } from 'vitest';

import { createProgram } from '../index.js';
import { renderTerminalReport } from '../output/report-renderer.js';
import { renderScanSummary } from '../output/scan-summary.js';
import { createDemoResults } from './test-utils.js';

describe('CLI help output', () => {
  it('stronghold --help lists the top-level commands', () => {
    const help = createProgram().helpInformation();

    expect(help).toContain('scan');
    expect(help).toContain('report');
    expect(help).toContain('plan');
    expect(help).toContain('drift');
    expect(help).toContain('demo');
    expect(help).toContain('iam-policy');
  });

  it('stronghold plan --help lists generate, validate, and runbook', () => {
    const planCommand = createProgram().commands.find((command) => command.name() === 'plan');
    const help = planCommand?.helpInformation() ?? '';

    expect(help).toContain('generate');
    expect(help).toContain('validate');
    expect(help).toContain('runbook');
  });
});

describe('CLI rendered output', () => {
  it('scan summary suggests the runbook command after saving results', async () => {
    const results = await createDemoResults('startup');
    const summary = renderScanSummary(results, { savedPath: '.stronghold/latest-scan.json' });

    expect(summary).toContain('stronghold plan runbook');
  });

  it('terminal report includes the scoring disclaimer', async () => {
    const results = await createDemoResults('startup');
    const report = renderTerminalReport(results.validationReport, {});

    expect(report).toContain(results.validationReport.scoreBreakdown.disclaimer);
  });
});
