import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GovernanceConfigValidationError,
  loadGovernanceConfig,
  parseGovernanceConfig,
} from '../index.js';

describe('loadGovernanceConfig', () => {
  it('returns null when the governance file does not exist', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-governance-'));

    expect(loadGovernanceConfig(path.join(directory, 'missing.yml'))).toBeNull();
  });

  it('warns and returns null for invalid yaml', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-governance-'));
    const filePath = path.join(directory, 'governance.yml');
    const warnings: string[] = [];

    fs.writeFileSync(filePath, 'version: 1\nownership: [broken', 'utf8');

    const config = loadGovernanceConfig(filePath, {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(config).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Invalid Stronghold governance config');
  });

  it('warns when a risk acceptance is already expired at load time', () => {
    const warnings: string[] = [];

    const config = loadGovernanceConfigFromString(
      `
version: 1
risk_acceptances:
  - id: ra-001
    finding_key: backup_plan_exists::payment-db
    accepted_by: mehdi@example.com
    justification: Temporary acceptance for testing
    accepted_at: "2026-01-01T00:00:00Z"
    expires_at: "2026-01-15T00:00:00Z"
    severity_at_acceptance: high
`,
      {
        asOf: new Date('2026-04-08T00:00:00Z'),
        onWarning: (warning) => warnings.push(warning),
      },
    );

    expect(config?.riskAcceptances).toHaveLength(1);
    expect(warnings).toEqual([
      expect.stringContaining('risk acceptance "ra-001" is already expired'),
    ]);
  });

  it('warns when a policy references an unknown rule id', () => {
    const warnings: string[] = [];

    const config = loadGovernanceConfigFromString(
      `
version: 1
policies:
  - id: pol-001
    name: Unknown rule policy
    description: This policy references a missing rule
    rule: imaginary_rule
    applies_to:
      resource_role: datastore
    severity: high
`,
      {
        onWarning: (warning) => warnings.push(warning),
      },
    );

    expect(config?.policies).toHaveLength(1);
    expect(warnings).toEqual([
      expect.stringContaining('references unknown rule "imaginary_rule"'),
    ]);
  });
});

describe('parseGovernanceConfig', () => {
  it('loads a valid governance config', () => {
    const config = parseGovernanceConfig(`
version: 1
ownership:
  payment:
    owner: team-backend
    contact: backend-team@example.com
    confirmed: true
    confirmed_at: "2026-03-15T10:00:00Z"
    review_cycle_days: 120
risk_acceptances:
  - id: ra-001
    finding_key: rds_multi_az_active::payment-db
    accepted_by: mehdi@example.com
    justification: Staging environment
    accepted_at: "2026-03-01T14:00:00Z"
    expires_at: "2026-09-01T00:00:00Z"
    severity_at_acceptance: high
policies:
  - id: pol-001
    name: Critical services must have backup
    description: Critical datastores must pass backup plan checks
    rule: backup_plan_exists
    applies_to:
      service_criticality: critical
      resource_role: datastore
    severity: critical
`);

    expect(config.ownership.payment).toEqual({
      owner: 'team-backend',
      contact: 'backend-team@example.com',
      confirmed: true,
      confirmedAt: '2026-03-15T10:00:00Z',
      reviewCycleDays: 120,
    });
    expect(config.riskAcceptances[0]?.findingKey).toBe('rds_multi_az_active::payment-db');
    expect(config.policies[0]?.appliesTo).toEqual({
      serviceCriticality: 'critical',
      resourceRole: 'datastore',
    });
  });

  it('loads a minimal governance config with empty sections', () => {
    const config = parseGovernanceConfig('version: 1');

    expect(config).toEqual({
      version: 1,
      ownership: {},
      riskAcceptances: [],
      policies: [],
    });
  });

  it('validates finding key format', () => {
    expect(() =>
      parseGovernanceConfig(`
version: 1
risk_acceptances:
  - id: ra-001
    finding_key: invalid-key
    accepted_by: mehdi@example.com
    justification: invalid
    accepted_at: "2026-03-01T14:00:00Z"
    expires_at: "2026-09-01T00:00:00Z"
    severity_at_acceptance: high
`),
    ).toThrow(GovernanceConfigValidationError);
  });
});

function loadGovernanceConfigFromString(
  contents: string,
  options: {
    readonly asOf?: Date;
    readonly onWarning?: (warning: string) => void;
  } = {},
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-governance-'));
  const filePath = path.join(directory, 'governance.yml');
  fs.writeFileSync(filePath, contents, 'utf8');
  return loadGovernanceConfig(filePath, options);
}
