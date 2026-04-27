/**
 * Scans Amazon EventBridge event buses, rules, and rule targets.
 */

import {
  DescribeRuleCommand,
  EventBridgeClient,
  ListEventBusesCommand,
  ListRulesCommand,
  ListTagsForResourceCommand,
  ListTargetsByRuleCommand,
  type DescribeRuleResponse,
  type EventBus,
  type Rule,
  type Target,
} from '@aws-sdk/client-eventbridge';
import { createAccountContext, tryParseArn, type AccountContext } from '../../../identity/index.js';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { EdgeType } from '../../../types/infrastructure.js';
import {
  computeRetryDelayMs,
  getAwsFailureType,
  isAwsThrottlingError,
  type AwsRetryPolicy,
} from '../aws-retry-utils.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import {
  createAccountContextResolver,
  createResource,
  paginateAws,
  sleep,
} from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

const EVENTBRIDGE_RETRY_POLICY: AwsRetryPolicy = {
  maxAttempts: 4,
  initialBackoffMs: 1,
  backoffMultiplier: 2,
  maxJitterMs: 0,
};

interface EventBridgeDependencyEdgeSummary {
  readonly source?: string;
  readonly target: string;
  readonly type: string;
  readonly relationship: string;
  readonly metadata?: Record<string, unknown>;
}

interface EventBridgeTargetSummary {
  readonly id: string;
  readonly targetResourceArn: string;
  readonly ruleArn: string;
  readonly arn: string;
  readonly roleArn: string | null;
  readonly inputTransformer: boolean;
  readonly deadLetterConfig: {
    readonly arn: string;
  } | null;
  readonly retryPolicy: {
    readonly maximumRetryAttempts: number;
    readonly maximumEventAgeInSeconds: number;
  } | null;
  readonly ecsParameters: {
    readonly taskDefinitionArn: string | null;
    readonly launchType: string | null;
    readonly subnetIds: readonly string[];
    readonly securityGroups: readonly string[];
  } | null;
}

interface EventBridgeBusSummary {
  readonly name: string;
  readonly arn: string;
  readonly state: string;
  readonly policy: string | null;
  readonly tags: Record<string, string>;
  readonly accountContext: AccountContext;
}

function nullableString(value: string | undefined | null): string | null {
  return value?.trim() || null;
}

function compactStrings(values: readonly (string | undefined | null)[]): string[] {
  return values
    .map((value) => value?.trim() ?? '')
    .filter((value): value is string => value.length > 0);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

async function sendWithRetry<TValue>(action: () => Promise<TValue>): Promise<TValue> {
  let retryCount = 0;

  for (let attempt = 1; attempt <= EVENTBRIDGE_RETRY_POLICY.maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (isAwsThrottlingError(error) && attempt < EVENTBRIDGE_RETRY_POLICY.maxAttempts) {
        retryCount += 1;
        await sleep(computeRetryDelayMs(retryCount, EVENTBRIDGE_RETRY_POLICY, () => 0));
        continue;
      }
      throw error;
    }
  }

  throw new Error('EventBridge retry loop exhausted unexpectedly.');
}

function accountContextFromArn(arn: string | undefined | null): AccountContext | null {
  if (!arn) return null;
  const parsed = tryParseArn(arn);
  if (!parsed?.accountId) return null;
  return createAccountContext({
    accountId: parsed.accountId,
    partition: parsed.partition,
  });
}

function buildEventBusArn(
  busName: string,
  region: string,
  accountContext: AccountContext,
): string {
  return `arn:${accountContext.partition}:events:${region}:${accountContext.accountId}:event-bus/${busName}`;
}

function buildRuleArn(
  ruleName: string,
  busName: string,
  region: string,
  accountContext: AccountContext,
): string {
  const resourceId = busName === 'default' ? ruleName : `${busName}/${ruleName}`;
  return `arn:${accountContext.partition}:events:${region}:${accountContext.accountId}:rule/${resourceId}`;
}

function buildTargetResourceArn(ruleArn: string, targetId: string): string | null {
  const parsed = tryParseArn(ruleArn);
  if (!parsed?.region || !parsed.accountId) return null;
  return `arn:${parsed.partition}:events:${parsed.region}:${parsed.accountId}:target/${parsed.resourceId}/${targetId}`;
}

function serviceFromArn(arn: string): string | null {
  return tryParseArn(arn)?.service ?? null;
}

