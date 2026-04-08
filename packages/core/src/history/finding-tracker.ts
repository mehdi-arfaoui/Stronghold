import fs from 'node:fs';
import path from 'node:path';

import type { ServicePosture } from '../services/index.js';
import type { ValidationReport } from '../validation/index.js';
import type { HistoryStore, ScanSnapshot } from './history-types.js';
import { buildFindingKey } from './history-store.js';
import type {
  FindingLifecycle,
  FindingLifecycleDelta,
  FindingLifecycleStore,
  StoredFindingLifecycle,
  TrackedFinding,
} from './finding-lifecycle-types.js';

const TRACKED_FINDING_STATUSES = new Set(['fail', 'error']);
const LIFECYCLE_STORE_VERSION = 1;
const GITIGNORE_FILENAME = '.gitignore';
const GITIGNORE_CONTENT = `# Stronghold local posture memory contains infrastructure-derived metadata.
# Review content before committing.
*
!.gitignore
`;

export interface TrackFindingsOptions {
  readonly lifecycleStore?: FindingLifecycleStore;
  readonly currentTimestamp?: string;
  readonly findingContextByKey?: ReadonlyMap<string, TrackedFinding>;
}

export class FileFindingLifecycleStore implements FindingLifecycleStore {
  public constructor(private readonly filePath: string) {}

  public async upsert(lifecycle: FindingLifecycle): Promise<void> {
    const records = this.readData();
    records.entries[lifecycle.findingKey] = toStoredLifecycle(lifecycle);
    this.writeData(records);
  }

  public async upsertMany(lifecycles: readonly FindingLifecycle[]): Promise<void> {
    const records = this.readData();
    lifecycles.forEach((lifecycle) => {
      records.entries[lifecycle.findingKey] = toStoredLifecycle(lifecycle);
    });
    this.writeData(records);
  }

  public async getByKey(
    findingKey: string,
    asOf = new Date().toISOString(),
  ): Promise<FindingLifecycle | null> {
    const record = this.readData().entries[findingKey];
    return record ? hydrateLifecycle(record, asOf) : null;
  }

  public async getActive(asOf = new Date().toISOString()): Promise<readonly FindingLifecycle[]> {
    return this.getAll(asOf).then((entries) =>
      entries.filter((entry) => entry.status === 'active' || entry.status === 'recurrent'),
    );
  }

  public async getResolved(
    since?: string,
    asOf = new Date().toISOString(),
  ): Promise<readonly FindingLifecycle[]> {
    return this.getAll(asOf).then((entries) =>
      entries.filter(
        (entry) =>
          entry.status === 'resolved' &&
          (!since || (entry.resolvedAt !== undefined && entry.resolvedAt >= since)),
      ),
    );
  }

  public async getRecurrent(asOf = new Date().toISOString()): Promise<readonly FindingLifecycle[]> {
    return this.getAll(asOf).then((entries) => entries.filter((entry) => entry.isRecurrent));
  }

  public async getAll(asOf = new Date().toISOString()): Promise<readonly FindingLifecycle[]> {
    return Object.values(this.readData().entries)
      .map((record) => hydrateLifecycle(record, asOf))
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }

  private readData(): {
    readonly version: number;
    readonly entries: Record<string, StoredFindingLifecycle>;
  } {
    const resolvedPath = path.resolve(this.filePath);
    if (!fs.existsSync(resolvedPath)) {
      return {
        version: LIFECYCLE_STORE_VERSION,
        entries: {},
      };
    }

    const contents = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;
    return validateLifecycleStore(parsed, resolvedPath);
  }

