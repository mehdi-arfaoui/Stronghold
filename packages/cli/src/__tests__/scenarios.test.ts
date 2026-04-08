import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderStatusSnapshot } from '../commands/status.js';
import { createProgram } from '../index.js';
import { buildServiceReportJson, renderTerminalServiceReport } from '../output/report-renderer.js';
import { renderScenarioAnalysis, renderScenarioCoverageSection } from '../output/scenario-renderer.js';
import { renderScanSummary } from '../output/scan-summary.js';
import { saveScanResults } from '../storage/file-store.js';
import { resolveStrongholdPaths } from '../storage/paths.js';
import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('scenario coverage CLI renderers', () => {
  it('renders the scenarios analysis view with verdicts', async () => {
    const results = await createDemoResults('startup');
    const analysis = results.scenarioAnalysis;

    expect(analysis).not.toBeNull();
    expect(renderScenarioAnalysis(analysis!, results.timestamp)).toContain('Scenario Coverage Analysis');
    expect(renderScenarioAnalysis(analysis!, results.timestamp)).toMatch(/COVERED|UNCOVERED|PARTIALLY COVERED|DEGRADED/);
  });

  it('scan summary includes the scenario coverage count', async () => {
    const results = await createDemoResults('startup');
    const summary = renderScanSummary(results);

    expect(summary).toContain('Scenario coverage:');
  });

  it('status snapshot includes scenario alerts', async () => {
    const results = await createDemoResults('startup');
    const auditLogPath = `${createTempDirectory('stronghold-status-')}\\audit.jsonl`;
    const rendered = renderStatusSnapshot(results, auditLogPath, []);

    expect(rendered).toContain('Scenarios:');
    expect(rendered).toMatch(/covered|uncovered/i);
    expect(rendered).toContain('3 uncovered scenarios');
  });

  it('service report and scenario section include scenario coverage output', async () => {
    const results = await createDemoResults('startup');
    const report = renderTerminalServiceReport(results, {});
    const scenarioSection = renderScenarioCoverageSection(results.scenarioAnalysis, 'terminal');

    expect(report).toContain('Scenario coverage:');
    expect(scenarioSection).toContain('Scenario Coverage');
  });

  it('service report JSON includes the scenarios array', async () => {
    const results = await createDemoResults('startup');
    const json = buildServiceReportJson(results, {});

    expect(Array.isArray(json.scenarios)).toBe(true);
  });

  it('does not render a scenario section when no scenarios are available', () => {
    expect(renderScenarioCoverageSection(null, 'terminal')).toBe('');
    expect(renderScenarioCoverageSection(null, 'markdown')).toBe('');
  });
});

describe('scenario coverage CLI commands', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
  });

  it('scenarios show renders a specific scenario without throwing', async () => {
    const results = await createDemoResults('startup');
    const scenarioId = results.scenarioAnalysis?.defaultScenarioIds[0];

    expect(scenarioId).toBeTruthy();

    const cwd = createTempDirectory('stronghold-scenarios-show-');
    const paths = resolveStrongholdPaths(cwd);
    saveScanResults(results, paths.latestScanPath);
    process.chdir(cwd);

    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'stronghold', 'scenarios', 'show', scenarioId!]);

    expect(stdout).toHaveBeenCalled();
  });
});
