export interface DemoServiceSeed {
  key: string;
  name: string;
  type: string;
  criticality: string;
  owner: string;
  linkedNodeId: string;
  businessPriority?: string;
  description?: string;
}

export interface DemoIncidentActionSeed {
  actionType: string;
  description: string;
  minutesAgo: number;
}

export interface DemoIncidentSeed {
  key: string;
  title: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  detectedHoursAgo: number;
  responsibleTeam: string;
  serviceKeys: string[];
  affectedNodeIds: string[];
  actions: DemoIncidentActionSeed[];
}

export interface DemoSimulationSeed {
  key: string;
  name: string;
  scenarioType: 'custom' | 'third_party_outage' | 'region_loss';
  fallbackNodeIds: string[];
}

export const DEMO_SERVICE_SEEDS: ReadonlyArray<DemoServiceSeed> = [
  {
    key: 'checkout_gateway',
    name: 'Checkout Gateway',
    type: 'APPLICATION',
    criticality: 'HIGH',
    owner: 'Platform Team',
    linkedNodeId: 'svc-api-gateway',
    businessPriority: 'P1',
    description: 'Entry point for checkout traffic and payment orchestration.',
  },
  {
    key: 'payment_api',
    name: 'Payment API',
    type: 'APPLICATION',
    criticality: 'HIGH',
    owner: 'Payments Team',
    linkedNodeId: 'svc-payment',
    businessPriority: 'P1',
    description: 'Processes card and wire payment requests.',
  },
  {
    key: 'order_management',
    name: 'Order Management',
    type: 'APPLICATION',
    criticality: 'HIGH',
    owner: 'Orders Team',
    linkedNodeId: 'svc-order',
    businessPriority: 'P1',
    description: 'Creates and tracks order lifecycle.',
  },
  {
    key: 'identity_service',
    name: 'Identity Service',
    type: 'APPLICATION',
    criticality: 'MEDIUM',
    owner: 'Identity Team',
    linkedNodeId: 'svc-user',
    businessPriority: 'P2',
    description: 'Handles account onboarding and authentication.',
  },
];

export const DEMO_INCIDENT_SEEDS: ReadonlyArray<DemoIncidentSeed> = [
  {
    key: 'payment_db_latency',
    title: 'High latency on payment path',
    description:
      'Payment transactions are delayed due to saturation on payment-db and increased retry traffic.',
    status: 'IN_PROGRESS',
    detectedHoursAgo: 5,
    responsibleTeam: 'Payments Team',
    serviceKeys: ['checkout_gateway', 'payment_api'],
    affectedNodeIds: ['svc-api-gateway', 'svc-payment', 'db-payment'],
    actions: [
      {
        actionType: 'CREATED',
        description: 'Incident opened by monitoring alert after latency threshold breach.',
        minutesAgo: 290,
      },
      {
        actionType: 'TRIAGED',
        description: 'Database contention confirmed on payment-db write path.',
        minutesAgo: 210,
      },
      {
        actionType: 'MITIGATION_STARTED',
        description: 'Read-only traffic shifted and queue backpressure enabled.',
        minutesAgo: 120,
      },
    ],
  },
  {
    key: 'erp_sync_backlog',
    title: 'Order to ERP synchronization degraded',
    description:
      'Order export jobs to legacy ERP are delayed after on-prem server instability.',
    status: 'RESOLVED',
    detectedHoursAgo: 32,
    responsibleTeam: 'Operations Team',
    serviceKeys: ['order_management'],
    affectedNodeIds: ['svc-order', 'erp-server', 'erp-db'],
    actions: [
      {
        actionType: 'CREATED',
        description: 'Synchronization backlog detected during overnight processing.',
        minutesAgo: 1800,
      },
      {
        actionType: 'MITIGATED',
        description: 'ERP service restarted and backlog replay completed.',
        minutesAgo: 1560,
      },
      {
        actionType: 'CLOSED',
        description: 'Business impact cleared and monitoring back to baseline.',
        minutesAgo: 1500,
      },
    ],
  },
];

export const DEMO_SIMULATION_SEEDS: ReadonlyArray<DemoSimulationSeed> = [
  {
    key: 'checkout_custom_failover',
    name: 'Checkout failover dry-run',
    scenarioType: 'custom',
    fallbackNodeIds: ['svc-api-gateway', 'svc-payment', 'db-payment'],
  },
  {
    key: 'stripe_provider_outage',
    name: 'Third-party outage on payment provider',
    scenarioType: 'third_party_outage',
    fallbackNodeIds: ['stripe-api', 'svc-payment'],
  },
];

export const DEMO_RUNBOOK_KEY = 'primary_recovery';
export const DEMO_PRA_EXERCISE_KEY = 'quarterly_failover';
