import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateDemoInfrastructure,
  getLayersForCompanySize,
} from '../../src/demo/services/demoInfrastructureFactory.ts';

const REQUIRED_CORE_IDS = [
  'svc-api-gateway',
  'svc-payment',
  'svc-order',
  'svc-user',
  'db-payment',
  'erp-server',
  'erp-db',
  'stripe-api',
] as const;

test('PME ecommerce demo infra stays compact and keeps required core nodes', () => {
  const infrastructure = generateDemoInfrastructure({
    sector: 'ecommerce',
    companySize: 'pme',
  });

  assert.ok(infrastructure.nodes.length >= 15);
  assert.ok(infrastructure.nodes.length <= 25);
  assert.ok(infrastructure.confirmedEdges.length >= 20);
  assert.ok(infrastructure.spofNodeIds.length >= 3);
  assert.ok(infrastructure.spofNodeIds.length <= 4);

  const nodeIds = new Set(infrastructure.nodes.map((node) => node.id));
  for (const requiredId of REQUIRED_CORE_IDS) {
    assert.equal(nodeIds.has(requiredId), true);
  }

  const mainApp = infrastructure.nodes.find((node) => node.id === 'svc-main-app');
  assert.equal(mainApp?.name, 'storefront');
  assert.equal(nodeIds.has('region-eu-central-1'), false);
});

test('ETI finance demo infra enables resilience + DR layers and finance labels', () => {
  const infrastructure = generateDemoInfrastructure({
    sector: 'finance',
    companySize: 'eti',
  });

  assert.ok(infrastructure.nodes.length >= 60);
  assert.ok(infrastructure.nodes.length <= 100);
  assert.deepEqual(getLayersForCompanySize('eti'), ['core', 'microservices', 'resilience', 'dr']);

  const nodeIds = new Set(infrastructure.nodes.map((node) => node.id));
  assert.equal(nodeIds.has('db-user-replica'), true);
  assert.equal(nodeIds.has('db-payment-dr-replica'), true);
  assert.equal(nodeIds.has('alb-dr'), true);

  const mainApp = infrastructure.nodes.find((node) => node.id === 'svc-main-app');
  const paymentDb = infrastructure.nodes.find((node) => node.id === 'db-payment');
  assert.equal(mainApp?.name, 'trading-platform');
  assert.equal(paymentDb?.name, 'ledger-db');

  const paymentService = infrastructure.nodes.find((node) => node.id === 'svc-payment');
  const redisMain = infrastructure.nodes.find((node) => node.id === 'redis-main');
  const albProd = infrastructure.nodes.find((node) => node.id === 'alb-prod');
  const backupsBucket = infrastructure.nodes.find((node) => node.id === 's3-backups');

  assert.equal(paymentService?.metadata.demoData, true);
  assert.equal(paymentService?.metadata.instanceType, 'm5.large');
  assert.equal(paymentService?.metadata.drCostGroupKey, 'cluster:eks-prod');
  assert.equal(paymentDb?.metadata.dbInstanceClass, 'db.r5.large');
  assert.equal(paymentDb?.metadata.clusterId, 'payment-db-cluster');
  assert.equal(redisMain?.metadata.cacheNodeType, 'cache.r5.large');
  assert.equal(redisMain?.metadata.clusterId, 'redis-main-cluster');
  assert.equal(albProd?.metadata.estimatedLcu, 3.5);
  assert.equal(albProd?.metadata.drCostGroupKey, 'ingress:shopmax-edge-primary');
  assert.equal(backupsBucket?.metadata.estimatedStorageGB, 1500);
  assert.equal(backupsBucket?.metadata.drCostGroupKey, 'storage:backup-archive-program');
});

test('Large manufacturing demo infra adds multi-region + extended legacy', () => {
  const infrastructure = generateDemoInfrastructure({
    sector: 'manufacturing',
    companySize: 'large',
  });

  assert.ok(infrastructure.nodes.length >= 120);
  assert.ok(infrastructure.nodes.length <= 180);
  assert.deepEqual(getLayersForCompanySize('large'), [
    'core',
    'microservices',
    'resilience',
    'dr',
    'multi_region',
    'legacy_extended',
  ]);

  const nodeIds = new Set(infrastructure.nodes.map((node) => node.id));
  assert.equal(nodeIds.has('global-load-balancer'), true);
  assert.equal(nodeIds.has('azure-vnet'), true);
  assert.equal(nodeIds.has('onprem-legacy-db2'), true);
  assert.equal(infrastructure.spofNodeIds.includes('onprem-legacy-db2'), true);
  assert.equal(infrastructure.spofNodeIds.includes('partner-gateway'), true);

  const mainApp = infrastructure.nodes.find((node) => node.id === 'svc-main-app');
  assert.equal(mainApp?.name, 'mes-console');
});
