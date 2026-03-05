import { describe, expect, it } from 'vitest';
import type { InfraNode } from '@/types/graph.types';
import {
  buildDiscoveryNodeTooltip,
  getDiscoveryNodeDomain,
  getDiscoveryNodeSearchText,
  getDiscoveryNodeTier,
  matchesCriticalityFilter,
  resolveDiscoveryNodeLabels,
} from './discovery-graph';

function node(partial: Partial<InfraNode>): InfraNode {
  return {
    id: partial.id || 'n-1',
    name: partial.name || 'technical-name',
    type: partial.type || 'VM',
    metadata: partial.metadata,
    provider: partial.provider,
    region: partial.region,
    businessName: partial.businessName,
    displayName: partial.displayName,
    technicalName: partial.technicalName,
    criticality: partial.criticality,
    isSPOF: partial.isSPOF,
    blastRadius: partial.blastRadius,
  };
}

describe('discovery-graph', () => {
  it('prioritizes business naming cascade for node labels', () => {
    expect(
      resolveDiscoveryNodeLabels(
        node({
          businessName: 'Paiement API',
          displayName: 'Display Name',
          technicalName: 'tech-payment-api',
          metadata: { tags: { Name: 'TagName' } },
        }),
      ).fullLabel,
    ).toBe('Paiement API');

    expect(
      resolveDiscoveryNodeLabels(
        node({
          displayName: 'Display Name',
          technicalName: 'tech-payment-api',
          metadata: { tags: { Name: 'TagName' } },
        }),
      ).fullLabel,
    ).toBe('TagName');
  });

  it('extracts domain and tier consistently', () => {
    expect(getDiscoveryNodeDomain(node({ type: 'APPLICATION' }))).toBe('application');
    expect(getDiscoveryNodeDomain(node({ type: 'VM' }))).toBe('platform');
    expect(getDiscoveryNodeDomain(node({ type: 'DATABASE' }))).toBe('foundation');
    expect(getDiscoveryNodeDomain(node({ type: 'VPC' }))).toBe('network');

    expect(getDiscoveryNodeTier(node({ metadata: { tier: 2 } }))).toBe(2);
    expect(getDiscoveryNodeTier(node({ metadata: { recoveryTier: 4 } }))).toBe(4);
    expect(getDiscoveryNodeTier(node({ metadata: { recoveryTier: 99 } }))).toBeNull();
  });

  it('supports criticality filters', () => {
    expect(matchesCriticalityFilter(85, 'high')).toBe(true);
    expect(matchesCriticalityFilter(50, 'medium')).toBe(true);
    expect(matchesCriticalityFilter(10, 'low')).toBe(true);
    expect(matchesCriticalityFilter(undefined, 'unknown')).toBe(true);
    expect(matchesCriticalityFilter(10, 'high')).toBe(false);
  });

  it('builds search text and tooltip from discovery metadata', () => {
    const current = node({
      id: 'srv-1',
      name: 'orders-api-prod-001',
      displayName: 'Orders API',
      technicalName: 'orders-api',
      provider: 'aws',
      region: 'eu-west-1',
      criticality: 88,
      metadata: {
        tags: { Name: 'OrdersService' },
        rto: '30m',
        rpo: '5m',
        services: ['billing', 'checkout'],
      },
    });

    const searchText = getDiscoveryNodeSearchText(current);
    expect(searchText).toContain('ordersservice');
    expect(searchText).toContain('orders-api-prod-001');

    const tooltip = buildDiscoveryNodeTooltip(current);
    expect(tooltip).toContain('Type: VM');
    expect(tooltip).toContain('RTO: 30m');
    expect(tooltip).toContain('RPO: 5m');
    expect(tooltip).toContain('Services associes: billing, checkout');
  });
});
