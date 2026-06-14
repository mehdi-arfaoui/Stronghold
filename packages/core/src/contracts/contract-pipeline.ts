import { evaluateContracts } from './contract-evaluator.js';
import { loadContracts } from './contract-loader.js';
import type {
  ContractHookConfig,
  ContractVerdict,
  HookTriggerEvent,
} from './contract-types.js';
import type {
  AllContractsEvaluationResult,
  ContractEvaluationInput,
  ContractEvaluationResult,
  ContractHookFireInfo,
  ContractSummary,
  CoverageDetailInfo,
  EvidenceRecordInfo,
  ProofOfRecoveryInfo,
  ServiceInfo,
  SpofInfo,
} from './contract-result-types.js';
import type {
  ContractHook,
  ContractHookPayload,
  ContractViolationSummary,
} from './hooks/hook-types.js';

const DEFAULT_STRONGHOLD_VERSION = 'unknown';

const COVERAGE_PRIORITY: Record<CoverageDetailInfo['verdict'], number> = {
  covered: 0,
  partially_covered: 1,
  degraded: 2,
  uncovered: 3,
};

export interface PipelineResult {
  readonly timestamp: string;
  readonly servicePosture?: {
    readonly detection: {
      readonly services: readonly PipelineService[];
    };
  };
  readonly scenarioAnalysis?: {
    readonly scenarios: readonly PipelineScenario[];
  };
  readonly proofOfRecovery?: {
    readonly perService: readonly PipelineProofOfRecoveryService[];
  };
  readonly analysis?: {
    readonly spofs: readonly PipelineSpofReport[];
  };
  readonly validationReport?: {
    readonly results: readonly PipelineValidationResult[];
  };
  readonly evidence?: readonly PipelineEvidence[];
}

export interface PipelineService {
  readonly id: string;
  readonly name: string;
  readonly resources: readonly {
    readonly nodeId: string;
  }[];
}

export interface PipelineScenario {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly coverage?: {
    readonly details: readonly PipelineCoverageDetail[];
  };
}

export interface PipelineCoverageDetail {
  readonly serviceId: string;
  readonly verdict: CoverageDetailInfo['verdict'];
  readonly evidenceLevel: string;
  readonly missingCapabilities: readonly string[];
}

export interface PipelineProofOfRecoveryService {
  readonly serviceId: string;
  readonly hasTestedEvidence: boolean;
  readonly hasObservedEvidence: boolean;
  readonly testedRuleCount: number;
  readonly totalRuleCount: number;
}

export interface PipelineSpofReport {
  readonly nodeId: string;
  readonly impactedServices: readonly string[];
}

export interface PipelineValidationResult {
  readonly ruleId?: string;
  readonly evidence?: readonly PipelineEvidence[];
}

export interface PipelineEvidence {
  readonly id: string;
  readonly type: string;
  readonly source: PipelineEvidenceSource;
  readonly subject: {
    readonly nodeId: string;
    readonly serviceId?: string;
  };
  readonly observation: {
    readonly key: string;
    readonly value: unknown;
  };
  readonly timestamp: string;
  readonly expiresAt?: string;
  readonly measuredRTO?: number;
  readonly measuredRPO?: number;
  readonly testResult?: {
    readonly measuredRTO?: number;
    readonly measuredRPO?: number;
    readonly executor?: string;
  };
}

export type PipelineEvidenceSource =
  | {
      readonly origin: 'scan';
      readonly scanTimestamp: string;
    }
  | {
      readonly origin: 'inference';
      readonly method: string;
      readonly confidence: number;
    }
  | {
      readonly origin: 'manual';
      readonly author?: string;
      readonly file?: string;
    }
  | {
      readonly origin: 'test';
      readonly testType: string;
      readonly testDate: string;
    };

/**
 * Builds the decoupled contract evaluator input from the final scan pipeline result.
 */
export function buildContractEvaluationInput(
  pipelineResult: PipelineResult,
): ContractEvaluationInput {
  const services = buildServices(pipelineResult);
  const resourceToService = buildResourceToServiceMap(pipelineResult);
  const serviceNames = new Map(services.map((service) => [service.serviceName, service.serviceId] as const));

  return {
    services,
    evidenceByService: buildEvidenceByService(pipelineResult, resourceToService, services),
    scenarioCoverage: buildScenarioCoverage(pipelineResult),
    proofOfRecovery: buildProofOfRecovery(pipelineResult),
    spofsByService: buildSpofsByService(pipelineResult, resourceToService, serviceNames),
  };
}

