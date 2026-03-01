import assert from 'node:assert/strict';
import test from 'node:test';

import { RunbookGeneratorService } from '../src/services/runbook-generator.service.ts';

test('generateFromSimulation builds a contextual database-failure runbook ordered by propagation', () => {
  const generated = RunbookGeneratorService.generateFromSimulation({
    simulation: {
      id: 'sim-db-1',
      name: 'Database failure dry-run',
      scenarioType: 'database_failure',
      scenarioParams: { region: 'eu-west-1' } as any,
      result: {
        directlyAffected: [{ id: 'db-primary', name: 'db-primary', type: 'DATABASE' }],
        cascadeImpacted: [{ id: 'payment-api', name: 'payment-api', type: 'APPLICATION' }],
        businessImpact: [{ estimatedRPO: 15 }],
        metrics: { estimatedDowntimeMinutes: 45 },
        warRoomData: {
          propagationTimeline: [
            {
              timestampMinutes: 0,
              delaySeconds: 0,
              nodeId: 'db-primary',
              nodeName: 'db-primary',
              nodeType: 'DATABASE',
              impactType: 'initial_failure',
              impactSeverity: 'critical',
              edgeType: 'dependency',
              parentNodeId: null,
              parentNodeName: null,
              description: 'Database primary offline',
            },
            {
              timestampMinutes: 5,
              delaySeconds: 300,
              nodeId: 'payment-api',
              nodeName: 'payment-api',
              nodeType: 'APPLICATION',
              impactType: 'direct_cascade',
              impactSeverity: 'major',
              edgeType: 'depends_on',
              parentNodeId: 'db-primary',
              parentNodeName: 'db-primary',
              description: 'API lost database connectivity',
            },
          ],
        },
      } as any,
      createdAt: new Date('2026-02-20T10:00:00.000Z'),
    },
    impactedNodes: [
      { id: 'db-primary', name: 'db-primary', type: 'DATABASE', provider: 'aws', region: 'eu-west-1', availabilityZone: 'eu-west-1a', metadata: { tier: 1 } as any },
      { id: 'payment-api', name: 'payment-api', type: 'APPLICATION', provider: 'aws', region: 'eu-west-1', availabilityZone: 'eu-west-1a', metadata: { tier: 1 } as any },
    ],
  });

  assert.equal(generated.context.scenarioType, 'database_failure');
  assert.deepEqual(
    Array.from(new Set(generated.steps.map((step) => step.phase))),
    ['detection', 'containment', 'recovery', 'validation', 'communication'],
  );

  const recoverySteps = generated.steps.filter((step) => step.phase === 'recovery');
  assert.equal(recoverySteps[0]?.serviceId, 'db-primary');
  assert.equal(recoverySteps[1]?.serviceId, 'payment-api');
  assert.equal(recoverySteps[1]?.prerequisites.includes(recoverySteps[0]?.id || ''), true);
  assert.match(recoverySteps[0]?.title || '', /Basculer/i);
});

test('generateFromSimulation adapts ransomware containment and recovery guidance', () => {
  const generated = RunbookGeneratorService.generateFromSimulation({
    simulation: {
      id: 'sim-ransom-1',
      name: 'Ransomware drill',
      scenarioType: 'ransomware',
      scenarioParams: { withBackupsCompromised: false } as any,
      result: {
        directlyAffected: [{ id: 'vm-1', name: 'vm-1', type: 'VM' }],
        cascadeImpacted: [],
        businessImpact: [{ estimatedRPO: 60 }],
        metrics: { estimatedDowntimeMinutes: 120 },
        warRoomData: {
          propagationTimeline: [
            {
              timestampMinutes: 0,
              delaySeconds: 0,
              nodeId: 'vm-1',
              nodeName: 'vm-1',
              nodeType: 'VM',
              impactType: 'initial_failure',
              impactSeverity: 'critical',
              edgeType: 'network_access',
              parentNodeId: null,
              parentNodeName: null,
              description: 'VM encrypted',
            },
          ],
        },
      } as any,
      createdAt: new Date('2026-02-20T10:00:00.000Z'),
    },
    impactedNodes: [
      { id: 'vm-1', name: 'vm-1', type: 'VM', provider: 'aws', region: 'eu-west-1', availabilityZone: 'eu-west-1a', metadata: {} as any },
    ],
  });

  const containment = generated.steps.find((step) => step.phase === 'containment');
  const recovery = generated.steps.find((step) => step.phase === 'recovery');

  assert.match(containment?.description || '', /reseau|secrets|geler/i);
  assert.match(recovery?.description || '', /source saine|restaurer|reprovisionner/i);
  assert.equal(recovery?.assignee, 'Security Operations');
});
