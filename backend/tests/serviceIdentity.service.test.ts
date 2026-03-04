import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveServiceIdentity } from '../src/services/service-identity.service.ts';

test('service identity keeps manual business name override first', () => {
  const identity = resolveServiceIdentity({
    name: 'stronghold-terraform-db',
    businessName: 'Base de donnees principale',
    type: 'DATABASE',
    metadata: {},
  });

  assert.equal(identity.displayName, 'Base de donnees principale');
  assert.equal(identity.technicalName, 'stronghold-terraform-db');
  assert.equal(identity.source, 'manual_override');
});

test('service identity generates business-friendly names from technical patterns', () => {
  const db = resolveServiceIdentity({
    name: 'stronghold-terraform-db',
    type: 'DATABASE',
    metadata: { sourceType: 'RDS' },
  });
  const dlq = resolveServiceIdentity({
    name: 'stronghold-terraform-alerts-dlq',
    type: 'MESSAGE_QUEUE',
    metadata: { sourceType: 'SQS_QUEUE' },
  });
  const worker = resolveServiceIdentity({
    name: 'prod-order-processor',
    type: 'SERVERLESS',
    metadata: { sourceType: 'LAMBDA' },
  });

  assert.equal(db.displayName, 'Base de donnees principale');
  assert.equal(dlq.displayName, 'File DLQ alertes');
  assert.equal(worker.displayName, 'Worker commandes');
});
