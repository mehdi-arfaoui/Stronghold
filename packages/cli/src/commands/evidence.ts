import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { Command } from 'commander';
import {
  FileEvidenceStore,
  checkFreshness,
  getCallerIdentity,
  parseManualServices,
  type Evidence,
  type EvidenceStore,
  type InfraNode,
} from '@stronghold-dr/core';

import {
  CommandAuditSession,
  collectAuditFlags,
  resolveAuditIdentity,
} from '../audit/command-audit.js';
import { buildDiscoveryCredentials } from '../config/credentials.js';
import { ConfigurationError } from '../errors/cli-error.js';
import { writeOutput } from '../output/io.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

const DEFAULT_TEST_EVIDENCE_EXPIRY_DAYS = 90;

interface EvidenceAddCommandOptions {
  readonly node: string;
  readonly type: string;
  readonly result: 'success' | 'failure' | 'partial';
  readonly duration?: string;
  readonly notes?: string;
  readonly service?: string;
  readonly expires?: number;
  readonly author?: string;
  readonly passphrase?: string;
}

export function registerEvidenceCommand(program: Command): void {
  const evidence = program.command('evidence').description('Manage manual DR evidence');

  evidence
    .command('add')
    .description('Register the result of a manual DR test')
    .requiredOption('--node <id>', 'Resource identifier (ARN or Stronghold resource ID)')
    .requiredOption('--type <string>', 'Test type, for example restore-test or failover-test')
    .requiredOption('--result <result>', 'Test outcome: success|failure|partial')
    .option('--duration <string>', 'Test duration, for example "12 minutes"')
    .option('--notes <string>', 'Freeform notes about the test')
    .option('--service <id>', 'Service this evidence applies to')
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
          '--service': Boolean(options.service),
          '--expires': options.expires !== undefined,
          '--author': Boolean(options.author),
        })
          ? {
              flags: collectAuditFlags({
                '--duration': Boolean(options.duration),
                '--notes': Boolean(options.notes),
                '--service': Boolean(options.service),
                '--expires': options.expires !== undefined,
                '--author': Boolean(options.author),
              }),
            }
          : {}),
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const paths = resolveStrongholdPaths();
        const store = new FileEvidenceStore(paths.evidencePath);
        const serviceId =
          options.service ??
          (await resolveServiceIdForNode(options.node, {
            passphrase: options.passphrase,
          }));
        const executor = await resolveEvidenceAuthor(options.author);
        const evidenceEntry = await addEvidenceEntry({
          store,
          nodeId: options.node,
          serviceId,
          testType: options.type,
          result: options.result,
          duration: options.duration,
          notes: options.notes,
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
      audit.setIdentityPromise(resolveAuditIdentity());
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
      audit.setIdentityPromise(resolveAuditIdentity());
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
  readonly testType: string;
  readonly result: 'success' | 'failure' | 'partial';
  readonly duration?: string;
  readonly notes?: string;
  readonly serviceId?: string | null;
  readonly expiresInDays?: number;
  readonly executor: string;
  readonly now?: Date;
}): Promise<Evidence> {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const expiresInDays = input.expiresInDays ?? DEFAULT_TEST_EVIDENCE_EXPIRY_DAYS;
  const expiresAt = addDays(now, expiresInDays).toISOString();

  const evidence: Evidence = {
    id: randomUUID(),
    type: 'tested',
    source: {
      origin: 'test',
      testType: input.testType,
      testDate: timestamp,
    },
    subject: {
      nodeId: input.nodeId,
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
    },
    observation: {
      key: input.testType,
      value: input.result,
      expected: 'success',
      description: `Manual ${input.testType} recorded as ${input.result}.`,
    },
    timestamp,
    expiresAt,
    testResult: {
      status: input.result,
      ...(input.duration ? { duration: input.duration } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      executor: input.executor,
    },
  };

  await input.store.add(evidence);
  return evidence;
}

export async function resolveServiceIdForNode(
  nodeId: string,
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

  const identity = await getCallerIdentity(buildDiscoveryCredentials().aws ?? {});
  return identity?.arn ?? 'unknown';
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

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}
