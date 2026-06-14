import type { SpofTolerance } from '../contract-types.js';
import type {
  DimensionResult,
  ServiceInfo,
  SpofInfo,
} from '../contract-result-types.js';

export function evaluateSpofRequirement(
  required: SpofTolerance,
  spofs: readonly SpofInfo[] | null,
  service: ServiceInfo,
): DimensionResult {
  if (required === 'any') {
    return {
      dimension: 'spof',
      verdict: 'met',
      required,
      actual: 'not checked',
      source: 'derived',
      reason: `SPOF tolerance for ${service.serviceName} allows any SPOFs.`,
    };
  }

  if (spofs === null) {
    return {
      dimension: 'spof',
      verdict: 'unknown',
      required,
      actual: null,
      source: 'not_available',
      reason: `No SPOF analysis data is available for ${service.serviceName}.`,
    };
  }

  if (required === 'none') {
    return evaluateNoSpofs(spofs, service);
  }

  return evaluateMitigatedSpofs(spofs, service);
}

function evaluateNoSpofs(
  spofs: readonly SpofInfo[],
  service: ServiceInfo,
): DimensionResult {
  if (spofs.length === 0) {
    return {
      dimension: 'spof',
      verdict: 'met',
      required: 'none',
      actual: '0 SPOFs',
      source: 'graph_analysis',
      reason: `No SPOFs were detected for ${service.serviceName}.`,
    };
  }

  return {
    dimension: 'spof',
    verdict: 'violated',
    required: 'none',
    actual: `${spofs.length} SPOF${spofs.length === 1 ? '' : 's'}`,
    source: 'graph_analysis',
    reason: `SPOFs are not allowed for ${service.serviceName}. Problematic SPOFs: ${formatSpofArns(spofs)}.`,
  };
}

function evaluateMitigatedSpofs(
  spofs: readonly SpofInfo[],
  service: ServiceInfo,
): DimensionResult {
  const unmitigated = spofs.filter((spof) => !spof.mitigated);
  if (unmitigated.length === 0) {
    return {
      dimension: 'spof',
      verdict: 'met',
      required: 'mitigated',
      actual: `${spofs.length} mitigated SPOF${spofs.length === 1 ? '' : 's'}`,
      source: 'graph_analysis',
      reason: `All detected SPOFs are mitigated for ${service.serviceName}.`,
    };
  }

  return {
    dimension: 'spof',
    verdict: 'violated',
    required: 'mitigated',
    actual: `${unmitigated.length} unmitigated SPOF${unmitigated.length === 1 ? '' : 's'}`,
    source: 'graph_analysis',
    reason: `Unmitigated SPOFs were detected for ${service.serviceName}. Problematic SPOFs: ${formatSpofArns(unmitigated)}.`,
  };
}

function formatSpofArns(spofs: readonly SpofInfo[]): string {
  return spofs.map((spof) => spof.nodeArn).join(', ');
}
