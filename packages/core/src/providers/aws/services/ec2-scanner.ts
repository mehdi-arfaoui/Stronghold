/**
 * Scans AWS EC2 instances, VPCs, subnets, and security groups.
 */

import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeNatGatewaysCommand,
  DescribeTagsCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
} from '@aws-sdk/client-ec2';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource, toBusinessTagMap } from '../scan-utils.js';

/** Scans EC2 instances in a region. */
export async function scanEc2Instances(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const ec2 = createAwsClient(EC2Client, options);
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];

  const reservations = await paginateAws(
    (nextToken) =>
      ec2.send(
        new DescribeInstancesCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.Reservations,
    (response) => response.NextToken,
  );

  for (const reservation of reservations) {
    for (const instance of reservation.Instances ?? []) {
      const awsTags = Object.fromEntries(
        (instance.Tags ?? [])
          .filter((tag): tag is { Key: string; Value?: string } => Boolean(tag?.Key))
          .map((tag) => [tag.Key, tag.Value ?? '']),
      );
      const nameFromTag =
        typeof awsTags.Name === 'string' && awsTags.Name.trim().length > 0
          ? awsTags.Name.trim()
          : null;

      resources.push(
        buildResource({
          source: 'aws',
          externalId: instance.InstanceId ?? 'ec2',
          name: nameFromTag ?? instance.InstanceId ?? 'ec2',
          kind: 'infra',
          type: 'EC2',
          ip: instance.PrivateIpAddress ?? null,
          hostname: instance.PrivateDnsName ?? null,
          tags: Object.entries(awsTags).map(([key, value]) => `${key}:${value}`),
          metadata: {
            state: instance.State?.Name,
            instanceType: instance.InstanceType,
            region: options.region,
            availabilityZone: instance.Placement?.AvailabilityZone,
            subnetId: instance.SubnetId,
            vpcId: instance.VpcId,
            securityGroups: (instance.SecurityGroups ?? [])
              .map((group) => group.GroupId)
              .filter((groupId): groupId is string => Boolean(groupId)),
            architecture: instance.Architecture,
            platformDetails: instance.PlatformDetails,
            displayName: nameFromTag ?? instance.InstanceId ?? 'ec2',
            awsTags,
          },
        }),
      );
    }
  }

  applyEc2Tags(ec2, options, resources, options.region).catch(() => {
    warnings.push(`EC2 tag enrichment failed in ${options.region}.`);
  });

  return { resources, warnings };
}

async function applyEc2Tags(
  ec2: EC2Client,
  options: AwsClientOptions,
  resources: DiscoveredResource[],
  region: string,
): Promise<void> {
  const tags = await ec2.send(new DescribeTagsCommand({}), getAwsCommandOptions(options));
  if (!tags.Tags) return;

  for (const tag of tags.Tags) {
    if (!tag.ResourceId || !tag.Key) continue;
    const resource = resources.find((item) => item.externalId === tag.ResourceId);
    if (!resource) continue;
    const existing = new Set(resource.tags ?? []);
    existing.add(`${tag.Key}:${tag.Value ?? ''}`);
    resource.tags = Array.from(existing);
    const meta = (resource.metadata ?? {}) as Record<string, unknown>;
    const awsTags = (meta.awsTags ?? {}) as Record<string, string>;
    resource.metadata = {
      ...meta,
      awsTags: { ...awsTags, [tag.Key]: tag.Value ?? '' },
    };

    if (tag.Key === 'Name') {
      const taggedName = (tag.Value ?? '').trim();
      if (taggedName.length > 0) {
        const currentName = String(resource.name || '').trim();
        if (!currentName || currentName === resource.externalId || currentName.startsWith('i-')) {
          resource.name = taggedName;
        }
        resource.metadata = { ...resource.metadata, displayName: taggedName };
      }
    }
  }

  enrichBusinessTags(resources, region);
}

function enrichBusinessTags(resources: DiscoveredResource[], _region: string): void {
  for (const resource of resources) {
    const businessTags = toBusinessTagMap(resource.tags ?? []);
    const metadata = (resource.metadata ?? {}) as Record<string, unknown>;
    const awsTags = (metadata.awsTags ?? {}) as Record<string, string>;
    const autoScalingGroupName =
      typeof awsTags['aws:autoscaling:groupName'] === 'string'
        ? awsTags['aws:autoscaling:groupName']
        : undefined;
    const nameFromTag = typeof awsTags.Name === 'string' ? awsTags.Name.trim() : '';
    if (
      nameFromTag.length > 0 &&
      (!resource.name || resource.name === resource.externalId || resource.name.startsWith('i-'))
    ) {
      resource.name = nameFromTag;
    }
    resource.metadata = {
      ...metadata,
      ...(nameFromTag.length > 0 ? { displayName: nameFromTag } : {}),
      ...(autoScalingGroupName ? { autoScalingGroupName } : {}),
      ...(Object.keys(businessTags).length > 0 ? { businessTags } : {}),
    };
  }
}

