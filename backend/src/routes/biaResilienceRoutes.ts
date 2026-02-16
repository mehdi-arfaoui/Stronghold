import { appLogger } from "../utils/logger.js";
// ============================================================
// BIA Resilience Routes — Auto-generated BIA from graph
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { generateBIA } from '../graph/biaEngine.js';
import { biaSuggestionService } from '../bia/services/bia-suggestion.service.js';
import type { InfraNodeAttrs } from '../graph/types.js';
import { FinancialEngineService } from '../services/financial-engine.service.js';

const router = Router();

// ─── POST /bia-resilience/auto-generate — Generate BIA from graph ──────────
router.post('/auto-generate', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    // Run analysis first
    const analysis = await analyzeFullGraph(graph);

    // Generate BIA
    const biaReport = generateBIA(graph, analysis);

    // Persist BIA report
    const dbReport = await prisma.bIAReport2.create({
      data: {
        generatedAt: biaReport.generatedAt,
        summary: biaReport.summary as any,
        tenantId,
        processes: {
          create: biaReport.processes.map(p => ({
            serviceNodeId: p.serviceNodeId,
            serviceName: p.serviceName,
            serviceType: p.serviceType,
            suggestedMAO: p.suggestedMAO,
            suggestedMTPD: p.suggestedMTPD,
            suggestedRTO: p.suggestedRTO,
            suggestedRPO: p.suggestedRPO,
            suggestedMBCO: p.suggestedMBCO,
            impactCategory: p.impactCategory,
            criticalityScore: p.criticalityScore,
            recoveryTier: p.recoveryTier,
            dependencyChain: p.dependencyChain as any,
            weakPoints: p.weakPoints as any,
            financialImpact: p.financialImpact as any,
            validationStatus: 'pending',
            tenantId,
          })),
        },
      },
      include: { processes: true },
    });

    // Also update node BIA data
    for (const p of biaReport.processes) {
      await prisma.infraNode.updateMany({
        where: { id: p.serviceNodeId, tenantId },
        data: {
          suggestedRTO: p.suggestedRTO,
          suggestedRPO: p.suggestedRPO,
          suggestedMTPD: p.suggestedMTPD,
          impactCategory: p.impactCategory,
          financialImpactPerHour: p.financialImpact.estimatedCostPerHour,
        },
      });
    }

    return res.json(dbReport);
  } catch (error) {
    appLogger.error('Error generating BIA:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Helper: build tier summary from processes ──────────
function buildTiers(processes: Array<{
  recoveryTier?: number;
  tier?: number;
  serviceName: string;
  financialImpact?: any;
  financialImpactPerHour?: number;
}>) {
  const tiers: Record<string, { count: number; services: string[]; totalImpact: number }> = {
    tier1: { count: 0, services: [], totalImpact: 0 },
    tier2: { count: 0, services: [], totalImpact: 0 },
    tier3: { count: 0, services: [], totalImpact: 0 },
    tier4: { count: 0, services: [], totalImpact: 0 },
  };
  for (const p of processes) {
    const tier = p.recoveryTier ?? p.tier ?? 4;
    const key = `tier${tier}` as keyof typeof tiers;
    if (tiers[key]) {
      tiers[key].count++;
      tiers[key].services.push(p.serviceName);
      tiers[key].totalImpact += p.financialImpactPerHour ?? ((p.financialImpact as any)?.estimatedCostPerHour || 0);
    }
  }
  return tiers;
}

// ─── GET /bia-resilience/entries — BIA entries with tiers (frontend expects this) ──────────
router.get('/entries', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { criticalityScore: 'desc' } } },
    });

    if (!report) {
      return res.json({
        entries: [],
        tiers: buildTiers([]),
      });
    }

    const nodeIds = report.processes.map((process) => process.serviceNodeId);
    const [graph, profile, overrides] = await Promise.all([
      GraphService.getGraph(prisma, tenantId),
      prisma.organizationProfile.findUnique({ where: { tenantId } }),
      prisma.nodeFinancialOverride.findMany({
        where: {
          tenantId,
          ...(nodeIds.length > 0 ? { nodeId: { in: nodeIds } } : {}),
        },
      }),
    ]);
    const overridesByNodeId = new Map(overrides.map((entry) => [entry.nodeId, entry]));

    const entries = report.processes.map((p) => {
      const node = graph.hasNode(p.serviceNodeId)
        ? (graph.getNodeAttributes(p.serviceNodeId) as InfraNodeAttrs)
        : undefined;

      const fallbackNode: InfraNodeAttrs = {
        id: p.serviceNodeId,
        name: p.serviceName,
        type: p.serviceType,
        provider: 'unknown',
        tags: {},
        metadata: {},
        criticalityScore: p.criticalityScore,
      };

      const suggestion = biaSuggestionService.suggestForNode(node ?? fallbackNode, {
        graph,
        explicitCriticalityScore: p.criticalityScore,
      });

      const financialOverride = overridesByNodeId.get(p.serviceNodeId);
      const dependentsCount = graph.hasNode(p.serviceNodeId) ? graph.inDegree(p.serviceNodeId) : 0;
      const financialImpact = FinancialEngineService.calculateNodeFinancialImpact(
        {
          id: p.serviceNodeId,
          name: p.serviceName,
          type: node?.type ?? p.serviceType,
          provider: node?.provider ?? 'unknown',
          region: node?.region ?? null,
          isSPOF: node?.isSPOF ?? false,
          criticalityScore: node?.criticalityScore ?? p.criticalityScore,
          redundancyScore: node?.redundancyScore ?? null,
          impactCategory: node?.impactCategory ?? p.impactCategory,
          suggestedRTO: p.suggestedRTO,
          validatedRTO: p.validatedRTO,
          suggestedRPO: p.suggestedRPO,
          validatedRPO: p.validatedRPO,
          suggestedMTPD: p.suggestedMTPD,
          validatedMTPD: p.validatedMTPD,
          dependentsCount,
        },
        profile,
        financialOverride
          ? {
              customCostPerHour: financialOverride.customCostPerHour,
              justification: financialOverride.justification,
              validatedBy: financialOverride.validatedBy,
              validatedAt: financialOverride.validatedAt,
            }
          : undefined,
      );

      const validated = p.validationStatus === 'validated';

      return {
      id: p.id,
      nodeId: p.serviceNodeId,
      serviceName: p.serviceName,
      serviceType: p.serviceType,
      tier: p.recoveryTier,
      rto: p.validatedRTO ?? null,
      rpo: p.validatedRPO ?? null,
      mtpd: p.validatedMTPD ?? null,
      rtoSuggested: suggestion.rto,
      rpoSuggested: suggestion.rpo,
      mtpdSuggested: suggestion.mtpd,
      validated,
      suggestion,
      effectiveRto: p.validatedRTO ?? suggestion.rto,
      effectiveRpo: p.validatedRPO ?? suggestion.rpo,
      effectiveMtpd: p.validatedMTPD ?? suggestion.mtpd,
      financialImpactPerHour: financialImpact.estimatedCostPerHour,
      financialConfidence: financialImpact.confidence,
      financialSources: financialImpact.sources,
      financialIsOverride: financialImpact.confidence === 'user_defined',
      financialOverride: financialOverride
        ? {
            customCostPerHour: financialOverride.customCostPerHour,
            justification: financialOverride.justification,
            validatedBy: financialOverride.validatedBy,
            validatedAt: financialOverride.validatedAt,
          }
        : null,
      dependencies: Array.isArray(p.dependencyChain) ? p.dependencyChain : [],
      criticalityScore: p.criticalityScore,
      impactCategory: p.impactCategory,
      validationStatus: p.validationStatus,
      };
    });

    return res.json({
      entries,
      tiers: buildTiers(entries),
    });
  } catch (error) {
    appLogger.error('Error fetching BIA entries:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/summary — BIA summary with tiers ──────────
router.get('/summary', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: true },
    });

    if (!report) {
      return res.json({
        totalServices: 0,
        validatedCount: 0,
        tiers: [
          { tier: 1, label: 'Mission Critical', serviceCount: 0, maxRTO: '0', totalFinancialImpact: 0 },
          { tier: 2, label: 'Business Critical', serviceCount: 0, maxRTO: '0', totalFinancialImpact: 0 },
          { tier: 3, label: 'Important', serviceCount: 0, maxRTO: '0', totalFinancialImpact: 0 },
          { tier: 4, label: 'Non-Critical', serviceCount: 0, maxRTO: '0', totalFinancialImpact: 0 },
        ],
      });
    }

    const tierNames: Record<number, string> = {
      1: 'Mission Critical',
      2: 'Business Critical',
      3: 'Important',
      4: 'Non-Critical',
    };

    const tiers = [1, 2, 3, 4].map(tier => {
      const procs = report.processes.filter(p => p.recoveryTier === tier);
      const maxRTO = procs.length > 0
        ? Math.max(...procs.map(p => (p.validatedRTO ?? p.suggestedRTO) || 0))
        : 0;
      return {
        tier,
        label: tierNames[tier],
        serviceCount: procs.length,
        maxRTO: String(maxRTO),
        totalFinancialImpact: procs.reduce(
          (sum, p) => sum + ((p.financialImpact as any)?.estimatedCostPerHour || 0), 0
        ),
      };
    });

    return res.json({
      totalServices: report.processes.length,
      validatedCount: report.processes.filter(p => p.validationStatus === 'validated').length,
      tiers,
    });
  } catch (error) {
    appLogger.error('Error fetching BIA summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/export/csv — Export BIA as CSV ──────────
router.get('/export/csv', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { recoveryTier: 'asc' } } },
    });

    const header = 'Service,Type,Tier,Suggested RTO,Suggested RPO,Suggested MTPD,Validated RTO,Validated RPO,Validated MTPD,Impact Category,Criticality Score,Financial Impact/h,Status\n';
    const rows = (report?.processes || []).map(p =>
      [
        `"${p.serviceName}"`,
        p.serviceType,
        p.recoveryTier,
        p.suggestedRTO,
        p.suggestedRPO,
        p.suggestedMTPD,
        p.validatedRTO ?? '',
        p.validatedRPO ?? '',
        p.validatedMTPD ?? '',
        p.impactCategory,
        p.criticalityScore,
        (p.financialImpact as any)?.estimatedCostPerHour || 0,
        p.validationStatus,
      ].join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bia-export.csv"');
    return res.send(header + rows);
  } catch (error) {
    appLogger.error('Error exporting BIA CSV:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/export/json — Export BIA as JSON ──────────
router.get('/export/json', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { recoveryTier: 'asc' } } },
    });

    const processes = (report?.processes || []).map(p => ({
      serviceName: p.serviceName,
      serviceType: p.serviceType,
      tier: p.recoveryTier,
      suggestedRTO: p.suggestedRTO,
      suggestedRPO: p.suggestedRPO,
      suggestedMTPD: p.suggestedMTPD,
      validatedRTO: p.validatedRTO,
      validatedRPO: p.validatedRPO,
      validatedMTPD: p.validatedMTPD,
      impactCategory: p.impactCategory,
      criticalityScore: p.criticalityScore,
      financialImpactPerHour: (p.financialImpact as any)?.estimatedCostPerHour || 0,
      validationStatus: p.validationStatus,
    }));

    return res.json({ exportedAt: new Date().toISOString(), processes });
  } catch (error) {
    appLogger.error('Error exporting BIA JSON:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/export/xlsx — Export BIA as XLSX (CSV-compatible TSV) ──────────
router.get('/export/xlsx', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { recoveryTier: 'asc' } } },
    });

    const header = 'Service\tType\tTier\tSuggested RTO\tSuggested RPO\tSuggested MTPD\tValidated RTO\tValidated RPO\tValidated MTPD\tImpact Category\tCriticality Score\tFinancial Impact/h\tStatus\n';
    const rows = (report?.processes || []).map(p =>
      [
        p.serviceName,
        p.serviceType,
        p.recoveryTier,
        p.suggestedRTO,
        p.suggestedRPO,
        p.suggestedMTPD,
        p.validatedRTO ?? '',
        p.validatedRPO ?? '',
        p.validatedMTPD ?? '',
        p.impactCategory,
        p.criticalityScore,
        (p.financialImpact as any)?.estimatedCostPerHour || 0,
        p.validationStatus,
      ].join('\t')
    ).join('\n');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bia-export.xlsx"');
    return res.send(header + rows);
  } catch (error) {
    appLogger.error('Error exporting BIA XLSX:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/export/pdf — Export BIA as PDF ──────────
router.get('/export/pdf', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { recoveryTier: 'asc' } } },
    });

    // Build text content for PDF
    const lines = [
      'Business Impact Analysis (BIA) Export',
      `Generated: ${new Date().toISOString()}`,
      '',
      ...((report?.processes || []).map(p =>
        `[Tier ${p.recoveryTier}] ${p.serviceName} (${p.serviceType}) - RTO: ${p.validatedRTO ?? p.suggestedRTO}min, RPO: ${p.validatedRPO ?? p.suggestedRPO}min - Impact: ${(p.financialImpact as any)?.estimatedCostPerHour || 0} EUR/h - ${p.validationStatus}`
      )),
    ];

    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const margin = 40;
    const fontSize = 10;
    const lineHeight = fontSize * 1.5;
    const pageSize = { width: 595.28, height: 841.89 };

    let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
    let y = page.getHeight() - margin;

    for (const line of lines) {
      if (y <= margin) {
        page = pdfDoc.addPage([pageSize.width, pageSize.height]);
        y = page.getHeight() - margin;
      }
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
      y -= lineHeight;
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="bia-export.pdf"');
    return res.send(Buffer.from(pdfBytes));
  } catch (error) {
    appLogger.error('Error exporting BIA PDF:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/report — Latest BIA report ──────────
router.get('/report', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { criticalityScore: 'desc' } } },
    });

    if (!report) {
      return res.json({ report: null, message: 'No BIA has been generated yet' });
    }

    return res.json(report);
  } catch (error) {
    appLogger.error('Error fetching BIA report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /bia-resilience/processes/:processId — Validate/adjust process ──────────
router.patch('/processes/:processId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const processId = req.params.processId as string;
    const { validatedRTO, validatedRPO, validatedMTPD, notes, validationStatus } = req.body;

    const existingProcess = await prisma.bIAProcess2.findFirst({
      where: { id: processId, tenantId },
      select: { id: true, serviceNodeId: true },
    });

    if (!existingProcess) {
      return res.status(404).json({ error: 'BIA process not found' });
    }

    const process = await prisma.bIAProcess2.update({
      where: { id: existingProcess.id },
      data: {
        validatedRTO: validatedRTO ?? undefined,
        validatedRPO: validatedRPO ?? undefined,
        validatedMTPD: validatedMTPD ?? undefined,
        notes: notes ?? undefined,
        validationStatus: validationStatus || 'validated',
      },
    });

    // Also update the infra node
    if (validatedRTO !== undefined || validatedRPO !== undefined || validatedMTPD !== undefined) {
      await prisma.infraNode.updateMany({
        where: { id: existingProcess.serviceNodeId, tenantId },
        data: {
          validatedRTO: validatedRTO ?? undefined,
          validatedRPO: validatedRPO ?? undefined,
          validatedMTPD: validatedMTPD ?? undefined,
        },
      });
    }

    return res.json(process);
  } catch (error) {
    appLogger.error('Error updating BIA process:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /bia-resilience/validate-all — Validate all processes at once ──────────
router.post('/validate-all', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { overrides } = req.body;

    // Get latest report
    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: true },
    });

    if (!report) {
      return res.status(400).json({ error: 'No BIA report to validate' });
    }

    // Apply overrides if provided
    const overrideMap = new Map(
      (overrides || []).map((o: any) => [o.processId, o])
    );

    for (const process of report.processes) {
      const override = overrideMap.get(process.id) as any;
      await prisma.bIAProcess2.update({
        where: { id: process.id },
        data: {
          validationStatus: 'validated',
          validatedRTO: override?.validatedRTO ?? process.suggestedRTO,
          validatedRPO: override?.validatedRPO ?? process.suggestedRPO,
          validatedMTPD: override?.validatedMTPD ?? process.suggestedMTPD,
          notes: override?.notes ?? undefined,
        },
      });
    }

    return res.json({ validated: report.processes.length });
  } catch (error) {
    appLogger.error('Error validating BIA:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/matrix — BIA matrix by tier ──────────
router.get('/matrix', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { recoveryTier: 'asc' } } },
    });

    if (!report) {
      return res.json({ tiers: [], message: 'No BIA report generated yet' });
    }

    const tierNames: Record<number, string> = {
      1: 'Mission Critical',
      2: 'Business Critical',
      3: 'Important',
      4: 'Non-Critical',
    };

    const tiers = [1, 2, 3, 4].map(tier => {
      const procs = report.processes.filter(p => p.recoveryTier === tier);
      return {
        tier,
        name: tierNames[tier],
        processes: procs,
        totalImpact: procs.reduce(
          (sum, p) => sum + ((p.financialImpact as any)?.estimatedCostPerHour || 0), 0
        ),
      };
    });

    return res.json({ tiers });
  } catch (error) {
    appLogger.error('Error fetching BIA matrix:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
