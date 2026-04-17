import { MultiDirectedGraph } from 'graphology';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticationError, buildAuthTarget } from '../auth/index.js';
import type { GraphInstance } from '../graph/graph-instance.js';
import { createAccountContext } from '../identity/index.js';
import { createResource } from '../types/resource.js';
import type { WeightedValidationResult } from '../validation/validation-types.js';
import { MultiAccountOrchestrator } from './multi-account-orchestrator.js';
import type { AccountScanResult, AccountScanTarget, ScanEngine } from './types.js';
import { ScanExecutionError } from './types.js';

describe('MultiAccountOrchestrator', () => {
  it('returns a multi-account result when all accounts succeed', async () => {
    const targets = [
      createTarget('111122223333', 'prod'),
      createTarget('444455556666', 'staging'),
      createTarget('777788889999', 'data'),
    ];
    const scanEngine: ScanEngine = {
      scanAccount: vi.fn(async (target) => createAccountResult(target)),
    };
    const orchestrator = new MultiAccountOrchestrator({
      maxConcurrency: 2,
      scanEngine,
    });

    const result = await orchestrator.scan(targets);

    expect(result.accounts).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.totalAccounts).toBe(3);
    expect(result.summary.successfulAccounts).toBe(3);
    expect(result.summary.failedAccounts).toBe(0);
    expect(result.mergedGraph.order).toBe(3);
  });

  it('collects authentication failures without stopping other accounts', async () => {
    const targets = [
      createTarget('111122223333', 'prod'),
      createTarget('444455556666', 'staging'),
      createTarget('777788889999', 'data'),
    ];
    const scanEngine: ScanEngine = {
      scanAccount: vi.fn(async (target) => {
        if (target.account.accountId === '444455556666') {
          throw new AuthenticationError(
            'Access denied',
            buildAuthTarget({
              account: target.account,
              region: target.regions[0] ?? 'eu-west-1',
            }),
            target.authProvider.kind,
          );
        }

        return createAccountResult(target);
      }),
    };
    const orchestrator = new MultiAccountOrchestrator({
      maxConcurrency: 2,
      scanEngine,
    });

    const result = await orchestrator.scan(targets);

    expect(result.accounts).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.phase).toBe('authentication');
    expect(result.summary.failedAccounts).toBe(1);
  });

  it('classifies scanner failures as scanning errors', async () => {
    const targets = [
      createTarget('111122223333', 'prod'),
      createTarget('444455556666', 'staging'),
      createTarget('777788889999', 'data'),
    ];
    const scanEngine: ScanEngine = {
      scanAccount: vi.fn(async (target) => {
        if (target.account.accountId === '777788889999') {
          throw new ScanExecutionError('scanner exploded');
        }
        return createAccountResult(target);
      }),
    };
    const orchestrator = new MultiAccountOrchestrator({
      maxConcurrency: 3,
      scanEngine,
    });

    const result = await orchestrator.scan(targets);

    expect(result.accounts).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.phase).toBe('scanning');
  });

  it('returns an empty merged graph when every account fails', async () => {
    const targets = [
      createTarget('111122223333', 'prod'),
      createTarget('444455556666', 'staging'),
      createTarget('777788889999', 'data'),
    ];
    const scanEngine: ScanEngine = {
      scanAccount: vi.fn(async () => {
        throw new Error('processing failed');
      }),
    };
    const orchestrator = new MultiAccountOrchestrator({
      maxConcurrency: 2,
      scanEngine,
    });

    const result = await orchestrator.scan(targets);

    expect(result.accounts).toHaveLength(0);
    expect(result.errors).toHaveLength(3);
    expect(result.mergedGraph.order).toBe(0);
    expect(result.summary.failedAccounts).toBe(3);
  });

  it('invokes callbacks in the expected order for each account', async () => {
    const target = createTarget('111122223333', 'prod');
    const events: string[] = [];
    const scanEngine: ScanEngine = {
      scanAccount: vi.fn(async (scanTarget) => {
        events.push(`engine:${scanTarget.account.accountId}`);
        return createAccountResult(scanTarget);
      }),
    };
    const orchestrator = new MultiAccountOrchestrator({
      maxConcurrency: 1,
      scanEngine,
      onAccountStart: (account) => {
        events.push(`start:${account.accountId}`);
      },
      onAccountComplete: (account) => {
        events.push(`complete:${account.accountId}`);
      },
      onAccountError: (account) => {
        events.push(`error:${account.accountId}`);
      },
    });

    await orchestrator.scan([target]);

    expect(events).toEqual([
      'start:111122223333',
      'engine:111122223333',
      'complete:111122223333',
    ]);
  });

  it('respects account concurrency limits', async () => {
    const targets = [
      createTarget('111122223333', 'prod'),
      createTarget('444455556666', 'staging'),
      createTarget('777788889999', 'data'),
    ];
    let running = 0;
    let maxRunning = 0;
    const gate = createDeferred<undefined>();
    let started = 0;

    const scanEngine: ScanEngine = {
      scanAccount: vi.fn(async (target) => {
        started += 1;
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        if (started < 3) {
          await gate.promise;
        }
        running -= 1;
        return createAccountResult(target);
      }),
    };

    const orchestrator = new MultiAccountOrchestrator({
      maxConcurrency: 2,
      scanEngine,
    });

    const execution = orchestrator.scan(targets);
    await Promise.resolve();
    await Promise.resolve();
    expect(maxRunning).toBe(2);

    gate.resolve(undefined);
    await execution;
    expect(maxRunning).toBe(2);
  });

  it('matches the direct single-account result when only one target is scanned', async () => {
    const target = createTarget('111122223333', 'prod');
    const directResult = createAccountResult(target);
    const scanEngine: ScanEngine = {
      scanAccount: vi.fn(async () => directResult),
    };
    const orchestrator = new MultiAccountOrchestrator({
      maxConcurrency: 3,
      scanEngine,
    });

    const result = await orchestrator.scan([target]);

    expect(result.accounts[0]).toEqual(directResult);
    expect(result.summary.totalResources).toBe(directResult.resources.length);
    expect(result.mergedFindings).toEqual(directResult.findings);
  });

  it('treats account timeout as a scanning failure', async () => {
    const target = createTarget('111122223333', 'prod', {
      scanTimeoutMs: 10,
    });
    const scanEngine: ScanEngine = {
      scanAccount: vi.fn(async () => {
        await wait(50);
        return createAccountResult(target);
      }),
    };
    const orchestrator = new MultiAccountOrchestrator({
      maxConcurrency: 1,
      scanEngine,
    });

    const result = await orchestrator.scan([target]);

    expect(result.accounts).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.phase).toBe('scanning');
  });

  it('adds cross-account edges to the merged graph after the account graphs are merged', async () => {
    const targets = [
      createTarget('111122223333', 'prod'),
      createTarget('444455556666', 'shared'),
    ];
    const scanEngine: ScanEngine = {
      scanAccount: vi.fn(async (target) => {
        if (target.account.accountId === '111122223333') {
          return createVpcPeeringAccountResult(target, {
            includePeering: true,
            localVpcId: 'vpc-a',
            peerVpcId: 'vpc-b',
            peerAccountId: '444455556666',
          });
        }

        return createVpcPeeringAccountResult(target, {
          includePeering: false,
          localVpcId: 'vpc-b',
          peerVpcId: 'vpc-a',
          peerAccountId: '111122223333',
        });
      }),
    };
    const orchestrator = new MultiAccountOrchestrator({
      maxConcurrency: 2,
      scanEngine,
    });

    const result = await orchestrator.scan(targets);

    expect(result.summary.crossAccountEdges).toBe(1);
    expect(result.crossAccount.edges).toHaveLength(1);
    expect(result.mergedGraph.size).toBe(1);

    const edgeKey = result.mergedGraph.edges()[0];
    expect(edgeKey).toBeDefined();
    expect(result.mergedGraph.getEdgeAttributes(edgeKey ?? '')).toMatchObject({
      type: 'cross_account',
      kind: 'vpc_peering',
      direction: 'bidirectional',
      drImpact: 'critical',
      completeness: 'complete',
    });
  });
});

