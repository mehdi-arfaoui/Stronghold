import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WarRoom } from './WarRoom';
import type { SimulationResult } from '@/types/simulation.types';

const mockResult: SimulationResult = {
  nodesDown: 3,
  nodesDegraded: 0,
  nodesHealthy: 81,
  infrastructureImpact: 3.6,
  estimatedDowntime: 10,
  financialLoss: 1200,
  resilienceScoreBefore: 100,
  resilienceScoreAfter: 72,
  affectedNodes: [
    { nodeId: 'db-primary', nodeName: 'db-primary', nodeType: 'DATABASE', status: 'down', cascadeLevel: 0 },
    { nodeId: 'api-gateway', nodeName: 'api-gateway', nodeType: 'APPLICATION', status: 'down', cascadeLevel: 1 },
    { nodeId: 'frontend', nodeName: 'frontend', nodeType: 'LOAD_BALANCER', status: 'down', cascadeLevel: 2 },
  ],
  impactedServices: [
    { serviceName: 'Checkout API', impact: 'total', estimatedRTO: 15 },
    { serviceName: 'Web', impact: 'degraded', estimatedRTO: 20 },
  ],
  recommendations: [
    {
      id: 'rec-1',
      priority: 'P0',
      title: 'Activer Multi-AZ sur RDS',
      description: 'Ajoute une base secondaire',
      action: 'Activer Multi-AZ',
      estimatedRto: 2,
      affectedNodes: ['db-primary'],
      category: 'failover',
      effort: 'medium',
    },
  ],
  blastRadiusMetrics: {
    totalNodesImpacted: 3,
    totalNodesInGraph: 84,
    impactPercentage: 3.6,
    criticalServicesImpacted: 2,
    estimatedDowntimeMinutes: 10,
    propagationDepth: 2,
    recoveryComplexity: 'medium',
  },
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
        edgeType: 'initial',
        parentNodeId: null,
        parentNodeName: null,
        description: 'Database principale indisponible.',
      },
      {
        timestampMinutes: 0.07,
        delaySeconds: 4,
        nodeId: 'api-gateway',
        nodeName: 'api-gateway',
        nodeType: 'APPLICATION',
        impactType: 'direct_cascade',
        impactSeverity: 'major',
        edgeType: 'database_connection',
        parentNodeId: 'db-primary',
        parentNodeName: 'db-primary',
        description: 'Pool de connexions epuise.',
      },
      {
        timestampMinutes: 0.17,
        delaySeconds: 10,
        nodeId: 'frontend',
        nodeName: 'frontend',
        nodeType: 'LOAD_BALANCER',
        impactType: 'indirect_cascade',
        impactSeverity: 'minor',
        edgeType: 'api_call',
        parentNodeId: 'api-gateway',
        parentNodeName: 'api-gateway',
        description: 'Timeout API apres 10s.',
      },
    ],
    impactedNodes: [
      { id: 'db-primary', name: 'db-primary', type: 'DATABASE', status: 'down', impactedAt: 0, impactedAtSeconds: 0, estimatedRecovery: 10 },
      { id: 'api-gateway', name: 'api-gateway', type: 'APPLICATION', status: 'down', impactedAt: 0.07, impactedAtSeconds: 4, estimatedRecovery: 12 },
      { id: 'frontend', name: 'frontend', type: 'LOAD_BALANCER', status: 'down', impactedAt: 0.17, impactedAtSeconds: 10, estimatedRecovery: 15 },
    ],
    remediationActions: [
      { id: 'act-1', title: 'Basculer la base secondaire', status: 'pending', priority: 'P0' },
    ],
  },
  warRoomFinancial: {
    hourlyDowntimeCost: 720,
    recoveryCostEstimate: 180,
    projectedBusinessLoss: 1200,
    totalDurationSeconds: 10,
    totalDurationMinutes: 0.17,
    costConfidence: 'approximate',
    costConfidenceLabel: 'Estimation approximative',
    biaCoverageRatio: 0.33,
    trackedNodeCount: 3,
    cumulativeLossTimeline: [
      { timestampMinutes: 0, timestampSeconds: 0, cumulativeBusinessLoss: 0, activeHourlyCost: 500 },
      { timestampMinutes: 0.07, timestampSeconds: 4, cumulativeBusinessLoss: 0.56, activeHourlyCost: 700 },
      { timestampMinutes: 0.17, timestampSeconds: 10, cumulativeBusinessLoss: 1.72, activeHourlyCost: 720 },
    ],
    nodeCostBreakdown: [
      {
        nodeId: 'db-primary',
        nodeName: 'db-primary',
        nodeType: 'DATABASE',
        costPerHour: 500,
        totalCost: 1.39,
        recoveryCost: 80,
        rtoMinutes: 10,
        downtimeMinutes: 0.17,
        downtimeSeconds: 10,
        impactedAtSeconds: 0,
        costSource: 'bia_configured',
        costSourceLabel: 'BIA configure',
        recoveryStrategy: 'warm_standby',
        monthlyDrCost: 40,
        recoveryActivationFactor: 0.4,
      },
      {
        nodeId: 'api-gateway',
        nodeName: 'api-gateway',
        nodeType: 'APPLICATION',
        costPerHour: 150,
        totalCost: 0.25,
        recoveryCost: 60,
        rtoMinutes: 12,
        downtimeMinutes: 0.1,
        downtimeSeconds: 6,
        impactedAtSeconds: 4,
        costSource: 'infra_estimated',
        costSourceLabel: 'Estimation infra',
        recoveryStrategy: 'pilot_light',
        monthlyDrCost: 15,
        recoveryActivationFactor: 0.8,
      },
    ],
  },
  cascadeSteps: [
    { step: 1, description: 'api-gateway', nodesAffected: ['api-gateway'] },
    { step: 2, description: 'frontend', nodesAffected: ['frontend'] },
  ],
};

describe('WarRoom', () => {
  it('supports timeline scrubbing, filtered journal and summary rendering', () => {
    render(
      <WarRoom
        open
        onClose={() => undefined}
        scenarioName="Panne base primaire"
        scenarioType="database_failure"
        result={mockResult}
        currency="EUR"
      />,
    );

    expect(screen.getAllByText('T+0:00').length).toBeGreaterThan(0);
    expect(screen.getByText('Database principale indisponible.')).toBeInTheDocument();
    expect(screen.queryByText('Pool de connexions epuise.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Timeline'), { target: { value: '7' } });

    expect(screen.getAllByText('T+0:07').length).toBeGreaterThan(0);
    expect(screen.getByText('Pool de connexions epuise.')).toBeInTheDocument();
    expect(screen.queryByText('Timeout API apres 10s.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Timeline'), { target: { value: '10' } });

    expect(screen.getByText('Resume de la simulation')).toBeInTheDocument();
    expect(screen.getByText('Activer Multi-AZ sur RDS')).toBeInTheDocument();
    expect(screen.getByText('BIA configure')).toBeInTheDocument();
    expect(screen.getByText('Estimation infra')).toBeInTheDocument();
  });
});
