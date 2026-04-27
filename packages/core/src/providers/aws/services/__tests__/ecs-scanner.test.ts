import { ECSClient } from '@aws-sdk/client-ecs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeType } from '../../../../types/infrastructure.js';
import { transformToScanResult } from '../../graph-bridge.js';
import { scanEcsServices } from '../ecs-scanner.js';

const REGION = 'eu-west-3';
const ACCOUNT_ID = '123456789012';
const CLUSTER_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:cluster/prod`;
const SERVICE_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/prod/api`;
const TASK_DEFINITION_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:task-definition/api:42`;
const TASK_ARN_A = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:task/prod/task-a`;
const TASK_ARN_B = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:task/prod/task-b`;
const TARGET_GROUP_ARN =
  `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT_ID}:targetgroup/api/abc123`;
const TASK_ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/api-task-role`;
const EXECUTION_ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/api-exec-role`;
const SECRET_ARN =
  `arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:db-password-AbCdEf`;
const SSM_PARAMETER_ARN = `arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter/api/config`;
const EFS_ARN = `arn:aws:elasticfilesystem:${REGION}:${ACCOUNT_ID}:file-system/fs-12345678`;
const ECR_REPOSITORY_ARN = `arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/app/api`;
const LOG_GROUP_ARN = `arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/ecs/api`;
const CONFIG_BUCKET_ARN = 'arn:aws:s3:::ecs-config';
const CUSTOM_CP_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:capacity-provider/custom-cp`;
const ASG_ARN =
  `arn:aws:autoscaling:${REGION}:${ACCOUNT_ID}:autoScalingGroup:uuid:autoScalingGroupName/ecs-asg`;

interface MockEcsScenario {
  readonly clusterPages: readonly (readonly string[])[];
  readonly clustersByArn: ReadonlyMap<string, Record<string, unknown>>;
  readonly servicePagesByCluster: ReadonlyMap<string, readonly (readonly string[])[]>;
  readonly servicesByCluster: ReadonlyMap<string, readonly Record<string, unknown>[]>;
  readonly taskDefinitionsByArn: ReadonlyMap<string, Record<string, unknown>>;
  readonly taskDefinitionTagsByArn: ReadonlyMap<string, readonly Record<string, string>[]>;
  readonly taskPagesByServiceKey: ReadonlyMap<string, readonly (readonly string[])[]>;
  readonly tasksByServiceKey: ReadonlyMap<string, readonly Record<string, unknown>[]>;
  readonly capacityProviders: readonly Record<string, unknown>[];
  readonly failDescribeServicesForClusters?: ReadonlySet<string>;
  readonly throttleTaskDefinitionAttempts?: number;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function commandName(command: unknown): string {
  if (!command || typeof command !== 'object') return '';
  return (command as { readonly constructor?: { readonly name?: string } }).constructor?.name ?? '';
}

function commandInput(command: unknown): Record<string, unknown> {
  if (!command || typeof command !== 'object') return {};
  return readRecord((command as { readonly input?: unknown }).input);
}

function pageAt<TValue>(
  pages: readonly (readonly TValue[])[] | undefined,
  nextToken: unknown,
): { readonly items: readonly TValue[]; readonly nextToken?: string } {
  const index = readString(nextToken) ? Number(nextToken) : 0;
  const page = pages?.[Number.isFinite(index) ? index : 0] ?? [];
  const followingIndex = (Number.isFinite(index) ? index : 0) + 1;
  return {
    items: page,
    ...(pages && followingIndex < pages.length ? { nextToken: String(followingIndex) } : {}),
  };
}

function serviceKey(clusterArn: string, serviceName: string): string {
  return `${clusterArn}|${serviceName}`;
}

function createThrottleError(): Error {
  const error = new Error('Rate exceeded');
  error.name = 'ThrottlingException';
  return error;
}

function createDefaultScenario(overrides: Partial<MockEcsScenario> = {}): MockEcsScenario {
  const taskDefinition = createTaskDefinition();
  return {
    clusterPages: [[CLUSTER_ARN]],
    clustersByArn: new Map([[CLUSTER_ARN, createCluster()]]),
    servicePagesByCluster: new Map([[CLUSTER_ARN, [[SERVICE_ARN]]]]),
    servicesByCluster: new Map([[CLUSTER_ARN, [createService()]]]),
    taskDefinitionsByArn: new Map([[TASK_DEFINITION_ARN, taskDefinition]]),
    taskDefinitionTagsByArn: new Map([[TASK_DEFINITION_ARN, [{ key: 'Name', value: 'api:42' }]]]),
    taskPagesByServiceKey: new Map([[serviceKey(CLUSTER_ARN, 'api'), [[TASK_ARN_A, TASK_ARN_B]]]]),
    tasksByServiceKey: new Map([
      [
        serviceKey(CLUSTER_ARN, 'api'),
        [
          createTask(TASK_ARN_A, 'eu-west-3a'),
          createTask(TASK_ARN_B, 'eu-west-3b'),
        ],
      ],
    ]),
    capacityProviders: [
      createCapacityProvider('FARGATE'),
      createCapacityProvider('FARGATE_SPOT'),
      createCapacityProvider('custom-cp', CUSTOM_CP_ARN, ASG_ARN),
    ],
    ...overrides,
  };
}

function createCluster(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clusterArn: CLUSTER_ARN,
    clusterName: 'prod',
    status: 'ACTIVE',
    registeredContainerInstancesCount: 0,
    activeServicesCount: 1,
    runningTasksCount: 2,
    capacityProviders: ['FARGATE', 'FARGATE_SPOT', 'custom-cp'],
    defaultCapacityProviderStrategy: [{ capacityProvider: 'FARGATE', weight: 1, base: 0 }],
    settings: [{ name: 'containerInsights', value: 'enabled' }],
    tags: [{ key: 'Name', value: 'prod' }],
    ...overrides,
  };
}

