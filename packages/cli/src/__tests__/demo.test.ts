import { describe, expect, it } from 'vitest';

import { getDemoInfrastructure } from '../demo/demo-infrastructure.js';
import { createDemoResults } from './test-utils.js';

describe('demo infrastructure', () => {
  it('startup produces roughly twenty nodes', () => {
    expect(getDemoInfrastructure('startup').nodes.length).toBeGreaterThanOrEqual(20);
  });

  it('enterprise produces roughly fifty nodes', () => {
    expect(getDemoInfrastructure('enterprise').nodes.length).toBeGreaterThanOrEqual(40);
  });

  it('minimal produces roughly eight nodes', () => {
    expect(getDemoInfrastructure('minimal').nodes.length).toBe(8);
  });

  it('every scenario includes nodes with non-empty metadata', () => {
    const scenarios = ['startup', 'enterprise', 'minimal'] as const;

    scenarios.forEach((scenario) => {
      expect(
        getDemoInfrastructure(scenario).nodes.every(
          (node) => Object.keys(node.metadata).length > 0,
        ),
      ).toBe(true);
    });
  });

  it('runs the full pipeline on demo data', async () => {
    const results = await createDemoResults('startup');

    expect(results.nodes.length).toBeGreaterThan(0);
    expect(results.validationReport.totalChecks).toBeGreaterThan(0);
    expect(results.drpPlan.services.length).toBeGreaterThan(0);
  });

  it('startup score stays in the expected range', async () => {
    const results = await createDemoResults('startup');

    expect(results.validationReport.score).toBeGreaterThanOrEqual(40);
    expect(results.validationReport.score).toBeLessThanOrEqual(70);
  });

  it('enterprise score stays in the expected range', async () => {
    const results = await createDemoResults('enterprise');

    expect(results.validationReport.score).toBeGreaterThanOrEqual(65);
    expect(results.validationReport.score).toBeLessThanOrEqual(100);
  });

  it('minimal score stays in the expected range', async () => {
    const results = await createDemoResults('minimal');

    expect(results.validationReport.score).toBeGreaterThanOrEqual(0);
    expect(results.validationReport.score).toBeLessThanOrEqual(30);
  });
});
