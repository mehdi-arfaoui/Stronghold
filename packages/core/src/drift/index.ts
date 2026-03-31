export type {
  InfrastructureNode,
  DriftSeverity,
  DriftCategory,
  DriftChange,
  DriftReport,
} from './drift-types.js';

export type { DriftRule } from './drift-rules.js';
export { DEFAULT_DRIFT_RULES } from './drift-rules.js';

export type { DetectDriftOptions } from './drift-detector.js';
export { detectDrift } from './drift-detector.js';

export type { AnalyzeDriftImpactOptions } from './drift-impact-analyzer.js';
export { analyzeDriftImpact } from './drift-impact-analyzer.js';

