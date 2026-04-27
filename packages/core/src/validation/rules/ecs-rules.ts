import { getMetadata, readNumber, readString } from '../../graph/analysis-helpers.js';
import { collectNodeReferences, hasNodeKind } from '../validation-node-utils.js';
import type {
  InfraNode,
  ValidationContext,
  ValidationResult,
  ValidationRule,
} from '../validation-types.js';

function createResult(
  ruleId: string,
  node: InfraNode,
  status: ValidationResult['status'],
  message: string,
  details?: Record<string, unknown>,
  remediation?: string,
): ValidationResult {
  return {
    ruleId,
    nodeId: node.id,
    status,
    message,
    ...(details ? { details } : {}),
    ...(remediation ? { remediation } : {}),
  };
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readObjectArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function normalizeReference(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase();
}

function findEcsServiceTasks(node: InfraNode, context: ValidationContext): readonly InfraNode[] {
  const metadata = getMetadata(node);
  const serviceArn = readString(metadata.serviceArn) ?? node.id;
  const serviceName = readString(metadata.serviceName);
  const clusterArn = readString(metadata.clusterArn);

  const byEdge = context.edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => context.allNodes.find((candidate) => candidate.id === edge.source))
    .filter((candidate): candidate is InfraNode => Boolean(candidate))
    .filter((candidate) => hasNodeKind(candidate, ['ecs-task']));

  const byMetadata = context.allNodes.filter((candidate) => {
    if (!hasNodeKind(candidate, ['ecs-task'])) return false;
    const candidateMetadata = getMetadata(candidate);
    if (readString(candidateMetadata.serviceArn) === serviceArn) return true;
    if (!serviceName) return false;
    return (
      readString(candidateMetadata.serviceName) === serviceName &&
      (!clusterArn || readString(candidateMetadata.clusterArn) === clusterArn)
    );
  });

  return Array.from(
    new Map([...byEdge, ...byMetadata].map((task) => [task.id, task] as const)).values(),
  );
}

function collectTaskAvailabilityZones(
  node: InfraNode,
  context: ValidationContext,
): readonly string[] {
  return Array.from(
    new Set(
      findEcsServiceTasks(node, context)
        .map((task) => readString(getMetadata(task).availabilityZone) ?? task.availabilityZone ?? null)
        .filter((zone): zone is string => Boolean(zone)),
    ),
  ).sort();
}

function activeCapacityProviderNames(node: InfraNode): readonly string[] {
  const metadata = getMetadata(node);
  const rawStrategy = readObjectArray(metadata.capacityProviderStrategy).length > 0
    ? readObjectArray(metadata.capacityProviderStrategy)
    : readObjectArray(metadata.effectiveCapacityProviderStrategy);
  const weighted = rawStrategy.filter((entry) => (readNumber(entry.weight) ?? 0) > 0);
  const strategy = weighted.length > 0 ? weighted : rawStrategy;
  return strategy
    .map((entry) => readString(entry.capacityProvider))
    .filter((entry): entry is string => entry !== null);
}

function collectSecretTargetArns(node: InfraNode): readonly string[] {
  const references = readObjectArray(getMetadata(node).secretReferences);
  return references
    .map((reference) => readString(reference.targetArn) ?? readString(reference.valueFrom))
    .filter((value): value is string => value !== null)
    .filter((value) => value.startsWith('arn:'));
}

function isVisibleInGraph(arn: string, context: ValidationContext): boolean {
  const normalized = normalizeReference(arn);
  return context.allNodes.some((node) => collectNodeReferences(node).has(normalized));
}

