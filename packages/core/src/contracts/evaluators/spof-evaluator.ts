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
    reason: `SPOFs are not allowed for ${service.serviceName}. Problematic SPOFs: ${formatSpofLabels(spofs)}.`,
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
    reason: `Unmitigated SPOFs were detected for ${service.serviceName}. Problematic SPOFs: ${formatSpofLabels(unmitigated)}.`,
  };
}

function formatSpofLabels(spofs: readonly SpofInfo[]): string {
  return spofs.map((spof) => formatResourceReference(spof.nodeArn)).join(', ');
}

function formatResourceReference(resourceId: string): string {
  if (!resourceId.startsWith('arn:')) {
    return `Resource (${shortIdentifier(resourceId)})`;
  }

  const arnParts = resourceId.split(':');
  const service = arnParts[2] ?? 'resource';
  const resource = arnParts.slice(5).join(':');
  const parsed = parseArnResource(service, resource);

  return `${parsed.label} (${shortIdentifier(parsed.identifier)})`;
}

function parseArnResource(
  service: string,
  resource: string,
): {
  readonly label: string;
  readonly identifier: string;
} {
  if (service === 'rds') {
    const [kind, identifier] = splitColonResource(resource);
    return {
      label: kind === 'cluster' ? 'RDS cluster' : kind === 'global-cluster' ? 'RDS global cluster' : 'RDS instance',
      identifier,
    };
  }

  if (service === 'ec2') {
    const [kind, identifier] = splitSlashResource(resource);
    return {
      label: kind === 'instance' ? 'EC2 instance' : 'EC2 resource',
      identifier,
    };
  }

  if (service === 'elasticache') {
    const [kind, identifier] = splitColonResource(resource);
    return {
      label: kind === 'replicationgroup' ? 'ElastiCache replication group' : 'ElastiCache resource',
      identifier,
    };
  }

  if (service === 'elasticloadbalancing') {
    const parts = resource.split('/');
    return {
      label: 'Load balancer',
      identifier: parts.length >= 3 ? parts[2] ?? resource : resource,
    };
  }

  if (service === 's3') {
    return {
      label: 'S3 bucket',
      identifier: resource,
    };
  }

  if (service === 'dynamodb') {
    const [kind, identifier] = splitSlashResource(resource);
    return {
      label: kind === 'table' ? 'DynamoDB table' : 'DynamoDB resource',
      identifier,
    };
  }

  if (service === 'lambda') {
    const [kind, identifier] = splitColonResource(resource);
    return {
      label: kind === 'function' ? 'Lambda function' : 'Lambda resource',
      identifier,
    };
  }

  if (service === 'backup') {
    const [kind, identifier] = splitColonResource(resource);
    return {
      label: kind === 'backup-plan' ? 'Backup plan' : 'Backup resource',
      identifier,
    };
  }

  if (service === 'cloudwatch') {
    const [kind, identifier] = splitColonResource(resource);
    return {
      label: kind === 'alarm' ? 'CloudWatch alarm' : 'CloudWatch resource',
      identifier,
    };
  }

  return {
    label: `${service.toUpperCase()} resource`,
    identifier: resource,
  };
}

function splitColonResource(resource: string): readonly [string, string] {
  const [kind, ...rest] = resource.split(':');
  return [kind ?? 'resource', rest.join(':') || resource];
}

function splitSlashResource(resource: string): readonly [string, string] {
  const [kind, ...rest] = resource.split('/');
  return [kind ?? 'resource', rest.join('/') || resource];
}

function shortIdentifier(identifier: string): string {
  const compact = identifier.split('/').at(-1)?.split(':').at(-1) ?? identifier;
  if (compact.length <= 12) {
    return compact;
  }

  return `***${compact.slice(-12)}`;
}
