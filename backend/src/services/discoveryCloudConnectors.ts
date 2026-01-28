import type { DiscoveryConnectorResult, DiscoveryCredentials, DiscoveredResource } from "./discoveryTypes.js";

import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeTagsCommand,
  DescribeRegionsCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from "@aws-sdk/client-auto-scaling";
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import {
  EKSClient,
  ListClustersCommand,
  DescribeClusterCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand,
} from "@aws-sdk/client-eks";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";

import { ClientSecretCredential } from "@azure/identity";
import { ResourceManagementClient } from "@azure/arm-resources";
import { ComputeManagementClient } from "@azure/arm-compute";
import { ContainerServiceClient } from "@azure/arm-containerservice";
import { StorageManagementClient } from "@azure/arm-storage";
import { SqlManagementClient } from "@azure/arm-sql";

import { InstancesClient, type protos } from "@google-cloud/compute";
import { ClusterManagerClient } from "@google-cloud/container";
import { SqlInstancesServiceClient } from "@google-cloud/sql";

function emptyResult(): DiscoveryConnectorResult {
  return { resources: [], flows: [], warnings: [] };
}

// Rate limiting: max concurrent region scans
const AWS_MAX_CONCURRENT_REGIONS = 5;

/**
 * Fetch all available AWS regions using EC2 DescribeRegions API.
 */
export async function getAllAwsRegions(
  credentials: DiscoveryCredentials
): Promise<string[]> {
  if (!credentials.aws?.accessKeyId && !credentials.aws?.roleArn) {
    return [];
  }

  const credentialProvider = credentials.aws.roleArn
    ? fromTemporaryCredentials({
        params: {
          RoleArn: credentials.aws.roleArn,
          RoleSessionName: "stronghold-discovery-regions",
          ExternalId: credentials.aws.externalId,
        },
        clientConfig: { region: "us-east-1" },
      })
    : {
        accessKeyId: credentials.aws.accessKeyId,
        secretAccessKey: credentials.aws.secretAccessKey,
        sessionToken: credentials.aws.sessionToken,
      };

  const ec2 = new EC2Client({ region: "us-east-1", credentials: credentialProvider as any });
  const { Regions } = await ec2.send(new DescribeRegionsCommand({}));

  return Regions?.map((r) => r.RegionName).filter((name): name is string => !!name) || [];
}

/**
 * Process items in batches with concurrency limit.
 */
async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

function buildResource(input: Partial<DiscoveredResource> & { source: string; externalId: string }) {
  return {
    name: input.name || input.externalId,
    kind: input.kind || "infra",
    type: input.type || "CLOUD",
    ...input,
  } satisfies DiscoveredResource;
}

/**
 * Scan a single AWS region for resources.
 * @internal
 */
