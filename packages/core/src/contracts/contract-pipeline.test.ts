import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ContractHook, ContractHookPayload } from './hooks/hook-types.js';
import {
  buildContractEvaluationInput,
  runContractEvaluation,
  type PipelineEvidence,
  type PipelineResult,
} from './contract-pipeline.js';
import type { ContractHookConfig } from './contract-types.js';

describe('buildContractEvaluationInput', () => {
  it('assembles evaluator input from a complete pipeline result', () => {
    const pipelineResult = pipeline({
      evidence: [evidence({ id: 'manual-rto', measuredRTO: 45 })],
      validationReport: {
        results: [
          {
            evidence: [evidence({
              id: 'validation-rpo',
              measuredRPO: 4,
              subject: { nodeId: PAYMENT_NODE },
            })],
          },
        ],
      },
    });

    const input = buildContractEvaluationInput(pipelineResult);

    expect(input.services).toEqual([
      { serviceId: 'svc-payment', serviceName: 'payment-processing' },
    ]);
    expect(input.evidenceByService.get('svc-payment')).toHaveLength(2);
    expect(input.scenarioCoverage.get('az_failure')?.[0]?.verdict).toBe('covered');
    expect(input.proofOfRecovery.get('svc-payment')?.hasTestedEvidence).toBe(true);
    expect(input.spofsByService.get('svc-payment')?.[0]?.nodeArn).toBe(SPOF_NODE);
  });

  it('uses empty maps when optional pipeline data is missing', () => {
    const input = buildContractEvaluationInput({
      timestamp: '2026-06-14T00:00:00.000Z',
    });

    expect(input.services).toEqual([]);
    expect(input.evidenceByService.size).toBe(0);
    expect(input.scenarioCoverage.size).toBe(0);
    expect(input.proofOfRecovery.size).toBe(0);
    expect(input.spofsByService.size).toBe(0);
  });
});

describe('runContractEvaluation', () => {
  it('returns null when contracts file is absent', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-contract-pipeline-'));

    const result = await runContractEvaluation({
      contractsPath: path.join(directory, 'contracts.yml'),
      pipelineResult: pipeline(),
    });

    expect(result).toBeNull();
  });

  it('calls a hook when the contract verdict matches its trigger', async () => {
    const hook = new RecordingHook();
    const result = await runContractEvaluation({
      contractsPath: writeContracts(`
version: "1"
contracts:
  - service: payment-processing
    enforcement: enforce
    hooks:
      - type: webhook
        url: https://example.com/hook
        on: [violated]
    requirements:
      - scenario: az-failure
        rto: 1h
`),
      pipelineResult: pipeline({
        evidence: [evidence({ measuredRTO: 90 })],
      }),
      hookImplementation: hook,
      strongholdVersion: '2.0.0',
    });

    expect(result?.hasEnforceableViolations).toBe(true);
    expect(result?.hooksFired).toHaveLength(1);
    expect(hook.calls).toHaveLength(1);
    expect(hook.calls[0]?.payload.contract.verdict).toBe('violated');
  });

  it('does not call hooks when hooks are disabled', async () => {
    const hook = new RecordingHook();
    const result = await runContractEvaluation({
      contractsPath: writeContracts(`
version: "1"
contracts:
  - service: payment-processing
    hooks:
      - type: webhook
        url: https://example.com/hook
        on: [violated]
    requirements:
      - scenario: az-failure
        rto: 1h
`),
      pipelineResult: pipeline({
        evidence: [evidence({ measuredRTO: 90 })],
      }),
      hookImplementation: hook,
      disableHooks: true,
    });

    expect(result?.hooksFired).toEqual([]);
    expect(hook.calls).toEqual([]);
  });

  it('does not call a hook when the verdict does not match its trigger', async () => {
    const hook = new RecordingHook();
    const result = await runContractEvaluation({
      contractsPath: writeContracts(`
version: "1"
contracts:
  - service: payment-processing
    hooks:
      - type: webhook
        url: https://example.com/hook
        on: [met]
    requirements:
      - scenario: az-failure
        rto: 1h
`),
      pipelineResult: pipeline({
        evidence: [evidence({ measuredRTO: 90 })],
      }),
      hookImplementation: hook,
    });

    expect(result?.hooksFired).toEqual([]);
    expect(hook.calls).toEqual([]);
  });

  it('sends hook payloads without sensitive infrastructure identifiers', async () => {
    const hook = new RecordingHook();
    await runContractEvaluation({
      contractsPath: writeContracts(`
version: "1"
contracts:
  - service: payment-processing
    hooks:
      - type: webhook
        url: https://example.com/hook
        on: [violated]
    requirements:
      - scenario: az-failure
        spof: none
`),
      pipelineResult: pipeline({
        analysis: {
          spofs: [
            {
              nodeId: 'arn:aws:rds:eu-west-1:123456789012:db:payment-db',
              impactedServices: ['svc-payment'],
            },
          ],
        },
      }),
      hookImplementation: hook,
    });

    const payload = JSON.stringify(hook.calls[0]?.payload);
    expect(payload).not.toContain('arn:aws');
    expect(payload).not.toContain('123456789012');
    expect(payload).toContain('RDS instance (payment-db)');
  });
});

