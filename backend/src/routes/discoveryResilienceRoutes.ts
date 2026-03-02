import { appLogger } from "../utils/logger.js";
// ============================================================
// Discovery Resilience Routes — Auto-scan, jobs, schedules
// Bridges existing discovery with resilience graph ingestion
// ============================================================

import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import {
  ingestDiscoveredResources,
} from '../discovery/discoveryOrchestrator.js';
import { discoveryQueue } from '../queues/discoveryQueue.js';
import {
  getDemoSeedGuard,
  runDemoOnboarding,
  isDemoCompanySizeKey,
  isDemoSectorKey,
  type DemoFinancialFieldKey,
  type DemoProfileSelectionInput,
} from '../demo/index.js';
import { buildScanHealthReport } from '../services/discoveryHealthService.js';
import {
  encryptScanConfigCredentials,
  scanConfigHasPlaintextCredentials,
} from '../services/scanConfigSecurityService.js';
import { encryptDiscoveryCredentials } from '../services/discoveryService.js';
import { scanAws, scanAzure, scanGcp } from '../services/discoveryCloudConnectors.js';
import * as GraphService from '../graph/graphService.js';
import type {
  DiscoveryConnectorResult,
  DiscoveryCredentials,
} from '../services/discoveryTypes.js';
import {
  enqueueScheduledScanRun,
  intervalToCronExpression,
  mapScanScheduleForApi,
} from '../services/scheduledScanService.js';

const router = Router();

export const cloudScanAdapters = {
  aws: scanAws,
  azure: scanAzure,
  gcp: scanGcp,
};

export const cloudScanIngestor = {
  ingest: ingestDiscoveredResources,
};

const DEMO_FINANCIAL_FIELDS: DemoFinancialFieldKey[] = [
  'annualRevenue',
  'employeeCount',
  'annualITBudget',
  'drBudgetPercent',
  'hourlyDowntimeCost',
];

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseDemoSeedProfileInput(body: unknown):
  | { ok: true; value: DemoProfileSelectionInput }
  | { ok: false; error: string; details: Array<{ field: string; message: string }> } {
  if (body == null || body === '') {
    return { ok: true, value: {} };
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      error: 'Invalid payload',
      details: [{ field: 'body', message: 'Expected JSON object' }],
    };
  }

  const payload = body as Record<string, unknown>;
  const details: Array<{ field: string; message: string }> = [];
  const input: DemoProfileSelectionInput = {};

  if (payload.sector !== undefined) {
    if (!isDemoSectorKey(payload.sector)) {
      details.push({ field: 'sector', message: 'Unsupported demo sector' });
    } else {
      input.sector = payload.sector;
    }
  }

  if (payload.companySize !== undefined) {
    if (!isDemoCompanySizeKey(payload.companySize)) {
      details.push({ field: 'companySize', message: 'Unsupported company size' });
    } else {
      input.companySize = payload.companySize;
    }
  }

  if (payload.financialOverrides !== undefined) {
    if (
      payload.financialOverrides == null ||
      typeof payload.financialOverrides !== 'object' ||
      Array.isArray(payload.financialOverrides)
    ) {
      details.push({
        field: 'financialOverrides',
        message: 'Expected object with numeric overrides',
      });
    } else {
      const parsedOverrides: Partial<Record<DemoFinancialFieldKey, number>> = {};
      const rawOverrides = payload.financialOverrides as Record<string, unknown>;
      for (const field of DEMO_FINANCIAL_FIELDS) {
        if (rawOverrides[field] === undefined) continue;
        const parsed = parsePositiveNumber(rawOverrides[field]);
        if (parsed == null) {
          details.push({
            field: `financialOverrides.${field}`,
            message: 'Expected positive number',
          });
          continue;
        }
        parsedOverrides[field] = parsed;
      }
      input.financialOverrides = parsedOverrides;
    }
  }

  if (details.length > 0) {
    return {
      ok: false,
      error: 'Invalid demo profile payload',
      details,
    };
  }

  return { ok: true, value: input };
}

type CloudProviderType = 'aws' | 'azure' | 'gcp';
type CloudProviderCredentials = Record<string, string>;
type IgnoredProvider = { provider: string; reason: string };

type AdapterStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

type AutoScanAdapter = {
  adapter: string;
  provider: string;
  status: AdapterStatus;
  resourcesFound: number;
  error?: string;
};

type AutoScanJobResponse = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  adapters: AutoScanAdapter[];
  nodesFound: number;
  edgesFound: number;
  inferredEdges: number;
  startedAt: string | null;
  completedAt: string | null;
  error?: string;
  scannedProviders: string[];
  ignoredProviders: IgnoredProvider[];
  failedProviders: string[];
  warnings: string[];
};

type ResolvedCloudScanProvider = {
  provider: CloudProviderType;
  credentials: CloudProviderCredentials;
  regions: string[];
};

