import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { Command } from 'commander';
import {
  EVIDENCE_TYPES,
  FileEvidenceStore,
  checkFreshness,
  parseDuration,
  parseManualServices,
  type Evidence,
  type EvidenceStore,
  type EvidenceType,
  type InfraNode,
} from '@stronghold-dr/core';

import {
  CommandAuditSession,
  collectAuditFlags,
} from '../audit/command-audit.js';
import { ConfigurationError } from '../errors/cli-error.js';
import { writeOutput } from '../output/io.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

const DEFAULT_TEST_EVIDENCE_EXPIRY_DAYS = 90;

interface EvidenceAddCommandOptions {
  readonly node?: string;
  readonly type: string;
  readonly result: 'success' | 'failure' | 'partial';
  readonly duration?: string;
  readonly notes?: string;
  readonly description?: string;
  readonly service?: string;
  readonly scenario?: string;
  readonly rto?: string;
  readonly rpo?: string;
  readonly expires?: number;
  readonly author?: string;
  readonly passphrase?: string;
}

export function registerEvidenceCommand(program: Command): void {
  const evidence = program.command('evidence').description('Manage manual DR evidence');

  evidence
    .command('add')
    .description('Register the result of a manual DR test')
    .option('--node <id>', 'Resource identifier (ARN or Stronghold resource ID)')
    .requiredOption('--type <string>', 'Evidence type (tested|observed|declared|inferred) or legacy test type')
    .option('--result <result>', 'Test outcome: success|failure|partial', parseEvidenceResult, 'success')
    .option('--duration <string>', 'Test duration, for example "12 minutes"')
    .option('--notes <string>', 'Freeform notes about the test')
    .option('--description <string>', 'Description of the evidence')
    .option('--service <id>', 'Service this evidence applies to')
    .option('--scenario <name>', 'DR scenario this evidence applies to')
    .option('--rto <duration>', 'Measured RTO, for example 45m or 1h')
    .option('--rpo <duration>', 'Measured RPO, for example 2m or 30s')
    .option(
      '--expires <days>',
      'Expiration in days (default: 90)',
      parsePositiveInteger,
    )
    .option('--author <string>', 'Who performed the test')
    .action(async (_: unknown, command: Command) => {
      const options = command.optsWithGlobals() as EvidenceAddCommandOptions;
      const audit = new CommandAuditSession('evidence_add', {
        outputFormat: 'summary',
        ...(collectAuditFlags({
          '--duration': Boolean(options.duration),
          '--notes': Boolean(options.notes),
          '--description': Boolean(options.description),
          '--service': Boolean(options.service),
          '--scenario': Boolean(options.scenario),
          '--rto': Boolean(options.rto),
          '--rpo': Boolean(options.rpo),
          '--expires': options.expires !== undefined,
          '--author': Boolean(options.author),
        })
          ? {
              flags: collectAuditFlags({
                '--duration': Boolean(options.duration),
                '--notes': Boolean(options.notes),
                '--description': Boolean(options.description),
                '--service': Boolean(options.service),
                '--scenario': Boolean(options.scenario),
                '--rto': Boolean(options.rto),
                '--rpo': Boolean(options.rpo),
                '--expires': options.expires !== undefined,
                '--author': Boolean(options.author),
              }),
            }
          : {}),
      });
      await audit.start();

      try {
        const paths = resolveStrongholdPaths();
        const store = new FileEvidenceStore(paths.evidencePath);
        const evidenceType = resolveEvidenceType(options.type);
        const measuredRTO = parseMeasuredDurationOption('--rto', options.rto);
        const measuredRPO = parseMeasuredDurationOption('--rpo', options.rpo);
        if ((measuredRTO !== undefined || measuredRPO !== undefined) && evidenceType !== 'tested') {
          throw new ConfigurationError('measured RTO/RPO requires --type tested');
        }
        if (!options.node && !options.service) {
          throw new ConfigurationError('evidence add requires --node or --service.');
        }
        const serviceId =
          (options.service
            ? await resolveServiceIdForName(options.service, {
                passphrase: options.passphrase,
              })
            : null) ??
          (await resolveServiceIdForNode(options.node, {
            passphrase: options.passphrase,
          }));
        const executor = await resolveEvidenceAuthor(options.author);
        const evidenceEntry = await addEvidenceEntry({
          store,
          nodeId: options.node ?? `service:${serviceId ?? options.service ?? 'unknown'}`,
          serviceId,
          evidenceType,
          testType: resolveTestType(options.type, options.scenario),
          result: options.result,
          duration: options.duration,
          notes: options.description ?? options.notes,
          scenario: options.scenario,
          measuredRTO,
          measuredRPO,
          expiresInDays: options.expires,
          executor,
        });

        await writeOutput(renderEvidenceRegistered(evidenceEntry));
        await audit.finish({
          status: 'success',
          resourceCount: 1,
        });
      } catch (error) {
        await audit.fail(error, 1);
        throw error;
      }
    });

  evidence
    .command('list')
    .description('List registered evidence entries')
    .action(async () => {
      const audit = new CommandAuditSession('evidence_list', {
        outputFormat: 'summary',
      });
      await audit.start();

      try {
        const store = new FileEvidenceStore(resolveStrongholdPaths().evidencePath);
        const entries = await store.getAll();
        await writeOutput(renderEvidenceList(entries));
        await audit.finish({
          status: 'success',
          resourceCount: entries.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });

  evidence
    .command('show <id>')
    .description('Show the details of a specific evidence entry')
    .action(async (id: string) => {
      const audit = new CommandAuditSession('evidence_show', {
        outputFormat: 'summary',
      });
      await audit.start();

      try {
        const store = new FileEvidenceStore(resolveStrongholdPaths().evidencePath);
        const evidenceEntry = (await store.getAll()).find((entry) => entry.id === id);
        if (!evidenceEntry) {
          throw new ConfigurationError(`Evidence "${id}" was not found.`);
        }

        await writeOutput(renderEvidenceDetail(evidenceEntry));
        await audit.finish({
          status: 'success',
          resourceCount: 1,
        });
      } catch (error) {
        await audit.fail(error, 1);
        throw error;
      }
    });
}

export async function addEvidenceEntry(input: {
  readonly store: EvidenceStore;
  readonly nodeId: string;
  readonly evidenceType?: EvidenceType;
  readonly testType: string;
  readonly result: 'success' | 'failure' | 'partial';
  readonly duration?: string;
  readonly notes?: string;
  readonly scenario?: string;
  readonly measuredRTO?: number;
  readonly measuredRPO?: number;
  readonly serviceId?: string | null;
  readonly expiresInDays?: number;
  readonly executor: string;
  readonly now?: Date;
}): Promise<Evidence> {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const expiresInDays = input.expiresInDays ?? DEFAULT_TEST_EVIDENCE_EXPIRY_DAYS;
  const expiresAt = addDays(now, expiresInDays).toISOString();
  const evidenceType = input.evidenceType ?? 'tested';

  const evidence: Evidence = {
    id: randomUUID(),
    type: evidenceType,
    source: evidenceType === 'tested'
      ? {
          origin: 'test',
          testType: input.testType,
          testDate: timestamp,
        }
      : {
          origin: 'manual',
          author: input.executor,
        },
    subject: {
      nodeId: input.nodeId,
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
    },
    observation: {
      key: input.scenario ? 'scenario' : input.testType,
      value: input.scenario
        ? {
            scenario: input.scenario,
            result: input.result,
            testType: input.testType,
          }
        : input.result,
      expected: 'success',
      description: input.notes ?? `Manual ${input.testType} recorded as ${input.result}.`,
    },
    timestamp,
    expiresAt,
    ...(input.scenario ? { scenario: input.scenario } : {}),
    ...(input.measuredRTO !== undefined ? { measuredRTO: input.measuredRTO } : {}),
    ...(input.measuredRPO !== undefined ? { measuredRPO: input.measuredRPO } : {}),
    testResult: {
      status: input.result,
      ...(input.duration ? { duration: input.duration } : {}),
      ...(input.measuredRTO !== undefined ? { measuredRTO: input.measuredRTO } : {}),
      ...(input.measuredRPO !== undefined ? { measuredRPO: input.measuredRPO } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      executor: input.executor,
    },
  };

  await input.store.add(evidence);
  return evidence;
}

export async function resolveServiceIdForNode(
  nodeId: string | undefined,
  options: {
    readonly passphrase?: string;
  } = {},
): Promise<string | null> {
  if (!nodeId) {
    return null;
  }

  const paths = resolveStrongholdPaths();
  const scanPath = resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);

  try {
    if (fs.existsSync(scanPath)) {
      const scan = await loadScanResultsWithEncryption(scanPath, {
        passphrase: options.passphrase,
      });
      const serviceFromScan = scan.servicePosture?.detection.services.find((service) =>
        service.resources.some((resource) => resource.nodeId === nodeId),
      );
      if (serviceFromScan) {
        return serviceFromScan.id;
      }
    }
  } catch {
    // Evidence can be registered without a prior scan.
  }

  if (!fs.existsSync(paths.servicesPath)) {
    return null;
  }

  try {
    const contents = fs.readFileSync(paths.servicesPath, 'utf8');
    const parsed = parseManualServices(contents, [createSyntheticNode(nodeId)], {
      filePath: paths.servicesPath,
    });
    return (
      parsed.services.find((service) => service.resources.some((resource) => resource.nodeId === nodeId))
        ?.id ?? null
    );
  } catch {
    return null;
  }
}

export async function resolveServiceIdForName(
  serviceName: string,
  options: {
    readonly passphrase?: string;
  } = {},
): Promise<string | null> {
  const paths = resolveStrongholdPaths();
  const scanPath = resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);

  try {
    if (fs.existsSync(scanPath)) {
      const scan = await loadScanResultsWithEncryption(scanPath, {
        passphrase: options.passphrase,
      });
      const serviceFromScan = scan.servicePosture?.detection.services.find(
        (service) => service.id === serviceName || service.name === serviceName,
      );
      if (serviceFromScan) {
        return serviceFromScan.id;
      }
    }
  } catch {
    return serviceName;
  }

  return serviceName;
}

export function renderEvidenceRegistered(evidence: Evidence): string {
  const lines = ['Evidence registered:'];
  lines.push(`  Type: ${evidence.type} (${evidence.source.origin === 'test' ? evidence.source.testType : evidence.observation.key})`);
  lines.push(`  Resource: ${shortResourceLabel(evidence.subject.nodeId)}`);
  lines.push(`  Service: ${evidence.subject.serviceId ?? 'none'}`);
  lines.push(
    `  Result: ${evidence.testResult?.status ?? 'n/a'}${evidence.testResult?.duration ? ` (${evidence.testResult.duration})` : ''}`,
  );
  lines.push(`  ${capitalize(formatFreshness(evidence, new Date(evidence.timestamp)))}`);
  lines.push('');
  lines.push(
    evidence.subject.serviceId
      ? `This evidence will improve the DR posture score for service "${evidence.subject.serviceId}".`
      : 'This evidence will improve the DR posture score once the resource is associated to a service.',
  );
  lines.push(`Run 'stronghold scan' to see the updated score.`);
  return lines.join('\n');
}

export function renderEvidenceList(
  evidence: readonly Evidence[],
  asOf: Date = new Date(),
): string {
  const sorted = [...evidence].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const lines = [`Evidence (${sorted.length}):`, ''];

  if (sorted.length === 0) {
    lines.push(`Run 'stronghold evidence add' to register new test results.`);
    return lines.join('\n');
  }

  for (const entry of sorted) {
    const freshness = formatFreshness(entry, asOf);
    lines.push(
      `  ${entry.type.padEnd(8)} ${shortResourceLabel(entry.subject.nodeId).padEnd(16)} ${(entry.source.origin === 'test' ? entry.source.testType : entry.observation.key).padEnd(15)} ${(entry.testResult?.status ?? 'n/a').padEnd(9)} ${(entry.testResult?.duration ?? '-').padEnd(10)} ${freshness}`,
    );
  }

  lines.push('');
  lines.push(`Run 'stronghold evidence add' to register new test results.`);
  return lines.join('\n');
}

export function renderEvidenceDetail(
  evidence: Evidence,
  asOf: Date = new Date(),
): string {
  const lines = [
    `Evidence: ${evidence.id}`,
    `  Type: ${evidence.type}`,
    `  Source: ${renderEvidenceSource(evidence)}`,
    `  Resource: ${evidence.subject.nodeId}`,
    `  Service: ${evidence.subject.serviceId ?? 'none'}`,
    `  Observation: ${evidence.observation.key} = ${String(evidence.observation.value)}`,
    `  Expected: ${evidence.observation.expected ?? 'n/a'}`,
    `  Captured: ${evidence.timestamp}`,
    `  Freshness: ${formatFreshness(evidence, asOf)}`,
  ];

  if (evidence.testResult) {
    lines.push(`  Result: ${evidence.testResult.status}`);
    if (evidence.testResult.duration) {
      lines.push(`  Duration: ${evidence.testResult.duration}`);
    }
    if (evidence.testResult.executor) {
      lines.push(`  Executor: ${evidence.testResult.executor}`);
    }
    if (evidence.testResult.notes) {
      lines.push(`  Notes: ${evidence.testResult.notes}`);
    }
  }

  return lines.join('\n');
}

async function resolveEvidenceAuthor(author?: string): Promise<string> {
  if (author) {
    return author;
  }

  return process.env.USERNAME ?? process.env.USER ?? 'unknown';
}

function createSyntheticNode(nodeId: string): InfraNode {
  return {
    id: nodeId,
    name: nodeId,
    type: 'RESOURCE',
    provider: 'aws',
    region: 'unknown',
    tags: {},
    metadata: {},
  };
}

function formatFreshness(evidence: Evidence, asOf: Date): string {
  const freshness = checkFreshness(evidence, asOf);
  if (freshness.daysUntilExpiry === null) {
    return 'no expiry';
  }
  if (freshness.status === 'expired') {
    return `EXPIRED (${formatDate(evidence.expiresAt)})`;
  }
  return `expires: ${formatDate(evidence.expiresAt)} (${freshness.daysUntilExpiry} day${freshness.daysUntilExpiry === 1 ? '' : 's'} left)`;
}

function renderEvidenceSource(evidence: Evidence): string {
  if (evidence.source.origin === 'test') {
    return `${evidence.source.testType} on ${evidence.source.testDate}`;
  }
  if (evidence.source.origin === 'manual') {
    return `manual${evidence.source.author ? ` by ${evidence.source.author}` : ''}`;
  }
  if (evidence.source.origin === 'inference') {
    return `inference via ${evidence.source.method}`;
  }
  return `scan ${evidence.source.scanTimestamp}`;
}

function shortResourceLabel(nodeId: string): string {
  const slash = nodeId.split('/').at(-1);
  const colon = nodeId.split(':').at(-1);
  return slash && slash.length <= nodeId.length ? slash : colon ?? nodeId;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function formatDate(value?: string): string {
  if (!value) {
    return 'n/a';
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : value;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigurationError('--expires must be a positive integer.');
  }
  return parsed;
}

function parseEvidenceResult(value: string): 'success' | 'failure' | 'partial' {
  if (value === 'success' || value === 'failure' || value === 'partial') {
    return value;
  }

  throw new ConfigurationError('--result must be success, failure, or partial.');
}

function resolveEvidenceType(type: string): EvidenceType {
  return isEvidenceType(type) ? type : 'tested';
}

function resolveTestType(type: string, scenario?: string): string {
  if (isEvidenceType(type)) {
    return scenario ?? 'manual-evidence';
  }

  return type;
}

function isEvidenceType(value: string): value is EvidenceType {
  return (EVIDENCE_TYPES as readonly string[]).includes(value);
}

function parseMeasuredDurationOption(
  flag: '--rto' | '--rpo',
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return parseDuration(value).totalMs / 60_000;
  } catch {
    throw new ConfigurationError(
      `${flag} must be a positive duration such as 45m, 1h, or 1h30m.`,
    );
  }
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}
