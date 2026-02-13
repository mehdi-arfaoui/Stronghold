// ============================================================
// PRA/PCA Report Routes — Intelligent report generation
// ============================================================

import { Router, type Response } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { reportRateLimit } from "../middleware/rateLimitMiddleware.js";
import { generatePraPcaReport } from '../graph/reportGenerator.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

type DocxModule = typeof import('docx');

const router = Router();

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function formatReportAsText(report: Awaited<ReturnType<typeof generatePraPcaReport>>): string {
  const summary = report.executiveSummary;
  const sections = report.sections;

  const topRisks = summary.topRisks.length > 0
    ? summary.topRisks
      .slice(0, 5)
      .map((risk, index) => `${index + 1}. ${risk.title} (P=${risk.probability}, I=${risk.impact})`)
      .join('\n')
    : 'Aucun risque prioritaire identifie.';

  const immediateActions = sections.recommendations.immediate.length > 0
    ? sections.recommendations.immediate.map((action) => `- ${action}`).join('\n')
    : '- Aucune action immediate renseignee.';

  const actionPlan = sections.actionPlan.actions.length > 0
    ? sections.actionPlan.actions
      .slice(0, 10)
      .map((action) => `- [${action.priority.toUpperCase()}] ${action.action} | Responsable: ${action.responsible} | Echeance: ${action.deadline}`)
      .join('\n')
    : '- Aucun plan d\'action detaille disponible.';

  return [
    '# Rapport PRA/PCA',
    '',
    `Genere le: ${new Date(report.metadata.generatedAt).toISOString()}`,
    `Version: ${report.metadata.version}`,
    `Standard: ${report.metadata.standard}`,
    '',
    '## Resume executif',
    `Score de resilience: ${summary.resilienceScore}`,
    `Services tier 1: ${summary.tier1Services}`,
    `Services tier 2: ${summary.tier2Services}`,
    `SPOF critiques: ${summary.criticalSPOFs}`,
    `Noeuds infrastructure: ${summary.totalInfrastructureNodes}`,
    `Dependances: ${summary.totalDependencies}`,
    `Evaluation globale: ${summary.overallAssessment}`,
    '',
    '## Top risques',
    topRisks,
    '',
    '## BIA',
    `Processus analyses: ${sections.businessImpactAnalysis.summary.totalProcesses}`,
    `Exposition financiere totale: ${sections.businessImpactAnalysis.summary.totalFinancialExposure}`,
    '',
    '## Simulations',
    `Simulations executees: ${sections.simulationResults.simulationsRun}`,
    sections.simulationResults.worstCase
      ? `Pire scenario: ${sections.simulationResults.worstCase.scenarioName} (${sections.simulationResults.worstCase.nodesAffected} noeuds impactes)`
      : 'Pire scenario: non disponible',
    '',
    '## Recommandations immediates',
    immediateActions,
    '',
    '## Plan d\'action prioritaire',
    actionPlan,
  ].join('\n');
}

function wrapPdfLine(text: string, maxWidth: number, font: any, fontSize: number): string[] {
  const words = text.split(' ');
  const wrapped: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) wrapped.push(current);
      current = word;
    }
  }

  if (current) wrapped.push(current);
  return wrapped.length > 0 ? wrapped : [''];
}