type CloudScanProviderSummary = {
  provider: string;
  status: 'scanned' | 'failed';
  resources: number;
  flows: number;
  warnings: string[];
  regions?: string[];
  error?: string;
};

type CloudScanProviderError = {
  provider: string;
  message: string;
  kind: 'aws-sdk' | 'scan';
};

const SUPPORTED_CLOUD_PROVIDERS: CloudProviderType[] = ['aws', 'azure', 'gcp'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProviderType(value: unknown): CloudProviderType | null {
  const candidate = readTrimmedString(value)?.toLowerCase();
  if (!candidate) return null;
  if (candidate === 'aws' || candidate === 'azure' || candidate === 'gcp') return candidate;
  return null;
}

function parseGcpServiceAccountJson(raw: unknown): CloudProviderCredentials | null {
  const jsonString = readTrimmedString(raw);
  if (!jsonString) return null;
  try {
    const parsed = JSON.parse(jsonString) as Record<string, unknown>;
    const projectId = readTrimmedString(parsed.project_id) || readTrimmedString(parsed.projectId);
    const clientEmail = readTrimmedString(parsed.client_email) || readTrimmedString(parsed.clientEmail);
    const privateKey = readTrimmedString(parsed.private_key) || readTrimmedString(parsed.privateKey);
    if (!projectId || !clientEmail || !privateKey) return null;
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

function resolveAwsCredentials(
  credentials: Record<string, unknown>,
  regions: string[]
): { value: CloudProviderCredentials | null; reason?: string } {
  const accessKeyId = readTrimmedString(credentials.accessKeyId);
  const secretAccessKey = readTrimmedString(credentials.secretAccessKey);
  const sessionToken = readTrimmedString(credentials.sessionToken);
  const roleArn = readTrimmedString(credentials.roleArn);
  const externalId = readTrimmedString(credentials.externalId);
  const regionFromCredential = readTrimmedString(credentials.region);
  const selectedRegion = regions.find((region) => region.length > 0) || null;
  const region = selectedRegion || regionFromCredential;

  const hasStaticKeys = Boolean(accessKeyId && secretAccessKey);
  if (!hasStaticKeys && !roleArn) {
    return { value: null, reason: 'AWS credentials missing (accessKeyId/secretAccessKey or roleArn required)' };
  }

  const value: CloudProviderCredentials = {};
  if (hasStaticKeys) {
    value.accessKeyId = accessKeyId as string;
    value.secretAccessKey = secretAccessKey as string;
  }
  if (sessionToken) value.sessionToken = sessionToken;
  if (roleArn) value.roleArn = roleArn;
  if (externalId) value.externalId = externalId;
  if (region) value.region = region;
  return { value };
}

function resolveAzureCredentials(
  credentials: Record<string, unknown>
): { value: CloudProviderCredentials | null; reason?: string } {
  const tenantId = readTrimmedString(credentials.tenantId);
  const clientId = readTrimmedString(credentials.clientId);
  const clientSecret = readTrimmedString(credentials.clientSecret);
  const subscriptionId = readTrimmedString(credentials.subscriptionId);

  if (!tenantId || !clientId || !clientSecret || !subscriptionId) {
    return {
      value: null,
      reason: 'Azure credentials missing (tenantId, clientId, clientSecret, subscriptionId required)',
    };
  }

  return {
    value: {
      tenantId,
      clientId,
      clientSecret,
      subscriptionId,
    },
  };
}

function resolveGcpCredentials(
  credentials: Record<string, unknown>
): { value: CloudProviderCredentials | null; reason?: string } {
  const fromJson = parseGcpServiceAccountJson(credentials.serviceAccountJson);
  if (fromJson) return { value: fromJson };

  const projectId = readTrimmedString(credentials.projectId);
  const clientEmail = readTrimmedString(credentials.clientEmail);
  const privateKey = readTrimmedString(credentials.privateKey);

  if (!projectId || !clientEmail || !privateKey) {
    return {
      value: null,
      reason: 'GCP credentials missing (serviceAccountJson or projectId/clientEmail/privateKey required)',
    };
  }

  return {
    value: {
      projectId,
      clientEmail,
      privateKey,
    },
  };
}

function resolveCloudProviderCredentials(
  provider: CloudProviderType,
  credentials: Record<string, unknown>,
  regions: string[]
): { value: CloudProviderCredentials | null; reason?: string } {
  if (provider === 'aws') return resolveAwsCredentials(credentials, regions);
  if (provider === 'azure') return resolveAzureCredentials(credentials);
  return resolveGcpCredentials(credentials);
}

function normalizeRegionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readTrimmedString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function resolveConfiguredCloudProviders(rawProviders: unknown): {
  providers: CloudProviderType[];
  credentials: Record<string, CloudProviderCredentials>;
  ignoredProviders: IgnoredProvider[];
} {
  const providers = Array.isArray(rawProviders) ? rawProviders : [];
  const configuredProviders = new Map<CloudProviderType, CloudProviderCredentials>();
  const ignoredProviders: IgnoredProvider[] = [];

  for (const entry of providers) {
    if (!isRecord(entry)) {
      ignoredProviders.push({ provider: 'unknown', reason: 'Invalid provider payload' });
      continue;
    }
    const provider = normalizeProviderType(entry.type ?? entry.provider);
    if (!provider) {
      ignoredProviders.push({
        provider: readTrimmedString(entry.type ?? entry.provider) || 'unknown',
        reason: `Unsupported provider. Supported values: ${SUPPORTED_CLOUD_PROVIDERS.join(', ')}`,
      });
      continue;
    }

    const credentials = isRecord(entry.credentials) ? entry.credentials : {};
    const regions = normalizeRegionList(entry.regions);
    const resolved = resolveCloudProviderCredentials(provider, credentials, regions);
    if (!resolved.value) {
      ignoredProviders.push({ provider, reason: resolved.reason || 'Credentials are incomplete' });
      continue;
    }

    configuredProviders.set(provider, resolved.value);
  }

  return {
    providers: Array.from(configuredProviders.keys()),
    credentials: Object.fromEntries(configuredProviders.entries()),
    ignoredProviders,
  };
}

function resolveCloudScanProviders(rawProviders: unknown): {
  providers: ResolvedCloudScanProvider[];
  ignoredProviders: IgnoredProvider[];
} {
  const providers = Array.isArray(rawProviders) ? rawProviders : [];
  const configuredProviders = new Map<CloudProviderType, ResolvedCloudScanProvider>();
  const ignoredProviders: IgnoredProvider[] = [];

  for (const entry of providers) {
    if (!isRecord(entry)) {
      ignoredProviders.push({ provider: 'unknown', reason: 'Invalid provider payload' });
      continue;
    }

    const provider = normalizeProviderType(entry.type ?? entry.provider);
    if (!provider) {
      ignoredProviders.push({
        provider: readTrimmedString(entry.type ?? entry.provider) || 'unknown',
        reason: `Unsupported provider. Supported values: ${SUPPORTED_CLOUD_PROVIDERS.join(', ')}`,
      });
      continue;
    }

    const credentials = isRecord(entry.credentials) ? entry.credentials : {};
    const regions = normalizeRegionList(entry.regions);
    const resolved = resolveCloudProviderCredentials(provider, credentials, regions);
    if (!resolved.value) {
      ignoredProviders.push({ provider, reason: resolved.reason || 'Credentials are incomplete' });
      continue;
    }

    configuredProviders.set(provider, {
      provider,
      credentials: resolved.value,
      regions,
    });
  }

  return {
    providers: Array.from(configuredProviders.values()),
    ignoredProviders,
  };
}

function toDiscoveryCredentials(
  provider: CloudProviderType,
  credentials: CloudProviderCredentials
): DiscoveryCredentials {
  if (provider === 'aws') {
    const aws: NonNullable<DiscoveryCredentials['aws']> = {};
    const accessKeyId = readTrimmedString(credentials.accessKeyId);
    const secretAccessKey = readTrimmedString(credentials.secretAccessKey);
    const sessionToken = readTrimmedString(credentials.sessionToken);
    const region = readTrimmedString(credentials.region);
    const roleArn = readTrimmedString(credentials.roleArn);
    const externalId = readTrimmedString(credentials.externalId);

    if (accessKeyId) aws.accessKeyId = accessKeyId;
    if (secretAccessKey) aws.secretAccessKey = secretAccessKey;
    if (sessionToken) aws.sessionToken = sessionToken;
    if (region) aws.region = region;
    if (roleArn) aws.roleArn = roleArn;
    if (externalId) aws.externalId = externalId;

    return { aws };
  }

  if (provider === 'azure') {
    const azure: NonNullable<DiscoveryCredentials['azure']> = {};
    const tenantId = readTrimmedString(credentials.tenantId);
    const clientId = readTrimmedString(credentials.clientId);
    const clientSecret = readTrimmedString(credentials.clientSecret);
    const subscriptionId = readTrimmedString(credentials.subscriptionId);

    if (tenantId) azure.tenantId = tenantId;
    if (clientId) azure.clientId = clientId;
    if (clientSecret) azure.clientSecret = clientSecret;
    if (subscriptionId) azure.subscriptionId = subscriptionId;

    return { azure };
  }

  const gcp: NonNullable<DiscoveryCredentials['gcp']> = {};
  const projectId = readTrimmedString(credentials.projectId);
  const clientEmail = readTrimmedString(credentials.clientEmail);
  const privateKey = readTrimmedString(credentials.privateKey);

  if (projectId) gcp.projectId = projectId;
  if (clientEmail) gcp.clientEmail = clientEmail;
  if (privateKey) gcp.privateKey = privateKey;

  return { gcp };
}

function resolveOnPremIpRanges(onPremise: unknown): string[] {
  if (!isRecord(onPremise) || !Array.isArray(onPremise.ipRanges)) return [];
  return onPremise.ipRanges
    .map((entry) => readTrimmedString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function resolveKubernetesCredentials(kubernetes: unknown): Record<string, string> | null {
  if (!Array.isArray(kubernetes)) return null;
  for (const cluster of kubernetes) {
    if (!isRecord(cluster)) continue;
    const kubeconfig = readTrimmedString(cluster.kubeconfig);
    if (!kubeconfig) continue;
    const context = readTrimmedString(cluster.context);
    const name = readTrimmedString(cluster.name);
    return {
      kubeconfig,
      ...(context ? { context } : {}),
      ...(name ? { name } : {}),
    };
  }
  return null;
}

function parseDiscoveryJobJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapDiscoveryJobStatus(status: unknown): 'pending' | 'running' | 'completed' | 'failed' {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'QUEUED') return 'pending';
  if (normalized === 'RUNNING') return 'running';
  if (normalized === 'COMPLETED') return 'completed';
  return 'failed';
}

function resolveFailedProviders(warnings: string[], providers: string[]): string[] {
  const loweredWarnings = warnings.map((warning) => warning.toLowerCase());
  return providers.filter((provider) =>
    loweredWarnings.some((warning) => warning.includes(provider.toLowerCase()))
  );
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildAutoScanJobResponse(job: {
  id: string;
  status: string;
  progress: number;
  parameters: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}): AutoScanJobResponse {
  const parameters = parseDiscoveryJobJson(job.parameters);
  const resultSummary = parseDiscoveryJobJson(job.resultSummary);
  const scannedProviders = Array.isArray(parameters.cloudProviders)
    ? parameters.cloudProviders
        .map((provider) => readTrimmedString(provider))
        .filter((provider): provider is string => Boolean(provider))
    : [];
  const ignoredProviders = Array.isArray(parameters.ignoredProviders)
    ? parameters.ignoredProviders
        .map((entry) => {
          if (!isRecord(entry)) return null;
          const provider = readTrimmedString(entry.provider);
          const reason = readTrimmedString(entry.reason);
          if (!provider || !reason) return null;
          return { provider, reason };
        })
        .filter((entry): entry is IgnoredProvider => Boolean(entry))
    : [];

  const warnings = Array.isArray(resultSummary.warnings)
    ? resultSummary.warnings
        .map((warning) => readTrimmedString(warning))
        .filter((warning): warning is string => Boolean(warning))
    : [];
  const failedProviders = resolveFailedProviders(warnings, scannedProviders);
  const status = mapDiscoveryJobStatus(job.status);
  const defaultAdapterStatus: AdapterStatus =
    status === 'pending' ? 'pending' : status === 'running' ? 'running' : status === 'failed' ? 'failed' : 'completed';

  const adapters: AutoScanAdapter[] = [
    ...scannedProviders.map((provider) => {
      const failed = failedProviders.includes(provider);
      return {
        adapter: provider,
        provider,
        status: status === 'completed' && failed ? 'failed' : defaultAdapterStatus,
        resourcesFound: toNumber(resultSummary.discoveredResources, 0),
        ...(status === 'completed' && failed ? { error: `Scan ${provider} failed` } : {}),
      };
    }),
    ...ignoredProviders.map((entry) => ({
      adapter: `${entry.provider}-ignored`,
      provider: entry.provider,
      status: 'skipped' as const,
      resourcesFound: 0,
      error: entry.reason,
    })),
  ];

  return {
    id: job.id,
    status,
    progress: toNumber(job.progress, 0),
    adapters,
    nodesFound: toNumber(resultSummary.discoveredResources, 0),
    edgesFound: toNumber(resultSummary.discoveredFlows, 0),
    inferredEdges: toNumber(resultSummary.inferredEdges, 0),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    ...(job.errorMessage ? { error: job.errorMessage } : {}),
    scannedProviders,
    ignoredProviders,
    failedProviders,
    warnings,
  };
}

function normalizeIntervalMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 24 * 60;
  if (parsed <= 60) return 60;
  if (parsed <= 24 * 60) return 24 * 60;
  return 7 * 24 * 60;
}

function hasScheduleSources(scanConfig: Record<string, unknown>): boolean {
  const providers = Array.isArray(scanConfig.providers) ? scanConfig.providers : [];
  const hasCloudProviders = providers.length > 0;
  const hasKubernetes = Array.isArray(scanConfig.kubernetes) && scanConfig.kubernetes.length > 0;
  const onPremise = isRecord(scanConfig.onPremise) ? scanConfig.onPremise : {};
  const onPremiseRanges = Array.isArray(onPremise.ipRanges) ? onPremise.ipRanges : [];
  const hasOnPremise = onPremiseRanges.some((entry) => readTrimmedString(entry));
  return hasCloudProviders || hasKubernetes || hasOnPremise;
}

type TimelineSummary = {
  discoveredResources?: number;
  discoveredFlows?: number;
  warnings?: string[];
};

// ─── POST /discovery/auto-scan — Launch automated scan ──────────
// ─── POST /discovery/cloud-scan — Scan configured cloud providers now ──────────
router.post('/cloud-scan', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    console.info(`[CLOUD-SCAN] tenant=${tenantId} request.received`);

    const configured = resolveCloudScanProviders(req.body?.providers);
    if (configured.providers.length === 0) {
      console.info(`[CLOUD-SCAN] tenant=${tenantId} request.rejected reason=no-valid-provider`);
      return res.status(400).json({
        error: 'At least one provider with valid credentials is required',
        ignoredProviders: configured.ignoredProviders,
      });
    }

    const inferDependencies = !(
      isRecord(req.body) &&
      isRecord(req.body.options) &&
      req.body.options.inferDependencies === false
    );

    const discoveredResources: DiscoveryConnectorResult['resources'] = [];
    const discoveredFlows: DiscoveryConnectorResult['flows'] = [];
    const warnings: string[] = [];
    const providerSummaries: CloudScanProviderSummary[] = [];
    const providerErrors: CloudScanProviderError[] = [];
    const scannedProviders: string[] = [];
    const failedProviders: string[] = [];

    for (const providerConfig of configured.providers) {
      const provider = providerConfig.provider;
      const regionSuffix =
        providerConfig.regions.length > 0 ? ` regions=${providerConfig.regions.join(',')}` : '';
      console.info(`[CLOUD-SCAN] tenant=${tenantId} provider=${provider} scan.start${regionSuffix}`);

      try {
        const credentials = toDiscoveryCredentials(provider, providerConfig.credentials);
        let connectorResult: DiscoveryConnectorResult;

        if (provider === 'aws') {
          const options = providerConfig.regions.length > 0 ? { regions: providerConfig.regions } : {};
          connectorResult = await cloudScanAdapters.aws(credentials, options);
        } else if (provider === 'azure') {
          connectorResult = await cloudScanAdapters.azure(credentials);
        } else {
          connectorResult = await cloudScanAdapters.gcp(credentials);
        }

        discoveredResources.push(...connectorResult.resources);
        discoveredFlows.push(...connectorResult.flows);
        warnings.push(...connectorResult.warnings.map((warning) => `${provider}: ${warning}`));
        scannedProviders.push(provider);

        providerSummaries.push({
          provider,
          status: 'scanned',
          resources: connectorResult.resources.length,
          flows: connectorResult.flows.length,
          warnings: connectorResult.warnings,
          ...(providerConfig.regions.length > 0 ? { regions: providerConfig.regions } : {}),
        });

        console.info(
          `[CLOUD-SCAN] tenant=${tenantId} provider=${provider} scan.completed resources=${connectorResult.resources.length} flows=${connectorResult.flows.length} warnings=${connectorResult.warnings.length}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown provider scan error';
        failedProviders.push(provider);
        providerErrors.push({
          provider,
          message,
          kind: provider === 'aws' ? 'aws-sdk' : 'scan',
        });
        providerSummaries.push({
          provider,
          status: 'failed',
          resources: 0,
          flows: 0,
          warnings: [],
          error: message,
          ...(providerConfig.regions.length > 0 ? { regions: providerConfig.regions } : {}),
        });

        console.error(`[CLOUD-SCAN] tenant=${tenantId} provider=${provider} scan.failed error=${message}`);
      }
    }

    console.info(
      `[CLOUD-SCAN] tenant=${tenantId} ingest.start resources=${discoveredResources.length} flows=${discoveredFlows.length} inferDependencies=${inferDependencies}`
    );

    const ingestReport =
      discoveredResources.length > 0 || discoveredFlows.length > 0
        ? await cloudScanIngestor.ingest(
            prisma,
            tenantId,
            discoveredResources,
            discoveredFlows,
            'cloud-scan',
            { inferDependencies }
          )
        : null;

    if (ingestReport) {
      console.info(
        `[CLOUD-SCAN] tenant=${tenantId} ingest.completed totalNodes=${ingestReport.totalNodes} totalEdges=${ingestReport.totalEdges}`
      );
    } else {
      console.info(`[CLOUD-SCAN] tenant=${tenantId} ingest.skipped reason=no-discovered-resource`);
    }

    const summary = {
      nodes: ingestReport?.totalNodes ?? 0,
      edges: ingestReport?.totalEdges ?? 0,
      providersScanned: scannedProviders.length,
      resourcesDiscovered: discoveredResources.length,
      flowsDiscovered: discoveredFlows.length,
    };
    const partial = providerErrors.length > 0;

    console.info(
      `[CLOUD-SCAN] tenant=${tenantId} request.completed partial=${partial} scanned=${scannedProviders.length} failed=${failedProviders.length} ignored=${configured.ignoredProviders.length}`
    );

    return res.status(200).json({
      success: !partial,
      partial,
      summary,
      scannedProviders,
      failedProviders,
      ignoredProviders: configured.ignoredProviders,
      providers: providerSummaries,
      warnings,
      errors: providerErrors,
      ...(ingestReport ? { ingestReport } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[CLOUD-SCAN] route.failed error=${message}`);
    appLogger.error('Error running cloud-scan:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/auto-scan', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { providers, kubernetes, onPremise, options } = req.body;
    const configuredCloudProviders = resolveConfiguredCloudProviders(providers);
    const ipRanges = resolveOnPremIpRanges(onPremise);
    const kubernetesCredentials = resolveKubernetesCredentials(kubernetes);
    const hasCloudProviders = configuredCloudProviders.providers.length > 0;
    const hasKubernetes = Boolean(kubernetesCredentials);
    const hasOnPremise = ipRanges.length > 0;

    if (!hasCloudProviders && !hasKubernetes && !hasOnPremise) {
      return res.status(400).json({
        error: 'At least one discovery source is required (cloud, kubernetes, or on-premise)',
        ignoredProviders: configuredCloudProviders.ignoredProviders,
      });
    }

    const combinedCredentials: Record<string, unknown> = {
      ...configuredCloudProviders.credentials,
      ...(kubernetesCredentials ? { kubernetes: kubernetesCredentials } : {}),
    };
    let encryptedCredentials: { ciphertext: string; iv: string; tag: string } | null = null;
    if (Object.keys(combinedCredentials).length > 0) {
      const secret = process.env.DISCOVERY_SECRET;
      if (!secret) {
        return res.status(400).json({
          error: 'Configuration manquante',
          details: [{ field: 'credentials', message: 'DISCOVERY_SECRET requis pour chiffrer les cles' }],
        });
      }
      encryptedCredentials = encryptDiscoveryCredentials(combinedCredentials, secret);
    }

    const job = await prisma.discoveryJob.create({
      data: {
        tenantId,
        status: 'QUEUED',
        jobType: 'AUTO_SCAN',
        progress: 0,
        step: 'QUEUED',
        parameters: JSON.stringify({
          ipRanges,
          cloudProviders: configuredCloudProviders.providers,
          ignoredProviders: configuredCloudProviders.ignoredProviders,
          requestedBy: req.apiKeyId ?? null,
          autoCreate: false,
          inferDependencies: options?.inferDependencies !== false,
        }),
        ...(encryptedCredentials
          ? {
              credentialsCiphertext: encryptedCredentials.ciphertext,
              credentialsIv: encryptedCredentials.iv,
              credentialsTag: encryptedCredentials.tag,
            }
          : {}),
        requestedByApiKeyId: req.apiKeyId ?? null,
      },
    });

    if (ipRanges.length > 0) {
      await prisma.discoveryScanAudit.createMany({
        data: ipRanges.map((range) => ({
          tenantId,
          jobId: job.id,
          apiKeyId: req.apiKeyId ?? null,
          ipRange: range,
        })),
      });
    }

    try {
      await discoveryQueue.add('discovery.run', {
        jobId: job.id,
        tenantId,
        ipRanges,
        cloudProviders: configuredCloudProviders.providers,
        requestedBy: req.apiKeyId ?? null,
      });
    } catch (queueError) {
      const message = queueError instanceof Error ? queueError.message : 'Queue enqueue failed';
      await prisma.discoveryJob.updateMany({
        where: { id: job.id, tenantId },
        data: {
          status: 'FAILED',
          step: 'FAILED',
          errorMessage: message,
          completedAt: new Date(),
        },
      });
    }

    return res.json({
      jobId: job.id,
      status: 'queued',
      scannedProviders: configuredCloudProviders.providers,
      ignoredProviders: configuredCloudProviders.ignoredProviders,
    });
  } catch (error) {
    appLogger.error('Error launching auto-scan:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /discovery/scan-jobs/:jobId — Track scan job progress ──────────
router.get('/scan-jobs/:jobId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const jobId = req.params.jobId as string;
    const job = await prisma.discoveryJob.findFirst({
      where: { id: jobId, tenantId },
      select: {
        id: true,
        status: true,
        progress: true,
        parameters: true,
        resultSummary: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Scan job not found' });
    }

    return res.json(buildAutoScanJobResponse(job));
  } catch (error) {
    appLogger.error('Error fetching scan job status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /discovery/scan-jobs — List scan jobs ──────────
router.get('/scan-jobs', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const limit = parseInt(req.query.limit as string) || 20;
    const jobs = await prisma.discoveryJob.findMany({
      where: { tenantId, jobType: { in: ['AUTO_SCAN', 'SCHEDULED_SCAN'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        progress: true,
        parameters: true,
        resultSummary: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
      },
    });

    return res.json({ jobs: jobs.map((job) => buildAutoScanJobResponse(job)) });
  } catch (error) {
    appLogger.error('Error listing scan jobs:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /discovery/schedules — Configure recurring scan ──────────
router.post('/schedules', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { enabled, intervalMinutes, cronExpression, providers, kubernetes, onPremise, options } = req.body || {};
    const scheduleEnabled = enabled !== false;
    const normalizedProviders = Array.isArray(providers) ? providers : [];
    const normalizedIntervalMinutes = normalizeIntervalMinutes(intervalMinutes);
    const effectiveCron = readTrimmedString(cronExpression) || intervalToCronExpression(normalizedIntervalMinutes);
    const scanConfig = {
      providers: normalizedProviders,
      kubernetes,
      onPremise,
      options: {
        ...(isRecord(options) ? options : {}),
        scanIntervalMinutes: normalizedIntervalMinutes,
      },
    };

    if (scheduleEnabled && !hasScheduleSources(scanConfig)) {
      return res.status(400).json({
        error: 'At least one discovery source is required (cloud, kubernetes, or on-premise)',
      });
    }

    if (
      scanConfigHasPlaintextCredentials(scanConfig) &&
      !process.env.CREDENTIAL_ENCRYPTION_KEY
    ) {
      return res.status(400).json({
        error: 'Configuration manquante',
        details: [{ field: 'credentials', message: 'CREDENTIAL_ENCRYPTION_KEY requis' }],
      });
    }

    const encryptedConfig = encryptScanConfigCredentials(scanConfig) as Prisma.InputJsonValue;
    const existingSchedules = await prisma.scanSchedule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    const primarySchedule = existingSchedules[0] ?? null;
    const nextRunAt = scheduleEnabled ? new Date(Date.now() + normalizedIntervalMinutes * 60 * 1000) : null;

    const savedSchedule = primarySchedule
      ? await (async () => {
          await prisma.scanSchedule.updateMany({
            where: {
              id: primarySchedule.id,
              tenantId,
            },
            data: {
              cronExpression: effectiveCron,
              config: encryptedConfig,
              isActive: scheduleEnabled,
              nextRunAt,
            },
          });
          return prisma.scanSchedule.findFirstOrThrow({
            where: {
              id: primarySchedule.id,
              tenantId,
            },
          });
        })()
      : await prisma.scanSchedule.create({
          data: {
            tenantId,
            cronExpression: effectiveCron,
            config: encryptedConfig,
            isActive: scheduleEnabled,
            nextRunAt,
          },
        });

    if (existingSchedules.length > 1) {
      const staleIds = existingSchedules.slice(1).map((schedule) => schedule.id);
      await prisma.scanSchedule.updateMany({
        where: { id: { in: staleIds }, tenantId },
        data: { isActive: false, nextRunAt: null },
      });
    }

    return res.status(201).json({
      schedule: mapScanScheduleForApi(savedSchedule),
    });
  } catch (error) {
    appLogger.error('Error creating scan schedule:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /discovery/schedules — List scan schedules ──────────
router.get('/schedules', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const schedules = await prisma.scanSchedule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return res.json({
      schedules: schedules.map((schedule) => mapScanScheduleForApi(schedule)),
    });
  } catch (error) {
    appLogger.error('Error listing scan schedules:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /discovery/graph — Graph export shortcut for validation scripts ──────────
// Trigger an immediate run using the currently active scheduled configuration.
router.post('/schedules/run-now', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const schedule = await prisma.scanSchedule.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!schedule) {
      return res.status(404).json({ error: 'No active schedule configured' });
    }

    const jobId = await enqueueScheduledScanRun(schedule, {
      trigger: 'manual',
      now: new Date(),
    });
    if (!jobId) {
      return res.status(400).json({
        error: 'Unable to enqueue scheduled scan. Verify providers and credentials.',
      });
    }

    return res.json({ jobId, status: 'queued' });
  } catch (error) {
    appLogger.error('Error running scheduled scan now:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Return recent discovery runs with drift summaries for dashboard timeline widgets.
router.get('/scan-timeline', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));
    const history = await prisma.discoveryHistory.findMany({
      where: { tenantId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        jobId: true,
        jobType: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        summary: true,
      },
    });

    const entries = await Promise.all(history.map(async (entry) => {
      const summary = (entry.summary && typeof entry.summary === 'object' && !Array.isArray(entry.summary)
        ? (entry.summary as TimelineSummary)
        : {}) as TimelineSummary;
      const referenceDate = entry.completedAt || entry.createdAt;

      const graphSnapshot = await prisma.graphAnalysis.findFirst({
        where: {
          tenantId,
          createdAt: { lte: referenceDate },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          totalNodes: true,
          totalEdges: true,
          spofCount: true,
        },
      });

      const snapshot = entry.jobId
        ? await prisma.infraSnapshot.findFirst({
            where: {
              tenantId,
              scanId: entry.jobId,
            },
            orderBy: { capturedAt: 'desc' },
            select: { id: true },
          })
        : null;

      const drifts = snapshot
        ? await prisma.driftEvent.findMany({
            where: { tenantId, snapshotId: snapshot.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true, severity: true, description: true },
            take: 5,
          })
        : [];

      return {
        id: entry.id,
        jobId: entry.jobId,
        type: entry.jobType === 'SCHEDULED_SCAN' ? 'scheduled' : 'manual',
        occurredAt: referenceDate.toISOString(),
        nodes: graphSnapshot?.totalNodes ?? Number(summary.discoveredResources || 0),
        edges: graphSnapshot?.totalEdges ?? Number(summary.discoveredFlows || 0),
        spofCount: graphSnapshot?.spofCount ?? 0,
        driftCount: drifts.length,
        drifts: drifts.map((drift) => ({
          id: drift.id,
          severity: drift.severity,
          description: drift.description,
        })),
      };
    }));

    return res.json({ entries });
  } catch (error) {
    appLogger.error('Error fetching scan timeline:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/graph', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);
    const data = GraphService.exportForVisualization(graph);
    const stats = GraphService.getGraphStats(graph);
    return res.json({ ...data, stats });
  } catch (error) {
    appLogger.error('Error fetching discovery graph shortcut:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /discovery/ingest — Direct ingest from external source ──────────
// Allows direct ingestion of discovered resources into the resilience graph
// without going through the full scan pipeline.
router.post('/ingest', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { resources, flows, provider, inferDependencies: infer } = req.body;

    if (!resources || !Array.isArray(resources)) {
      return res.status(400).json({ error: 'resources array is required' });
    }

    const report = await ingestDiscoveredResources(
      prisma,
      tenantId,
      resources,
      flows || [],
      provider || 'manual',
      { inferDependencies: infer !== false }
    );

    return res.json(report);
  } catch (error) {
    appLogger.error('Error ingesting discovery resources:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /discovery/test-credentials — Test provider credentials ──────────
router.post('/test-credentials', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { provider, credentials } = req.body;
    if (!provider || !credentials) {
      return res.status(400).json({ error: 'provider and credentials are required' });
    }

    const normalizedProvider = normalizeProviderType(provider);
    if (!normalizedProvider) {
      return res.status(400).json({
        success: false,
        message: `Unsupported provider. Supported values: ${SUPPORTED_CLOUD_PROVIDERS.join(', ')}`,
      });
    }
    if (!isRecord(credentials)) {
      return res.status(400).json({
        success: false,
        message: 'credentials must be an object',
      });
    }

    const resolved = resolveCloudProviderCredentials(normalizedProvider, credentials, []);
    if (!resolved.value) {
      return res.status(400).json({
        success: false,
        message: resolved.reason || 'Credentials are incomplete',
        provider: normalizedProvider,
      });
    }

    return res.json({
      success: true,
      message: `Credentials for ${normalizedProvider} appear valid (format check only)`,
      provider: normalizedProvider,
    });
  } catch (error) {
    appLogger.error('Error testing credentials:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});



// ─── GET /discovery/health — Scan health dashboard ──────────
router.get('/health', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: { code: 'ERR_500', message: 'Tenant not resolved' } });

    const report = await buildScanHealthReport(prisma, tenantId);
    return res.json({ data: report });
  } catch (error) {
    appLogger.error('Error fetching discovery health report:', error);
    return res.status(500).json({ error: { code: 'ERR_500', message: 'Internal server error' } });
  }
});

// ─── POST /discovery/seed-demo — Load demo environment (dev only) ──────────
router.post('/seed-demo', async (req: TenantRequest, res) => {
  try {
    const guard = getDemoSeedGuard();
    if (!guard.allowed) {
      return res.status(403).json({
        error: guard.reason,
        environment: guard.nodeEnv,
        mode: guard.mode,
      });
    }

    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const parsedProfileInput = parseDemoSeedProfileInput(req.body);
    if (!parsedProfileInput.ok) {
      return res.status(400).json({
        error: parsedProfileInput.error,
        details: parsedProfileInput.details,
      });
    }

    const summary = await runDemoOnboarding(prisma, tenantId, {
      profile: parsedProfileInput.value,
    });

    return res.json({
      success: true,
      message: `Demo onboarding completed for "${summary.demoProfile.sectorLabel}"`,
      environment: guard.nodeEnv,
      mode: guard.mode,
      ...summary,
    });
  } catch (error) {
    appLogger.error('Error seeding demo data:', error);
    return res.status(500).json({ error: 'Failed to seed demo data' });
  }
});

export default router;
