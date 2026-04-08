import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { InfraNode } from '../../validation/validation-types.js';
import { loadManualServices, parseManualServices } from '../services-loader.js';
import type { Service } from '../service-types.js';

describe('loadManualServices', () => {
  it('returns null when the services file does not exist', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-services-'));

    expect(loadManualServices([], { filePath: path.join(directory, 'missing.yml') })).toBeNull();
  });
});

describe('parseManualServices', () => {
  it('parses a valid services file and resolves glob patterns', () => {
    const result = parseManualServices(
      `
version: 1
services:
  payment:
    name: Payment Service
    criticality: critical
    owner: team-backend
    resources:
      - arn:aws:rds:eu-west-1:*:db:payment-*
      - arn:aws:lambda:eu-west-1:*:function:payment-*
`,
      [
        createNode('arn:aws:rds:eu-west-1:123456789012:db:payment-db', 'DATABASE', 'rds'),
        createNode(
          'arn:aws:lambda:eu-west-1:123456789012:function:payment-api',
          'SERVERLESS',
          'lambda',
        ),
      ],
    );

    expect(result.services).toHaveLength(1);
    expect(result.services[0]?.resources).toHaveLength(2);
    expect(result.services[0]?.owner).toBe('team-backend');
  });

  it('warns when a glob pattern matches no resources', () => {
    const result = parseManualServices(
      `
version: 1
services:
  payment:
    name: Payment Service
    criticality: critical
    resources:
      - arn:aws:sqs:eu-west-1:*:payment-queue
`,
      [createNode('arn:aws:rds:eu-west-1:123456789012:db:payment-db', 'DATABASE', 'rds')],
    );

    expect(result.warnings).toContain(
      'Pattern "arn:aws:sqs:eu-west-1:*:payment-queue" in service "payment" matched no resources.',
    );
  });

  it('errors when a resource matches multiple services', () => {
    expect(() =>
      parseManualServices(
        `
version: 1
services:
  payment:
    name: Payment Service
    criticality: critical
    resources:
      - arn:aws:rds:eu-west-1:*:db:payment-db
  billing:
    name: Billing Service
    criticality: high
    resources:
      - arn:aws:rds:eu-west-1:*:db:payment-db
`,
        [createNode('arn:aws:rds:eu-west-1:123456789012:db:payment-db', 'DATABASE', 'rds')],
      ),
    ).toThrow(/matches multiple services/);
  });

  it('flags new resources matched by glob patterns compared with the previous assignment', () => {
    const previousAssignments: Service[] = [
      {
        id: 'payment',
        name: 'Payment Service',
        criticality: 'critical',
        detectionSource: {
          type: 'manual',
          file: '.stronghold/services.yml',
          confidence: 1.0,
        },
        resources: [
          {
            nodeId: 'arn:aws:lambda:eu-west-1:123456789012:function:payment-api',
            detectionSource: {
              type: 'manual',
              file: '.stronghold/services.yml',
              confidence: 1.0,
            },
          },
        ],
        metadata: {},
      },
    ];

    const result = parseManualServices(
      `
version: 1
services:
  payment:
    name: Payment Service
    criticality: critical
    resources:
      - arn:aws:lambda:eu-west-1:*:function:payment-*
`,
      [
        createNode(
          'arn:aws:lambda:eu-west-1:123456789012:function:payment-api',
          'SERVERLESS',
          'lambda',
        ),
        createNode(
          'arn:aws:lambda:eu-west-1:123456789012:function:payment-refund',
          'SERVERLESS',
          'lambda',
        ),
      ],
      { previousAssignments },
    );

    expect(result.newMatches).toEqual([
      {
        serviceId: 'payment',
        serviceName: 'Payment Service',
        resourceIds: ['arn:aws:lambda:eu-west-1:123456789012:function:payment-refund'],
      },
    ]);
  });
});

function createNode(id: string, type: string, sourceType: string): InfraNode {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: null,
    tags: {},
    metadata: { sourceType },
  };
}