function createService(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serviceArn: SERVICE_ARN,
    serviceName: 'api',
    clusterArn: CLUSTER_ARN,
    taskDefinition: TASK_DEFINITION_ARN,
    desiredCount: 2,
    runningCount: 2,
    pendingCount: 0,
    capacityProviderStrategy: [
      { capacityProvider: 'FARGATE', weight: 3 },
      { capacityProvider: 'FARGATE_SPOT', weight: 1 },
    ],
    platformVersion: '1.4.0',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: ['subnet-a', 'subnet-b'],
        securityGroups: ['sg-api'],
        assignPublicIp: 'DISABLED',
      },
    },
    loadBalancers: [
      {
        targetGroupArn: TARGET_GROUP_ARN,
        containerName: 'api',
        containerPort: 8080,
      },
    ],
    serviceRegistries: [
      {
        registryArn: `arn:aws:servicediscovery:${REGION}:${ACCOUNT_ID}:service/srv-api`,
      },
    ],
    deploymentConfiguration: {
      deploymentCircuitBreaker: { enable: true, rollback: true },
      minimumHealthyPercent: 50,
      maximumPercent: 200,
    },
    deployments: [
      {
        status: 'PRIMARY',
        desiredCount: 2,
        runningCount: 2,
        taskDefinition: TASK_DEFINITION_ARN,
      },
    ],
    schedulingStrategy: 'REPLICA',
    tags: [{ key: 'Name', value: 'api-service' }],
    ...overrides,
  };
}

function createTaskDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskDefinitionArn: TASK_DEFINITION_ARN,
    family: 'api',
    revision: 42,
    status: 'ACTIVE',
    taskRoleArn: TASK_ROLE_ARN,
    executionRoleArn: EXECUTION_ROLE_ARN,
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu: '512',
    memory: '1024',
    containerDefinitions: [
      {
        name: 'api',
        image: `${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/app/api:prod`,
        essential: true,
        cpu: 256,
        memory: 512,
        memoryReservation: 256,
        portMappings: [{ containerPort: 8080, protocol: 'tcp' }],
        environment: [
          {
            name: 'DATABASE_URL',
            value: 'postgres://orders.cluster-abcd.eu-west-3.rds.amazonaws.com:5432/app',
          },
        ],
        environmentFiles: [{ type: 's3', value: `${CONFIG_BUCKET_ARN}/api.env` }],
        secrets: [
          { name: 'DB_PASSWORD', valueFrom: `${SECRET_ARN}:password::` },
          { name: 'APP_CONFIG', valueFrom: SSM_PARAMETER_ARN },
        ],
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': '/ecs/api',
            'awslogs-region': REGION,
          },
        },
      },
    ],
    volumes: [
      {
        name: 'shared',
        efsVolumeConfiguration: {
          fileSystemId: 'fs-12345678',
          rootDirectory: '/',
          transitEncryption: 'ENABLED',
        },
      },
    ],
    ephemeralStorage: { sizeInGiB: 50 },
    ...overrides,
  };
}

function createTask(
  taskArn: string,
  availabilityZone: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    taskArn,
    clusterArn: CLUSTER_ARN,
    taskDefinitionArn: TASK_DEFINITION_ARN,
    lastStatus: 'RUNNING',
    desiredStatus: 'RUNNING',
    launchType: 'FARGATE',
    capacityProviderName: 'FARGATE',
    availabilityZone,
    connectivity: 'CONNECTED',
    healthStatus: 'HEALTHY',
    startedAt: new Date('2026-04-01T00:00:00.000Z'),
    cpu: '512',
    memory: '1024',
    group: 'service:api',
    attachments: [
      {
        details: [
          { name: 'subnetId', value: availabilityZone.endsWith('a') ? 'subnet-a' : 'subnet-b' },
          { name: 'securityGroups', value: 'sg-api' },
        ],
      },
    ],
    tags: [{ key: 'Name', value: taskArn.split('/').pop() ?? 'task' }],
    ...overrides,
  };
}