async function renderPdfBuffer(content: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const margin = 40;
  const fontSize = 11;
  const lineHeight = fontSize * 1.4;
  const pageSize = { width: 595.28, height: 841.89 };

  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = page.getHeight() - margin;
  const usableWidth = page.getWidth() - margin * 2;

  for (const line of splitLines(content)) {
    const wrappedLines = wrapPdfLine(line, usableWidth, font, fontSize);

    for (const wrapped of wrappedLines) {
      if (y <= margin) {
        page = pdfDoc.addPage([pageSize.width, pageSize.height]);
        y = page.getHeight() - margin;
      }

      page.drawText(wrapped, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });

      y -= lineHeight;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function loadDocx(): Promise<DocxModule> {
  const module = await import('docx');
  return module as DocxModule;
}

function toDocxParagraph(docx: DocxModule, line: string) {
  const docxAny = docx as any;
  if (line.startsWith('# ')) {
    return new docxAny.Paragraph({
      text: line.replace(/^#\s*/, '').trim(),
      heading: docxAny.HeadingLevel.HEADING_1,
    });
  }

  if (line.startsWith('## ')) {
    return new docxAny.Paragraph({
      text: line.replace(/^##\s*/, '').trim(),
      heading: docxAny.HeadingLevel.HEADING_2,
    });
  }

  return new docxAny.Paragraph({
    children: [new docxAny.TextRun(line || ' ')],
  });
}

async function renderDocxBuffer(content: string): Promise<Buffer> {
  const docx = await loadDocx();
  const docxAny = docx as any;
  const doc = new docxAny.Document({
    sections: [
      {
        properties: {},
        children: splitLines(content).map((line) => toDocxParagraph(docx, line)),
      },
    ],
  });

  return docxAny.Packer.toBuffer(doc);
}

async function getDataAvailability(tenantId: string) {
  const [nodeCount, analysisCount, biaCount, simCount] = await Promise.all([
    prisma.infraNode.count({ where: { tenantId } }),
    prisma.graphAnalysis.count({ where: { tenantId } }),
    prisma.bIAReport2.count({ where: { tenantId } }),
    prisma.simulation.count({ where: { tenantId } }),
  ]);

  return {
    infrastructureNodes: nodeCount,
    analysisRuns: analysisCount,
    biaReports: biaCount,
    simulations: simCount,
    readyToGenerate: nodeCount > 0,
  };
}

async function handleReportGeneration(req: TenantRequest, res: Response) {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

  const {
    includeSimulations,
    includeExercises,
    format = 'json',
    sections,
  } = req.body;

  const sanitizedIncludeSimulations = Array.isArray(includeSimulations)
    ? includeSimulations.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    : undefined;

  const sanitizedIncludeExercises = Array.isArray(includeExercises)
    ? includeExercises.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    : undefined;

  const nodeCount = await prisma.infraNode.count({ where: { tenantId } });
  if (nodeCount === 0) {
    return res.status(400).json({
      error: 'No infrastructure data available. Run a discovery scan first.',
    });
  }

  const reportConfig = {
    ...(sanitizedIncludeSimulations ? { includeSimulations: sanitizedIncludeSimulations } : {}),
    ...(sanitizedIncludeExercises ? { includeExercises: sanitizedIncludeExercises } : {}),
    format: format || 'json',
    sections,
  };

  const report = await generatePraPcaReport(prisma, tenantId, reportConfig);

  if (format === 'json') {
    return res.json(report);
  }

  const textReport = formatReportAsText(report);

  if (format === 'pdf') {
    const pdfBuffer = await renderPdfBuffer(textReport);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="rapport-pra-pca.pdf"');
    return res.send(pdfBuffer);
  }

  if (format === 'docx') {
    const docxBuffer = await renderDocxBuffer(textReport);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="rapport-pra-pca.docx"');
    return res.send(docxBuffer);
  }

  return res.json({
    ...report,
    _renderingNote: 'PDF/DOCX generation available. Use this JSON payload with your document rendering service. The report structure follows ISO 22301:2019 sections.',
  });
}

// ─── POST /reports/pra-pca — Generate PRA/PCA report ──────────
router.post('/pra-pca', reportRateLimit, async (req: TenantRequest, res) => {
  try {
    return await handleReportGeneration(req, res);
  } catch (error) {
    console.error('Error generating PRA/PCA report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Compatibility route for frontend report generator
router.post('/generate', reportRateLimit, async (req: TenantRequest, res) => {
  try {
    req.body = { ...req.body, format: req.body?.format ?? 'pdf' };
    return await handleReportGeneration(req, res);
  } catch (error) {
    console.error('Error generating PRA/PCA report (compat):', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /reports/pra-pca/latest — Get latest report metadata ──────────
router.get('/pra-pca/latest', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    return res.json({
      dataAvailability: await getDataAvailability(tenantId),
    });
  } catch (error) {
    console.error('Error fetching report metadata:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// HTML preview of the report (used by frontend ReportGenerator)
router.get('/preview', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const nodeCount = await prisma.infraNode.count({ where: { tenantId } });
    if (nodeCount === 0) {
      return res.json({ html: '<p>Aucune donnee d\'infrastructure disponible. Lancez un scan de decouverte.</p>' });
    }

    const report = await generatePraPcaReport(prisma, tenantId, { format: 'json' });
    const textReport = formatReportAsText(report);

    // Convert markdown-like text to basic HTML
    const html = textReport
      .split('\n')
      .map((line) => {
        if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
        if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
        if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
        if (line.trim() === '') return '<br/>';
        return `<p>${line}</p>`;
      })
      .join('\n');

    return res.json({ html });
  } catch (error) {
    console.error('Error generating report preview:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Frontend prerequisites list used to unlock PRA/PCA generation button
router.get('/prerequisites', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const data = await getDataAvailability(tenantId);

    return res.json([
      {
        id: 'infrastructure',
        label: 'Infrastructure decouverte',
        met: data.infrastructureNodes > 0,
        details: `${data.infrastructureNodes} noeud(s)`,
      },
      {
        id: 'bia',
        label: 'Analyse BIA disponible',
        met: data.biaReports > 0,
        details: `${data.biaReports} rapport(s) BIA`,
      },
      {
        id: 'simulations',
        label: 'Simulation de resilience executee',
        met: data.simulations > 0,
        details: `${data.simulations} simulation(s)`,
      },
    ]);
  } catch (error) {
    console.error('Error fetching report prerequisites:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /reports/executive-summary — Board-ready 1-page PDF ──────────
router.post('/executive-summary', reportRateLimit, async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { currency = 'EUR', includeROI = true, includeCompliance = true } = req.body;

    // Gather all data
    const [nodeCount, spofCount, analysisResult, biaReport, simCount, latestAnalysis] = await Promise.all([
      prisma.infraNode.count({ where: { tenantId } }),
      prisma.infraNode.count({ where: { tenantId, isSPOF: true } }),
      prisma.graphAnalysis.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      prisma.bIAReport2.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' }, include: { processes: true } }),
      prisma.simulation.count({ where: { tenantId } }),
      prisma.graphAnalysis.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const resilienceScore = latestAnalysis?.resilienceScore ?? 0;
    const totalEdges = latestAnalysis?.totalEdges ?? 0;

    // Calculate providers from nodes
    const providers = await prisma.infraNode.groupBy({
      by: ['provider'],
      where: { tenantId },
      _count: true,
    });
    const providerList = providers.map(p => p.provider).filter(Boolean);

    const regions = await prisma.infraNode.groupBy({
      by: ['region'],
      where: { tenantId, region: { not: null } },
      _count: true,
    });

    // ROI data
    let roiSection = '';
    if (includeROI) {
      const { calculateROI } = await import('../services/roiCalculatorService.js');
      const roi = await calculateROI(prisma, tenantId, { currency });
      roiSection = [
        '',
        'PLAN DE REMEDIATION',
        `Cout mensuel estime : ${roi.remediationDetails.totalMonthlyCost} ${currency}/mois`,
        `ROI annuel : ${roi.roiPercentage}% (payback < ${roi.paybackPeriodMonths} mois)`,
        `Risque annuel actuel : ${roi.breakdown.currentAnnualRisk} ${currency}`,
        `Reduction de risque estimee : ${roi.breakdown.riskReduction} ${currency}`,
      ].join('\n');
    }

    // Compliance data
    let complianceSection = '';
    if (includeCompliance) {
      const { calculateComplianceCoverage } = await import('../constants/compliance-mapping.js');
      const features = ['discovery', 'graph_analysis', 'spof_analysis', 'risk_detection', 'bia_auto_generate', 'bia_rto_rpo', 'recommendations', 'recovery_strategy', 'simulations', 'report_pra_pca'];
      const coverage = calculateComplianceCoverage(features);
      complianceSection = [
        '',
        'CONFORMITE',
        ...Object.entries(coverage).map(([name, c]) => `${name} : ${c.percentage}% de couverture (${c.covered}/${c.total} clauses)`),
      ].join('\n');
    }

    // Processes by tier
    const tier1 = biaReport?.processes.filter(p => p.recoveryTier === 1).length ?? 0;
    const tier2 = biaReport?.processes.filter(p => p.recoveryTier === 2).length ?? 0;

    const avgRto = biaReport?.processes.length
      ? Math.round(biaReport.processes.reduce((s, p) => s + (p.validatedRTO ?? p.suggestedRTO ?? 0), 0) / biaReport.processes.length)
      : 0;

    const content = [
      'STRONGHOLD — RAPPORT DE RESILIENCE IT',
      `Date : ${new Date().toLocaleDateString('fr-FR')}`,
      '',
      `SCORE DE RESILIENCE : ${resilienceScore}/100`,
      '',
      'INFRASTRUCTURE ANALYSEE',
      `${nodeCount} services | ${providerList.length} provider(s) (${providerList.join(', ')}) | ${regions.length} region(s)`,
      '',
      'RISQUES CRITIQUES',
      `${spofCount} Single Point(s) of Failure detecte(s)`,
      `RTO moyen actuel : ${avgRto} min`,
      `${tier1} services Tier 1 (Mission Critical)`,
      `${tier2} services Tier 2 (Business Critical)`,
      roiSection,
      complianceSection,
      '',
      'PROCHAINES ETAPES',
      `1. Corriger les ${spofCount} SPOF critiques`,
      '2. Activer le monitoring continu (drift detection)',
      '3. Planifier un exercice de basculement',
    ].join('\n');

    const pdfBuffer = await renderPdfBuffer(content);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="executive-summary.pdf"');
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating executive summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