/** Scans VPCs in a region. */
export async function scanVpcs(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const ec2 = createAwsClient(EC2Client, options);
  const vpcs = await paginateAws(
    (nextToken) =>
      ec2.send(new DescribeVpcsCommand({ NextToken: nextToken }), getAwsCommandOptions(options)),
    (response) => response.Vpcs,
    (response) => response.NextToken,
  );

  return vpcs.map((vpc) => {
    const vpcName = vpc.Tags?.find((t) => t.Key === 'Name')?.Value ?? vpc.VpcId;
    return buildResource({
      source: 'aws',
      externalId: vpc.VpcId ?? 'vpc',
      name: vpcName ?? 'vpc',
      kind: 'infra',
      type: 'VPC',
      metadata: {
        region: options.region,
        cidrBlock: vpc.CidrBlock,
        state: vpc.State,
        isDefault: vpc.IsDefault,
        dhcpOptionsId: vpc.DhcpOptionsId,
      },
    });
  });
}

/** Scans subnets in a region. */
export async function scanSubnets(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const ec2 = createAwsClient(EC2Client, options);
  const subnets = await paginateAws(
    (nextToken) =>
      ec2.send(
        new DescribeSubnetsCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.Subnets,
    (response) => response.NextToken,
  );

  return subnets.map((subnet) => {
    const subnetName = subnet.Tags?.find((t) => t.Key === 'Name')?.Value ?? subnet.SubnetId;
    return buildResource({
      source: 'aws',
      externalId: subnet.SubnetId ?? 'subnet',
      name: subnetName ?? 'subnet',
      kind: 'infra',
      type: 'SUBNET',
      metadata: {
        region: options.region,
        vpcId: subnet.VpcId,
        cidrBlock: subnet.CidrBlock,
        availabilityZone: subnet.AvailabilityZone,
        availableIpAddressCount: subnet.AvailableIpAddressCount,
        mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch,
        defaultForAz: subnet.DefaultForAz,
      },
    });
  });
}

/** Scans NAT gateways in a region. */
export async function scanNatGateways(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const ec2 = createAwsClient(EC2Client, options);
  const natGateways = await paginateAws(
    (nextToken) =>
      ec2.send(
        new DescribeNatGatewaysCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.NatGateways,
    (response) => response.NextToken,
  );

  return natGateways.map((natGateway) =>
    buildResource({
      source: 'aws',
      externalId: natGateway.NatGatewayId ?? 'nat-gateway',
      name: natGateway.NatGatewayId ?? 'nat-gateway',
      kind: 'infra',
      type: 'NAT_GATEWAY',
      metadata: {
        region: options.region,
        natGatewayId: natGateway.NatGatewayId,
        state: natGateway.State,
        connectivityType: natGateway.ConnectivityType,
        subnetId: natGateway.SubnetId,
        vpcId: natGateway.VpcId,
        publicIps: (natGateway.NatGatewayAddresses ?? [])
          .map((address) => address.PublicIp)
          .filter((value): value is string => Boolean(value)),
        privateIps: (natGateway.NatGatewayAddresses ?? [])
          .map((address) => address.PrivateIp)
          .filter((value): value is string => Boolean(value)),
        displayName: natGateway.NatGatewayId ?? 'nat-gateway',
      },
    }),
  );
}

/** Scans security groups in a region. */
export async function scanSecurityGroups(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const ec2 = createAwsClient(EC2Client, options);
  const securityGroups = await paginateAws(
    (nextToken) =>
      ec2.send(
        new DescribeSecurityGroupsCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.SecurityGroups,
    (response) => response.NextToken,
  );

  return securityGroups.map((sg) =>
    buildResource({
      source: 'aws',
      externalId: sg.GroupId ?? 'sg',
      name: sg.GroupName ?? 'sg',
      kind: 'infra',
      type: 'SECURITY_GROUP',
      metadata: {
        region: options.region,
        groupId: sg.GroupId,
        vpcId: sg.VpcId,
        description: sg.Description,
        inboundRulesCount: sg.IpPermissions?.length ?? 0,
        outboundRulesCount: sg.IpPermissionsEgress?.length ?? 0,
        inboundRules: sg.IpPermissions?.map((rule) => ({
          protocol: rule.IpProtocol,
          fromPort: rule.FromPort,
          toPort: rule.ToPort,
          sources: [
            ...(rule.IpRanges?.map((r) => r.CidrIp) ?? []),
            ...(rule.Ipv6Ranges?.map((r) => r.CidrIpv6) ?? []),
            ...(rule.UserIdGroupPairs?.map((g) => g.GroupId) ?? []),
          ],
        })),
      },
    }),
  );
}
