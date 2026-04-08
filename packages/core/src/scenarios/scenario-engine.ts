import type { GraphAnalysisReport } from '../types/analysis.js';
import type { InfraNodeAttrs } from '../types/infrastructure.js';
import type { DRPlan } from '../drp/drp-types.js';
import type { Evidence } from '../evidence/index.js';
import type { GraphInstance } from '../graph/graph-instance.js';
import { generateRunbook } from '../drp/runbook/runbook-generator.js';
import type { Service } from '../services/service-types.js';
import { analyzeCoverage } from './coverage-analyzer.js';
import { generateBuiltInScenarios } from './built-in-scenarios.js';
import { propagateImpact } from './impact-propagator.js';
export {
  selectByAZ,
  selectByNodeId,
  selectByRegion,
  selectByServiceType,
  selectDatastores,
} from './selection-helpers.js';
import type {
  AnalyzeScenariosInput,
  AnalyzeScenarioInput,
  Scenario,
  ScenarioAnalysis,
  ScenarioCoverageSummary,
} from './scenario-types.js';

export function analyzeScenario(input: AnalyzeScenarioInput): Scenario {
  const impact = propagateImpact(input.graph, input.scenario.disruption.affectedNodes, input.services);
  const scenarioWithImpact = {
    ...input.scenario,
    impact,
  } satisfies Scenario;
  const coverage = analyzeCoverage(
    scenarioWithImpact,
    input.drp,
    input.evidence,
    input.services,
    input.nodes,
    input.runbook,
  );

  return {
    ...scenarioWithImpact,
    coverage,
  };
}

export function analyzeScenarios(input: AnalyzeScenariosInput): ScenarioAnalysis {
  const runbook =
    input.runbook !== undefined
      ? input.runbook
      : input.drp
        ? generateRunbook(input.drp, input.nodes)
        : null;
  const scenarios = input.scenarios.map((scenario) =>
    analyzeScenario({
      graph: input.graph,
      nodes: input.nodes,
      services: input.services,
      scenario,
      drp: input.drp,
      evidence: input.evidence,
      runbook,
    }),
  );
  const defaultScenarioIds =
    input.defaultScenarioIds ?? scenarios.map((scenario) => scenario.id);

  return {
    scenarios,
    defaultScenarioIds,
    summary: summarizeScenarioCoverage(
      scenarios.filter((scenario) => defaultScenarioIds.includes(scenario.id)),
    ),
  };
}

export function analyzeBuiltInScenarios(options: {
  readonly graph: GraphInstance;
  readonly nodes: readonly InfraNodeAttrs[];
  readonly services: readonly Service[];
  readonly analysis: GraphAnalysisReport;
  readonly drp: DRPlan | null;
  readonly evidence: readonly Evidence[];
}): ScenarioAnalysis {
  const generated = generateBuiltInScenarios({
    nodes: options.nodes,
    services: options.services,
    analysis: options.analysis,
  });

  return analyzeScenarios({
    graph: options.graph,
    nodes: options.nodes,
    services: options.services,
    scenarios: generated.scenarios,
    defaultScenarioIds: generated.defaultScenarioIds,
    drp: options.drp,
    evidence: options.evidence,
  });
}

export function selectDefaultScenarios(analysis: ScenarioAnalysis): readonly Scenario[] {
  const defaults = new Set(analysis.defaultScenarioIds);
  return analysis.scenarios.filter((scenario) => defaults.has(scenario.id));
}

export function summarizeScenarioCoverage(scenarios: readonly Scenario[]): ScenarioCoverageSummary {
  return scenarios.reduce<ScenarioCoverageSummary>(
    (summary, scenario) => {
      switch (scenario.coverage?.verdict) {
        case 'covered':
          return { ...summary, total: summary.total + 1, covered: summary.covered + 1 };
        case 'partially_covered':
          return {
            ...summary,
            total: summary.total + 1,
            partiallyCovered: summary.partiallyCovered + 1,
          };
        case 'degraded':
          return { ...summary, total: summary.total + 1, degraded: summary.degraded + 1 };
        case 'uncovered':
          return { ...summary, total: summary.total + 1, uncovered: summary.uncovered + 1 };
        default:
          return { ...summary, total: summary.total + 1 };
      }
    },
    buildEmptySummary(),
  );
}

function buildEmptySummary(): ScenarioCoverageSummary {
  return {
    total: 0,
    covered: 0,
    partiallyCovered: 0,
    uncovered: 0,
    degraded: 0,
  };
}