const PAYMENT_NODE = 'arn:aws:lambda:eu-west-1:111122223333:function:payment-api';
const SPOF_NODE = 'arn:aws:rds:eu-west-1:111122223333:db:payment-db';

class RecordingHook implements ContractHook {
  public readonly calls: {
    readonly config: ContractHookConfig;
    readonly payload: ContractHookPayload;
  }[] = [];

  public async fire(config: ContractHookConfig, payload: ContractHookPayload): Promise<void> {
    this.calls.push({ config, payload });
  }
}

function pipeline(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    timestamp: '2026-06-14T00:00:00.000Z',
    servicePosture: {
      detection: {
        services: [
          {
            id: 'svc-payment',
            name: 'payment-processing',
            resources: [{ nodeId: PAYMENT_NODE }, { nodeId: SPOF_NODE }],
          },
        ],
      },
    },
    scenarioAnalysis: {
      scenarios: [
        {
          id: 'az-failure-eu-west-1a',
          name: 'AZ failure - eu-west-1a',
          type: 'az_failure',
          coverage: {
            details: [
              {
                serviceId: 'svc-payment',
                verdict: 'covered',
                evidenceLevel: 'tested',
                missingCapabilities: [],
              },
            ],
          },
        },
      ],
    },
    proofOfRecovery: {
      perService: [
        {
          serviceId: 'svc-payment',
          hasTestedEvidence: true,
          hasObservedEvidence: true,
          testedRuleCount: 1,
          totalRuleCount: 1,
        },
      ],
    },
    analysis: {
      spofs: [
        {
          nodeId: SPOF_NODE,
          impactedServices: ['svc-payment'],
        },
      ],
    },
    validationReport: { results: [] },
    ...overrides,
  };
}

function evidence(overrides: Partial<PipelineEvidence> = {}): PipelineEvidence {
  return {
    id: 'evidence-1',
    type: 'tested',
    source: {
      origin: 'test',
      testType: 'restore-drill',
      testDate: '2026-06-01T00:00:00.000Z',
    },
    subject: {
      nodeId: PAYMENT_NODE,
      serviceId: 'svc-payment',
    },
    observation: {
      key: 'scenario',
      value: 'az_failure',
    },
    timestamp: '2026-06-01T00:00:00.000Z',
    measuredRTO: 30,
    measuredRPO: 2,
    ...overrides,
  };
}

function writeContracts(contents: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-contract-pipeline-'));
  const filePath = path.join(directory, 'contracts.yml');
  fs.writeFileSync(filePath, `${contents.trim()}\n`, 'utf8');
  return filePath;
}
