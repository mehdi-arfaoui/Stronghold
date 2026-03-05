import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
} from "@aws-sdk/client-auto-scaling";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import type { InfraNodeAttrs } from "../../graph/types.js";
import { appLogger } from "../../utils/logger.js";
import type { Enricher, EnrichmentResult } from "./types.js";
import {
  getNodeMetadata,
  isAccessDeniedError,
  readString,
  resolveNodeRegion,
  setNodeMetadata,
  toErrorMessage,
} from "./types.js";

function resolveAwsClientCredentials(credentials: unknown, region: string): unknown {
  const awsCredentials =
    credentials && typeof credentials === "object"
      ? (credentials as Record<string, unknown>)
      : {};

  const roleArn = readString(awsCredentials.roleArn);
  const externalId = readString(awsCredentials.externalId);
  if (roleArn) {
    return fromTemporaryCredentials({
      params: {
        RoleArn: roleArn,
        RoleSessionName: "stronghold-enrichment-asg",
        ...(externalId ? { ExternalId: externalId } : {}),
      },
      clientConfig: { region },
    });
  }

  const accessKeyId = readString(awsCredentials.accessKeyId);
  const secretAccessKey = readString(awsCredentials.secretAccessKey);
  const sessionToken = readString(awsCredentials.sessionToken);
  if (accessKeyId && secretAccessKey) {
    return {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
  }

  return undefined;
}

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

    const regionMap = byRegion.get(nodeRegion) || new Map<string, InfraNodeAttrs[]>();
    const existing = regionMap.get(asgName) || [];
    existing.push(node);
    regionMap.set(asgName, existing);
    byRegion.set(nodeRegion, regionMap);
  }

  return { byRegion, skipped, failed };
}

export const awsEc2AsgEnricher: Enricher = {
  name: "aws-ec2-asg",
  provider: "aws",
  appliesTo: (node) =>
    node.provider === "aws" &&
    node.type === "VM" &&
    Boolean(readString(getNodeMetadata(node).autoScalingGroupName)),

  enrich: async (
    nodes,
    credentials,
    region,
  ): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;
    let failed = 0;

    const grouped = groupNodesByRegionAndAsg(nodes, region);
    failed += grouped.failed;
    let skipped = grouped.skipped;

    for (const [awsRegion, asgMap] of grouped.byRegion.entries()) {
      const asgNames = Array.from(asgMap.keys());
      if (asgNames.length === 0) continue;

      const clientCredentials = resolveAwsClientCredentials(credentials, awsRegion);
      const client = new AutoScalingClient({
        region: awsRegion,
        ...(clientCredentials ? { credentials: clientCredentials as any } : {}),
      });

      for (let i = 0; i < asgNames.length; i += 50) {
        const batch = asgNames.slice(i, i + 50);
        try {
          const response = await client.send(
            new DescribeAutoScalingGroupsCommand({
              AutoScalingGroupNames: batch,
            }),
          );
          const byName = new Map(
            (response.AutoScalingGroups || [])
              .filter((asg) => Boolean(asg.AutoScalingGroupName))
              .map((asg) => [String(asg.AutoScalingGroupName), asg]),
          );

          for (const asgName of batch) {
            const matchingNodes = asgMap.get(asgName) || [];
            const asg = byName.get(asgName);
            if (!asg) {
              for (const node of matchingNodes) {
                applyAsgUnknownMetadata(node);
              }
              failed += matchingNodes.length;
              continue;
            }

            const availabilityZones = (asg.AvailabilityZones || []).filter(
              (zone): zone is string => typeof zone === "string",
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
          appLogger.debug("[MetadataEnrichment] aws-ec2-asg batch failed", {
            region: awsRegion,
            accessDenied: isAccessDeniedError(error),
            message: toErrorMessage(error),
          });
          for (const asgName of batch) {
            const matchingNodes = asgMap.get(asgName) || [];
            for (const node of matchingNodes) {
              applyAsgUnknownMetadata(node);
            }
            failed += matchingNodes.length;
          }
        }
      }
    }

    const accounted = enriched + failed + skipped;
    if (accounted < nodes.length) {
      skipped += nodes.length - accounted;
    }

    return {
      enriched,
      failed,
      skipped,
      durationMs: Date.now() - start,
    };
  },
};
