import assert from 'node:assert/strict';
import test from 'node:test';

import { transformToScanResult } from '../src/discovery/graphBridge.ts';
import { isAnalyzableServiceNode } from '../src/graph/serviceClassification.ts';
import { NodeType } from '../src/graph/types.ts';
import type { DiscoveredResource } from '../src/services/discoveryTypes.ts';

const emptyFlows: [] = [];

test('graphBridge resolves AWS display names and service labels', () => {
  const resources: DiscoveredResource[] = [
    {
      source: 'aws',
      externalId: 'i-0123456789',
      name: 'i-0123456789',
      kind: 'infra',
      type: 'EC2',
      tags: ['Name:stronghold-terraform-api-server'],
      metadata: { region: 'eu-west-1' },
    },
    {
      source: 'aws',
      externalId: 'orders-queue',
      name: 'orders-queue',
      kind: 'infra',
      type: 'SQS_QUEUE',
      metadata: { region: 'eu-west-1' },
    },
    {
      source: 'aws',
      externalId: 'arn:aws:sns:eu-west-1:123456:alerts',
      name: 'alerts',
      kind: 'infra',
      type: 'SNS_TOPIC',
      metadata: { region: 'eu-west-1' },
    },
    {
      source: 'aws',
      externalId: 'redis-cluster',
      name: 'redis-cluster',
      kind: 'infra',
      type: 'ELASTICACHE',
      metadata: { region: 'eu-west-1', engine: 'redis', numCacheNodes: 1 },
    },
    {
      source: 'aws',
      externalId: 'sessions',
      name: 'sessions',
      kind: 'infra',
      type: 'DYNAMODB',
      metadata: { region: 'eu-west-1' },
    },
    {
      source: 'aws',
      externalId: 'arn:aws:s3:::app-assets',
      name: 'app-assets',
      kind: 'infra',
      type: 'S3_BUCKET',
      metadata: { region: 'eu-west-1' },
    },
  ];

  const result = transformToScanResult(resources, emptyFlows, 'aws');
  const byId = new Map(result.nodes.map((node) => [node.id, node]));

  const ec2 = byId.get('i-0123456789');
  assert.ok(ec2);
  assert.equal(ec2.name, 'stronghold-terraform-api-server');
  assert.equal(ec2.type, NodeType.VM);
  assert.equal(ec2.metadata?.awsService, 'EC2 Instance');

  const sqs = byId.get('orders-queue');
  assert.ok(sqs);
  assert.equal(sqs.type, NodeType.MESSAGE_QUEUE);
  assert.equal(sqs.metadata?.awsService, 'SQS Queue');

  const sns = byId.get('arn:aws:sns:eu-west-1:123456:alerts');
  assert.ok(sns);
  assert.equal(sns.type, NodeType.MESSAGE_QUEUE);
  assert.equal(sns.metadata?.awsService, 'SNS Topic');

  const cache = byId.get('redis-cluster');
  assert.ok(cache);
  assert.equal(cache.type, NodeType.CACHE);
  assert.equal(cache.metadata?.awsService, 'ElastiCache Redis');
  assert.equal(cache.metadata?.numCacheNodes, 1);

  const dynamodb = byId.get('sessions');
  assert.ok(dynamodb);
  assert.equal(dynamodb.type, NodeType.DATABASE);
  assert.equal(dynamodb.metadata?.awsService, 'DynamoDB Table');

  const s3 = byId.get('arn:aws:s3:::app-assets');
  assert.ok(s3);
  assert.equal(s3.type, NodeType.OBJECT_STORAGE);
  assert.equal(s3.metadata?.awsService, 'S3 Bucket');
});

