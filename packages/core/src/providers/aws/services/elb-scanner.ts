/**
 * Scans AWS Elastic Load Balancers (ALB, NLB).
 */

import {
  DescribeLoadBalancerAttributesCommand,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, type AwsClientOptions } from '../aws-client-factory.js';
import { buildResource, paginateAws } from '../scan-utils.js';

function parseBooleanAttribute(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function extractLoadBalancerResourceName(loadBalancerArn: string | undefined): string | undefined {
  if (!loadBalancerArn) return undefined;
  const marker = 'loadbalancer/';
  const index = loadBalancerArn.indexOf(marker);
  return index >= 0 ? loadBalancerArn.slice(index + marker.length) : undefined;
}

export async function scanLoadBalancers(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const elb = createAwsClient(ElasticLoadBalancingV2Client, options);
  const warnings: string[] = [];
  const resources: DiscoveredResource[] = [];

  const loadBalancers = await paginateAws(
    (marker) => elb.send(new DescribeLoadBalancersCommand({ Marker: marker })),
    (response) => response.LoadBalancers,
    (response) => response.NextMarker,
  );

  for (const loadBalancer of loadBalancers) {
    const availabilityZones = (loadBalancer.AvailabilityZones ?? [])
      .map((zone) => zone.ZoneName)
      .filter((zone): zone is string => Boolean(zone));
    const subnetIds = (loadBalancer.AvailabilityZones ?? [])
      .map((zone) => zone.SubnetId)
      .filter((subnetId): subnetId is string => Boolean(subnetId));

    let crossZoneLoadBalancing: boolean | undefined;
    let healthCheck: Record<string, unknown> | undefined;
    let healthChecks: readonly Record<string, unknown>[] = [];

    if (loadBalancer.LoadBalancerArn) {
      try {
        const attributes = await elb.send(
          new DescribeLoadBalancerAttributesCommand({
            LoadBalancerArn: loadBalancer.LoadBalancerArn,
          }),
        );
        const attributeMap = new Map(
          (attributes.Attributes ?? [])
            .filter((attribute): attribute is { Key: string; Value?: string } => Boolean(attribute.Key))
            .map((attribute) => [attribute.Key, attribute.Value] as const),
        );
        crossZoneLoadBalancing = parseBooleanAttribute(
          attributeMap.get('load_balancing.cross_zone.enabled'),
        );
      } catch {
        warnings.push(
          `ELB attributes unavailable for ${loadBalancer.LoadBalancerName ?? loadBalancer.LoadBalancerArn}.`,
        );
      }

      try {
        const targetGroups = await paginateAws(
          (marker) =>
            elb.send(
              new DescribeTargetGroupsCommand({
                LoadBalancerArn: loadBalancer.LoadBalancerArn,
                Marker: marker,
              }),
            ),
          (response) => response.TargetGroups,
          (response) => response.NextMarker,
        );
        healthChecks = targetGroups.map((targetGroup) => ({
          targetGroupArn: targetGroup.TargetGroupArn,
          targetGroupName: targetGroup.TargetGroupName,
          protocol: targetGroup.HealthCheckProtocol,
          port: targetGroup.HealthCheckPort,
          path: targetGroup.HealthCheckPath,
          enabled: targetGroup.HealthCheckEnabled,
          interval: targetGroup.HealthCheckIntervalSeconds,
          timeout: targetGroup.HealthCheckTimeoutSeconds,
          healthyThreshold: targetGroup.HealthyThresholdCount,
          unhealthyThreshold: targetGroup.UnhealthyThresholdCount,
          matcher: targetGroup.Matcher
            ? {
                httpCode: targetGroup.Matcher.HttpCode,
                grpcCode: targetGroup.Matcher.GrpcCode,
              }
            : undefined,
        }));
        healthCheck = healthChecks[0];
      } catch {
        warnings.push(
          `ELB target groups unavailable for ${loadBalancer.LoadBalancerName ?? loadBalancer.LoadBalancerArn}.`,
        );
      }
    }

    resources.push(
      buildResource({
        source: 'aws',
        externalId: loadBalancer.LoadBalancerArn ?? loadBalancer.LoadBalancerName ?? 'elb',
        name: loadBalancer.LoadBalancerName ?? 'elb',
        kind: 'infra',
        type: 'ELB',
        ip: loadBalancer.DNSName ?? null,
        metadata: {
          scheme: loadBalancer.Scheme,
          type: loadBalancer.Type,
          region: options.region,
          dnsName: loadBalancer.DNSName,
          loadBalancerArn: loadBalancer.LoadBalancerArn,
          loadBalancerName: loadBalancer.LoadBalancerName,
          loadBalancerResourceName: extractLoadBalancerResourceName(loadBalancer.LoadBalancerArn),
          vpcId: loadBalancer.VpcId,
          securityGroups: loadBalancer.SecurityGroups ?? undefined,
          availabilityZones,
          subnetId: subnetIds[0],
          subnetIds,
          crossZoneLoadBalancing,
          loadBalancingCrossZoneEnabled: crossZoneLoadBalancing,
          healthCheck,
          healthChecks,
          displayName: loadBalancer.LoadBalancerName ?? 'elb',
        },
      }),
    );
  }

  return { resources, warnings };
}
