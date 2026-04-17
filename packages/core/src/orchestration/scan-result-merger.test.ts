import { MultiDirectedGraph } from 'graphology';
import { describe, expect, it, vi } from 'vitest';

import type { GraphInstance } from '../graph/graph-instance.js';
import { createAccountContext } from '../identity/index.js';
import { createResource } from '../types/resource.js';
import type { WeightedValidationResult } from '../validation/validation-types.js';
import { ScanResultMerger } from './scan-result-merger.js';
import type { AccountScanResult } from './types.js';

describe('ScanResultMerger', () => {
  it('merges disjoint graphs into one unified graph', () => {
    const first = createAccountResult('111122223333', 'prod', ['arn:aws:ec2:eu-west-1:111122223333:instance/i-1']);
    const second = createAccountResult('444455556666', 'staging', ['arn:aws:ec2:eu-west-1:444455556666:instance/i-2']);

    const merger = new ScanResultMerger();
    const merged = merger.merge([first, second]);

    expect(merged.mergedGraph.order).toBe(2);
    expect(merged.mergedGraph.size).toBe(0);
    expect(merged.summary.totalResources).toBe(2);
    expect(merged.summary.resourcesByAccount.get('111122223333')).toBe(1);
    expect(merged.summary.resourcesByAccount.get('444455556666')).toBe(1);
  });

  it('returns the same content when merging a single graph', () => {
    const result = createAccountResult('111122223333', 'prod', [
      'arn:aws:ec2:eu-west-1:111122223333:instance/i-1',
      'arn:aws:ec2:eu-west-1:111122223333:instance/i-2',
    ]);

    const merger = new ScanResultMerger();
    const merged = merger.merge([result]);

    expect(merged.mergedGraph.order).toBe(result.graph.order);
    expect(merged.summary.totalResources).toBe(result.resources.length);
    expect(merged.mergedFindings).toEqual(result.findings);
  });

  it('returns an empty graph and zeroed summary for empty input', () => {
    const merger = new ScanResultMerger();
    const merged = merger.merge([]);

    expect(merged.mergedGraph.order).toBe(0);
    expect(merged.mergedGraph.size).toBe(0);
    expect(merged.summary.totalAccounts).toBe(0);
    expect(merged.summary.totalResources).toBe(0);
    expect(merged.summary.totalFindings).toBe(0);
  });

  it('warns and keeps the first node when duplicate ARNs are encountered', () => {
    const warningSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const duplicatedArn = 'arn:aws:ec2:eu-west-1:111122223333:instance/i-1';
    const first = createAccountResult('111122223333', 'prod', [duplicatedArn]);
    const second = createAccountResult('111122223333', 'prod-copy', [duplicatedArn]);

    const merger = new ScanResultMerger();
    const merged = merger.merge([first, second]);

    expect(warningSpy).toHaveBeenCalledOnce();
    expect(merged.mergedGraph.order).toBe(1);
  });

  it('preserves findings order by account', () => {
    const first = createAccountResult(
      '111122223333',
      'prod',
      ['arn:aws:ec2:eu-west-1:111122223333:instance/i-1'],
      ['first-a', 'first-b'],
    );
    const second = createAccountResult(
      '444455556666',
      'staging',
      ['arn:aws:ec2:eu-west-1:444455556666:instance/i-2'],
      ['second-a'],
    );

    const merger = new ScanResultMerger();
    const merged = merger.merge([first, second]);

    expect(merged.mergedFindings.map((finding) => finding.ruleId)).toEqual([
      'first-a',
      'first-b',
      'second-a',
    ]);
  });

  it('ensures merged nodes carry accountId metadata', () => {
    const result = createAccountResult('111122223333', 'prod', [
      'arn:aws:ec2:eu-west-1:111122223333:instance/i-1',
    ]);
    const merger = new ScanResultMerger();

    const merged = merger.merge([result]);
    const nodeId = result.resources[0]?.arn;

    expect(nodeId).toBeDefined();
    expect(merged.mergedGraph.getNodeAttributes(nodeId ?? '')).toMatchObject({
      accountId: '111122223333',
    });
  });
});

function createAccountResult(
  accountId: string,
  alias: string,
  arns: readonly string[],
  findingIds: readonly string[] = ['finding'],
): AccountScanResult {
  const account = createAccountContext({
    accountId,
    accountAlias: alias,
  });
  const graph = new MultiDirectedGraph<Record<string, unknown>, Record<string, unknown>>();

  const resources = arns.map((arn, index) => {
    const resource = createResource({
      arn,
      source: 'aws',
      type: 'EC2',
      name: `resource-${index + 1}`,
    });

    graph.addNode(resource.arn, {
      id: resource.arn,
      name: resource.name,
      type: 'VM',
      provider: 'aws',
      region: resource.region,
      tags: {},
      metadata: {},
    });

    return resource;
  });

  return {
    account,
    regions: ['eu-west-1'],
    resources,
    findings: findingIds.map((ruleId, index) =>
      createFinding(ruleId, resources[index % resources.length]?.arn ?? arns[0] ?? 'node'),
    ),
    graph: graph as unknown as GraphInstance,
    scanDurationMs: 1_000,
    scannersExecuted: ['EC2'],
    scannersSkipped: [],
  };
}

function createFinding(ruleId: string, nodeId: string): WeightedValidationResult {
  return {
    ruleId,
    nodeId,
    status: 'fail',
    message: `${ruleId} failed`,
    severity: 'high',
    category: 'backup',
    nodeName: nodeId,
    nodeType: 'VM',
    weight: 10,
    weightBreakdown: {
      severityWeight: 5,
      criticalityWeight: 2,
      blastRadiusWeight: 2,
      directDependentCount: 1,
    },
  };
}
