import { createInterface } from 'node:readline/promises';

import { Command } from 'commander';
import {
  buildServicePosture,
  detectServices,
  generateRecommendations,
  loadManualServices,
  mergeServices,
  type LoadedManualServices,
  type Service,
  type ServiceDetectionResult,
  type ServicePosture,
  type ServicePostureService,
} from '@stronghold-dr/core';

import {
  CommandAuditSession,
  collectAuditFlags,
  resolveAuditIdentity,
} from '../audit/command-audit.js';
import {
  formatDeclaredOwner,
  formatDeclaredOwnerVerbose,
  formatFindingsCount,
  formatSourceBadge,
  sortServiceEntries,
} from '../output/service-helpers.js';
import { writeOutput } from '../output/io.js';
import { writeTextFile } from '../storage/secure-file-store.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

export function registerServicesCommand(program: Command): void {
  const services = program.command('services').description('Manage detected and manual services');

  services
    .command('detect')
    .description('Detect services from the last saved scan and optionally write services.yml')
    .option('--yes', 'Write services.yml without prompting', false)
    .action(async (_, command: Command) => {
      const options = command.optsWithGlobals() as { readonly yes?: boolean };
      const audit = new CommandAuditSession('services_detect', {
        outputFormat: 'summary',
        ...(collectAuditFlags({ '--yes': options.yes }) ? { flags: collectAuditFlags({ '--yes': options.yes }) } : {}),
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const resolved = await loadServicesView();
        await writeOutput(renderDetectedServices(resolved.autoDetected));
        if (resolved.manualServices?.warnings.length) {
          await writeOutput('');
          for (const warning of resolved.manualServices.warnings) {
            await writeOutput(`Warning: ${warning}`);
          }
        }
        if (resolved.manualServices?.newMatches.length) {
          await writeOutput('');
          await writeOutput(renderNewMatchWarnings(resolved.manualServices.newMatches));
        }

        const existing = resolved.manualServices?.services ?? [];
        if (existing.length > 0) {
          const diff = renderServicesDiff(existing, resolved.autoDetected.services);
          if (diff) {
            await writeOutput('');
            await writeOutput(diff);
          }
        }

        const shouldWrite =
          options.yes ||
          (await confirmAction(
            existing.length > 0
              ? 'Update .stronghold/services.yml? [y/N]: '
              : 'Save to .stronghold/services.yml? [Y/n]: ',
            existing.length === 0,
          ));

        if (shouldWrite) {
          await writeTextFile(
            renderServicesYaml(existing.length > 0 ? resolved.merged.services : resolved.autoDetected.services),
            resolved.paths.servicesPath,
            { encrypt: false },
          );
          await writeOutput(`Wrote ${resolved.paths.servicesPath}`);
        }

        await audit.finish({
          status: 'success',
          resourceCount: resolved.scan.nodes.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });

  services
    .command('list')
    .description('List the current merged service view')
    .action(async () => {
      const audit = new CommandAuditSession('services_list', {
        outputFormat: 'summary',
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const resolved = await loadServicesView();
        await writeOutput(renderServicesList(resolved.posture));
        await audit.finish({
          status: 'success',
          resourceCount: resolved.scan.nodes.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });

  services
    .command('show <name>')
    .description('Show the details for a specific service')
    .action(async (name: string) => {
      const audit = new CommandAuditSession('services_show', {
        outputFormat: 'summary',
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const resolved = await loadServicesView();
        const service = resolved.posture.services.find(
          (candidate) =>
            candidate.service.id === name ||
            candidate.service.name.toLowerCase() === name.toLowerCase(),
        );
        if (!service) {
          throw new Error(`Service "${name}" was not found in the latest scan.`);
        }

        await writeOutput(renderServiceDetail(service));
        await audit.finish({
          status: 'success',
          resourceCount: service.service.resources.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}

export function renderDetectedServices(result: ServiceDetectionResult): string {
  const lines = ['Detected services from last scan:', ''];
  appendDetectionGroup(lines, 'CloudFormation', result.services, 'cloudformation');
  appendDetectionGroup(lines, 'tags', result.services, 'tag');
  appendDetectionGroup(lines, 'topology', result.services, 'topology');
  lines.push(`  Unassigned: ${result.unassignedResources.length} resources`);
  return lines.join('\n');
}

export function renderServicesList(posture: ServicePosture): string {
  const lines = [`Services (${posture.services.length}):`];
  for (const service of sortServiceEntries(posture.services)) {
    const ownerLabel = service.score.owner ? `  owner: ${formatDeclaredOwner(service.score.owner)}` : '';
    const sourceLabel = formatSourceBadge(service.score.detectionSource);
    lines.push(
      `  ${service.service.id.padEnd(14)} ${service.score.criticality.padEnd(8)} ${String(service.service.resources.length).padStart(2)} resources  ${String(service.score.score).padStart(3)}/100  ${service.score.grade}  ${ownerLabel || `source: ${sourceLabel}`}`,
    );
    if (ownerLabel) {
      lines.push(`                    source: ${sourceLabel}`);
    }
  }
  lines.push('');
  lines.push(`Unassigned: ${posture.unassigned.resourceCount} resources`);
  return lines.join('\n');
}

export function renderServiceDetail(service: ServicePostureService): string {
  const criticalFindingCount = service.score.findingsCount.critical;
  const capLabel =
    criticalFindingCount > 0
      ? ` - capped by ${criticalFindingCount} critical finding${criticalFindingCount === 1 ? '' : 's'}`
      : service.score.findingsCount.high > 0
        ? ` - capped by ${service.score.findingsCount.high} high finding${service.score.findingsCount.high === 1 ? '' : 's'}`
        : '';
  const lines = [
    `Service: ${service.service.id}`,
    `  Name: ${service.service.name}`,
    `  Criticality: ${service.score.criticality}`,
    `  Owner: ${formatDeclaredOwnerVerbose(service.score.owner)}`,
    `  Source: ${formatSourceBadge(service.score.detectionSource)}`,
    '',
    `  Resources (${service.service.resources.length}):`,
    ...service.service.resources.map(
      (resource) => `    ${resource.nodeId}${resource.role ? `  ${resource.role}` : ''}`,
    ),
    '',
    `  DR Score: ${service.score.score}/100 (grade: ${service.score.grade}${capLabel})`,
    `  Findings: ${formatFindingsCount(service.score.findingsCount)}`,
    `  Coverage gaps: ${service.score.coverageGaps.length > 0 ? service.score.coverageGaps.join('; ') : 'None'}`,
  ];
  return lines.join('\n');
}

export function renderServicesYaml(services: readonly Service[]): string {
  const lines = [
    '# Stronghold Service Definitions',
    "# Auto-generated by 'stronghold services detect', manually editable.",
    '# Resources can be matched by exact ID or glob patterns.',
    '# Owners are declared here but NOT verified by Stronghold - treat as informational.',
    '',
    'version: 1',
    '',
    'services:',
  ];

  for (const service of services) {
    lines.push(`  ${service.id}:`);
    lines.push(`    name: ${service.name}`);
    lines.push(`    criticality: ${service.criticality}`);
    if (service.owner) {
      lines.push(`    owner: ${service.owner}`);
    }
    lines.push('    resources:');
    for (const resource of service.resources) {
      lines.push(`      - ${resource.nodeId}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function renderServicesDiff(
  currentServices: readonly Service[],
  nextServices: readonly Service[],
): string {
  const currentById = new Map(currentServices.map((service) => [service.id, service] as const));
  const nextById = new Map(nextServices.map((service) => [service.id, service] as const));
  const lines = ['Changes from current services.yml:'];

  const added = nextServices.filter((service) => !currentById.has(service.id));
  const removed = currentServices.filter((service) => !nextById.has(service.id));
  const changed = nextServices.flatMap((service) => {
    const current = currentById.get(service.id);
    if (!current) return [];

    const currentIds = new Set(current.resources.map((resource) => resource.nodeId));
    const additions = service.resources.filter((resource) => !currentIds.has(resource.nodeId));
    return additions.length > 0
      ? [`  ~ ${service.id}: ${additions.length} new resources matched`]
      : [];
  });

  lines.push(`  + ${added.length} new service${added.length === 1 ? '' : 's'} detected${added.length > 0 ? `: ${added.map((service) => service.id).join(', ')}` : ''}`);
  lines.push(...changed);
  lines.push(`  - ${removed.length} service${removed.length === 1 ? '' : 's'} removed`);

  return lines.join('\n');
}

async function loadServicesView(): Promise<{
  readonly paths: ReturnType<typeof resolveStrongholdPaths>;
  readonly scan: Awaited<ReturnType<typeof loadScanResultsWithEncryption>>;
  readonly autoDetected: ServiceDetectionResult;
  readonly manualServices: LoadedManualServices | null;
  readonly merged: ServiceDetectionResult;
  readonly posture: ServicePosture;
}> {
  const paths = resolveStrongholdPaths();
  const scanPath = resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);
  const scan = await loadScanResultsWithEncryption(scanPath);
  const autoDetected = detectServices(scan.nodes, scan.edges);
  const manualServices = loadManualServices(scan.nodes, {
    filePath: paths.servicesPath,
    previousAssignments: scan.servicePosture?.detection.services,
  });
  const merged =
    manualServices && manualServices.services.length > 0
      ? mergeServices(autoDetected, manualServices.services)
      : autoDetected;
  const posture = buildServicePosture({
    nodes: scan.nodes,
    edges: scan.edges,
    validationReport: scan.validationReport,
    recommendations: generateRecommendations({
      nodes: scan.nodes,
      validationReport: scan.validationReport,
      drpPlan: scan.drpPlan,
      isDemo: scan.isDemo,
    }),
    manualServices: manualServices?.services,
  });

  return {
    paths,
    scan,
    autoDetected,
    manualServices,
    merged,
    posture,
  };
}

function appendDetectionGroup(
  lines: string[],
  label: string,
  services: readonly Service[],
  detectionType: Service['detectionSource']['type'],
): void {
  const matchingServices = services.filter(
    (service) => service.detectionSource.type === detectionType,
  );
  if (matchingServices.length === 0) {
    return;
  }

  lines.push(`  Via ${label} (${matchingServices.length}):`);
  for (const service of matchingServices) {
    lines.push(
      `    ${service.id} -> ${service.resources.length} resources (confidence: ${service.detectionSource.confidence.toFixed(2)})`,
    );
  }
  lines.push('');
}

function renderNewMatchWarnings(
  matches: ReadonlyArray<{
    readonly serviceId: string;
    readonly serviceName: string;
    readonly resourceIds: readonly string[];
  }>,
): string {
  const lines: string[] = [];
  for (const match of matches) {
    lines.push(
      `Warning: ${match.resourceIds.length} new resources matched service "${match.serviceName}" since last scan:`,
    );
    match.resourceIds.forEach((resourceId) => lines.push(`  + ${resourceId}`));
    lines.push(`  Review with 'stronghold services show ${match.serviceId}'`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

async function confirmAction(prompt: string, defaultYes: boolean): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await input.question(prompt)).trim().toLowerCase();
    if (!answer) {
      return defaultYes;
    }
    return answer === 'y' || answer === 'yes';
  } finally {
    input.close();
  }
}
