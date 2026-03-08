import type { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildLandingZoneFinancialContext } from './landing-zone-financial.service.js';
import {
  COMPLIANCE_DISCLAIMER,
  ComplianceService,
} from './compliance/complianceService.js';
import { appLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

type InfraNodeExport = {
  id: string;
  name: string;
  businessName: string | null;
  type: string;
  provider: string;
  metadata: unknown;
  isSPOF: boolean;
  blastRadius: number | null;
};

type SpofExport = {
  nodeId: string;
  name: string;
  type: string;
  blastRadius: number;
  ale: number;
};

type RecommendationExport = {
  nodeId: string;
  title: string;
  serviceName: string;
  strategy: string;
  monthlyCostDelta: number;
  annualCostDelta: number;
  paybackMonths: number | null;
  roi: number | null;
  quickWin: boolean;
};

type BiaServiceExport = {
  nodeId: string;
  name: string;
  tier: number;
  rtoMinutes: number | null;
  rpoMinutes: number | null;
};

type PythonRunResult = {
  stdout: string;
  stderr: string;
  command: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTier(value: unknown): number {
  const parsedNumber = toNumber(value);
  if (parsedNumber && parsedNumber >= 1 && parsedNumber <= 4) {
    return Math.round(parsedNumber);
  }

  if (typeof value === 'string') {
    const match = value.match(/([1-4])/);
    if (match?.[1]) {
      const fromString = Number(match[1]);
      if (Number.isFinite(fromString)) return fromString;
    }
  }

  return 3;
}

function resolveTier(node: InfraNodeExport): number {
  const metadata = asRecord(node.metadata);
  if (metadata) {
    const tierCandidate = metadata.tier ?? metadata.recoveryTier ?? metadata.criticalityTier;
    const tier = normalizeTier(tierCandidate);
    if (tier >= 1 && tier <= 4) return tier;
  }
  return 3;
}

function formatDateFr(date: Date): string {
  try {
    return date.toLocaleDateString('fr-FR');
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function parseGeneratorResponse(stdout: string): { success: boolean; slides?: number } {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reverse();

  for (const line of lines) {
    try {
      const payload = JSON.parse(line) as { success?: boolean; slides?: number };
      const parsed = {
        success: payload.success === true,
      } as { success: boolean; slides?: number };
      if (Number.isFinite(payload.slides)) {
        parsed.slides = Number(payload.slides);
      }
      return parsed;
    } catch {
      continue;
    }
  }

  throw new Error('PPTX generator did not return a valid JSON response');
}

function buildDownloadFilename(date = new Date()): string {
  return `stronghold-audit-${date.toISOString().slice(0, 10)}.pptx`;
}

export class PptxExportService {
  private readonly templatePath: string;
  private readonly scriptPath: string;
  private readonly landingZoneCache = new Map<string, ReturnType<typeof buildLandingZoneFinancialContext>>();
  private readonly complianceService: ComplianceService;

  constructor(private readonly prismaClient: PrismaClient) {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(moduleDir, '../..');

    this.templatePath = path.join(projectRoot, 'templates', 'Template_Stronghold.pptx');
    this.scriptPath = path.join(projectRoot, 'scripts', 'generate-pptx.py');
    this.complianceService = new ComplianceService(prismaClient);
  }

  static get mimeType(): string {
    return PPTX_MIME;
  }

  static getDownloadFilename(date = new Date()): string {
    return buildDownloadFilename(date);
  }

  async generateReport(tenantId: string): Promise<Buffer> {
    await this.assertRequiredFiles();

    const payload = await this.collectData(tenantId);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stronghold-pptx-'));
    const dataPath = path.join(tempDir, 'payload.json');
    const outputPath = path.join(tempDir, 'stronghold-report.pptx');

    try {
      await fs.writeFile(dataPath, JSON.stringify(payload), 'utf-8');
      const { stdout, stderr, command } = await this.runGenerator(dataPath, outputPath);
      if (stderr.trim().length > 0) {
        appLogger.warn('reports.pptx.generator_stderr', {
          tenantId,
          command,
          stderr: stderr.slice(0, 600),
        });
      }

      const parsed = parseGeneratorResponse(stdout);
      if (!parsed.success) {
        throw new Error('PPTX generator returned unsuccessful status');
      }

      const buffer = await fs.readFile(outputPath);
      appLogger.info('reports.pptx.generated', {
        tenantId,
        bytes: buffer.length,
        slides: parsed.slides ?? null,
      });

      return buffer;
    } finally {
      this.landingZoneCache.delete(tenantId);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async assertRequiredFiles(): Promise<void> {
    const checks = await Promise.all([
      fs.access(this.templatePath).then(
        () => true,
        () => false,
      ),
      fs.access(this.scriptPath).then(
        () => true,
        () => false,
      ),
    ]);

    if (!checks[0]) {
      throw new Error(`Stronghold template missing at ${this.templatePath}`);
    }
    if (!checks[1]) {
      throw new Error(`PPTX generator script missing at ${this.scriptPath}`);
    }
  }

  private async runGenerator(dataPath: string, outputPath: string): Promise<PythonRunResult> {
    const args = [
      this.scriptPath,
      '--data',
      dataPath,
      '--template',
      this.templatePath,
      '--output',
      outputPath,
    ];

    const preferred = [process.env.PPTX_PYTHON_BIN, process.env.PYTHON_BIN]
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim());
    const candidates = Array.from(new Set([...preferred, 'python3', 'python', 'py']));

    let lastError: unknown;
    for (const command of candidates) {
      try {
        const result = await execFileAsync(command, args, {
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          command,
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `Python runtime not found. Tried: ${candidates.join(', ')}. Last error: ${String(
        (lastError as Error | undefined)?.message || 'unknown',
      )}`,
    );
  }

  private async collectData(tenantId: string): Promise<Record<string, unknown>> {
    const settled = await Promise.allSettled([
      this.getTenantName(tenantId),
      this.getScanDate(tenantId),
      this.getResilienceScore(tenantId),
      this.getNodes(tenantId),
      this.getSpofs(tenantId),
      this.getRecommendations(tenantId),
      this.getBiaServices(tenantId),
      this.getLandingZoneContext(tenantId),
      this.getComplianceSummary(tenantId),
    ]);

    const tenantName = settled[0].status === 'fulfilled' ? settled[0].value : 'Client';
    const scanDate = settled[1].status === 'fulfilled' ? settled[1].value : formatDateFr(new Date());
    const resilienceScore = settled[2].status === 'fulfilled' ? settled[2].value : 0;
    const nodes = settled[3].status === 'fulfilled' ? settled[3].value : [];
    const spofs = settled[4].status === 'fulfilled' ? settled[4].value : [];
    const recommendations = settled[5].status === 'fulfilled' ? settled[5].value : [];
    const biaServices = settled[6].status === 'fulfilled' ? settled[6].value : [];
    const landingZone = settled[7].status === 'fulfilled' ? settled[7].value : null;
    const complianceSummary = settled[8].status === 'fulfilled'
      ? settled[8].value
      : { frameworks: [], disclaimer: COMPLIANCE_DISCLAIMER };

    const providers = Array.from(
      new Set(
        nodes
          .map((node) => node.provider)
          .filter((provider): provider is string => typeof provider === 'string' && provider.length > 0),
      ),
    );

    const servicesByTier = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
    for (const node of nodes) {
      const tier = resolveTier(node);
      if (tier === 1) servicesByTier.tier1 += 1;
      else if (tier === 2) servicesByTier.tier2 += 1;
      else if (tier === 4) servicesByTier.tier4 += 1;
      else servicesByTier.tier3 += 1;
    }

    const strategyMap = new Map<string, { count: number; annualCost: number }>();
    for (const recommendation of recommendations) {
      const strategy = recommendation.strategy?.trim() || 'other';
      const current = strategyMap.get(strategy) ?? { count: 0, annualCost: 0 };
      current.count += 1;
      current.annualCost += Number(recommendation.annualCostDelta || 0);
      strategyMap.set(strategy, current);
    }
    const totalStrategyAnnualCost = Array.from(strategyMap.values()).reduce(
      (sum, item) => sum + item.annualCost,
      0,
    );

    const budgetByStrategy = Array.from(strategyMap.entries())
      .map(([strategy, item]) => ({
        strategy,
        count: item.count,
        annualCost: Math.round(item.annualCost),
        percentage:
          totalStrategyAnnualCost > 0
            ? Number(((item.annualCost / totalStrategyAnnualCost) * 100).toFixed(1))
            : 0,
      }))
      .sort((left, right) => right.annualCost - left.annualCost);

    const spofNodeIds = new Set(spofs.map((item) => item.nodeId));
    const recommendationNodeIds = new Set(recommendations.map((item) => item.nodeId));
    const resilientByDesign = nodes.reduce((count, node) => {
      if (spofNodeIds.has(node.id)) return count;
      if (recommendationNodeIds.has(node.id)) return count;
      return count + 1;
    }, 0);

    const topSpofs = spofs.slice(0, 8).map((item) => ({
      name: item.name,
      type: item.type,
      blastRadius: item.blastRadius,
    }));

    const topRecommendations = recommendations.slice(0, 10).map((item) => ({
      title: item.title,
      service: item.serviceName,
      strategy: item.strategy,
      monthlyCost: Number(item.monthlyCostDelta || 0),
      quickWin: item.quickWin,
    }));

    const topBiaServices = biaServices.slice(0, 10).map((service) => ({
      name: service.name,
      tier: service.tier,
      rto: service.rtoMinutes != null ? `${service.rtoMinutes} min` : 'N/A',
      rpo: service.rpoMinutes != null ? `${service.rpoMinutes} min` : 'N/A',
    }));

    const totalDrCostAnnual =
      landingZone?.summary?.totalCostAnnual != null
        ? Math.round(landingZone.summary.totalCostAnnual)
        : Math.round(totalStrategyAnnualCost);
    const globalRoi =
      landingZone?.summary?.roiPercent != null
        ? Number(landingZone.summary.roiPercent.toFixed(2))
        : null;
    const totalAnnualSavings = Math.round(Number(landingZone?.roi?.netAnnualSavings || 0));
    const financialProfileConfigured = landingZone?.summary?.financialProfileConfigured === true;

    return {
      clientName: tenantName,
      scanDate,
      resilienceScore,
      totalNodes: nodes.length,
      spofCount: spofs.length,
      recommendationCount: recommendations.length,
      resilientByDesign,
      totalDrCostAnnual,
      financialProfileConfigured,
      globalRoi: globalRoi ?? 'N/A',
      totalAnnualSavings,
      providers,
      servicesByTier,
      topSpofs,
      topRecommendations,
      budgetByStrategy:
        budgetByStrategy.length > 0
          ? budgetByStrategy
          : [{ strategy: 'N/A', count: 0, annualCost: 0, percentage: 0 }],
      topBiaServices,
      compliance: complianceSummary,
    };
  }

  private async getTenantName(tenantId: string): Promise<string> {
    const tenant = await this.prismaClient.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return tenant?.name || 'Client';
  }

  private async getScanDate(tenantId: string): Promise<string> {
    const latest = await this.prismaClient.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return formatDateFr(latest?.createdAt ?? new Date());
  }

  private async getResilienceScore(tenantId: string): Promise<number> {
    const latest = await this.prismaClient.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { resilienceScore: true },
    });
    return Number(latest?.resilienceScore || 0);
  }

  private async getNodes(tenantId: string): Promise<InfraNodeExport[]> {
    const rows = await this.prismaClient.infraNode.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        businessName: true,
        type: true,
        provider: true,
        metadata: true,
        isSPOF: true,
        blastRadius: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      businessName: row.businessName,
      type: row.type,
      provider: row.provider,
      metadata: row.metadata,
      isSPOF: row.isSPOF,
      blastRadius: row.blastRadius,
    }));
  }

  private async getSpofs(tenantId: string): Promise<SpofExport[]> {
    const context = await this.getLandingZoneContext(tenantId);
    const fromAle = context.ale.aleBySPOF.map((spof) => ({
      nodeId: spof.nodeId,
      name: spof.nodeName || 'N/A',
      type: spof.nodeType || 'N/A',
      blastRadius: Number(spof.dependentsCount || 0),
      ale: Number(spof.ale || 0),
    }));
    if (fromAle.length > 0) {
      return fromAle.sort((left, right) => right.ale - left.ale);
    }

    const fallback = await this.prismaClient.infraNode.findMany({
      where: { tenantId, isSPOF: true },
      select: {
        id: true,
        name: true,
        businessName: true,
        type: true,
        blastRadius: true,
      },
      orderBy: { blastRadius: 'desc' },
      take: 20,
    });

    return fallback.map((node) => ({
      nodeId: node.id,
      name: node.businessName || node.name,
      type: node.type,
      blastRadius: Number(node.blastRadius || 0),
      ale: 0,
    }));
  }

  private async getRecommendations(tenantId: string): Promise<RecommendationExport[]> {
    const context = await this.getLandingZoneContext(tenantId);
    const sorted = [...context.recommendations].sort((left, right) => right.priority - left.priority);

    return sorted
      .filter((entry) => entry.status !== 'rejected')
      .map((entry) => {
        const title =
          entry.description?.trim().length > 0
            ? entry.description.trim()
            : `${entry.serviceDisplayName} - ${entry.strategy}`;
        const paybackMonths =
          entry.paybackMonths != null && Number.isFinite(entry.paybackMonths)
            ? Number(entry.paybackMonths)
            : null;
        const roi = entry.roi != null && Number.isFinite(entry.roi) ? Number(entry.roi) : null;
        return {
          nodeId: entry.nodeId,
          title,
          serviceName: entry.serviceDisplayName,
          strategy: entry.strategy,
          monthlyCostDelta: Number(entry.estimatedCost || 0),
          annualCostDelta: Number(entry.estimatedAnnualCost || 0),
          paybackMonths,
          roi,
          quickWin:
            paybackMonths != null &&
            paybackMonths <= 6 &&
            roi != null &&
            roi >= 100,
        };
      });
  }

  private async getBiaServices(tenantId: string): Promise<BiaServiceExport[]> {
    const latestReport = await this.prismaClient.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        processes: {
          select: {
            serviceNodeId: true,
            serviceName: true,
            recoveryTier: true,
            validatedRTO: true,
            validatedRPO: true,
            suggestedRTO: true,
            suggestedRPO: true,
            criticalityScore: true,
          },
          orderBy: [{ recoveryTier: 'asc' }, { criticalityScore: 'desc' }],
        },
      },
    });

    if (!latestReport) return [];

    return latestReport.processes.map((process) => ({
      nodeId: process.serviceNodeId,
      name: process.serviceName,
      tier: process.recoveryTier,
      rtoMinutes: process.validatedRTO ?? process.suggestedRTO ?? null,
      rpoMinutes: process.validatedRPO ?? process.suggestedRPO ?? null,
    }));
  }

  private getLandingZoneContext(tenantId: string) {
    const existing = this.landingZoneCache.get(tenantId);
    if (existing) return existing;

    const promise = buildLandingZoneFinancialContext(this.prismaClient, tenantId);
    this.landingZoneCache.set(tenantId, promise);
    return promise;
  }

  private async getComplianceSummary(tenantId: string): Promise<{
    frameworks: Array<{
      id: string;
      name: string;
      score: number;
      compliant: number;
      partial: number;
      nonCompliant: number;
      unavailable: number;
    }>;
    disclaimer: string;
  }> {
    const reports = await this.complianceService.evaluateAll(tenantId);
    const frameworks = reports.map((report) => ComplianceService.toFrameworkSummary(report));
    return {
      frameworks,
      disclaimer: reports[0]?.disclaimer ?? COMPLIANCE_DISCLAIMER,
    };
  }
}
