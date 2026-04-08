import fs from 'node:fs';
import path from 'node:path';

import {
  allValidationRules,
  buildFindingKey,
  createGovernanceEditAuditEvent,
  createRiskAcceptanceAuditEvent,
  FileAuditLogger,
  logGovernanceAuditEvent,
  parseGovernanceConfig,
  type GovernanceConfig,
  type GovernancePolicyDefinition,
  type GovernanceRiskAcceptanceDefinition,
} from '@stronghold-dr/core';
import { Command } from 'commander';

import { resolveAuditIdentity, CommandAuditSession } from '../audit/command-audit.js';
import { ConfigurationError } from '../errors/cli-error.js';
import {
  renderGovernanceOverview,
  renderGovernanceTip,
  renderGovernanceValidation,
  type GovernanceValidationItem,
  type GovernanceValidationResult,
} from '../output/governance-renderer.js';
import { writeError, writeOutput } from '../output/io.js';
import { rebuildScanResults } from '../pipeline/rebuild-scan.js';
import type { ScanResults } from '../storage/file-store.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

const GOVERNANCE_TEMPLATE = `# Stronghold DR Governance
# This file defines organizational DR policies, service ownership, and risk acceptances.
# All entries are audited in .stronghold/audit.jsonl.

version: 1

# Service ownership
# ownership:
#   payment:
#     owner: team-backend
#     contact: backend-team@company.com
#     confirmed: true
#     confirmed_at: "2026-03-15T10:00:00Z"
#     review_cycle_days: 90

# Risk acceptances
# risk_acceptances:
#   - id: ra-001
#     finding_key: "rds_multi_az_active::payment-db"
#     accepted_by: jean.dupont@company.com
#     justification: "Staging environment - Multi-AZ is not cost-justified."
#     accepted_at: "2026-03-01T14:00:00Z"
#     expires_at: "2026-09-01T00:00:00Z"
#     severity_at_acceptance: high

# Custom DR policies
# policies:
#   - id: pol-001
#     name: "Critical services must have backup"
#     description: "All critical datastores must pass backup_plan_exists."
#     rule: backup_plan_exists
#     applies_to:
#       service_criticality: critical
#       resource_role: datastore
#     severity: critical
`;

const STRONGHOLD_GITIGNORE = `# Stronghold local state contains infrastructure-derived metadata.
*
!.gitignore
`;

const KNOWN_RULE_IDS = new Set(allValidationRules.map((rule) => rule.id));

export interface GovernanceAcceptParams {
  readonly governancePath: string;
  readonly auditLogPath: string;
  readonly scan: ScanResults;
  readonly findingKey: string;
  readonly acceptedBy: string;
  readonly justification: string;
  readonly expiresDays: number;
  readonly now?: Date;
}

export interface GovernanceAcceptResult {
  readonly acceptanceId: string;
  readonly expiresAt: string;
}

