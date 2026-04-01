/** Barrel exports for the graph engine module. */

export type { GraphInstance } from './graph-instance.js';

export {
  cloneGraph,
  getDependencies,
  getDependents,
  getBlastRadius,
  getSubgraph,
  exportForVisualization,
  calculateCascade,
  getGraphStats,
  getCriticalPaths,
} from './graph-utils.js';

export { isAnalyzableServiceNode } from './service-classification.js';

export {
  type BlastRadiusResult,
  type BlastEdge,
  calculateBlastRadius,
} from './blast-radius-engine.js';

export {
  type CriticalityClassification,
  classifyServiceCriticality,
} from './criticality-classifier.js';

export { detectRisks } from './risk-detection-engine.js';

export { inferBestEffortEdges } from './fallback-inference-engine.js';

export { inferDependencies } from './dependency-inference-engine.js';

export {
  DEFAULT_GRAPH_OVERRIDES_PATH,
  GRAPH_OVERRIDES_VERSION,
  type GraphOverrides,
  type GraphEdgeOverride,
  type GraphCriticalityOverride,
  type ApplyGraphOverridesResult,
  type ApplyGraphOverridesWarning,
  GraphOverrideValidationError,
  loadGraphOverrides,
  parseGraphOverrides,
  validateGraphOverrides,
  renderGraphOverridesTemplate,
  applyGraphOverrides,
  buildEdgeKey,
} from './overrides/index.js';

export { DEFAULT_RESOLVER } from './analysis-helpers.js';

export { analyzeFullGraph } from './graph-analysis-engine.js';

export { generateLandingZoneRecommendations } from './landing-zone-service.js';

export { SCENARIO_TEMPLATES, applyScenario, getScenarioOptions } from './simulation-scenarios.js';

export { runSimulation } from './simulation-engine.js';

export { buildSimulationPropagation } from './simulation-propagation.js';

export { type GenerateBiaOptions, generateBIA } from './bia-engine.js';