function createTarget(
  accountId: string,
  alias: string,
  overrides: Partial<AccountScanTarget> = {},
): AccountScanTarget {
  const account = createAccountContext({
    accountId,
    accountAlias: alias,
  });

  return {
    account,
    regions: ['eu-west-1'],
    authProvider: {
      kind: 'profile',
      canHandle: async () => true,
      getCredentials: async () => ({
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'secret',
      }),
      describeAuthMethod: () => 'profile:test',
    },
    ...overrides,
  };
}

function createAccountResult(target: AccountScanTarget): AccountScanResult {
  const resource = createResource({
    arn: `arn:aws:ec2:${target.regions[0] ?? 'eu-west-1'}:${target.account.accountId}:instance/i-${target.account.accountId.slice(-4)}`,
    source: 'aws',
    type: 'EC2',
    name: target.account.accountAlias ?? target.account.accountId,
  });
  const graph = new MultiDirectedGraph<Record<string, unknown>, Record<string, unknown>>();
  graph.addNode(resource.arn, {
    id: resource.arn,
    accountId: target.account.accountId,
    name: resource.name,
    type: 'VM',
    provider: 'aws',
    region: resource.region,
    tags: {},
    metadata: {},
  });

  return {
    account: target.account,
    regions: target.regions,
    resources: [resource],
    findings: [createFinding(resource.arn)],
    graph: graph as unknown as GraphInstance,
    scanDurationMs: 250,
    scannersExecuted: ['EC2'],
    scannersSkipped: [],
  };
}

