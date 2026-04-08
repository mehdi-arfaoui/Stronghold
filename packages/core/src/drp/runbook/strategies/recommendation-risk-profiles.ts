import { registerRunbookStrategy } from '../strategy-registry.js';

const noop = () => {
  throw new Error('Recommendation-only risk profiles do not generate runbooks.');
};

registerRunbookStrategy('recommendation-backup-plan', '*', {
  generate: noop,
  executionRisk: 'safe',
  riskReason: 'Backup plan and lifecycle changes are additive and do not require downtime.',
});

registerRunbookStrategy('recommendation-cloudwatch-alarm', '*', {
  generate: noop,
  executionRisk: 'safe',
  riskReason: 'Monitoring changes are additive and safe to apply during normal operations.',
});

registerRunbookStrategy('recommendation-elb-setting', 'cross-zone', {
  generate: noop,
  executionRisk: 'safe',
  riskReason: 'Cross-zone balancing is an additive resilience change and does not require downtime.',
});

registerRunbookStrategy('recommendation-elb-setting', 'health-check', {
  generate: noop,
  executionRisk: 'caution',
  riskReason: 'Health-check tuning can change traffic flow and should be planned before rollout.',
});

registerRunbookStrategy('recommendation-elb-setting', 'multi-az', {
  generate: noop,
  executionRisk: 'caution',
  riskReason: 'Adding AZ coverage to a load balancer changes networking and should be reviewed first.',
});

registerRunbookStrategy('recommendation-sqs-queue', 'dlq', {
  generate: noop,
  executionRisk: 'safe',
  riskReason: 'Dead-letter queues are additive and do not interrupt queue processing.',
});

registerRunbookStrategy('recommendation-vpc-topology', '*', {
  generate: noop,
  executionRisk: 'dangerous',
  riskReason: 'Subnet and NAT topology changes affect foundational networking and require explicit approval.',
});
