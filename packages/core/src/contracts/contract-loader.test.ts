import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isChainCoverageSufficient,
  isEvidenceSufficient,
  loadContracts,
  parseContractsYaml,
} from './index.js';

describe('loadContracts', () => {
  describe('file not found', () => {
    it('returns not_found for missing file', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-contracts-'));
      const result = await loadContracts(path.join(directory, 'contracts.yml'));

      expect(result.status).toBe('not_found');
    });
  });

  describe('invalid YAML', () => {
    it('returns invalid for malformed YAML', () => {
      const result = parseContractsYaml('{ invalid yaml :::');

      expect(result.status).toBe('invalid');
    });
  });

  describe('schema validation', () => {
    it('rejects missing version', () => {
      const result = parseContractsYaml('contracts: []');

      expect(result.status).toBe('invalid');
    });

    it('rejects missing contracts key', () => {
      const result = parseContractsYaml('version: "1"');

      expect(result.status).toBe('invalid');
    });

    it('rejects contract without service', () => {
      const yaml = `
version: "1"
contracts:
  - requirements:
      - scenario: az-failure
        evidence: observed
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('rejects contract without requirements', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('rejects empty requirements array', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    requirements: []
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('rejects requirement with only scenario', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    requirements:
      - scenario: az-failure
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('rejects unknown enforcement level', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    enforcement: explode
    requirements:
      - scenario: az-failure
        evidence: observed
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('rejects old hook enforcement level', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    enforcement: hook
    requirements:
      - scenario: az-failure
        evidence: observed
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('rejects old singular hook config', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    hook:
      type: webhook
      url: https://example.com/hook
      on: [violated]
    requirements:
      - scenario: az-failure
        evidence: observed
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('rejects scalar hooks on value', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    hooks:
      - type: webhook
        url: https://example.com/hook
        on: violated
    requirements:
      - scenario: az-failure
        evidence: observed
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('rejects unknown evidence level', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    requirements:
      - scenario: az-failure
        evidence: legendary
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('rejects additional properties', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    magic: true
    requirements:
      - scenario: az-failure
        evidence: observed
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });

    it('accepts an empty contracts array', () => {
      const result = parseContractsYaml(`
version: "1"
contracts: []
`);

      expect(result.status).toBe('loaded');
      if (result.status === 'loaded') {
        expect(result.config.contracts).toEqual([]);
      }
    });
  });

  describe('duration validation', () => {
    it('rejects invalid RTO duration', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    requirements:
      - scenario: az-failure
        rto: "abc"
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.errors[0]).toContain('duration');
      }
    });

    it('rejects invalid RPO duration', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    requirements:
      - scenario: az-failure
        rpo: "0h"
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('invalid');
    });
  });

  describe('valid contracts', () => {
    it('loads minimal contract', () => {
      const yaml = `
version: "1"
contracts:
  - service: "*"
    requirements:
      - scenario: "*"
        evidence: observed
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('loaded');
      if (result.status === 'loaded') {
        const contract = result.config.contracts[0];
        const requirement = contract?.requirements[0];
        expect(result.config.contracts).toHaveLength(1);
        expect(contract?.service).toBe('*');
        expect(contract?.enforcement).toBe('warn');
        expect(contract?.hooks).toEqual([]);
        expect(requirement?.evidence).toBe('observed');
        expect(requirement?.rto).toBeNull();
      }
    });

    it('loads full contract with all dimensions', () => {
      const yaml = `
version: "1"
contracts:
  - service: payment-processing
    description: "PCI-DSS DR requirements"
    owner: platform-team
    enforcement: enforce
    requirements:
      - scenario: region-failure
        rto: 1h
        rpo: 5m
        evidence: tested
        chain_coverage: proven
        spof: none
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('loaded');
      if (result.status === 'loaded') {
        const contract = result.config.contracts[0];
        const requirement = contract?.requirements[0];
        expect(contract?.enforcement).toBe('enforce');
        expect(contract?.description).toBe('PCI-DSS DR requirements');
        expect(requirement?.rto?.totalMs).toBe(3_600_000);
        expect(requirement?.rpo?.totalMs).toBe(300_000);
        expect(requirement?.evidence).toBe('tested');
        expect(requirement?.chainCoverage).toBe('proven');
        expect(requirement?.spof).toBe('none');
      }
    });

    it('loads contract with hook', () => {
      const yaml = `
version: "1"
contracts:
  - service: auth
    enforcement: enforce
    hooks:
      - type: webhook
        url: https://hooks.slack.com/services/T00/B00/xxx
        on: [violated]
    requirements:
      - scenario: az-failure
        rto: 5m
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('loaded');
      if (result.status === 'loaded') {
        const hook = result.config.contracts[0]?.hooks[0];
        expect(hook).toBeDefined();
        expect(hook?.type).toBe('webhook');
        expect(hook?.url).toContain('hooks.slack.com');
        expect(hook?.on).toEqual(['violated']);
      }
    });

    it('loads hooks without explicit enforcement using warn by default', () => {
      const yaml = `
version: "1"
contracts:
  - service: auth
    hooks:
      - type: webhook
        url: https://hooks.slack.com/services/T00/B00/xxx
        on: [violated]
    requirements:
      - scenario: az-failure
        rto: 5m
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('loaded');
      if (result.status === 'loaded') {
        expect(result.config.contracts[0]?.enforcement).toBe('warn');
        expect(result.config.contracts[0]?.hooks).toHaveLength(1);
      }
    });

    it('loads enforce without hooks', () => {
      const yaml = `
version: "1"
contracts:
  - service: auth
    enforcement: enforce
    requirements:
      - scenario: az-failure
        rto: 5m
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('loaded');
      if (result.status === 'loaded') {
        expect(result.config.contracts[0]?.enforcement).toBe('enforce');
        expect(result.config.contracts[0]?.hooks).toEqual([]);
      }
    });

    it('loads multiple contracts', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    requirements:
      - scenario: az-failure
        rto: 5m
  - service: analytics
    requirements:
      - scenario: region-failure
        rto: 24h
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('loaded');
      if (result.status === 'loaded') {
        expect(result.config.contracts).toHaveLength(2);
      }
    });

    it('converts snake_case YAML to camelCase types', () => {
      const yaml = `
version: "1"
contracts:
  - service: payments
    requirements:
      - scenario: az-failure
        chain_coverage: proven
`;
      const result = parseContractsYaml(yaml);

      expect(result.status).toBe('loaded');
      if (result.status === 'loaded') {
        expect(result.config.contracts[0]?.requirements[0]?.chainCoverage).toBe('proven');
      }
    });

    it('loads from a real file', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-contracts-'));
      const filePath = path.join(directory, 'contracts.yml');
      fs.writeFileSync(
        filePath,
        `
version: "1"
contracts:
  - service: payments
    requirements:
      - scenario: az-failure
        evidence: observed
`,
        'utf8',
      );

      const result = await loadContracts(filePath);

      expect(result.status).toBe('loaded');
    });
  });

  describe('all 5 ADR examples', () => {
    it('parses ADR example 1 - minimal', () => {
      expectLoaded(ADR_EXAMPLE_1);
    });

    it('parses ADR example 2 - compliance-driven fintech', () => {
      expectLoaded(ADR_EXAMPLE_2);
    });

    it('parses ADR example 3 - tiered requirements', () => {
      expectLoaded(ADR_EXAMPLE_3);
    });

    it('parses ADR example 4 - with hook', () => {
      expectLoaded(ADR_EXAMPLE_4);
    });

    it('parses ADR example 5 - glob pattern', () => {
      expectLoaded(ADR_EXAMPLE_5);
    });
  });
});