function createFinding(nodeId: string): WeightedValidationResult {
  return {
    ruleId: 'backup_plan_exists',
    nodeId,
    status: 'fail',
    message: 'backup missing',
    severity: 'high',
    category: 'backup',
    nodeName: nodeId,
    nodeType: 'VM',
    weight: 5,
    weightBreakdown: {
      severityWeight: 3,
      criticalityWeight: 1,
      blastRadiusWeight: 1,
      directDependentCount: 0,
    },
  };
}

function createVpcPeeringAccountResult(
  target: AccountScanTarget,
  input: {
    readonly includePeering: boolean;
    readonly localVpcId: string;
    readonly peerVpcId: string;
    readonly peerAccountId: string;
  },
): AccountScanResult {
  const region = target.regions[0] ?? 'eu-west-1';
  const graph = new MultiDirectedGraph<Record<string, unknown>, Record<string, unknown>>();
  const localVpcArn = `arn:aws:ec2:${region}:${target.account.accountId}:vpc/${input.localVpcId}`;

  graph.addNode(localVpcArn, {
    id: localVpcArn,
    accountId: target.account.accountId,
    name: input.localVpcId,
    type: 'VPC',
    provider: 'aws',
    region,
    tags: {},
    metadata: {
      sourceType: 'VPC',
      vpcId: input.localVpcId,
      region,
    },
  });

  if (input.includePeering) {
    const peeringArn = `arn:aws:ec2:${region}:${target.account.accountId}:vpc-peering-connection/pcx-1`;
    graph.addNode(peeringArn, {
      id: peeringArn,
      accountId: target.account.accountId,
      name: 'pcx-1',
      type: 'NETWORK_DEVICE',
      provider: 'aws',
      region,
      tags: {},
      metadata: {
        sourceType: 'VPC_PEERING_CONNECTION',
        peeringConnectionId: 'pcx-1',
        requesterOwnerId: target.account.accountId,
        accepterOwnerId: input.peerAccountId,
        requesterVpcId: input.localVpcId,
        accepterVpcId: input.peerVpcId,
        status: 'active',
        routeTableIds: ['rtb-1'],
        region,
      },
    });
  }

  const vpcResource = createResource({
    arn: localVpcArn,
    source: 'aws',
    type: 'VPC',
    name: input.localVpcId,
  });

  return {
    account: target.account,
    regions: target.regions,
    resources: [vpcResource],
    findings: [],
    graph: graph as unknown as GraphInstance,
    scanDurationMs: 100,
    scannersExecuted: ['EC2'],
    scannersSkipped: [],
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeferred<TValue>() {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void;
  const promise = new Promise<TValue>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}