function createCapacityProvider(
  name: string,
  arn = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:capacity-provider/${name}`,
  asgArn?: string,
): Record<string, unknown> {
  return {
    capacityProviderArn: arn,
    name,
    status: 'ACTIVE',
    autoScalingGroupProvider: asgArn
      ? {
          autoScalingGroupArn: asgArn,
          managedScaling: {
            status: 'ENABLED',
            targetCapacity: 80,
            minimumScalingStepSize: 1,
            maximumScalingStepSize: 10,
          },
          managedTerminationProtection: 'ENABLED',
        }
      : undefined,
    tags: [{ key: 'Name', value: name }],
  };
}

function installEcsMock(scenario: MockEcsScenario) {
  let describeTaskDefinitionAttempts = 0;
  const implementation = ((command: unknown) => {
    const name = commandName(command);
    const input = commandInput(command);

    if (name === 'ListClustersCommand') {
      const page = pageAt(scenario.clusterPages, input.nextToken);
      return Promise.resolve({ clusterArns: page.items, nextToken: page.nextToken });
    }

    if (name === 'DescribeClustersCommand') {
      return Promise.resolve({
        clusters: readStringArray(input.clusters)
          .map((clusterArn) => scenario.clustersByArn.get(clusterArn))
          .filter((cluster): cluster is Record<string, unknown> => Boolean(cluster)),
      });
    }

    if (name === 'ListServicesCommand') {
      const clusterArn = readString(input.cluster) ?? '';
      const page = pageAt(scenario.servicePagesByCluster.get(clusterArn), input.nextToken);
      return Promise.resolve({ serviceArns: page.items, nextToken: page.nextToken });
    }

    if (name === 'DescribeServicesCommand') {
      const clusterArn = readString(input.cluster) ?? '';
      if (scenario.failDescribeServicesForClusters?.has(clusterArn)) {
        const error = new Error('DescribeServices failed');
        error.name = 'AccessDeniedException';
        throw error;
      }
      const requestedServices = new Set(readStringArray(input.services));
      return Promise.resolve({
        services: (scenario.servicesByCluster.get(clusterArn) ?? []).filter((service) => {
          const serviceArn = readString(service.serviceArn);
          return serviceArn ? requestedServices.has(serviceArn) : true;
        }),
      });
    }

    if (name === 'DescribeTaskDefinitionCommand') {
      describeTaskDefinitionAttempts += 1;
      if (
        scenario.throttleTaskDefinitionAttempts &&
        describeTaskDefinitionAttempts <= scenario.throttleTaskDefinitionAttempts
      ) {
        throw createThrottleError();
      }
      const taskDefinitionArn = readString(input.taskDefinition) ?? '';
      return Promise.resolve({
        taskDefinition: scenario.taskDefinitionsByArn.get(taskDefinitionArn),
        tags: scenario.taskDefinitionTagsByArn.get(taskDefinitionArn) ?? [],
      });
    }

    if (name === 'ListTasksCommand') {
      const clusterArn = readString(input.cluster) ?? '';
      const serviceName = readString(input.serviceName) ?? '';
      const page = pageAt(
        scenario.taskPagesByServiceKey.get(serviceKey(clusterArn, serviceName)),
        input.nextToken,
      );
      return Promise.resolve({ taskArns: page.items, nextToken: page.nextToken });
    }

    if (name === 'DescribeTasksCommand') {
      const requestedTasks = new Set(readStringArray(input.tasks));
      const tasks = Array.from(scenario.tasksByServiceKey.values())
        .flat()
        .filter((task) => {
          const taskArn = readString(task.taskArn);
          return taskArn ? requestedTasks.has(taskArn) : false;
        });
      return Promise.resolve({ tasks });
    }

    if (name === 'DescribeCapacityProvidersCommand') {
      const requested = new Set(readStringArray(input.capacityProviders));
      return Promise.resolve({
        capacityProviders: scenario.capacityProviders.filter((provider) => {
          const nameValue = readString(provider.name);
          return nameValue ? requested.has(nameValue) : false;
        }),
      });
    }

    return Promise.reject(new Error(`Unexpected ECS command ${name}`));
  }) as unknown as ECSClient['send'];

  return vi.spyOn(ECSClient.prototype, 'send').mockImplementation(implementation);
}

async function scanScenario(scenario: MockEcsScenario) {
  installEcsMock(scenario);
  return scanEcsServices({ region: REGION, maxAttempts: 1 });
}

function resourcesOf(resources: readonly { readonly type: string }[], type: string) {
  return resources.filter((resource) => resource.type === type);
}

function hasEdge(
  result: ReturnType<typeof transformToScanResult>,
  source: string,
  target: string,
  type: string,
): boolean {
  return result.edges.some(
    (edge) => edge.source === source && edge.target === target && edge.type === type,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EcsScanner', () => {
  describe('resource discovery', () => {
    it('discovers clusters', async () => {
      const clusterTwoArn = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:cluster/dev`;
      const result = await scanScenario(
        createDefaultScenario({
          clusterPages: [[CLUSTER_ARN, clusterTwoArn]],
          clustersByArn: new Map([
            [CLUSTER_ARN, createCluster()],
            [clusterTwoArn, createCluster({ clusterArn: clusterTwoArn, clusterName: 'dev' })],
          ]),
          servicePagesByCluster: new Map([
            [CLUSTER_ARN, [[]]],
            [clusterTwoArn, [[]]],
          ]),
          servicesByCluster: new Map(),
        }),
      );

      expect(resourcesOf(result.resources, 'ECS_CLUSTER')).toHaveLength(2);
      expect(result.resources.map((resource) => resource.arn)).toContain(CLUSTER_ARN);
      expect(result.resources.map((resource) => resource.arn)).toContain(clusterTwoArn);
    });

    it('discovers services within each cluster', async () => {
      const serviceArns = ['api', 'worker', 'admin'].map(
        (name) => `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/prod/${name}`,
      );
      const services = serviceArns.map((serviceArn) =>
        createService({
          serviceArn,
          serviceName: serviceArn.split('/').pop(),
          desiredCount: 0,
          runningCount: 0,
        }),
      );
      const result = await scanScenario(
        createDefaultScenario({
          servicePagesByCluster: new Map([[CLUSTER_ARN, [serviceArns]]]),
          servicesByCluster: new Map([[CLUSTER_ARN, services]]),
          taskPagesByServiceKey: new Map(serviceArns.map((serviceArn) => [
            serviceKey(CLUSTER_ARN, serviceArn.split('/').pop() ?? ''),
            [[]],
          ])),
        }),
      );
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(resourcesOf(result.resources, 'ECS_SERVICE')).toHaveLength(3);
      for (const serviceArn of serviceArns) {
        expect(hasEdge(graph, CLUSTER_ARN, serviceArn, EdgeType.CONTAINS)).toBe(true);
      }
    });

    it('discovers task definitions for each service and caches shared definitions', async () => {
      const serviceTwoArn = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/prod/worker`;
      const sendSpy = installEcsMock(
        createDefaultScenario({
          servicePagesByCluster: new Map([[CLUSTER_ARN, [[SERVICE_ARN, serviceTwoArn]]]]),
          servicesByCluster: new Map([
            [
              CLUSTER_ARN,
              [
                createService(),
                createService({ serviceArn: serviceTwoArn, serviceName: 'worker' }),
              ],
            ],
          ]),
          taskPagesByServiceKey: new Map([
            [serviceKey(CLUSTER_ARN, 'api'), [[]]],
            [serviceKey(CLUSTER_ARN, 'worker'), [[]]],
          ]),
        }),
      );
      const result = await scanEcsServices({ region: REGION, maxAttempts: 1 });

      expect(resourcesOf(result.resources, 'ECS_TASK_DEFINITION')).toHaveLength(1);
      const taskDefinition = resourcesOf(result.resources, 'ECS_TASK_DEFINITION')[0];
      expect(taskDefinition?.metadata?.family).toBe('api');
      expect(taskDefinition?.metadata?.executionRoleArn).toBe(EXECUTION_ROLE_ARN);
      const describeTaskDefinitionCalls = sendSpy.mock.calls.filter(
        ([command]) => commandName(command) === 'DescribeTaskDefinitionCommand',
      );
      expect(describeTaskDefinitionCalls).toHaveLength(1);
    });

    it('discovers running tasks', async () => {
      const taskArns = [TASK_ARN_A, TASK_ARN_B, `${TASK_ARN_A}-c`, `${TASK_ARN_A}-d`];
      const result = await scanScenario(
        createDefaultScenario({
          taskPagesByServiceKey: new Map([[serviceKey(CLUSTER_ARN, 'api'), [taskArns]]]),
          tasksByServiceKey: new Map([
            [
              serviceKey(CLUSTER_ARN, 'api'),
              taskArns.map((taskArn, index) =>
                createTask(taskArn, index < 2 ? 'eu-west-3a' : 'eu-west-3b'),
              ),
            ],
          ]),
        }),
      );

      expect(resourcesOf(result.resources, 'ECS_TASK')).toHaveLength(4);
      expect(
        resourcesOf(result.resources, 'ECS_TASK').map(
          (resource) => resource.metadata?.availabilityZone,
        ),
      ).toContain('eu-west-3a');
    });

    it('discovers capacity providers', async () => {
      const result = await scanScenario(createDefaultScenario());

      expect(resourcesOf(result.resources, 'ECS_CAPACITY_PROVIDER')).toHaveLength(3);
      expect(result.resources.map((resource) => resource.arn)).toContain(CUSTOM_CP_ARN);
    });
  });

  describe('dependency edges', () => {
    it('creates ECS service, task definition, and target group dependency edges', async () => {
      const result = await scanScenario(createDefaultScenario());
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(hasEdge(graph, SERVICE_ARN, TARGET_GROUP_ARN, EdgeType.ROUTES_TO)).toBe(true);
      expect(hasEdge(graph, SERVICE_ARN, TASK_DEFINITION_ARN, EdgeType.USES)).toBe(true);
      expect(hasEdge(graph, SERVICE_ARN, CLUSTER_ARN, EdgeType.DEPENDS_ON)).toBe(true);
    });

    it('creates IAM role dependency edges from the task definition', async () => {
      const result = await scanScenario(createDefaultScenario());
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(hasEdge(graph, TASK_DEFINITION_ARN, TASK_ROLE_ARN, EdgeType.IAM_ACCESS)).toBe(true);
      expect(hasEdge(graph, TASK_DEFINITION_ARN, EXECUTION_ROLE_ARN, EdgeType.IAM_ACCESS)).toBe(true);
    });

    it('creates edges for secrets, EFS, ECR, CloudWatch Logs, and S3 references', async () => {
      const result = await scanScenario(createDefaultScenario());
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(hasEdge(graph, TASK_DEFINITION_ARN, SECRET_ARN, EdgeType.DEPENDS_ON)).toBe(true);
      expect(hasEdge(graph, TASK_DEFINITION_ARN, SSM_PARAMETER_ARN, EdgeType.DEPENDS_ON)).toBe(true);
      expect(hasEdge(graph, TASK_DEFINITION_ARN, EFS_ARN, EdgeType.DEPENDS_ON)).toBe(true);
      expect(hasEdge(graph, TASK_DEFINITION_ARN, ECR_REPOSITORY_ARN, EdgeType.USES)).toBe(true);
      expect(hasEdge(graph, TASK_DEFINITION_ARN, LOG_GROUP_ARN, EdgeType.USES)).toBe(true);
      expect(hasEdge(graph, TASK_DEFINITION_ARN, CONFIG_BUCKET_ARN, EdgeType.DEPENDS_ON)).toBe(true);
    });

    it('creates ECS task and capacity provider edges', async () => {
      const result = await scanScenario(createDefaultScenario());
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(hasEdge(graph, TASK_ARN_A, SERVICE_ARN, EdgeType.DEPENDS_ON)).toBe(true);
      expect(hasEdge(graph, CLUSTER_ARN, CUSTOM_CP_ARN, EdgeType.USES)).toBe(true);
      expect(hasEdge(graph, CUSTOM_CP_ARN, ASG_ARN, EdgeType.USES)).toBe(true);
    });

    it('does not create an ECR edge for public Docker Hub images', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          taskDefinitionsByArn: new Map([
            [
              TASK_DEFINITION_ARN,
              createTaskDefinition({
                containerDefinitions: [
                  {
                    name: 'api',
                    image: 'docker.io/library/nginx:latest',
                    essential: true,
                    environment: [],
                    secrets: [],
                  },
                ],
                volumes: [],
              }),
            ],
          ]),
        }),
      );
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(graph.edges.some((edge) => edge.target === ECR_REPOSITORY_ARN)).toBe(false);
    });

    it('does not parse environment variables for implicit dependencies', async () => {
      const result = await scanScenario(createDefaultScenario());
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(
        graph.edges.some((edge) =>
          edge.target.includes('orders.cluster-abcd.eu-west-3.rds.amazonaws.com'),
        ),
      ).toBe(false);
    });
  });

  describe('pagination', () => {
    it('handles paginated ListClusters', async () => {
      const clusterTwoArn = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:cluster/dev`;
      const result = await scanScenario(
        createDefaultScenario({
          clusterPages: [[CLUSTER_ARN], [clusterTwoArn]],
          clustersByArn: new Map([
            [CLUSTER_ARN, createCluster()],
            [clusterTwoArn, createCluster({ clusterArn: clusterTwoArn, clusterName: 'dev' })],
          ]),
          servicePagesByCluster: new Map([
            [CLUSTER_ARN, [[]]],
            [clusterTwoArn, [[]]],
          ]),
          servicesByCluster: new Map(),
        }),
      );

      expect(resourcesOf(result.resources, 'ECS_CLUSTER')).toHaveLength(2);
    });

    it('handles paginated ListServices', async () => {
      const serviceTwoArn = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/prod/worker`;
      const result = await scanScenario(
        createDefaultScenario({
          servicePagesByCluster: new Map([[CLUSTER_ARN, [[SERVICE_ARN], [serviceTwoArn]]]]),
          servicesByCluster: new Map([
            [
              CLUSTER_ARN,
              [
                createService(),
                createService({ serviceArn: serviceTwoArn, serviceName: 'worker' }),
              ],
            ],
          ]),
          taskPagesByServiceKey: new Map([
            [serviceKey(CLUSTER_ARN, 'api'), [[]]],
            [serviceKey(CLUSTER_ARN, 'worker'), [[]]],
          ]),
        }),
      );

      expect(resourcesOf(result.resources, 'ECS_SERVICE')).toHaveLength(2);
    });

    it('handles paginated ListTasks', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          taskPagesByServiceKey: new Map([[serviceKey(CLUSTER_ARN, 'api'), [[TASK_ARN_A], [TASK_ARN_B]]]]),
        }),
      );

      expect(resourcesOf(result.resources, 'ECS_TASK')).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('continues on DescribeServices failure for one cluster', async () => {
      const clusterTwoArn = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:cluster/broken`;
      const result = await scanScenario(
        createDefaultScenario({
          clusterPages: [[CLUSTER_ARN, clusterTwoArn]],
          clustersByArn: new Map([
            [CLUSTER_ARN, createCluster()],
            [clusterTwoArn, createCluster({ clusterArn: clusterTwoArn, clusterName: 'broken' })],
          ]),
          servicePagesByCluster: new Map([
            [CLUSTER_ARN, [[SERVICE_ARN]]],
            [clusterTwoArn, [[`arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/broken/api`]]],
          ]),
          failDescribeServicesForClusters: new Set([clusterTwoArn]),
        }),
      );

      expect(resourcesOf(result.resources, 'ECS_SERVICE')).toHaveLength(1);
      expect(resourcesOf(result.resources, 'ECS_CLUSTER')).toHaveLength(2);
      expect(result.warnings.some((warning) => warning.includes('broken'))).toBe(true);
    });

    it('handles ThrottlingException with retry', async () => {
      const result = await scanScenario(
        createDefaultScenario({ throttleTaskDefinitionAttempts: 2 }),
      );

      expect(resourcesOf(result.resources, 'ECS_TASK_DEFINITION')).toHaveLength(1);
      expect(result.warnings).toEqual([]);
    });

    it('handles empty clusters', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          servicePagesByCluster: new Map([[CLUSTER_ARN, [[]]]]),
          servicesByCluster: new Map(),
        }),
      );

      expect(resourcesOf(result.resources, 'ECS_CLUSTER')).toHaveLength(1);
      expect(resourcesOf(result.resources, 'ECS_SERVICE')).toHaveLength(0);
    });
  });

  describe('ARN construction', () => {
    it('uses valid ECS ARNs returned by AWS', async () => {
      const result = await scanScenario(createDefaultScenario());

      expect(result.resources.find((resource) => resource.type === 'ECS_CLUSTER')?.arn).toBe(CLUSTER_ARN);
      expect(result.resources.find((resource) => resource.type === 'ECS_SERVICE')?.arn).toBe(SERVICE_ARN);
      expect(result.resources.find((resource) => resource.type === 'ECS_TASK_DEFINITION')?.arn).toBe(
        TASK_DEFINITION_ARN,
      );
      expect(result.resources.find((resource) => resource.type === 'ECS_TASK')?.arn).toBe(TASK_ARN_A);
    });
  });
});