const ecsMultiAzDeploymentRule: ValidationRule = {
  id: 'ECS_MULTI_AZ_DEPLOYMENT',
  name: 'ECS Multi-AZ Deployment',
  description: 'Checks whether running ECS service tasks span multiple availability zones.',
  category: 'redundancy',
  severity: 'high',
  appliesToTypes: ['ecs-service'],
  observedKeys: ['desiredCount', 'runningCount', 'availabilityZone'],
  validate: (node, context) => {
    const metadata = getMetadata(node);
    const serviceName = readString(metadata.serviceName) ?? node.name;
    const desiredCount = readNumber(metadata.desiredCount) ?? 0;
    const availabilityZones = collectTaskAvailabilityZones(node, context);
    const taskCount = findEcsServiceTasks(node, context).length;

    if (taskCount === 0) {
      return createResult(
        ecsMultiAzDeploymentRule.id,
        node,
        'skip',
        `ECS service '${serviceName}' has no running tasks visible in this scan.`,
      );
    }
    if (availabilityZones.length >= 2) {
      return createResult(
        ecsMultiAzDeploymentRule.id,
        node,
        'pass',
        `ECS service '${serviceName}' runs across ${availabilityZones.length} availability zones.`,
        { availabilityZones, taskCount },
      );
    }

    const az = availabilityZones[0] ?? 'unknown';
    return createResult(
      ecsMultiAzDeploymentRule.id,
      node,
      'fail',
      `ECS service '${serviceName}' has all ${taskCount} tasks in a single AZ (${az}). An AZ failure would take down the entire service.`,
      {
        availabilityZones,
        taskCount,
        desiredCount,
        effectiveSeverity: desiredCount >= 2 ? 'high' : 'medium',
      },
      'Run the service across subnets in at least two availability zones.',
    );
  },
};

const ecsCircuitBreakerDisabledRule: ValidationRule = {
  id: 'ECS_CIRCUIT_BREAKER_DISABLED',
  name: 'ECS Deployment Circuit Breaker',
  description: 'Checks whether ECS can automatically roll back failed deployments.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['ecs-service'],
  observedKeys: ['deploymentConfiguration.deploymentCircuitBreaker'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const serviceName = readString(metadata.serviceName) ?? node.name;
    const deploymentConfiguration = readObject(metadata.deploymentConfiguration);
    const circuitBreaker = readObject(deploymentConfiguration?.deploymentCircuitBreaker);
    const enabled = circuitBreaker?.enable === true;
    return enabled
      ? createResult(
          ecsCircuitBreakerDisabledRule.id,
          node,
          'pass',
          `ECS service '${serviceName}' has deployment circuit breaker enabled.`,
        )
      : createResult(
          ecsCircuitBreakerDisabledRule.id,
          node,
          'fail',
          `ECS service '${serviceName}' has no deployment circuit breaker. A bad deployment cannot be automatically rolled back.`,
          { deploymentCircuitBreaker: circuitBreaker },
          'Enable the ECS deployment circuit breaker with rollback.',
        );
  },
};

const ecsFargateSpotOnlyRule: ValidationRule = {
  id: 'ECS_FARGATE_SPOT_ONLY',
  name: 'ECS Fargate Spot Only',
  description: 'Checks whether an ECS service depends exclusively on Fargate Spot capacity.',
  category: 'recovery',
  severity: 'high',
  appliesToTypes: ['ecs-service'],
  observedKeys: ['capacityProviderStrategy', 'effectiveCapacityProviderStrategy'],
  validate: (node) => {
    const serviceName = readString(getMetadata(node).serviceName) ?? node.name;
    const capacityProviders = activeCapacityProviderNames(node);
    if (capacityProviders.length === 0) {
      return createResult(
        ecsFargateSpotOnlyRule.id,
        node,
        'skip',
        `ECS service '${serviceName}' does not declare a capacity provider strategy.`,
      );
    }

    const normalized: string[] = capacityProviders.map((provider) => provider.toUpperCase());
    const includesOnDemandFargate = normalized.some((provider) => provider === 'FARGATE');
    const spotOnly =
      normalized.length > 0 &&
      normalized.every((provider) => provider === 'FARGATE_SPOT') &&
      !includesOnDemandFargate;
    return spotOnly
      ? createResult(
          ecsFargateSpotOnlyRule.id,
          node,
          'fail',
          `ECS service '${serviceName}' runs exclusively on Fargate Spot. Spot interruptions during a DR event would prevent service recovery.`,
          { capacityProviders },
          'Add on-demand FARGATE capacity to the strategy.',
        )
      : createResult(
          ecsFargateSpotOnlyRule.id,
          node,
          'pass',
          `ECS service '${serviceName}' has non-Spot capacity available.`,
          { capacityProviders },
        );
  },
};

