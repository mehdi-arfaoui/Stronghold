import { describe, expect, it } from 'vitest';

import { buildServiceReportJson, renderTerminalServiceReport } from '../output/report-renderer.js';
import { createDemoResults } from './test-utils.js';

describe('report reasoning section', () => {
  it('shows a condensed service analysis for the worst services', async () => {
    const results = await createDemoResults('startup');

    const rendered = renderTerminalServiceReport(results, {});

    expect(rendered).toContain('Service Analysis (Worst 3)');
    expect(rendered).toContain('gap');
    expect(rendered).toContain('Next:');
  });

  it('omits the reasoning section when disabled', async () => {
    const results = await createDemoResults('startup');

    const rendered = renderTerminalServiceReport(results, { reasoning: false });

    expect(rendered).not.toContain('Service Analysis (Worst 3)');
  });

  it('includes condensed service analysis in JSON output', async () => {
    const results = await createDemoResults('startup');

    const report = buildServiceReportJson(results, {});
    const serviceAnalysis = report.serviceAnalysis as
      | ReadonlyArray<{ readonly bullets: readonly string[] }>
      | undefined;

    expect(Array.isArray(serviceAnalysis)).toBe(true);
    expect(serviceAnalysis?.length).toBeGreaterThan(0);
    expect(serviceAnalysis?.every((entry) => entry.bullets.length <= 4)).toBe(true);
  });
});