/**
 * Loads contracts, evaluates them, and triggers matching notification hooks.
 */
export async function runContractEvaluation(options: {
  readonly contractsPath: string;
  readonly pipelineResult: PipelineResult;
  readonly hookImplementation?: ContractHook;
  readonly disableHooks?: boolean;
  readonly strongholdVersion?: string;
}): Promise<AllContractsEvaluationResult | null> {
  const loadResult = await loadContracts(options.contractsPath);
  if (loadResult.status === 'not_found') {
    return null;
  }
  if (loadResult.status === 'invalid') {
    throw new ContractPipelineError(
      `Invalid contracts file: ${loadResult.errors.join('; ')}`,
    );
  }

  const evaluation = evaluateContracts(
    loadResult.config.contracts,
    buildContractEvaluationInput(options.pipelineResult),
  );
  const hooksFired = options.disableHooks === true || !options.hookImplementation
    ? []
    : await fireMatchingHooks({
        evaluation,
        hookImplementation: options.hookImplementation,
        timestamp: options.pipelineResult.timestamp,
        strongholdVersion: options.strongholdVersion ?? DEFAULT_STRONGHOLD_VERSION,
      });

  return {
    ...evaluation,
    hooksFired,
  };
}

export class ContractPipelineError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ContractPipelineError';
  }
}

function buildServices(pipelineResult: PipelineResult): readonly ServiceInfo[] {
  return (pipelineResult.servicePosture?.detection.services ?? [])
    .map((service) => ({
      serviceId: service.id,
      serviceName: service.name,
    }))
    .sort((left, right) =>
      left.serviceName.localeCompare(right.serviceName) ||
      left.serviceId.localeCompare(right.serviceId),
    );
}

function buildResourceToServiceMap(
  pipelineResult: PipelineResult,
): ReadonlyMap<string, string> {
  const entries = (pipelineResult.servicePosture?.detection.services ?? [])
    .flatMap((service) =>
      service.resources.map((resource) => [resource.nodeId, service.id] as const),
    );

  return new Map(entries);
}

function buildEvidenceByService(
  pipelineResult: PipelineResult,
  resourceToService: ReadonlyMap<string, string>,
  services: readonly ServiceInfo[],
): ReadonlyMap<string, readonly EvidenceRecordInfo[]> {
  const serviceIds = new Set(services.map((service) => service.serviceId));
  const recordsByService = new Map<string, EvidenceRecordInfo[]>();
  const evidenceRecords = collectEvidence(pipelineResult);

  for (const evidence of evidenceRecords) {
    const serviceId = resolveEvidenceServiceId(evidence, resourceToService, serviceIds);
    if (!serviceId) {
      continue;
    }

    const records = recordsByService.get(serviceId) ?? [];
    records.push(mapEvidenceRecord(evidence, serviceId, pipelineResult.timestamp));
    recordsByService.set(serviceId, records);
  }

  return new Map(
    Array.from(recordsByService.entries()).map(([serviceId, records]) => [
      serviceId,
      records.sort((left, right) => right.testedAt.localeCompare(left.testedAt)),
    ] as const),
  );
}

function collectEvidence(pipelineResult: PipelineResult): readonly PipelineEvidence[] {
  const evidenceById = new Map<string, PipelineEvidence>();
  for (const evidence of pipelineResult.evidence ?? []) {
    evidenceById.set(evidence.id, evidence);
  }
  for (const result of pipelineResult.validationReport?.results ?? []) {
    for (const evidence of result.evidence ?? []) {
      evidenceById.set(evidence.id, evidence);
    }
  }

  return Array.from(evidenceById.values());
}

function resolveEvidenceServiceId(
  evidence: PipelineEvidence,
  resourceToService: ReadonlyMap<string, string>,
  serviceIds: ReadonlySet<string>,
): string | null {
  if (evidence.subject.serviceId && serviceIds.has(evidence.subject.serviceId)) {
    return evidence.subject.serviceId;
  }

  return resourceToService.get(evidence.subject.nodeId) ?? null;
}

