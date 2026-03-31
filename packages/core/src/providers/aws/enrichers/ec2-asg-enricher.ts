/**
 * Enriches EC2 nodes with Auto Scaling group configuration.
 */

import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from '@aws-sdk/client-auto-scaling';
import type { InfraNodeAttrs } from '../../../types/infrastructure.js';
import { resolveAwsCredentials } from '../aws-client-factory.js';
import type { DiscoveryCloudCredentials } from '../../../types/discovery.js';
import type { Enricher, EnrichmentResult } from './types.js';
import {
  getNodeMetadata,
  readString,
  resolveNodeRegion,
  setNodeMetadata,
  toErrorMessage,
} from './types.js';

function applyAsgUnknownMetadata(node: InfraNodeAttrs): void {
  setNodeMetadata(node, {
    asgMinSize: null,
    asgMaxSize: null,
    asgDesiredCapacity: null,
    asgAZCount: null,
    asgAvailabilityZones: null,
  });
}

function groupNodesByRegionAndAsg(
  nodes: InfraNodeAttrs[],
  fallbackRegion?: string,
): {
  byRegion: Map<string, Map<string, InfraNodeAttrs[]>>;
  skipped: number;
  failed: number;
} {
  const byRegion = new Map<string, Map<string, InfraNodeAttrs[]>>();
  let skipped = 0;
  let failed = 0;

  for (const node of nodes) {
    const metadata = getNodeMetadata(node);
    const asgName = readString(metadata.autoScalingGroupName);
    if (!asgName) {
      skipped += 1;
      continue;
    }

    const nodeRegion = resolveNodeRegion(node, fallbackRegion);
    if (!nodeRegion) {
      failed += 1;
      applyAsgUnknownMetadata(node);
      continue;
    }

    const regionMap = byRegion.get(nodeRegion) ?? new Map<string, InfraNodeAttrs[]>();
    const existing = regionMap.get(asgName) ?? [];
    existing.push(node);
    regionMap.set(asgName, existing);
    byRegion.set(nodeRegion, regionMap);
  }

  return { byRegion, skipped, failed };
}

const ASG_BATCH_SIZE = 50;

export const ec2AsgEnricher: Enricher = {
  name: 'aws-ec2-asg',
  provider: 'aws',
  appliesTo: (node) =>
    node.provider === 'aws' &&
    node.type === 'VM' &&
    Boolean(readString(getNodeMetadata(node).autoScalingGroupName)),

  enrich: async (nodes, credentials, region): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;
    let failed = 0;

    const grouped = groupNodesByRegionAndAsg(nodes, region);
    failed += grouped.failed;
    let skipped = grouped.skipped;

    for (const [awsRegion, asgMap] of grouped.byRegion.entries()) {
      const asgNames = Array.from(asgMap.keys());
      if (asgNames.length === 0) continue;

      const creds = credentials as DiscoveryCloudCredentials;
      const resolved = resolveAwsCredentials(creds, awsRegion, 'stronghold-enrichment-asg');
      const client = new AutoScalingClient({
        region: awsRegion,
        ...(resolved ? { credentials: resolved } : {}),
      });

      for (let i = 0; i < asgNames.length; i += ASG_BATCH_SIZE) {
        const batch = asgNames.slice(i, i + ASG_BATCH_SIZE);
        try {
          const response = await client.send(
            new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: batch }),
          );
          const byName = new Map(
            (response.AutoScalingGroups ?? [])
              .filter((asg) => Boolean(asg.AutoScalingGroupName))
              .map((asg) => [String(asg.AutoScalingGroupName), asg]),
          );

          for (const asgName of batch) {
            const matchingNodes = asgMap.get(asgName) ?? [];
            const asg = byName.get(asgName);
            if (!asg) {
              for (const node of matchingNodes) applyAsgUnknownMetadata(node);
              failed += matchingNodes.length;
              continue;
            }

            const availabilityZones = (asg.AvailabilityZones ?? []).filter(
              (zone): zone is string => typeof zone === 'string',
            );
            for (const node of matchingNodes) {
              setNodeMetadata(node, {
                asgMinSize: asg.MinSize ?? null,
                asgMaxSize: asg.MaxSize ?? null,
                asgDesiredCapacity: asg.DesiredCapacity ?? null,
                asgAZCount: new Set(availabilityZones).size,
                asgAvailabilityZones: availabilityZones,
              });
              enriched += 1;
            }
          }
        } catch (error) {
          void toErrorMessage(error);
          for (const asgName of batch) {
            const matchingNodes = asgMap.get(asgName) ?? [];
            for (const node of matchingNodes) applyAsgUnknownMetadata(node);
            failed += matchingNodes.length;
          }
        }
      }
    }

    const accounted = enriched + failed + skipped;
    if (accounted < nodes.length) {
      skipped += nodes.length - accounted;
    }

    return { enriched, failed, skipped, durationMs: Date.now() - start };
  },
};
