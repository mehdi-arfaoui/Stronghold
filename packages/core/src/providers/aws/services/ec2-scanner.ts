/**
 * Scans AWS EC2 instances, VPCs, subnets, and security groups.
 */

import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeNatGatewaysCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
} from '@aws-sdk/client-ec2';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { getNameTag, tagsArrayToMap } from '../tag-utils.js';
import {
  createAccountContextResolver,
  createResource,
  paginateAws,
  toBusinessTagMap,
} from '../scan-utils.js';

/** Scans EC2 instances in a region. */
export async function scanEc2Instances(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const ec2 = createAwsClient(EC2Client, options);
  const resources: DiscoveredResource[] = [];
  const accountContext = await createAccountContextResolver(options)();

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
      const tags = tagsArrayToMap(instance.Tags);
      const businessTags = toBusinessTagMap(tags);
      const nameFromTag = getNameTag(tags);

      resources.push(
        createResource({
          source: 'aws',
          arn: `arn:${accountContext.partition}:ec2:${options.region}:${accountContext.accountId}:instance/${instance.InstanceId ?? 'ec2'}`,
          name: nameFromTag ?? instance.InstanceId ?? 'ec2',
          kind: 'infra',
          type: 'EC2',
          ip: instance.PrivateIpAddress ?? null,
          hostname: instance.PrivateDnsName ?? null,
          account: accountContext,
          tags,
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
            ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
            ...(Object.keys(businessTags).length > 0 ? { businessTags } : {}),
          },
        }),
      );
    }
  }

  return { resources, warnings: [] };
}

/** Scans VPCs in a region. */
export async function scanVpcs(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const ec2 = createAwsClient(EC2Client, options);
  const accountContext = await createAccountContextResolver(options)();
  const vpcs = await paginateAws(
    (nextToken) =>
      ec2.send(new DescribeVpcsCommand({ NextToken: nextToken }), getAwsCommandOptions(options)),
    (response) => response.Vpcs,
    (response) => response.NextToken,
  );

  return vpcs.map((vpc) => {
    const tags = tagsArrayToMap(vpc.Tags);
    const businessTags = toBusinessTagMap(tags);
    const vpcName = getNameTag(tags) ?? vpc.VpcId;
    return createResource({
      source: 'aws',
      arn: `arn:${accountContext.partition}:ec2:${options.region}:${accountContext.accountId}:vpc/${vpc.VpcId ?? 'vpc'}`,
      name: vpcName ?? 'vpc',
      kind: 'infra',
      type: 'VPC',
      account: accountContext,
      tags,
      metadata: {
        region: options.region,
        cidrBlock: vpc.CidrBlock,
        state: vpc.State,
        isDefault: vpc.IsDefault,
        dhcpOptionsId: vpc.DhcpOptionsId,
        displayName: vpcName ?? 'vpc',
        ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        ...(Object.keys(businessTags).length > 0 ? { businessTags } : {}),
      },
    });
  });
}

/** Scans subnets in a region. */
export async function scanSubnets(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const ec2 = createAwsClient(EC2Client, options);
  const accountContext = await createAccountContextResolver(options)();
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
    const tags = tagsArrayToMap(subnet.Tags);
    const businessTags = toBusinessTagMap(tags);
    const subnetName = getNameTag(tags) ?? subnet.SubnetId;
    return createResource({
      source: 'aws',
      arn: `arn:${accountContext.partition}:ec2:${options.region}:${accountContext.accountId}:subnet/${subnet.SubnetId ?? 'subnet'}`,
      name: subnetName ?? 'subnet',
      kind: 'infra',
      type: 'SUBNET',
      account: accountContext,
      tags,
      metadata: {
        region: options.region,
        vpcId: subnet.VpcId,
        cidrBlock: subnet.CidrBlock,
        availabilityZone: subnet.AvailabilityZone,
        availableIpAddressCount: subnet.AvailableIpAddressCount,
        mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch,
        defaultForAz: subnet.DefaultForAz,
        displayName: subnetName ?? 'subnet',
        ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        ...(Object.keys(businessTags).length > 0 ? { businessTags } : {}),
      },
    });
  });
}

/** Scans NAT gateways in a region. */
export async function scanNatGateways(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const ec2 = createAwsClient(EC2Client, options);
  const accountContext = await createAccountContextResolver(options)();
  const natGateways = await paginateAws(
    (nextToken) =>
      ec2.send(
        new DescribeNatGatewaysCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.NatGateways,
    (response) => response.NextToken,
  );

  return natGateways.map((natGateway) => {
    const tags = tagsArrayToMap(natGateway.Tags);
    const businessTags = toBusinessTagMap(tags);
    const displayName = getNameTag(tags) ?? natGateway.NatGatewayId ?? 'nat-gateway';

    return createResource({
      source: 'aws',
      arn: `arn:${accountContext.partition}:ec2:${options.region}:${accountContext.accountId}:natgateway/${natGateway.NatGatewayId ?? 'nat-gateway'}`,
      name: displayName,
      kind: 'infra',
      type: 'NAT_GATEWAY',
      account: accountContext,
      tags,
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
        displayName,
        ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        ...(Object.keys(businessTags).length > 0 ? { businessTags } : {}),
      },
    });
  });
}

/** Scans security groups in a region. */
export async function scanSecurityGroups(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const ec2 = createAwsClient(EC2Client, options);
  const accountContext = await createAccountContextResolver(options)();
  const securityGroups = await paginateAws(
    (nextToken) =>
      ec2.send(
        new DescribeSecurityGroupsCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.SecurityGroups,
    (response) => response.NextToken,
  );

  return securityGroups.map((sg) => {
    const tags = tagsArrayToMap(sg.Tags);
    const businessTags = toBusinessTagMap(tags);
    const displayName = getNameTag(tags) ?? sg.GroupName ?? sg.GroupId ?? 'sg';

    return createResource({
      source: 'aws',
      arn: `arn:${accountContext.partition}:ec2:${options.region}:${accountContext.accountId}:security-group/${sg.GroupId ?? 'sg'}`,
      name: displayName,
      kind: 'infra',
      type: 'SECURITY_GROUP',
      account: accountContext,
      tags,
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
        displayName,
        ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        ...(Object.keys(businessTags).length > 0 ? { businessTags } : {}),
      },
    });
  });
}