function mapEvidenceRecord(
  evidence: PipelineEvidence,
  serviceId: string,
  scanTimestamp: string,
): EvidenceRecordInfo {
  return {
    id: evidence.id,
    serviceId,
    type: evidence.type,
    scenario: readEvidenceScenario(evidence),
    measuredRTO: evidence.measuredRTO ?? evidence.testResult?.measuredRTO ?? null,
    measuredRPO: evidence.measuredRPO ?? evidence.testResult?.measuredRPO ?? null,
    testedAt: resolveEvidenceTimestamp(evidence),
    testedBy: evidence.testResult?.executor ?? resolveEvidenceAuthor(evidence.source),
    confidence: resolveEvidenceConfidence(evidence.type),
    expired: isEvidenceExpired(evidence, scanTimestamp),
  };
}

function readEvidenceScenario(evidence: PipelineEvidence): string | null {
  if (evidence.observation.key === 'scenario' && typeof evidence.observation.value === 'string') {
    return evidence.observation.value;
  }
  if (isRecord(evidence.observation.value)) {
    const scenario = evidence.observation.value.scenario;
    return typeof scenario === 'string' && scenario.length > 0 ? scenario : null;
  }

  return null;
}

function resolveEvidenceTimestamp(evidence: PipelineEvidence): string {
  if (evidence.source.origin === 'test') {
    return evidence.source.testDate;
  }

  return evidence.timestamp;
}

function resolveEvidenceAuthor(source: PipelineEvidenceSource): string | null {
  if (source.origin === 'manual') {
    return source.author ?? null;
  }

  return null;
}

function resolveEvidenceConfidence(type: string): EvidenceRecordInfo['confidence'] {
  if (type === 'tested') {
    return 'high';
  }
  if (type === 'observed' || type === 'declared') {
    return 'medium';
  }
  return 'low';
}

function isEvidenceExpired(evidence: PipelineEvidence, scanTimestamp: string): boolean {
  if (evidence.type === 'expired') {
    return true;
  }
  if (!evidence.expiresAt) {
    return false;
  }

  const expiresAt = Date.parse(evidence.expiresAt);
  const evaluatedAt = Date.parse(scanTimestamp);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(evaluatedAt)) {
    return false;
  }

  return expiresAt <= evaluatedAt;
}

function buildScenarioCoverage(
  pipelineResult: PipelineResult,
): ReadonlyMap<string, readonly CoverageDetailInfo[]> {
  const coverageByScenario = new Map<string, CoverageDetailInfo[]>();

  for (const scenario of pipelineResult.scenarioAnalysis?.scenarios ?? []) {
    const details = (scenario.coverage?.details ?? []).map((detail) => ({
      serviceId: detail.serviceId,
      verdict: detail.verdict,
      evidenceLevel: detail.evidenceLevel,
      missingCapabilities: [...detail.missingCapabilities],
    }));

    for (const key of scenarioCoverageKeys(scenario)) {
      mergeCoverageDetails(coverageByScenario, key, details);
    }
  }

  return new Map(coverageByScenario);
}

function scenarioCoverageKeys(scenario: PipelineScenario): readonly string[] {
  const keys = new Set<string>([scenario.id, scenario.type]);
  if (scenario.name.trim().length > 0) {
    keys.add(scenario.name);
  }
  if (scenario.type === 'node_failure') {
    keys.add('spof_failure');
  }

  return Array.from(keys);
}

function mergeCoverageDetails(
  coverageByScenario: Map<string, CoverageDetailInfo[]>,
  key: string,
  details: readonly CoverageDetailInfo[],
): void {
  const mergedByService = new Map(
    (coverageByScenario.get(key) ?? []).map((detail) => [detail.serviceId, detail] as const),
  );

  for (const detail of details) {
    const current = mergedByService.get(detail.serviceId);
    if (!current || COVERAGE_PRIORITY[detail.verdict] > COVERAGE_PRIORITY[current.verdict]) {
      mergedByService.set(detail.serviceId, detail);
      continue;
    }
    if (current.verdict === detail.verdict) {
      mergedByService.set(detail.serviceId, {
        ...current,
        missingCapabilities: Array.from(
          new Set([...current.missingCapabilities, ...detail.missingCapabilities]),
        ),
      });
    }
  }

  coverageByScenario.set(
    key,
    Array.from(mergedByService.values()).sort((left, right) =>
      left.serviceId.localeCompare(right.serviceId),
    ),
  );
}

function buildProofOfRecovery(
  pipelineResult: PipelineResult,
): ReadonlyMap<string, ProofOfRecoveryInfo> {
  return new Map(
    (pipelineResult.proofOfRecovery?.perService ?? []).map((service) => [
      service.serviceId,
      {
        hasTestedEvidence: service.hasTestedEvidence,
        hasObservedEvidence: service.hasObservedEvidence,
        testedRuleCount: service.testedRuleCount,
        totalRuleCount: service.totalRuleCount,
      },
    ] as const),
  );
}