describe('evidence and chain_coverage ordering', () => {
  it('tested > declared > observed > inferred', () => {
    expect(isEvidenceSufficient('tested', 'tested')).toBe(true);
    expect(isEvidenceSufficient('tested', 'observed')).toBe(true);
    expect(isEvidenceSufficient('observed', 'tested')).toBe(false);
    expect(isEvidenceSufficient('inferred', 'observed')).toBe(false);
  });

  it('proven > observed > partial', () => {
    expect(isChainCoverageSufficient('proven', 'proven')).toBe(true);
    expect(isChainCoverageSufficient('proven', 'observed')).toBe(true);
    expect(isChainCoverageSufficient('observed', 'proven')).toBe(false);
    expect(isChainCoverageSufficient('partial', 'observed')).toBe(false);
  });
});

function expectLoaded(yaml: string): void {
  const result = parseContractsYaml(yaml);

  expect(result.status).toBe('loaded');
}

const ADR_EXAMPLE_1 = `
version: "1"
contracts:
  - service: "*"
    description: "All services must have at least observed evidence"
    enforcement: warn
    requirements:
      - scenario: "*"
        evidence: observed
`;

const ADR_EXAMPLE_2 = `
version: "1"
contracts:
  - service: payment-processing
    description: "PCI-DSS requires proven recovery within 1h"
    owner: platform-team
    enforcement: enforce
    requirements:
      - scenario: region-failure
        rto: 1h
        rpo: 5m
        evidence: tested
        chain_coverage: proven
        spof: none
      - scenario: data-corruption
        rpo: 1m
        evidence: tested
`;

const ADR_EXAMPLE_3 = `
version: "1"
contracts:
  - service: checkout
    enforcement: enforce
    requirements:
      - scenario: az-failure
        rto: 5m
        chain_coverage: proven
      - scenario: region-failure
        rto: 1h
        chain_coverage: observed
      - scenario: data-corruption
        rpo: 15m
        evidence: tested
`;

const ADR_EXAMPLE_4 = `
version: "1"
contracts:
  - service: user-auth
    enforcement: enforce
    hooks:
      - type: webhook
        url: https://hooks.slack.com/services/T00/B00/xxx
        on: [violated]
    requirements:
      - scenario: az-failure
        rto: 5m
        spof: none
`;

const ADR_EXAMPLE_5 = `
version: "1"
contracts:
  - service: "payment-*"
    description: "All payment services must meet baseline DR"
    enforcement: enforce
    requirements:
      - scenario: az-failure
        evidence: observed
        chain_coverage: observed
      - scenario: region-failure
        evidence: tested
        chain_coverage: proven
        spof: none
`;