const ecsDesiredVsRunningMismatchRule: ValidationRule = {
  id: 'ECS_DESIRED_VS_RUNNING_MISMATCH',
  name: 'ECS Desired vs Running',
  description: 'Checks whether ECS running task count matches desired count before an incident.',
  category: 'detection',
  severity: 'medium',
  appliesToTypes: ['ecs-service'],
  observedKeys: ['desiredCount', 'runningCount'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const serviceName = readString(metadata.serviceName) ?? node.name;
    const desiredCount = readNumber(metadata.desiredCount) ?? 0;
    const runningCount = readNumber(metadata.runningCount) ?? 0;
    return runningCount < desiredCount
      ? createResult(
          ecsDesiredVsRunningMismatchRule.id,
          node,
          'fail',
          `ECS service '${serviceName}' has ${runningCount}/${desiredCount} tasks running. The service is already degraded before any incident.`,
          { desiredCount, runningCount },
          'Investigate stopped tasks and restore the desired service count.',
        )
      : createResult(
          ecsDesiredVsRunningMismatchRule.id,
          node,
          'pass',
          `ECS service '${serviceName}' has ${runningCount}/${desiredCount} tasks running.`,
          { desiredCount, runningCount },
        );
  },
};

const ecsMissingExecutionRoleRule: ValidationRule = {
  id: 'ECS_MISSING_EXECUTION_ROLE',
  name: 'ECS Execution Role',
  description: 'Checks whether ECS task definitions declare an execution role.',
  category: 'recovery',
  severity: 'critical',
  appliesToTypes: ['ecs-task-definition'],
  observedKeys: ['executionRoleArn'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const family = readString(metadata.family) ?? node.name;
    const revision = readNumber(metadata.revision) ?? 0;
    return readString(metadata.executionRoleArn)
      ? createResult(
          ecsMissingExecutionRoleRule.id,
          node,
          'pass',
          `ECS task definition '${family}:${revision}' has an execution role.`,
        )
      : createResult(
          ecsMissingExecutionRoleRule.id,
          node,
          'fail',
          `ECS task definition '${family}:${revision}' has no execution role. ECS agent cannot pull images or write logs.`,
          { executionRoleArn: null },
          'Attach a task execution role with ECR and CloudWatch Logs permissions.',
        );
  },
};

const ecsSecretsDependencyRule: ValidationRule = {
  id: 'ECS_SECRETS_DEPENDENCY',
  name: 'ECS Secrets Visibility',
  description: 'Checks whether ECS task definition secret dependencies are visible in the scan graph.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['ecs-task-definition'],
  observedKeys: ['secretReferences'],
  validate: (node, context) => {
    const metadata = getMetadata(node);
    const family = readString(metadata.family) ?? node.name;
    const secretArns = uniqueStrings(collectSecretTargetArns(node));
    if (secretArns.length === 0) {
      return createResult(
        ecsSecretsDependencyRule.id,
        node,
        'pass',
        `ECS task definition '${family}' does not reference external secrets.`,
      );
    }

    const missingSecrets = secretArns.filter((arn) => !isVisibleInGraph(arn, context));
    return missingSecrets.length === 0
      ? createResult(
          ecsSecretsDependencyRule.id,
          node,
          'pass',
          `ECS task definition '${family}' has all secret dependencies visible in this scan.`,
          { secretArns },
        )
      : createResult(
          ecsSecretsDependencyRule.id,
          node,
          'fail',
          `ECS task definition '${family}' depends on ${missingSecrets.length} secrets not visible in this scan. These secrets must be available post-recovery.`,
          { secretArns, missingSecrets },
          'Include Secrets Manager and SSM Parameter Store dependencies in the recovery scope.',
        );
  },
};

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values)).sort();
}

export const ecsValidationRules: readonly ValidationRule[] = [
  ecsMultiAzDeploymentRule,
  ecsCircuitBreakerDisabledRule,
  ecsFargateSpotOnlyRule,
  ecsDesiredVsRunningMismatchRule,
  ecsMissingExecutionRoleRule,
  ecsSecretsDependencyRule,
];
