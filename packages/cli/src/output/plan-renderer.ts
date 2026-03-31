import { serializeDRPlan, type DRPlan } from '@stronghold-dr/core';

import type { PlanOutputFormat } from '../config/options.js';
import type { ScanResults } from '../storage/file-store.js';

export function renderPlanDocument(
  plan: DRPlan,
  format: PlanOutputFormat,
  scan: ScanResults,
): string {
  const serialized = serializeDRPlan(plan, format);
  if (format === 'json') {
    return serialized;
  }

  return `${buildYamlHeader(scan)}\n${serialized}`;
}

function buildYamlHeader(scan: ScanResults): string {
  return `# Stronghold DR Plan
# Generated: ${scan.timestamp}
# Infrastructure hash: ${scan.drpPlan.infrastructureHash}
# Regions: ${scan.regions.join(', ')}
# Resources: ${scan.nodes.length}
# DR Posture Score: ${scan.validationReport.score}/100 (Grade: ${scan.validationReport.scoreBreakdown.grade})
#
# This plan is declarative — it describes WHAT to restore and in what order.
# Review recovery strategies and test RTOs before relying on this plan.
#
# Commit this file to your repository and run 'stronghold plan validate'
# after infrastructure changes to detect drift.`;
}