async function scanAwsRegion(
  region: string,
  credentials: DiscoveryCredentials
): Promise<DiscoveredResource[]> {
  const credentialProvider = credentials.aws?.roleArn
    ? fromTemporaryCredentials({
        params: {
          RoleArn: credentials.aws.roleArn,
          RoleSessionName: "stronghold-discovery",
          ExternalId: credentials.aws.externalId,
        },
        clientConfig: { region },
      })
    : {
        accessKeyId: credentials.aws?.accessKeyId,
        secretAccessKey: credentials.aws?.secretAccessKey,
        sessionToken: credentials.aws?.sessionToken,
      };

  const ec2 = new EC2Client({ region, credentials: credentialProvider as any });
  const rds = new RDSClient({ region, credentials: credentialProvider as any });
  const lambda = new LambdaClient({ region, credentials: credentialProvider as any });
  const asg = new AutoScalingClient({ region, credentials: credentialProvider as any });
  const elb = new ElasticLoadBalancingV2Client({ region, credentials: credentialProvider as any });
  const eks = new EKSClient({ region, credentials: credentialProvider as any });

  const resources: DiscoveredResource[] = [];

  // EC2 Instances
  const instances = await ec2.send(new DescribeInstancesCommand({}));
  instances.Reservations?.forEach((reservation) => {
    reservation.Instances?.forEach((instance) => {
      resources.push(
        buildResource({
          source: "aws",
          externalId: instance.InstanceId || "ec2",
          name: instance.InstanceId || "ec2",
          kind: "infra",
          type: "EC2",
          ip: instance.PrivateIpAddress || null,
          hostname: instance.PrivateDnsName || null,
          metadata: { state: instance.State?.Name, instanceType: instance.InstanceType, region },
        })
      );
    });
  });

  // EC2 Tags
  const tags = await ec2.send(new DescribeTagsCommand({}));
  if (tags.Tags) {
    tags.Tags.forEach((tag) => {
      if (!tag.ResourceId || !tag.Key) return;
      const resource = resources.find((item) => item.externalId === tag.ResourceId);
      if (!resource) return;
      const existing = new Set(resource.tags || []);
      existing.add(`${tag.Key}:${tag.Value ?? ""}`);
      resource.tags = Array.from(existing);
    });
  }

  // RDS Instances
  const dbInstances = await rds.send(new DescribeDBInstancesCommand({}));
  dbInstances.DBInstances?.forEach((db) => {
    resources.push(
      buildResource({
        source: "aws",
        externalId: db.DBInstanceIdentifier || "rds",
        name: db.DBInstanceIdentifier || "rds",
        kind: "infra",
        type: "RDS",
        ip: db.Endpoint?.Address || null,
        metadata: { engine: db.Engine, status: db.DBInstanceStatus, region },
      })
    );
  });

  // Lambda Functions
  const lambdas = await lambda.send(new ListFunctionsCommand({}));
  lambdas.Functions?.forEach((fn) => {
    resources.push(
      buildResource({
        source: "aws",
        externalId: fn.FunctionArn || fn.FunctionName || "lambda",
        name: fn.FunctionName || "lambda",
        kind: "service",
        type: "LAMBDA",
        metadata: { runtime: fn.Runtime, handler: fn.Handler, region },
      })
    );
  });

  // Auto Scaling Groups
  const groups = await asg.send(new DescribeAutoScalingGroupsCommand({}));
  groups.AutoScalingGroups?.forEach((group) => {
    resources.push(
      buildResource({
        source: "aws",
        externalId: group.AutoScalingGroupARN || group.AutoScalingGroupName || "asg",
        name: group.AutoScalingGroupName || "asg",
        kind: "infra",
        type: "ASG",
        metadata: { minSize: group.MinSize, maxSize: group.MaxSize, region },
      })
    );
  });

  // Load Balancers
  const loadBalancers = await elb.send(new DescribeLoadBalancersCommand({}));
  loadBalancers.LoadBalancers?.forEach((lb) => {
    resources.push(
      buildResource({
        source: "aws",
        externalId: lb.LoadBalancerArn || lb.LoadBalancerName || "elb",
        name: lb.LoadBalancerName || "elb",
        kind: "infra",
        type: "ELB",
        ip: lb.DNSName || null,
        metadata: { scheme: lb.Scheme, type: lb.Type, region },
      })
    );
  });

  // EKS Clusters
  const clusterList = await eks.send(new ListClustersCommand({}));
  for (const clusterName of clusterList.clusters || []) {
    const clusterDetails = await eks.send(new DescribeClusterCommand({ name: clusterName }));
    const cluster = clusterDetails.cluster;
    if (!cluster) continue;

    resources.push(
      buildResource({
        source: "aws",
        externalId: cluster.arn || clusterName,
        name: clusterName,
        kind: "infra",
        type: "EKS",
        metadata: {
          region,
          version: cluster.version,
          status: cluster.status,
          endpoint: cluster.endpoint,
          platformVersion: cluster.platformVersion,
          vpcId: cluster.resourcesVpcConfig?.vpcId,
        },
      })
    );

    // List node groups for this cluster
    const nodeGroupList = await eks.send(new ListNodegroupsCommand({ clusterName }));
    for (const nodeGroupName of nodeGroupList.nodegroups || []) {
      const nodeGroupDetails = await eks.send(
        new DescribeNodegroupCommand({ clusterName, nodegroupName: nodeGroupName })
      );
      const nodeGroup = nodeGroupDetails.nodegroup;
      if (!nodeGroup) continue;

      resources.push(
        buildResource({
          source: "aws",
          externalId: nodeGroup.nodegroupArn || `${clusterName}/${nodeGroupName}`,
          name: `${clusterName}/${nodeGroupName}`,
          kind: "infra",
          type: "EKS_NODEGROUP",
          metadata: {
            region,
            clusterName,
            status: nodeGroup.status,
            capacityType: nodeGroup.capacityType,
            instanceTypes: nodeGroup.instanceTypes,
            desiredSize: nodeGroup.scalingConfig?.desiredSize,
            minSize: nodeGroup.scalingConfig?.minSize,
            maxSize: nodeGroup.scalingConfig?.maxSize,
          },
        })
      );
    }
  }

  // VPCs
  const vpcs = await ec2.send(new DescribeVpcsCommand({}));
  vpcs.Vpcs?.forEach((vpc) => {
    const vpcName = vpc.Tags?.find((t) => t.Key === "Name")?.Value || vpc.VpcId;
    resources.push(
      buildResource({
        source: "aws",
        externalId: vpc.VpcId || "vpc",
        name: vpcName || "vpc",
        kind: "infra",
        type: "VPC",
        metadata: {
          region,
          cidrBlock: vpc.CidrBlock,
          state: vpc.State,
          isDefault: vpc.IsDefault,
          dhcpOptionsId: vpc.DhcpOptionsId,
        },
      })
    );
  });

  // Subnets
  const subnets = await ec2.send(new DescribeSubnetsCommand({}));
  subnets.Subnets?.forEach((subnet) => {
    const subnetName = subnet.Tags?.find((t) => t.Key === "Name")?.Value || subnet.SubnetId;
    resources.push(
      buildResource({
        source: "aws",
        externalId: subnet.SubnetId || "subnet",
        name: subnetName || "subnet",
        kind: "infra",
        type: "SUBNET",
        metadata: {
          region,
          vpcId: subnet.VpcId,
          cidrBlock: subnet.CidrBlock,
          availabilityZone: subnet.AvailabilityZone,
          availableIpAddressCount: subnet.AvailableIpAddressCount,
          mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch,
          defaultForAz: subnet.DefaultForAz,
        },
      })
    );
  });

  // Security Groups
  const securityGroups = await ec2.send(new DescribeSecurityGroupsCommand({}));
  securityGroups.SecurityGroups?.forEach((sg) => {
    resources.push(
      buildResource({
        source: "aws",
        externalId: sg.GroupId || "sg",
        name: sg.GroupName || "sg",
        kind: "infra",
        type: "SECURITY_GROUP",
        metadata: {
          region,
          vpcId: sg.VpcId,
          description: sg.Description,
          inboundRulesCount: sg.IpPermissions?.length || 0,
          outboundRulesCount: sg.IpPermissionsEgress?.length || 0,
          inboundRules: sg.IpPermissions?.map((rule) => ({
            protocol: rule.IpProtocol,
            fromPort: rule.FromPort,
            toPort: rule.ToPort,
            sources: [
              ...(rule.IpRanges?.map((r) => r.CidrIp) || []),
              ...(rule.Ipv6Ranges?.map((r) => r.CidrIpv6) || []),
              ...(rule.UserIdGroupPairs?.map((g) => g.GroupId) || []),
            ],
          })),
        },
      })
    );
  });

  return resources;
}

