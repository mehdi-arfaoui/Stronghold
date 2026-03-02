import assert from 'node:assert/strict';
import test from 'node:test';

import { getDemoSeedGuard } from '../../src/demo/services/demoOnboardingService.ts';

test('getDemoSeedGuard blocks production', () => {
  const result = getDemoSeedGuard({ NODE_ENV: 'production' });
  assert.equal(result.allowed, false);
  assert.equal(result.mode, 'production');
});

test('getDemoSeedGuard allows development and test', () => {
  const developmentResult = getDemoSeedGuard({ NODE_ENV: 'development' });
  const testResult = getDemoSeedGuard({ NODE_ENV: 'test' });

  assert.equal(developmentResult.allowed, true);
  assert.equal(developmentResult.mode, 'development');
  assert.equal(testResult.allowed, true);
  assert.equal(testResult.mode, 'test');
});

test('getDemoSeedGuard allows explicit demo contexts outside development', () => {
  const stagingDemo = getDemoSeedGuard({
    NODE_ENV: 'staging',
    APP_ENV: 'demo',
  });
  assert.equal(stagingDemo.allowed, true);
  assert.equal(stagingDemo.mode, 'demo');

  const stagingFlag = getDemoSeedGuard({
    NODE_ENV: 'staging',
    ALLOW_DEMO_SEED: 'true',
  });
  assert.equal(stagingFlag.allowed, true);
  assert.equal(stagingFlag.mode, 'demo');

  const restricted = getDemoSeedGuard({ NODE_ENV: 'staging' });
  assert.equal(restricted.allowed, false);
  assert.equal(restricted.mode, 'restricted');
});
