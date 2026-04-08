import { describe, expect, it } from 'vitest';
import type { Service, ServicePosture, ServicePostureService } from '@stronghold-dr/core';

import {
  renderDetectedServices,
  renderServiceDetail,
  renderServicesList,
  renderServicesYaml,
} from '../commands/services.js';

describe('services command renderers', () => {
  it('renders detection results grouped by strategy', () => {
    const rendered = renderDetectedServices({
      services: [
        createService('payment', 'Payment', 'cloudformation', ['db-1', 'lambda-1']),
        createService('monitoring', 'Monitoring', 'tag', ['alarm-1']),
        createService('cluster-1', 'cluster-1', 'topology', ['ec2-1', 'ec2-2']),
      ],
      unassignedResources: ['orphan-1'],
      detectionSummary: {
        cloudformation: 1,
        tag: 1,
        topology: 1,
        manual: 0,
        totalResources: 6,
        assignedResources: 5,
        unassignedResources: 1,
      },
    });

    expect(rendered).toContain('Via CloudFormation (1)');
    expect(rendered).toContain('Via tags (1)');
    expect(rendered).toContain('Via topology (1)');
    expect(rendered).toContain('Unassigned: 1 resources');
  });

  it('renders a merged services list with governance ownership status', () => {
    const rendered = renderServicesList(createPosture([
      createServicePosture('payment', 'Payment', 'manual', ['db-1', 'lambda-1'], {
        owner: 'team-backend',
        criticality: 'critical',
        governance: {
          owner: 'team-backend',
          ownerStatus: 'confirmed',
        },
      }),
    ]));

    expect(rendered).toContain('owner: team-backend ✓');
    expect(rendered).toContain('source: manual');
  });

  it('renders service details and YAML output', () => {
    const service = {
      ...createService('payment', 'Payment', 'manual', ['db-1', 'lambda-1']),
      owner: 'team-backend',
      criticality: 'critical',
    };

    expect(renderServiceDetail(createServicePosture('payment', 'Payment', 'manual', ['db-1', 'lambda-1'], {
      owner: 'team-backend',
      criticality: 'critical',
      governance: {
        owner: 'team-backend',
        ownerStatus: 'review_due',
      },
    }))).toContain('Owner: team-backend ⚠ review due');
    expect(renderServicesYaml([service])).toContain('payment:');
    expect(renderServicesYaml([service])).toContain('- db-1');
  });
});

function createService(
  id: string,
  name: string,
  detectionType: 'cloudformation' | 'tag' | 'topology' | 'manual',
  resourceIds: readonly string[],
): Service {
  const detectionSource =
    detectionType === 'cloudformation'
      ? { type: 'cloudformation', stackName: name, confidence: 0.9 as const }
      : detectionType === 'tag'
        ? { type: 'tag', key: 'service', value: name, confidence: 0.75 as const }
        : detectionType === 'topology'
          ? { type: 'topology', algorithm: 'connected-components', confidence: 0.45 as const }
          : { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 as const };

  return {
    id,
    name,
    criticality: 'medium',
    detectionSource,
    resources: resourceIds.map((resourceId) => ({
      nodeId: resourceId,
      detectionSource,
    })),
    metadata: {},
  };
}

function createServicePosture(
  id: string,
  name: string,
  detectionType: 'cloudformation' | 'tag' | 'topology' | 'manual',
  resourceIds: readonly string[],
  options: {
    readonly owner?: string;
    readonly criticality?: Service['criticality'];
    readonly governance?: Service['governance'];
  } = {},
): ServicePostureService {
  const service = {
    ...createService(id, name, detectionType, resourceIds),
    ...(options.owner ? { owner: options.owner } : {}),
    ...(options.criticality ? { criticality: options.criticality } : {}),
    ...(options.governance ? { governance: options.governance } : {}),
  };

  return {
    service,
    score: {
      serviceId: service.id,
      serviceName: service.name,
      resourceCount: service.resources.length,
      criticality: service.criticality,
      ...(service.owner ? { owner: service.owner } : {}),
      detectionSource: service.detectionSource,
      score: 34,
      grade: 'D',
      findingsCount: {
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
      },
      findings: [],
      coverageGaps: ['Backup coverage is incomplete for this service.'],
    },
    contextualFindings: [],
    recommendations: [],
  };
}

function createPosture(services: readonly ServicePostureService[]): ServicePosture {
  return {
    detection: {
      services: services.map((service) => service.service),
      unassignedResources: ['orphan-1'],
      detectionSummary: {
        cloudformation: 0,
        tag: 0,
        topology: 0,
        manual: services.length,
        totalResources: services.reduce((count, service) => count + service.service.resources.length, 0) + 1,
        assignedResources: services.reduce((count, service) => count + service.service.resources.length, 0),
        unassignedResources: 1,
      },
    },
    scoring: {
      services: services.map((service) => service.score),
      unassigned: null,
    },
    contextualFindings: [],
    recommendations: [],
    services,
    unassigned: {
      score: null,
      resourceCount: 1,
      contextualFindings: [],
      recommendations: [],
    },
  };
}