export function registerGovernanceCommand(program: Command): void {
  const governance = program
    .command('governance')
    .description('Inspect and manage DR governance state');

  governance.action(async (_, command: Command) => {
    const options = command.optsWithGlobals() as { readonly passphrase?: string };
    const audit = new CommandAuditSession('governance', {
      outputFormat: 'summary',
    });
    audit.setIdentityPromise(resolveAuditIdentity());
    await audit.start();

    try {
      const paths = resolveStrongholdPaths();
      if (!fs.existsSync(paths.governancePath)) {
        await writeOutput(renderGovernanceTip());
        await audit.finish({ status: 'success' });
        return;
      }

      const governanceConfig = loadGovernanceConfigStrict(paths.governancePath);
      const scan = await loadLatestEffectiveScan(options.passphrase);
      await writeOutput(renderGovernanceOverview(governanceConfig, scan));
      await audit.finish({
        status: 'success',
        ...(scan ? { resourceCount: scan.nodes.length } : {}),
      });
    } catch (error) {
      await audit.fail(error);
      throw error;
    }
  });

  governance
    .command('init')
    .description('Create .stronghold/governance.yml with a commented template')
    .action(async () => {
      const paths = resolveStrongholdPaths();
      await initGovernanceFile(paths.governancePath, paths.auditLogPath);
      await writeOutput(`Created governance template at ${paths.governancePath}.`);
    });

  governance
    .command('accept')
    .description('Accept a finding risk with justification and expiration')
    .requiredOption('--finding <key>', 'Finding key in ruleId::nodeId format')
    .requiredOption('--by <email>', 'Approver email or identifier')
    .requiredOption('--justification <text>', 'Why the risk is being accepted')
    .requiredOption('--expires <days>', 'Expiration in days from now')
    .action(
      async (
        options: {
          readonly finding: string;
          readonly by: string;
          readonly justification: string;
          readonly expires: string;
        },
        command: Command,
      ) => {
        const globals = command.optsWithGlobals() as { readonly passphrase?: string };
        const expiresDays = Number.parseInt(options.expires, 10);
        if (!Number.isInteger(expiresDays)) {
          throw new ConfigurationError('--expires must be an integer number of days.');
        }

        const scan = await requireLatestEffectiveScan(globals.passphrase);
        const paths = resolveStrongholdPaths();
        const result = await acceptGovernanceRisk({
          governancePath: paths.governancePath,
          auditLogPath: paths.auditLogPath,
          scan,
          findingKey: options.finding,
          acceptedBy: options.by,
          justification: options.justification,
          expiresDays,
        });

        await writeOutput(
          `Accepted ${options.finding} as ${result.acceptanceId} until ${result.expiresAt.slice(0, 10)}.`,
        );
      },
    );

  governance
    .command('validate')
    .description('Validate governance.yml against the latest scan')
    .action(async (_, command: Command) => {
      const options = command.optsWithGlobals() as { readonly passphrase?: string };
      const audit = new CommandAuditSession('governance_validate', {
        outputFormat: 'summary',
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const paths = resolveStrongholdPaths();
        const governanceConfig = loadGovernanceConfigStrict(paths.governancePath);
        const scan = await requireLatestEffectiveScan(options.passphrase);
        const result = validateGovernanceAgainstScan(governanceConfig, scan);
        await writeOutput(renderGovernanceValidation(result));
        if (!result.valid) {
          process.exitCode = 1;
        }
        await audit.finish({
          status: result.valid ? 'success' : 'failure',
          resourceCount: scan.nodes.length,
          ...(result.valid ? {} : { errorMessage: 'Governance validation reported errors.' }),
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}

export async function initGovernanceFile(
  governancePath: string,
  auditLogPath: string,
): Promise<void> {
  const targetPath = path.resolve(governancePath);
  if (fs.existsSync(targetPath)) {
    throw new ConfigurationError(`Governance file already exists at ${targetPath}.`);
  }

  ensureStrongholdDirectory(targetPath);
  fs.writeFileSync(targetPath, GOVERNANCE_TEMPLATE, 'utf8');
  await logAuditSafely(
    auditLogPath,
    createGovernanceEditAuditEvent(targetPath, 'Initialized governance template.'),
  );
}

export async function acceptGovernanceRisk(
  params: GovernanceAcceptParams,
): Promise<GovernanceAcceptResult> {
  if (!fs.existsSync(params.governancePath)) {
    throw new ConfigurationError(
      `No governance file found at ${path.resolve(params.governancePath)}. Run 'stronghold governance init' first.`,
    );
  }
  if (params.justification.trim().length === 0) {
    throw new ConfigurationError('--justification must not be empty.');
  }
  if (params.expiresDays < 30 || params.expiresDays > 365) {
    throw new ConfigurationError('--expires must be between 30 and 365 days.');
  }

  const now = params.now ?? new Date();
  const governanceConfig = loadGovernanceConfigStrict(params.governancePath);
  const finding = findGovernedFinding(params.scan, params.findingKey);
  if (!finding) {
    throw new ConfigurationError(
      `Finding "${params.findingKey}" was not found in the latest scan. Run 'stronghold scan' and try again.`,
    );
  }
  if ((finding.policyViolations?.length ?? 0) > 0) {
    const policyIds = finding.policyViolations?.map((violation) => violation.policyId).join(', ') ?? 'policy';
    throw new ConfigurationError(
      `This finding violates policy ${policyIds}. Risk acceptance requires removing the policy or fixing the finding.`,
    );
  }

  const existingAcceptance = params.scan.governance?.riskAcceptances.find(
    (acceptance) =>
      acceptance.findingKey === params.findingKey && acceptance.status === 'active',
  );
  if (existingAcceptance) {
    throw new ConfigurationError(
      `Finding "${params.findingKey}" already has an active acceptance (${existingAcceptance.id}).`,
    );
  }

  const acceptanceId = nextRiskAcceptanceId(governanceConfig.riskAcceptances);
  const acceptedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + params.expiresDays * 86_400_000).toISOString();
  const acceptance: GovernanceRiskAcceptanceDefinition = {
    id: acceptanceId,
    findingKey: params.findingKey,
    acceptedBy: params.acceptedBy.trim(),
    justification: params.justification.trim(),
    acceptedAt,
    expiresAt,
    severityAtAcceptance: finding.severity,
  };
  const updatedConfig: GovernanceConfig = {
    ...governanceConfig,
    riskAcceptances: [...governanceConfig.riskAcceptances, acceptance],
  };

  ensureStrongholdDirectory(params.governancePath);
  fs.writeFileSync(
    path.resolve(params.governancePath),
    `${serializeGovernanceConfig(updatedConfig)}\n`,
    'utf8',
  );
  await logAuditSafely(
    params.auditLogPath,
    createRiskAcceptanceAuditEvent({
      id: acceptance.id,
      findingKey: acceptance.findingKey,
      acceptedBy: acceptance.acceptedBy,
      justification: acceptance.justification,
      expiresAt: acceptance.expiresAt,
    }),
    acceptedAt,
  );
  await logAuditSafely(
    params.auditLogPath,
    createGovernanceEditAuditEvent(
      path.resolve(params.governancePath),
      `Added risk acceptance ${acceptance.id}.`,
    ),
    acceptedAt,
  );

  return {
    acceptanceId,
    expiresAt,
  };
}

export function validateGovernanceAgainstScan(
  governance: GovernanceConfig,
  scan: ScanResults,
  asOf = new Date(),
): GovernanceValidationResult {
  const serviceIds = new Set(scan.servicePosture?.services.map((service) => service.service.id) ?? []);
  const findingKeys = new Set(
    (scan.servicePosture?.contextualFindings ?? []).map((finding) =>
      buildFindingKey(finding.ruleId, finding.nodeId),
    ),
  );
  const acceptancesById = new Map(
    (scan.governance?.riskAcceptances ?? []).map((acceptance) => [acceptance.id, acceptance] as const),
  );
  const ownership: GovernanceValidationItem[] = Object.entries(governance.ownership)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([serviceId, entry]) => ({
      status: serviceIds.has(serviceId) ? 'ok' : 'error',
      label: serviceId,
      message: serviceIds.has(serviceId)
        ? `owner "${entry.owner}" exists in services`
        : `service "${serviceId}" not found in the latest scan`,
    }));
  const riskAcceptances: GovernanceValidationItem[] = governance.riskAcceptances.map((acceptance) => {
    const currentAcceptance = acceptancesById.get(acceptance.id);
    if (!findingKeys.has(acceptance.findingKey)) {
      return {
        status: 'error',
        label: acceptance.id,
        message: `finding key "${acceptance.findingKey}" does not match any finding`,
      } as const;
    }
    if (Date.parse(acceptance.expiresAt) <= asOf.getTime()) {
      return {
        status: 'error',
        label: acceptance.id,
        message: 'acceptance EXPIRED',
      } as const;
    }
    if (currentAcceptance?.status === 'superseded') {
      return {
        status: 'error',
        label: acceptance.id,
        message: 'acceptance SUPERSEDED',
      } as const;
    }
    return {
      status: 'ok',
      label: acceptance.id,
      message: 'finding exists, acceptance is active',
    } as const;
  });
  const policies: GovernanceValidationItem[] = governance.policies.map((policy) => ({
    status: KNOWN_RULE_IDS.has(policy.rule) ? 'ok' : 'warn',
    label: policy.id,
    message: KNOWN_RULE_IDS.has(policy.rule)
      ? `rule "${policy.rule}" exists`
      : `rule "${policy.rule}" not found in validation engine`,
  }));
  const valid = [...ownership, ...riskAcceptances, ...policies].every(
    (item) => item.status !== 'error',
  );

  return {
    ownership,
    riskAcceptances,
    policies,
    valid,
  };
}

function loadGovernanceConfigStrict(filePath: string): GovernanceConfig {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new ConfigurationError(
      `No governance file found at ${resolvedPath}. Run 'stronghold governance init' first.`,
    );
  }

  try {
    const contents = fs.readFileSync(resolvedPath, 'utf8');
    return parseGovernanceConfig(contents, { filePath: resolvedPath });
  } catch (error) {
    throw new ConfigurationError(
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}

async function loadLatestEffectiveScan(passphrase: string | undefined): Promise<ScanResults | null> {
  const paths = resolveStrongholdPaths();
  const preferredPath = resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);
  if (!fs.existsSync(preferredPath)) {
    return null;
  }

  const scan = await loadScanResultsWithEncryption(preferredPath, { passphrase });
  return rebuildScanResults(scan);
}

async function requireLatestEffectiveScan(passphrase: string | undefined): Promise<ScanResults> {
  const scan = await loadLatestEffectiveScan(passphrase);
  if (!scan) {
    throw new ConfigurationError(
      `No latest scan artifact found. Run 'stronghold scan' before using governance commands.`,
    );
  }
  return scan;
}

function ensureStrongholdDirectory(governancePath: string): void {
  const rootDir = path.dirname(path.resolve(governancePath));
  fs.mkdirSync(rootDir, { recursive: true });
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, STRONGHOLD_GITIGNORE, 'utf8');
  }
}

function nextRiskAcceptanceId(
  acceptances: readonly GovernanceRiskAcceptanceDefinition[],
): string {
  const numericIds = acceptances
    .map((acceptance) => acceptance.id.match(/^ra-(\d+)$/)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));
  const nextValue = (numericIds.length > 0 ? Math.max(...numericIds) : 0) + 1;
  return `ra-${String(nextValue).padStart(3, '0')}`;
}

function findGovernedFinding(scan: ScanResults, findingKey: string) {
  return scan.servicePosture?.contextualFindings.find(
    (finding) => buildFindingKey(finding.ruleId, finding.nodeId) === findingKey,
  );
}

async function logAuditSafely(
  auditLogPath: string,
  event: ReturnType<typeof createGovernanceEditAuditEvent> | ReturnType<typeof createRiskAcceptanceAuditEvent>,
  timestamp = new Date().toISOString(),
): Promise<void> {
  try {
    await logGovernanceAuditEvent(new FileAuditLogger(auditLogPath), event, { timestamp });
  } catch (error) {
    writeError(`Warning: failed to write audit log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function serializeGovernanceConfig(governance: GovernanceConfig): string {
  const lines = [`version: ${governance.version}`];

  const ownershipEntries = Object.entries(governance.ownership).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (ownershipEntries.length > 0) {
    lines.push('', 'ownership:');
    ownershipEntries.forEach(([serviceId, entry]) => {
      lines.push(`  ${serviceId}:`);
      lines.push(`    owner: ${yamlString(entry.owner)}`);
      if (entry.contact) {
        lines.push(`    contact: ${yamlString(entry.contact)}`);
      }
      lines.push(`    confirmed: ${entry.confirmed ? 'true' : 'false'}`);
      if (entry.confirmedAt) {
        lines.push(`    confirmed_at: ${yamlString(entry.confirmedAt)}`);
      }
      lines.push(`    review_cycle_days: ${entry.reviewCycleDays}`);
    });
  }

  if (governance.riskAcceptances.length > 0) {
    lines.push('', 'risk_acceptances:');
    governance.riskAcceptances.forEach((acceptance) => {
      lines.push(`  - id: ${yamlString(acceptance.id)}`);
      lines.push(`    finding_key: ${yamlString(acceptance.findingKey)}`);
      lines.push(`    accepted_by: ${yamlString(acceptance.acceptedBy)}`);
      lines.push(`    justification: ${yamlString(acceptance.justification)}`);
      lines.push(`    accepted_at: ${yamlString(acceptance.acceptedAt)}`);
      lines.push(`    expires_at: ${yamlString(acceptance.expiresAt)}`);
      lines.push(`    severity_at_acceptance: ${acceptance.severityAtAcceptance}`);
      if (acceptance.reviewNotes !== undefined) {
        lines.push(`    review_notes: ${yamlString(acceptance.reviewNotes)}`);
      }
    });
  }

  if (governance.policies.length > 0) {
    lines.push('', 'policies:');
    governance.policies.forEach((policy) => {
      lines.push(...serializePolicy(policy));
    });
  }

  return lines.join('\n');
}

function serializePolicy(policy: GovernancePolicyDefinition): readonly string[] {
  const lines = [
    `  - id: ${yamlString(policy.id)}`,
    `    name: ${yamlString(policy.name)}`,
    `    description: ${yamlString(policy.description)}`,
    `    rule: ${yamlString(policy.rule)}`,
    '    applies_to:',
  ];

  if (policy.appliesTo.serviceCriticality) {
    lines.push(`      service_criticality: ${policy.appliesTo.serviceCriticality}`);
  }
  if (policy.appliesTo.resourceRole) {
    lines.push(`      resource_role: ${policy.appliesTo.resourceRole}`);
  }
  if (policy.appliesTo.serviceId) {
    lines.push(`      service_id: ${yamlString(policy.appliesTo.serviceId)}`);
  }
  if (policy.appliesTo.tag) {
    lines.push('      tag:');
    lines.push(`        key: ${yamlString(policy.appliesTo.tag.key)}`);
    lines.push(`        value: ${yamlString(policy.appliesTo.tag.value)}`);
  }
  lines.push(`    severity: ${policy.severity}`);

  return lines;
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