function extractPolicyPrincipalAccountIds(
  policy: string | null,
  owningAccountId: string,
): readonly string[] {
  if (!policy) return [];

  try {
    const parsed = JSON.parse(policy) as unknown;
    const document = readRecord(parsed);
    const statements = Array.isArray(document.Statement)
      ? document.Statement
      : [document.Statement];
    const accountIds = new Set<string>();

    for (const statement of statements) {
      const record = readRecord(statement);
      if (String(record.Effect ?? '').toLowerCase() === 'deny') continue;
      for (const principal of readPrincipalValues(record.Principal)) {
        const accountId = extractAccountIdFromPrincipal(principal);
        if (accountId && accountId !== owningAccountId) {
          accountIds.add(accountId);
        }
      }
    }

    return Array.from(accountIds).sort();
  } catch {
    return [];
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readPrincipalValues(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  const record = readRecord(value);
  const awsPrincipal = record.AWS;
  if (typeof awsPrincipal === 'string') return [awsPrincipal];
  if (Array.isArray(awsPrincipal)) {
    return awsPrincipal.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function extractAccountIdFromPrincipal(principal: string): string | null {
  const trimmed = principal.trim();
  if (/^\d{12}$/.test(trimmed)) return trimmed;
  const parsed = tryParseArn(trimmed);
  return parsed?.accountId ?? null;
}

function buildCrossAccountPolicyEdges(
  busArn: string,
  policy: string | null,
  accountContext: AccountContext,
): readonly EventBridgeDependencyEdgeSummary[] {
  return extractPolicyPrincipalAccountIds(policy, accountContext.accountId).map((accountId) => ({
    source: `arn:${accountContext.partition}:iam::${accountId}:root`,
    target: busArn,
    type: EdgeType.CROSS_ACCOUNT,
    relationship: 'eventbridge_bus_policy_allows_put_events',
    metadata: {
      principalAccountId: accountId,
      targetAccountId: accountContext.accountId,
    },
  }));
}

function dependencyEdgeForTargetArn(
  target: EventBridgeTargetSummary,
): EventBridgeDependencyEdgeSummary | null {
  const service = serviceFromArn(target.arn);
  if (!service) return null;

  if (service === 'lambda') {
    return {
      target: target.arn,
      type: EdgeType.TRIGGERS,
      relationship: 'invokes_lambda_function',
    };
  }

  if (service === 'sqs') {
    return {
      target: target.arn,
      type: EdgeType.PUBLISHES_TO,
      relationship: 'sends_to_sqs_queue',
    };
  }

  if (service === 'sns') {
    return {
      target: target.arn,
      type: EdgeType.PUBLISHES_TO,
      relationship: 'publishes_to_sns_topic',
    };
  }

  if (service === 'ecs' && target.ecsParameters) {
    return {
      target: target.arn,
      type: EdgeType.TRIGGERS,
      relationship: 'runs_ecs_task_in_cluster',
    };
  }

  if (service === 'states') {
    return {
      target: target.arn,
      type: EdgeType.TRIGGERS,
      relationship: 'starts_step_function_execution',
    };
  }

  return {
    target: target.arn,
    type: EdgeType.TRIGGERS,
    relationship: 'delivers_event_to_target',
  };
}

function buildTargetDependencyEdges(
  target: EventBridgeTargetSummary,
  ruleArn: string,
): readonly EventBridgeDependencyEdgeSummary[] {
  const edges: EventBridgeDependencyEdgeSummary[] = [
    {
      target: ruleArn,
      type: EdgeType.DEPENDS_ON,
      relationship: 'belongs_to_eventbridge_rule',
    },
  ];
  const targetEdge = dependencyEdgeForTargetArn(target);
  if (targetEdge) edges.push(targetEdge);
  if (target.roleArn) {
    edges.push({
      target: target.roleArn,
      type: EdgeType.IAM_ACCESS,
      relationship: 'uses_target_invocation_role',
    });
  }
  if (target.deadLetterConfig) {
    edges.push({
      target: target.deadLetterConfig.arn,
      type: EdgeType.DEAD_LETTER,
      relationship: 'eventbridge_target_dead_letter_queue',
    });
  }
  if (target.ecsParameters?.taskDefinitionArn) {
    edges.push({
      target: target.ecsParameters.taskDefinitionArn,
      type: EdgeType.USES,
      relationship: 'uses_ecs_task_definition',
    });
  }
  return edges;
}

function buildRuleDependencyEdges(
  ruleArn: string,
  busArn: string,
  targetResourceArns: readonly string[],
): readonly EventBridgeDependencyEdgeSummary[] {
  return [
    {
      target: busArn,
      type: EdgeType.DEPENDS_ON,
      relationship: 'belongs_to_eventbridge_bus',
    },
    ...targetResourceArns.map((targetArn) => ({
      target: targetArn,
      type: EdgeType.TRIGGERS,
      relationship: 'has_eventbridge_target',
    })),
  ].map((edge) => ({ ...edge, source: ruleArn }));
}

function summarizeTarget(
  target: Target,
  ruleArn: string,
): EventBridgeTargetSummary | null {
  const targetId = nullableString(target.Id);
  const targetArn = nullableString(target.Arn);
  if (!targetId || !targetArn) return null;

  const targetResourceArn = buildTargetResourceArn(ruleArn, targetId);
  if (!targetResourceArn) return null;

  const retryPolicy =
    target.RetryPolicy?.MaximumRetryAttempts !== undefined ||
    target.RetryPolicy?.MaximumEventAgeInSeconds !== undefined
      ? {
          maximumRetryAttempts: target.RetryPolicy.MaximumRetryAttempts ?? 0,
          maximumEventAgeInSeconds: target.RetryPolicy.MaximumEventAgeInSeconds ?? 0,
        }
      : null;
  const ecsParameters = target.EcsParameters
    ? {
        taskDefinitionArn: nullableString(target.EcsParameters.TaskDefinitionArn),
        launchType: nullableString(target.EcsParameters.LaunchType),
        subnetIds: compactStrings(
          target.EcsParameters.NetworkConfiguration?.awsvpcConfiguration?.Subnets ?? [],
        ),
        securityGroups: compactStrings(
          target.EcsParameters.NetworkConfiguration?.awsvpcConfiguration?.SecurityGroups ?? [],
        ),
      }
    : null;

  return {
    id: targetId,
    targetResourceArn,
    ruleArn,
    arn: targetArn,
    roleArn: nullableString(target.RoleArn),
    inputTransformer: Boolean(target.InputTransformer),
    deadLetterConfig: target.DeadLetterConfig?.Arn
      ? { arn: target.DeadLetterConfig.Arn }
      : null,
    retryPolicy,
    ecsParameters,
  };
}

async function listEventBridgeTargets(
  eventBridge: EventBridgeClient,
  options: AwsClientOptions,
  ruleName: string,
  ruleArn: string,
  eventBusName: string,
  warnings: string[],
): Promise<readonly EventBridgeTargetSummary[]> {
  try {
    const targets = await paginateAws(
      (nextToken) =>
        sendWithRetry(() =>
          eventBridge.send(
            new ListTargetsByRuleCommand({
              Rule: ruleName,
              EventBusName: eventBusName,
              NextToken: nextToken,
            }),
            getAwsCommandOptions(options),
          ),
        ),
      (response) => response.Targets,
      (response) => response.NextToken,
    );

    return targets
      .map((target) => summarizeTarget(target, ruleArn))
      .filter((target): target is EventBridgeTargetSummary => target !== null);
  } catch (error) {
    warnings.push(
      `EventBridge targets unavailable for rule ${ruleName} in ${options.region} (${getAwsFailureType(error)}).`,
    );
    return [];
  }
}

async function describeRule(
  eventBridge: EventBridgeClient,
  options: AwsClientOptions,
  rule: Rule,
  eventBusName: string,
  warnings: string[],
): Promise<DescribeRuleResponse | Rule> {
  const ruleName = nullableString(rule.Name);
  if (!ruleName) return rule;

  try {
    return await sendWithRetry(() =>
      eventBridge.send(
        new DescribeRuleCommand({
          Name: ruleName,
          EventBusName: eventBusName,
        }),
        getAwsCommandOptions(options),
      ),
    );
  } catch (error) {
    warnings.push(
      `EventBridge rule details unavailable for ${ruleName} in ${options.region} (${getAwsFailureType(error)}).`,
    );
    return rule;
  }
}

async function buildBusSummary(
  eventBridge: EventBridgeClient,
  options: AwsClientOptions,
  bus: EventBus,
  resolveFallbackAccountContext: () => Promise<AccountContext>,
  warnings: string[],
  tagWarnings: Set<string>,
): Promise<EventBridgeBusSummary | null> {
  const name = nullableString(bus.Name);
  if (!name) return null;
  const accountContext = accountContextFromArn(bus.Arn) ?? await resolveFallbackAccountContext();
  const arn = bus.Arn ?? buildEventBusArn(name, options.region, accountContext);
  const tags = await fetchAwsTagsWithRetry(
    () =>
      eventBridge.send(
        new ListTagsForResourceCommand({ ResourceARN: arn }),
        getAwsCommandOptions(options),
      ),
    (response) => tagsArrayToMap(response.Tags),
    {
      description: `EventBridge tag discovery unavailable in ${options.region}`,
      warnings,
      warningDeduper: tagWarnings,
    },
  );

  return {
    name,
    arn,
    state: 'ACTIVE',
    policy: bus.Policy ?? null,
    tags,
    accountContext,
  };
}

function buildBusResource(bus: EventBridgeBusSummary): DiscoveredResource {
  const displayName = getNameTag(bus.tags) ?? bus.name;
  const crossAccountPrincipalAccountIds = extractPolicyPrincipalAccountIds(
    bus.policy,
    bus.accountContext.accountId,
  );

  return createResource({
    source: 'aws',
    arn: bus.arn,
    name: displayName,
    kind: 'infra',
    type: 'EVENTBRIDGE_BUS',
    tags: bus.tags,
    metadata: {
      name: bus.name,
      eventBusName: bus.name,
      eventBusArn: bus.arn,
      region: tryParseArn(bus.arn)?.region ?? null,
      state: bus.state,
      policy: bus.policy,
      crossAccountPrincipalAccountIds,
      directDependencyEdges: buildCrossAccountPolicyEdges(bus.arn, bus.policy, bus.accountContext),
      displayName,
      ...(Object.keys(bus.tags).length > 0 ? { awsTags: bus.tags } : {}),
    },
  });
}

function buildRuleResource(input: {
  readonly rule: Rule | DescribeRuleResponse;
  readonly ruleArn: string;
  readonly ruleName: string;
  readonly bus: EventBridgeBusSummary;
  readonly tags: Record<string, string>;
  readonly targets: readonly EventBridgeTargetSummary[];
}): DiscoveredResource {
  const displayName = getNameTag(input.tags) ?? input.ruleName;
  const targetResourceArns = input.targets.map((target) => target.targetResourceArn);

  return createResource({
    source: 'aws',
    arn: input.ruleArn,
    name: displayName,
    kind: 'service',
    type: 'EVENTBRIDGE_RULE',
    tags: input.tags,
    metadata: {
      name: input.ruleName,
      ruleArn: input.ruleArn,
      ruleName: input.ruleName,
      eventBusName: nullableString(input.rule.EventBusName) ?? input.bus.name,
      eventBusArn: input.bus.arn,
      state: input.rule.State ?? '',
      scheduleExpression: input.rule.ScheduleExpression ?? null,
      eventPattern: input.rule.EventPattern ?? null,
      description: input.rule.Description ?? null,
      targetsCount: input.targets.length,
      targetCount: input.targets.length,
      managedBy: input.rule.ManagedBy ?? null,
      roleArn: input.rule.RoleArn ?? null,
      targetArns: input.targets.map((target) => target.arn),
      targetResourceArns,
      targetRoleArns: compactStrings(input.targets.map((target) => target.roleArn)),
      targetDeadLetterArns: compactStrings(
        input.targets.map((target) => target.deadLetterConfig?.arn),
      ),
      ecsTargetTaskDefinitionArns: compactStrings(
        input.targets.map((target) => target.ecsParameters?.taskDefinitionArn),
      ),
      directDependencyEdges: buildRuleDependencyEdges(
        input.ruleArn,
        input.bus.arn,
        targetResourceArns,
      ),
      targets: input.targets.map((target) => ({
        id: target.id,
        arn: target.arn,
        targetResourceArn: target.targetResourceArn,
        inputTransformer: target.inputTransformer,
        deadLetterConfig: target.deadLetterConfig,
        retryPolicy: target.retryPolicy,
      })),
      displayName,
      ...(Object.keys(input.tags).length > 0 ? { awsTags: input.tags } : {}),
    },
  });
}

function buildTargetResource(input: {
  readonly target: EventBridgeTargetSummary;
  readonly ruleName: string;
  readonly eventBusName: string;
  readonly ruleManagedBy: string | null;
  readonly region: string;
}): DiscoveredResource {
  return createResource({
    source: 'aws',
    arn: input.target.targetResourceArn,
    name: `${input.ruleName}:${input.target.id}`,
    kind: 'infra',
    type: 'EVENTBRIDGE_TARGET',
    tags: {},
    metadata: {
      id: input.target.id,
      targetId: input.target.id,
      ruleArn: input.target.ruleArn,
      ruleName: input.ruleName,
      eventBusName: input.eventBusName,
      region: input.region,
      targetArn: input.target.arn,
      arn: input.target.arn,
      roleArn: input.target.roleArn,
      inputTransformer: input.target.inputTransformer,
      deadLetterConfig: input.target.deadLetterConfig,
      retryPolicy: input.target.retryPolicy,
      ecsParameters: input.target.ecsParameters,
      managedBy: input.ruleManagedBy,
      directDependencyEdges: buildTargetDependencyEdges(input.target, input.target.ruleArn),
      displayName: `${input.ruleName}:${input.target.id}`,
    },
  });
}

export async function scanEventBridgeRules(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const eventBridge = createAwsClient(EventBridgeClient, options);
  const resolveAccountContext = createAccountContextResolver(options);
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();
  const resources: DiscoveredResource[] = [];
  let fallbackAccountContext: AccountContext | null = null;
  const resolveFallbackAccountContext = async (): Promise<AccountContext> => {
    if (!fallbackAccountContext) {
      fallbackAccountContext = await resolveAccountContext();
    }
    return fallbackAccountContext;
  };

  const eventBuses = await paginateAws(
    (nextToken) =>
      sendWithRetry(() =>
        eventBridge.send(
          new ListEventBusesCommand({ NextToken: nextToken }),
          getAwsCommandOptions(options),
        ),
      ),
    (response) => response.EventBuses,
    (response) => response.NextToken,
  );

  const busSummaries = (
    await Promise.all(
      eventBuses.map((bus) =>
        buildBusSummary(
          eventBridge,
          options,
          bus,
          resolveFallbackAccountContext,
          warnings,
          tagWarnings,
        ),
      ),
    )
  ).filter((bus): bus is EventBridgeBusSummary => bus !== null);

  for (const bus of busSummaries) {
    resources.push(buildBusResource(bus));

    let rules: readonly Rule[] = [];
    try {
      rules = await paginateAws(
        (nextToken) =>
          sendWithRetry(() =>
            eventBridge.send(
              new ListRulesCommand({
                EventBusName: bus.name,
                NextToken: nextToken,
              }),
              getAwsCommandOptions(options),
            ),
          ),
        (response) => response.Rules,
        (response) => response.NextToken,
      );
    } catch (error) {
      warnings.push(
        `EventBridge rules unavailable for bus ${bus.name} in ${options.region} (${getAwsFailureType(error)}).`,
      );
      continue;
    }

    for (const listedRule of rules) {
      const ruleName = nullableString(listedRule.Name);
      if (!ruleName) continue;

      const ruleDetails = await describeRule(eventBridge, options, listedRule, bus.name, warnings);
      const ruleArn = nullableString(ruleDetails.Arn)
        ?? nullableString(listedRule.Arn)
        ?? buildRuleArn(ruleName, bus.name, options.region, bus.accountContext);
      const tags = await fetchAwsTagsWithRetry(
        () =>
          eventBridge.send(
            new ListTagsForResourceCommand({ ResourceARN: ruleArn }),
            getAwsCommandOptions(options),
          ),
        (response) => tagsArrayToMap(response.Tags),
        {
          description: `EventBridge tag discovery unavailable in ${options.region}`,
          warnings,
          warningDeduper: tagWarnings,
        },
      );
      const targets = await listEventBridgeTargets(
        eventBridge,
        options,
        ruleName,
        ruleArn,
        bus.name,
        warnings,
      );
      const ruleManagedBy = ruleDetails.ManagedBy ?? listedRule.ManagedBy ?? null;

      resources.push(
        buildRuleResource({
          rule: ruleDetails,
          ruleArn,
          ruleName,
          bus,
          tags,
          targets,
        }),
      );
      resources.push(
        ...targets.map((target) =>
          buildTargetResource({
            target,
            ruleName,
            eventBusName: bus.name,
            ruleManagedBy,
            region: options.region,
          }),
        ),
      );
    }
  }

  const discoveredBusNames = new Set(busSummaries.map((bus) => bus.name));
  if (!discoveredBusNames.has('default')) {
    const accountContext = await resolveFallbackAccountContext();
    const defaultBus = await buildBusSummary(
      eventBridge,
      options,
      {
        Name: 'default',
        Arn: buildEventBusArn('default', options.region, accountContext),
      },
      resolveFallbackAccountContext,
      warnings,
      tagWarnings,
    );
    if (defaultBus) {
      resources.push(buildBusResource(defaultBus));
    }
  }

  return {
    resources,
    warnings: uniqueStrings(warnings),
  };
}