export type AwsScanOptions = {
  /**
   * Regions to scan:
   * - undefined: use credentials.aws.region (single region, backward compatible)
   * - ['all']: scan all available regions
   * - ['us-east-1', 'eu-west-1']: scan specific regions
   */
  regions?: string[];
  /**
   * Callback for progress updates during multi-region scan.
   */
  onProgress?: (completed: number, total: number, currentRegion: string) => void;
};

/**
 * Scan AWS infrastructure across one or multiple regions.
 *
 * @param credentials - AWS credentials (IAM keys or role ARN)
 * @param options - Scan options including regions to scan
 */
export async function scanAws(
  credentials: DiscoveryCredentials,
  options: AwsScanOptions = {}
): Promise<DiscoveryConnectorResult> {
  // Determine which regions to scan
  let regionsToScan: string[] = [];

  if (options.regions && options.regions.length > 0) {
    if (options.regions.includes("all")) {
      // Fetch all available regions
      regionsToScan = await getAllAwsRegions(credentials);
      if (regionsToScan.length === 0) {
        return { resources: [], flows: [], warnings: ["Could not fetch AWS regions"] };
      }
    } else {
      regionsToScan = options.regions;
    }
  } else if (credentials.aws?.region) {
    // Backward compatible: single region from credentials
    regionsToScan = [credentials.aws.region];
  } else {
    return emptyResult();
  }

  const allResources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  let completed = 0;

  // Scan regions with rate limiting (max concurrent)
  const results = await processInBatches(regionsToScan, AWS_MAX_CONCURRENT_REGIONS, async (region) => {
    const resources = await scanAwsRegion(region, credentials);
    completed++;
    options.onProgress?.(completed, regionsToScan.length, region);
    return { region, resources };
  });

  // Aggregate results
  for (const result of results) {
    if (result.status === "fulfilled") {
      allResources.push(...result.value.resources);
    } else {
      // Extract region from error if possible
      const errorMsg = result.reason?.message || String(result.reason);
      warnings.push(`AWS scan failed for region: ${errorMsg}`);
    }
  }

  return { resources: allResources, flows: [], warnings };
}