test('serviceClassification keeps aws cache/storage/queue/topic as analyzable services', () => {
  assert.equal(
    isAnalyzableServiceNode({
      id: 'cache-1',
      name: 'redis-main',
      type: NodeType.CACHE,
      provider: 'aws',
      tags: {},
      metadata: { sourceType: 'ELASTICACHE' },
    }),
    true
  );
  assert.equal(
    isAnalyzableServiceNode({
      id: 'bucket-1',
      name: 'app-assets',
      type: NodeType.OBJECT_STORAGE,
      provider: 'aws',
      tags: {},
      metadata: { sourceType: 'S3_BUCKET' },
    }),
    true
  );
  assert.equal(
    isAnalyzableServiceNode({
      id: 'topic-1',
      name: 'alerts',
      type: NodeType.MESSAGE_QUEUE,
      provider: 'aws',
      tags: {},
      metadata: { sourceType: 'SNS_TOPIC' },
    }),
    true
  );
});

test('serviceClassification recognizes Azure and GCP managed services as analyzable', () => {
  assert.equal(
    isAnalyzableServiceNode({
      id: 'azure-redis',
      name: 'redis-main',
      type: NodeType.CACHE,
      provider: 'azure',
      tags: {},
      metadata: { sourceType: 'Microsoft.Cache/Redis' },
    }),
    true
  );
  assert.equal(
    isAnalyzableServiceNode({
      id: 'azure-storage',
      name: 'storage-main',
      type: NodeType.OBJECT_STORAGE,
      provider: 'azure',
      tags: {},
      metadata: { sourceType: 'Microsoft.Storage/storageAccounts' },
    }),
    true
  );
  assert.equal(
    isAnalyzableServiceNode({
      id: 'gcp-pubsub',
      name: 'events',
      type: NodeType.MESSAGE_QUEUE,
      provider: 'gcp',
      tags: {},
      metadata: { sourceType: 'pubsub.googleapis.com/Topic' },
    }),
    true
  );
  assert.equal(
    isAnalyzableServiceNode({
      id: 'gcp-storage',
      name: 'assets',
      type: NodeType.OBJECT_STORAGE,
      provider: 'gcp',
      tags: {},
      metadata: { sourceType: 'storage.googleapis.com/Bucket' },
    }),
    true
  );
});

test('graphBridge maps Azure and GCP resource types to expected node categories', () => {
  const resources: DiscoveredResource[] = [
    {
      source: 'azure',
      externalId: '/subscriptions/x/resourceGroups/rg/providers/Microsoft.DBforPostgreSQL/flexibleServers/main',
      name: 'main',
      kind: 'infra',
      type: 'Microsoft.DBforPostgreSQL/flexibleServers',
      metadata: { location: 'westeurope' },
    },
    {
      source: 'azure',
      externalId: '/subscriptions/x/resourceGroups/rg/providers/Microsoft.Cache/Redis/cache-main',
      name: 'cache-main',
      kind: 'infra',
      type: 'Microsoft.Cache/Redis',
      metadata: { location: 'westeurope' },
    },
    {
      source: 'gcp',
      externalId: 'projects/demo/instances/orders-sql',
      name: 'orders-sql',
      kind: 'infra',
      type: 'CLOUD_SQL',
      metadata: { region: 'europe-west1' },
    },
    {
      source: 'gcp',
      externalId: 'projects/demo/topics/events',
      name: 'events',
      kind: 'infra',
      type: 'PUBSUB_TOPIC',
      metadata: { region: 'europe-west1' },
    },
  ];

  const result = transformToScanResult(resources, emptyFlows, 'mixed');
  const byId = new Map(result.nodes.map((node) => [node.id, node]));

  assert.equal(byId.get('/subscriptions/x/resourceGroups/rg/providers/Microsoft.DBforPostgreSQL/flexibleServers/main')?.type, NodeType.DATABASE);
  assert.equal(byId.get('/subscriptions/x/resourceGroups/rg/providers/Microsoft.Cache/Redis/cache-main')?.type, NodeType.CACHE);
  assert.equal(byId.get('projects/demo/instances/orders-sql')?.type, NodeType.DATABASE);
  assert.equal(byId.get('projects/demo/topics/events')?.type, NodeType.MESSAGE_QUEUE);
});
