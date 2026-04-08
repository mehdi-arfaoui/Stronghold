export type {
  Criticality,
  DetectionSource,
  LoadedManualServices,
  ManualServiceDefinition,
  OwnerStatus,
  ResourceRole,
  Service,
  ServiceDetectionResult,
  ServiceDetectionSummary,
  ServiceFinding,
  ServiceGovernance,
  ServiceResource,
  ServiceScore,
  ServiceScoringResult,
} from './service-types.js';

export type {
  ContextualFinding,
  DRCapability,
  RemediationAction,
} from './finding-types.js';

export type {
  ServicePosture,
  ServicePostureService,
  ServiceRecommendationProjection,
  UnassignedServicePosture,
} from './service-posture-types.js';

export {
  buildServiceIndex,
  classifyResourceRole,
  cleanServiceName,
  deriveCriticality,
  extractPrefixCandidate,
  hasSharedAvailabilityPattern,
  normalizeEdgeType,
  readNameTag,
  resolveNodeTags,
  resolveTagValue,
  slugifyServiceId,
} from './service-utils.js';

export { detectServices } from './service-detector.js';

export {
  detectCloudFormationServices,
  detectTagServices,
  detectTopologyServices,
} from './detection-strategies/index.js';

export {
  DEFAULT_SERVICES_FILE_PATH,
  SERVICES_FILE_VERSION,
  loadManualServices,
  parseManualServices,
} from './services-loader.js';

export { mergeServices } from './services-merger.js';

export { scoreServices } from './service-scoring.js';

export { contextualizeFindings, populateScenarioImpact } from './finding-contextualizer.js';

export { buildServicePosture, type BuildServicePostureInput } from './service-posture-builder.js';

export { applyScenarioImpactToServicePosture } from './service-posture-scenarios.js';