export async function scanAzure(credentials: DiscoveryCredentials): Promise<DiscoveryConnectorResult> {
  if (!credentials.azure?.tenantId || !credentials.azure?.clientId || !credentials.azure?.clientSecret) {
    return emptyResult();
  }
  const subscriptionId = credentials.azure.subscriptionId;
  if (!subscriptionId) return emptyResult();

  const credential = new ClientSecretCredential(
    credentials.azure.tenantId,
    credentials.azure.clientId,
    credentials.azure.clientSecret
  );

  const resourceClient = new ResourceManagementClient(credential, subscriptionId);
  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  const aksClient = new ContainerServiceClient(credential, subscriptionId);
  const storageClient = new StorageManagementClient(credential, subscriptionId);
  const sqlClient = new SqlManagementClient(credential, subscriptionId);

  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];

  for await (const resource of resourceClient.resources.list()) {
    resources.push(
      buildResource({
        source: "azure",
        externalId: resource.id || resource.name || "resource",
        name: resource.name || resource.id || "resource",
        kind: "infra",
        type: resource.type || "RESOURCE",
        metadata: { location: resource.location, tags: resource.tags },
      })
    );
  }

  for await (const vm of computeClient.virtualMachines.listAll()) {
    resources.push(
      buildResource({
        source: "azure",
        externalId: vm.id || vm.name || "vm",
        name: vm.name || "vm",
        kind: "infra",
        type: "AZURE_VM",
        metadata: { size: vm.hardwareProfile?.vmSize, osType: vm.storageProfile?.osDisk?.osType },
      })
    );
  }

  for await (const cluster of aksClient.managedClusters.list()) {
    resources.push(
      buildResource({
        source: "azure",
        externalId: cluster.id || cluster.name || "aks",
        name: cluster.name || "aks",
        kind: "infra",
        type: "AKS",
        metadata: { kubernetesVersion: cluster.kubernetesVersion },
      })
    );
  }

  for await (const account of storageClient.storageAccounts.list()) {
    resources.push(
      buildResource({
        source: "azure",
        externalId: account.id || account.name || "storage",
        name: account.name || "storage",
        kind: "infra",
        type: "STORAGE",
        metadata: { location: account.location, kind: account.kind },
      })
    );
  }

  // Azure SQL Servers and Databases
  try {
    for await (const server of sqlClient.servers.list()) {
      const serverName = server.name || "sql-server";
      resources.push(
        buildResource({
          source: "azure",
          externalId: server.id || serverName,
          name: serverName,
          kind: "infra",
          type: "AZURE_SQL_SERVER",
          ip: server.fullyQualifiedDomainName || null,
          metadata: {
            location: server.location,
            version: server.version,
            state: server.state,
            administratorLogin: server.administratorLogin,
            publicNetworkAccess: server.publicNetworkAccess,
            minimalTlsVersion: server.minimalTlsVersion,
          },
        })
      );

      // List databases for this server
      const resourceGroup = server.id?.split("/")[4];
      if (resourceGroup && server.name) {
        try {
          for await (const db of sqlClient.databases.listByServer(resourceGroup, server.name)) {
            resources.push(
              buildResource({
                source: "azure",
                externalId: db.id || `${serverName}/${db.name}`,
                name: `${serverName}/${db.name}`,
                kind: "infra",
                type: "AZURE_SQL_DATABASE",
                metadata: {
                  location: db.location,
                  serverName,
                  status: db.status,
                  edition: db.sku?.tier,
                  sku: db.sku?.name,
                  maxSizeBytes: db.maxSizeBytes,
                  collation: db.collation,
                  zoneRedundant: db.zoneRedundant,
                  readScale: db.readScale,
                  currentServiceObjectiveName: db.currentServiceObjectiveName,
                },
              })
            );
          }
        } catch {
          warnings.push(`Failed to list databases for SQL server: ${serverName}`);
        }
      }
    }
  } catch {
    warnings.push("Failed to list Azure SQL servers");
  }

  return { resources, flows: [], warnings };
}