function buildSpofsByService(
  pipelineResult: PipelineResult,
  resourceToService: ReadonlyMap<string, string>,
  serviceNames: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly SpofInfo[]> {
  const spofsByService = new Map<string, SpofInfo[]>();

  for (const spof of pipelineResult.analysis?.spofs ?? []) {
    const serviceIds = new Set<string>();
    const ownerService = resourceToService.get(spof.nodeId);
    if (ownerService) {
      serviceIds.add(ownerService);
    }
    for (const impactedService of spof.impactedServices) {
      serviceIds.add(serviceNames.get(impactedService) ?? impactedService);
    }

    for (const serviceId of serviceIds) {
      const spofs = spofsByService.get(serviceId) ?? [];
      spofs.push({ nodeArn: spof.nodeId, mitigated: false });
      spofsByService.set(serviceId, spofs);
    }
  }

  return new Map(spofsByService);
}

async function fireMatchingHooks(input: {
  readonly evaluation: AllContractsEvaluationResult;
  readonly hookImplementation: ContractHook;
  readonly timestamp: string;
  readonly strongholdVersion: string;
}): Promise<readonly ContractHookFireInfo[]> {
  const hooksFired: ContractHookFireInfo[] = [];

  for (const contractResult of input.evaluation.contractResults) {
    const verdict = resolveContractVerdict(contractResult.summary);
    if (!isHookTriggerEvent(verdict)) {
      continue;
    }

    for (const hook of contractResult.contract.hooks) {
      if (!hook.on.includes(verdict)) {
        continue;
      }

      await safelyFireHook(input.hookImplementation, hook, buildHookPayload({
        contractResult,
        verdict,
        timestamp: input.timestamp,
        strongholdVersion: input.strongholdVersion,
      }));
      hooksFired.push({
        contractService: contractResult.contract.service,
        hook: { type: hook.type },
        trigger: verdict,
      });
    }
  }

  return hooksFired;
}

async function safelyFireHook(
  hookImplementation: ContractHook,
  hook: ContractHookConfig,
  payload: ContractHookPayload,
): Promise<void> {
  try {
    await hookImplementation.fire(hook, payload);
  } catch {
    // Hook adapters are notification side effects; contract enforcement remains deterministic.
  }
}

function buildHookPayload(input: {
  readonly contractResult: ContractEvaluationResult;
  readonly verdict: HookTriggerEvent;
  readonly timestamp: string;
  readonly strongholdVersion: string;
}): ContractHookPayload {
  return {
    event: 'contract_evaluated',
    timestamp: input.timestamp,
    strongholdVersion: input.strongholdVersion,
    contract: {
      service: input.contractResult.contract.service,
      enforcement: input.contractResult.contract.enforcement,
      verdict: input.verdict,
      summary: input.contractResult.summary,
    },
    violations: buildViolationSummaries(input.contractResult),
  };
}

function buildViolationSummaries(
  contractResult: ContractEvaluationResult,
): readonly ContractViolationSummary[] {
  return contractResult.results
    .filter((result) => result.verdict === 'violated')
    .map((result) => ({
      scenario: result.requirement.scenario,
      failedDimensions: result.dimensions
        .filter((dimension) => dimension.verdict === 'violated')
        .map((dimension) => ({
          dimension: dimension.dimension,
          required: dimension.required,
          actual: dimension.actual,
          reason: sanitizeHookText(dimension.reason),
        })),
    }));
}

function sanitizeHookText(value: string): string {
  return value
    .replace(/arn:[^\s,]+/giu, '[redacted-resource]')
    .replace(/\b\d{12}\b/gu, '[redacted-account]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, '[redacted-ip]');
}

function resolveContractVerdict(summary: ContractSummary): ContractVerdict {
  if (summary.violated > 0) {
    return 'violated';
  }
  if (summary.unknown > 0) {
    return 'unknown';
  }
  if (summary.met > 0 || summary.total === 0) {
    return 'met';
  }
  return 'not_applicable';
}

function isHookTriggerEvent(verdict: ContractVerdict): verdict is HookTriggerEvent {
  return verdict === 'met' || verdict === 'violated' || verdict === 'unknown';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
