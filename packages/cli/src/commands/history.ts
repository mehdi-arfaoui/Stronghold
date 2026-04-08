import fs from 'node:fs';

import { Command } from 'commander';
import {
  FileFindingLifecycleStore,
  FileHistoryStore,
  analyzeTrend,
  type ScanSnapshot,
} from '@stronghold-dr/core';

import { CommandAuditSession, resolveAuditIdentity } from '../audit/command-audit.js';
import {
  DEFAULT_HISTORY_LIMIT,
  getCommandOptions,
  parseHistoryLimitOption,
  type HistoryCommandOptions,
} from '../config/options.js';
import { loadLocalPostureMemory } from '../history/posture-memory.js';
import { writeOutput } from '../output/io.js';
import {
  buildHistoryJson,
  renderHistoryTimeline,
  renderServiceHistory,
} from '../output/history-renderer.js';
import { rebuildScanResults } from '../pipeline/rebuild-scan.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('Show DR posture history and temporal trends')
    .option('--service <name>', 'Filter to a single service by id or name')
    .option('--limit <number>', 'Limit the number of entries (1-50)', parseHistoryLimitOption, DEFAULT_HISTORY_LIMIT)
    .option('--json', 'Output JSON for scripting', false)
    .action(async (_: HistoryCommandOptions, command: Command) => {
      const options = getCommandOptions<HistoryCommandOptions>(command);
      const audit = new CommandAuditSession('history', {
        outputFormat: options.json ? 'json' : 'summary',
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const paths = resolveStrongholdPaths();
        const scanPath = resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);
        if (!fs.existsSync(paths.historyPath)) {
          await writeOutput(
            "No posture history yet. Run 'stronghold scan' or 'stronghold demo' to create the first snapshot.",
          );
          await audit.finish({ status: 'success' });
          return;
        }

        const rawScan = fs.existsSync(scanPath)
          ? await loadScanResultsWithEncryption(scanPath, { passphrase: options.passphrase })
          : null;
        const effectiveScan = rawScan ? await rebuildScanResults(rawScan) : null;
        const postureMemory = effectiveScan
          ? await loadLocalPostureMemory(effectiveScan, paths)
          : await loadStoredHistoryContext(paths);
        const snapshots = postureMemory.snapshots;

        if (options.service) {
          const resolvedService = resolveServiceTarget(snapshots, options.service);
          const output = options.json
            ? JSON.stringify(
                buildHistoryJson({
                  snapshots,
                  trend: postureMemory.trend,
                  serviceId: resolvedService.id,
                  serviceName: resolvedService.name,
                  lifecycles: postureMemory.allLifecycles,
                  limit: options.limit,
                }),
                null,
                2,
              )
            : renderServiceHistory({
                snapshots,
                serviceId: resolvedService.id,
                serviceName: resolvedService.name,
                lifecycles: postureMemory.allLifecycles,
                limit: options.limit,
              });
          await writeOutput(output);
        } else {
          const output = options.json
            ? JSON.stringify(
                buildHistoryJson({
                  snapshots,
                  trend: postureMemory.trend,
                  limit: options.limit,
                }),
                null,
                2,
              )
            : renderHistoryTimeline({
                snapshots,
                trend: postureMemory.trend,
                limit: options.limit,
              });
          await writeOutput(output);
        }

        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}

function resolveServiceTarget(
  snapshots: readonly ScanSnapshot[],
  query: string,
): {
  readonly id: string;
  readonly name: string;
} {
  const normalized = query.trim().toLowerCase();
  const latestSnapshot = snapshots.at(-1);
  const candidates =
    latestSnapshot?.services ??
    snapshots.flatMap((snapshot) => snapshot.services);
  const match =
    candidates.find((service) => service.serviceId.toLowerCase() === normalized) ??
    candidates.find((service) => service.serviceName.toLowerCase() === normalized);

  if (!match) {
    throw new Error(`No service history found for "${query}".`);
  }

  return {
    id: match.serviceId,
    name: match.serviceName,
  };
}

async function loadStoredHistoryContext(
  paths: ReturnType<typeof resolveStrongholdPaths>,
): Promise<Awaited<ReturnType<typeof loadLocalPostureMemory>>> {
  const historyStore = new FileHistoryStore(paths.historyPath);
  const lifecycleStore = new FileFindingLifecycleStore(paths.findingLifecyclesPath);
  const snapshots = await historyStore.getSnapshots();
  const currentSnapshot = snapshots.at(-1) ?? null;
  const previousSnapshot = snapshots.length >= 2 ? snapshots[snapshots.length - 2] ?? null : null;
  const allLifecycles = await lifecycleStore.getAll(currentSnapshot?.timestamp);
  const activeLifecycles = await lifecycleStore.getActive(currentSnapshot?.timestamp);
  const resolvedLifecycles = await lifecycleStore.getResolved(undefined, currentSnapshot?.timestamp);
  const recurrentLifecycles = await lifecycleStore.getRecurrent(currentSnapshot?.timestamp);

  return {
    snapshots,
    currentSnapshot,
    previousSnapshot,
    allLifecycles,
    activeLifecycles,
    resolvedLifecycles,
    recurrentLifecycles,
    currentDebt: [],
    trend: analyzeTrend(snapshots, allLifecycles, []),
    warning: null,
  };
}