  private writeData(data: {
    readonly version: number;
    readonly entries: Record<string, StoredFindingLifecycle>;
  }): void {
    const resolvedPath = path.resolve(this.filePath);
    ensureDirectory(path.dirname(resolvedPath));
    ensureGitignore(path.dirname(resolvedPath));
    fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
}

export async function trackFindings(
  currentFindingKeys: readonly string[],
  historyStore: HistoryStore,
  options: TrackFindingsOptions = {},
): Promise<FindingLifecycleDelta> {
  const currentTimestamp = options.currentTimestamp ?? new Date().toISOString();
  const previousSnapshot = await historyStore.getPrevious();
  const previousKeys = new Set(previousSnapshot?.findingIds ?? []);
  const currentKeys = Array.from(new Set(currentFindingKeys));
  const currentKeySet = new Set(currentKeys);
  const allSnapshots = options.lifecycleStore ? [] : await historyStore.getSnapshots();
  const historySnapshots = allSnapshots.slice(0, Math.max(0, allSnapshots.length - 1));
  const newFindings: FindingLifecycle[] = [];
  const resolvedFindings: FindingLifecycle[] = [];
  const recurrentFindings: FindingLifecycle[] = [];
  const persistentFindings: FindingLifecycle[] = [];

  for (const findingKey of currentKeys) {
    const currentContext = resolveTrackedFinding(findingKey, options.findingContextByKey);
    const existingLifecycle = await resolveExistingLifecycle(
      findingKey,
      currentTimestamp,
      historySnapshots,
      options.lifecycleStore,
      currentContext,
    );

    if (!previousKeys.has(findingKey)) {
      if (existingLifecycle && existingLifecycle.resolvedAt) {
        recurrentFindings.push(
          buildLifecycle(existingLifecycle, currentContext, {
            status: 'recurrent',
            lastSeenAt: currentTimestamp,
            recurrenceCount: existingLifecycle.recurrenceCount + 1,
            resolvedAt: undefined,
          }),
        );
      } else {
        newFindings.push(
          buildLifecycle(existingLifecycle, currentContext, {
            status: 'active',
            firstSeenAt: existingLifecycle?.firstSeenAt ?? currentTimestamp,
            lastSeenAt: currentTimestamp,
            recurrenceCount: existingLifecycle?.recurrenceCount ?? 0,
            resolvedAt: undefined,
          }),
        );
      }
      continue;
    }

    persistentFindings.push(
      buildLifecycle(existingLifecycle, currentContext, {
        status: existingLifecycle?.isRecurrent ? 'recurrent' : 'active',
        firstSeenAt: existingLifecycle?.firstSeenAt ?? previousSnapshot?.timestamp ?? currentTimestamp,
        lastSeenAt: currentTimestamp,
        recurrenceCount: existingLifecycle?.recurrenceCount ?? 0,
        resolvedAt: undefined,
      }),
    );
  }

  for (const findingKey of previousKeys) {
    if (currentKeySet.has(findingKey)) {
      continue;
    }

    const existingLifecycle = await resolveExistingLifecycle(
      findingKey,
      currentTimestamp,
      historySnapshots,
      options.lifecycleStore,
      resolveTrackedFinding(findingKey, options.findingContextByKey),
    );

    resolvedFindings.push(
      buildLifecycle(existingLifecycle, resolveTrackedFinding(findingKey, options.findingContextByKey), {
        status: 'resolved',
        firstSeenAt: existingLifecycle?.firstSeenAt ?? previousSnapshot?.timestamp ?? currentTimestamp,
        lastSeenAt: existingLifecycle?.lastSeenAt ?? previousSnapshot?.timestamp ?? currentTimestamp,
        resolvedAt: currentTimestamp,
        recurrenceCount: existingLifecycle?.recurrenceCount ?? 0,
      }),
    );
  }

  const touchedLifecycles = [
    ...newFindings,
    ...resolvedFindings,
    ...recurrentFindings,
    ...persistentFindings,
  ];
  if (options.lifecycleStore && touchedLifecycles.length > 0) {
    await persistLifecycles(options.lifecycleStore, touchedLifecycles);
  }

  return {
    newFindings,
    resolvedFindings,
    recurrentFindings,
    persistentFindings,
    summary: {
      newCount: newFindings.length,
      resolvedCount: resolvedFindings.length,
      recurrentCount: recurrentFindings.length,
      persistentCount: persistentFindings.length,
    },
  };
}

export function collectTrackedFindings(
  validationReport: ValidationReport,
  servicePosture?: ServicePosture | null,
): readonly TrackedFinding[] {
  const serviceLookup = new Map(
    servicePosture?.services.flatMap((service) =>
      service.service.resources.map((resource) => [
        resource.nodeId,
        { serviceId: service.service.id, serviceName: service.service.name },
      ] as const),
    ) ?? [],
  );
  const findingsByKey = new Map<string, TrackedFinding>();

  validationReport.results
    .filter((result) => TRACKED_FINDING_STATUSES.has(result.status))
    .forEach((result) => {
      const findingKey = buildFindingKey(result.ruleId, result.nodeId);
      const serviceContext = serviceLookup.get(result.nodeId);
      findingsByKey.set(findingKey, {
        findingKey,
        ruleId: result.ruleId,
        nodeId: result.nodeId,
        severity: result.severity,
        ...(serviceContext
          ? {
              serviceId: serviceContext.serviceId,
              serviceName: serviceContext.serviceName,
            }
          : {}),
      });
    });

  return Array.from(findingsByKey.values());
}

export function parseFindingKey(findingKey: string): {
  readonly ruleId: string;
  readonly nodeId: string;
} {
  const separatorIndex = findingKey.indexOf('::');
  if (separatorIndex === -1) {
    return {
      ruleId: findingKey,
      nodeId: findingKey,
    };
  }

  return {
    ruleId: findingKey.slice(0, separatorIndex),
    nodeId: findingKey.slice(separatorIndex + 2),
  };
}

function buildLifecycle(
  existing: FindingLifecycle | null,
  context: TrackedFinding,
  overrides: {
    readonly status: FindingLifecycle['status'];
    readonly firstSeenAt?: string;
    readonly lastSeenAt: string;
    readonly resolvedAt?: string;
    readonly recurrenceCount: number;
  },
): FindingLifecycle {
  const firstSeenAt = existing?.firstSeenAt ?? overrides.firstSeenAt ?? overrides.lastSeenAt;
  const resolvedAt = overrides.resolvedAt;
  const referenceTimestamp = resolvedAt ?? overrides.lastSeenAt;

  return {
    findingKey: existing?.findingKey ?? context.findingKey,
    ruleId: existing?.ruleId ?? context.ruleId,
    nodeId: existing?.nodeId ?? context.nodeId,
    severity: context.severity ?? existing?.severity,
    status: overrides.status,
    firstSeenAt,
    lastSeenAt: overrides.lastSeenAt,
    ...(resolvedAt ? { resolvedAt } : {}),
    recurrenceCount: overrides.recurrenceCount,
    isRecurrent: overrides.recurrenceCount > 0 || existing?.isRecurrent === true,
    ageInDays: diffDays(firstSeenAt, referenceTimestamp),
    ...(context.serviceId ?? existing?.serviceId
      ? {
          serviceId: context.serviceId ?? existing?.serviceId,
          serviceName: context.serviceName ?? existing?.serviceName,
        }
      : {}),
  };
}

async function resolveExistingLifecycle(
  findingKey: string,
  currentTimestamp: string,
  historySnapshots: readonly ScanSnapshot[],
  lifecycleStore: FindingLifecycleStore | undefined,
  context: TrackedFinding,
): Promise<FindingLifecycle | null> {
  if (lifecycleStore) {
    return lifecycleStore.getByKey(findingKey, currentTimestamp);
  }

  const history = summarizeFindingHistory(findingKey, historySnapshots);
  if (!history.firstSeenAt) {
    return null;
  }

  return {
    findingKey,
    ruleId: context.ruleId,
    nodeId: context.nodeId,
    severity: context.severity,
    status: history.currentlyActive
      ? history.recurrenceCount > 0
        ? 'recurrent'
        : 'active'
      : 'resolved',
    firstSeenAt: history.firstSeenAt,
    lastSeenAt: history.lastSeenAt ?? history.firstSeenAt,
    ...(history.currentlyActive ? {} : { resolvedAt: currentTimestamp }),
    recurrenceCount: history.recurrenceCount,
    isRecurrent: history.recurrenceCount > 0,
    ageInDays: diffDays(history.firstSeenAt, history.lastSeenAt ?? currentTimestamp),
    ...(context.serviceId ? { serviceId: context.serviceId, serviceName: context.serviceName } : {}),
  };
}

function summarizeFindingHistory(
  findingKey: string,
  snapshots: readonly ScanSnapshot[],
): {
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly recurrenceCount: number;
  readonly currentlyActive: boolean;
} {
  let firstSeenAt: string | null = null;
  let lastSeenAt: string | null = null;
  let recurrenceCount = 0;
  let hadPresence = false;
  let wasPresent = false;

  snapshots.forEach((snapshot) => {
    const present = snapshot.findingIds.includes(findingKey);
    if (present) {
      if (!hadPresence) {
        firstSeenAt = snapshot.timestamp;
      } else if (!wasPresent) {
        recurrenceCount += 1;
      }
      hadPresence = true;
      lastSeenAt = snapshot.timestamp;
    }
    wasPresent = present;
  });

  return {
    firstSeenAt,
    lastSeenAt,
    recurrenceCount,
    currentlyActive: snapshots.at(-1)?.findingIds.includes(findingKey) ?? false,
  };
}

async function persistLifecycles(
  lifecycleStore: FindingLifecycleStore,
  lifecycles: readonly FindingLifecycle[],
): Promise<void> {
  if (hasBulkUpsert(lifecycleStore)) {
    await lifecycleStore.upsertMany(lifecycles);
    return;
  }

  for (const lifecycle of lifecycles) {
    await lifecycleStore.upsert(lifecycle);
  }
}

function resolveTrackedFinding(
  findingKey: string,
  findingContextByKey: ReadonlyMap<string, TrackedFinding> | undefined,
): TrackedFinding {
  const existing = findingContextByKey?.get(findingKey);
  if (existing) {
    return existing;
  }

  const parsed = parseFindingKey(findingKey);
  return {
    findingKey,
    ruleId: parsed.ruleId,
    nodeId: parsed.nodeId,
    severity: 'medium',
  };
}

function toStoredLifecycle(lifecycle: FindingLifecycle): StoredFindingLifecycle {
  return {
    findingKey: lifecycle.findingKey,
    ruleId: lifecycle.ruleId,
    nodeId: lifecycle.nodeId,
    ...(lifecycle.severity ? { severity: lifecycle.severity } : {}),
    status: lifecycle.status,
    firstSeenAt: lifecycle.firstSeenAt,
    lastSeenAt: lifecycle.lastSeenAt,
    ...(lifecycle.resolvedAt ? { resolvedAt: lifecycle.resolvedAt } : {}),
    recurrenceCount: lifecycle.recurrenceCount,
    isRecurrent: lifecycle.isRecurrent,
    ...(lifecycle.serviceId
      ? {
          serviceId: lifecycle.serviceId,
          serviceName: lifecycle.serviceName,
        }
      : {}),
  };
}

function hydrateLifecycle(record: StoredFindingLifecycle, asOf: string): FindingLifecycle {
  const referenceTimestamp =
    record.resolvedAt && record.resolvedAt < asOf ? record.resolvedAt : asOf;

  return {
    ...record,
    ageInDays: diffDays(record.firstSeenAt, referenceTimestamp),
  };
}

function diffDays(startAt: string, endAt: string): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function validateLifecycleStore(
  value: unknown,
  filePath: string,
): {
  readonly version: number;
  readonly entries: Record<string, StoredFindingLifecycle>;
} {
  if (!isRecord(value)) {
    throw new Error(`Finding lifecycle store at ${filePath} must be a JSON object.`);
  }

  const entriesValue = value.entries;
  if (!isRecord(entriesValue)) {
    throw new Error(`Finding lifecycle store at ${filePath} is missing entries.`);
  }

  return {
    version:
      typeof value.version === 'number' && Number.isFinite(value.version)
        ? value.version
        : LIFECYCLE_STORE_VERSION,
    entries: Object.fromEntries(
      Object.entries(entriesValue).map(([key, entry]) => [key, validateStoredLifecycle(entry, filePath)]),
    ),
  };
}

function validateStoredLifecycle(value: unknown, filePath: string): StoredFindingLifecycle {
  if (!isRecord(value)) {
    throw new Error(`Finding lifecycle store at ${filePath} contains an invalid entry.`);
  }

  return {
    findingKey: readString(value.findingKey, filePath, 'findingKey'),
    ruleId: readString(value.ruleId, filePath, 'ruleId'),
    nodeId: readString(value.nodeId, filePath, 'nodeId'),
    ...(typeof value.severity === 'string' ? { severity: value.severity as TrackedFinding['severity'] } : {}),
    status: readString(value.status, filePath, 'status') as StoredFindingLifecycle['status'],
    firstSeenAt: readString(value.firstSeenAt, filePath, 'firstSeenAt'),
    lastSeenAt: readString(value.lastSeenAt, filePath, 'lastSeenAt'),
    ...(typeof value.resolvedAt === 'string' ? { resolvedAt: value.resolvedAt } : {}),
    recurrenceCount: readNumber(value.recurrenceCount, filePath, 'recurrenceCount'),
    isRecurrent: readBoolean(value.isRecurrent, filePath, 'isRecurrent'),
    ...(typeof value.serviceId === 'string'
      ? {
          serviceId: value.serviceId,
          serviceName: typeof value.serviceName === 'string' ? value.serviceName : undefined,
        }
      : {}),
  };
}

function readString(value: unknown, filePath: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Finding lifecycle store at ${filePath} is missing ${field}.`);
  }
  return value;
}

function readNumber(value: unknown, filePath: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Finding lifecycle store at ${filePath} is missing ${field}.`);
  }
  return value;
}

function readBoolean(value: unknown, filePath: string, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Finding lifecycle store at ${filePath} is missing ${field}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasBulkUpsert(
  store: FindingLifecycleStore,
): store is FindingLifecycleStore & {
  upsertMany(lifecycles: readonly FindingLifecycle[]): Promise<void>;
} {
  return 'upsertMany' in store && typeof store.upsertMany === 'function';
}

function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function ensureGitignore(directoryPath: string): void {
  if (path.basename(directoryPath) !== '.stronghold') {
    return;
  }

  const gitignorePath = path.join(directoryPath, GITIGNORE_FILENAME);
  if (fs.existsSync(gitignorePath)) {
    return;
  }

  fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf8');
}