export async function scanGcp(credentials: DiscoveryCredentials): Promise<DiscoveryConnectorResult> {
  if (!credentials.gcp?.projectId || !credentials.gcp?.clientEmail || !credentials.gcp?.privateKey) {
    return emptyResult();
  }

  const resources: DiscoveredResource[] = [];
  const projectId = credentials.gcp.projectId;
  const clientEmail = credentials.gcp.clientEmail;
  const privateKey = credentials.gcp.privateKey;

  const instancesClient = new InstancesClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
    projectId,
  });
  const aggregatedIterable: AsyncIterable<
    [string, protos.google.cloud.compute.v1.IInstancesScopedList]
  > = instancesClient.aggregatedListAsync({ project: projectId });
  for await (const [zone, response] of aggregatedIterable) {
    response.instances?.forEach((instance: any) => {
      resources.push(
        buildResource({
          source: "gcp",
          externalId: instance.id?.toString() || instance.name || "compute",
          name: instance.name || "compute",
          kind: "infra",
          type: "GCE",
          ip: instance.networkInterfaces?.[0]?.networkIP || null,
          hostname: instance.hostname || null,
          metadata: { zone, status: instance.status },
        })
      );
    });
  }

  const containerClient = new ClusterManagerClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
  });
  const [clusters] = await containerClient.listClusters({ parent: `projects/${projectId}/locations/-` });
  clusters.clusters?.forEach((cluster) => {
    resources.push(
      buildResource({
        source: "gcp",
        externalId: cluster.selfLink || cluster.name || "gke",
        name: cluster.name || "gke",
        kind: "infra",
        type: "GKE",
        metadata: { endpoint: cluster.endpoint, version: cluster.currentMasterVersion },
      })
    );
  });

  const sqlClient = new SqlInstancesServiceClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
  });
  const [instances] = await sqlClient.list({ project: projectId });
  instances.items?.forEach((instance) => {
    resources.push(
      buildResource({
        source: "gcp",
        externalId: instance.name || instance.connectionName || "sql",
        name: instance.name || "sql",
        kind: "infra",
        type: "CLOUD_SQL",
        metadata: { region: instance.region, databaseVersion: instance.databaseVersion },
      })
    );
  });

  return { resources, flows: [], warnings: [] };
}
