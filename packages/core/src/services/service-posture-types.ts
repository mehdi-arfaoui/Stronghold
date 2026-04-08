import type { Grade } from '../validation/validation-types.js';
import type { Recommendation } from '../recommendations/recommendation-types.js';
import type { ContextualFinding } from './finding-types.js';
import type {
  Criticality,
  Service,
  ServiceDetectionResult,
  ServiceScore,
  ServiceScoringResult,
} from './service-types.js';

export interface ServiceRecommendationProjection extends Recommendation {
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly serviceCriticality: Criticality | null;
  readonly serviceOwner?: string;
  readonly projectedScore: {
    readonly current: number | null;
    readonly next: number | null;
    readonly currentGrade: Grade | null;
    readonly nextGrade: Grade | null;
  };
  readonly drImpactSummary: string | null;
}

export interface ServicePostureService {
  readonly service: Service;
  readonly score: ServiceScore;
  readonly contextualFindings: readonly ContextualFinding[];
  readonly recommendations: readonly ServiceRecommendationProjection[];
}

export interface UnassignedServicePosture {
  readonly score: ServiceScore | null;
  readonly resourceCount: number;
  readonly contextualFindings: readonly ContextualFinding[];
  readonly recommendations: readonly ServiceRecommendationProjection[];
}

export interface ServicePosture {
  readonly detection: ServiceDetectionResult;
  readonly scoring: ServiceScoringResult;
  readonly contextualFindings: readonly ContextualFinding[];
  readonly recommendations: readonly ServiceRecommendationProjection[];
  readonly services: readonly ServicePostureService[];
  readonly unassigned: UnassignedServicePosture;
}
