import type { DiscoveryConnectorResult, DiscoveryCredentials, DiscoveredResource } from "./discoveryTypes.js";

import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeTagsCommand,
} from "@aws-sdk/client-ec2";
import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from "@aws-sdk/client-auto-scaling";
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";

import { ClientSecretCredential } from "@azure/identity";
import { ResourceManagementClient } from "@azure/arm-resources";
import { ComputeManagementClient } from "@azure/arm-compute";
import { ContainerServiceClient } from "@azure/arm-containerservice";
import { StorageManagementClient } from "@azure/arm-storage";

import { InstancesClient } from "@google-cloud/compute";
import { ClusterManagerClient } from "@google-cloud/container";
import { SqlInstancesServiceClient } from "@google-cloud/sql";

function emptyResult(): DiscoveryConnectorResult {
  return { resources: [], flows: [], warnings: [] };
}

function buildResource(input: Partial<DiscoveredResource> & { source: string; externalId: string }) {
  return {
    name: input.name || input.externalId,
    kind: input.kind || "infra",
    type: input.type || "CLOUD",
    ...input,
  } satisfies DiscoveredResource;
}

export async function scanAws(credentials: DiscoveryCredentials): Promise<DiscoveryConnectorResult> {
  if (!credentials.aws?.region) return emptyResult();
  const region = credentials.aws.region;
  const credentialProvider = credentials.aws.roleArn
    ? fromTemporaryCredentials({
        params: {
          RoleArn: credentials.aws.roleArn,
          RoleSessionName: "stronghold-discovery",
          ExternalId: credentials.aws.externalId,
        },
        clientConfig: { region },
      })
    : {
        accessKeyId: credentials.aws.accessKeyId,
        secretAccessKey: credentials.aws.secretAccessKey,
        sessionToken: credentials.aws.sessionToken,
      };

  const ec2 = new EC2Client({ region, credentials: credentialProvider as any });
  const rds = new RDSClient({ region, credentials: credentialProvider as any });
  const lambda = new LambdaClient({ region, credentials: credentialProvider as any });
  const asg = new AutoScalingClient({ region, credentials: credentialProvider as any });
  const elb = new ElasticLoadBalancingV2Client({ region, credentials: credentialProvider as any });

  const resources: DiscoveredResource[] = [];

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
          metadata: { state: instance.State?.Name, instanceType: instance.InstanceType },
        })
      );
    });
  });

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
        metadata: { engine: db.Engine, status: db.DBInstanceStatus },
      })
    );
  });

  const lambdas = await lambda.send(new ListFunctionsCommand({}));
  lambdas.Functions?.forEach((fn) => {
    resources.push(
      buildResource({
        source: "aws",
        externalId: fn.FunctionArn || fn.FunctionName || "lambda",
        name: fn.FunctionName || "lambda",
        kind: "service",
        type: "LAMBDA",
        metadata: { runtime: fn.Runtime, handler: fn.Handler },
      })
    );
  });

  const groups = await asg.send(new DescribeAutoScalingGroupsCommand({}));
  groups.AutoScalingGroups?.forEach((group) => {
    resources.push(
      buildResource({
        source: "aws",
        externalId: group.AutoScalingGroupARN || group.AutoScalingGroupName || "asg",
        name: group.AutoScalingGroupName || "asg",
        kind: "infra",
        type: "ASG",
        metadata: { minSize: group.MinSize, maxSize: group.MaxSize },
      })
    );
  });

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
        metadata: { scheme: lb.Scheme, type: lb.Type },
      })
    );
  });

  return { resources, flows: [], warnings: [] };
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

  const resources: DiscoveredResource[] = [];

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

  return { resources, flows: [], warnings: [] };
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
  const [aggregated] = await instancesClient.aggregatedListAsync({ project: projectId });
  for await (const [zone, response] of aggregated) {
    response.instances?.forEach((instance) => {
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
