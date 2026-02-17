// ============================================================
// PRA/PCA Report Routes — Intelligent report generation
// ============================================================

import { Router, type Response } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { reportRateLimit } from "../middleware/rateLimitMiddleware.js";
import { generatePraPcaReport } from '../graph/reportGenerator.js';
import { appLogger } from "../utils/logger.js";
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { buildFinancialSummaryPayload } from '../services/financial-dashboard.service.js';
import DOMPurify from 'isomorphic-dompurify';

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

function sanitizePreviewText(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
}

function renderPreviewHtml(textReport: string): string {
  return textReport
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${sanitizePreviewText(line.slice(2))}</h1>`;
      if (line.startsWith('## ')) return `<h2>${sanitizePreviewText(line.slice(3))}</h2>`;
      if (line.startsWith('- ')) return `<li>${sanitizePreviewText(line.slice(2))}</li>`;
      if (line.trim() === '') return '<br/>';
      return `<p>${sanitizePreviewText(line)}</p>`;
    })
    .join('\n');
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

function formatCurrencyValue(value: number, currency: string): string {
  try {
    const formatted = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
    // pdf-lib standard fonts cannot encode narrow no-break spaces.
    return formatted.replace(/[\u202f\u00a0]/g, ' ');
  } catch {
    return `${Math.round(value).toLocaleString('fr-FR')} ${currency}`;
  }
}

function formatPercent(value: number): string {
  return `${Number(value || 0).toFixed(1)}%`;
}

function buildHexagonPath(cx: number, cy: number, radius: number): string {
  const points = Array.from({ length: 6 }).map((_, index) => {
    const angle = ((60 * index - 30) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  const [first, ...rest] = points;
  return [
    `M ${first?.x ?? cx} ${first?.y ?? cy}`,
    ...rest.map((point) => `L ${point.x} ${point.y}`),
    'Z',
  ].join(' ');
}

function drawStrongholdLogo(options: {
  page: any;
  x: number;
  y: number;
  titleFont: any;
  subtitleFont: any;
}) {
  const { page, x, y, titleFont, subtitleFont } = options;
  const iconCenterX = x + 24;
  const iconCenterY = y - 8;
  const strokes = [18, 13, 8];
  for (const radius of strokes) {
    page.drawSvgPath(buildHexagonPath(iconCenterX, iconCenterY, radius), {
      borderColor: rgb(0.09, 0.16, 0.32),
      borderWidth: 1.2,
      color: rgb(1, 1, 1),
      opacity: 0,
    });
  }

  page.drawText('Stronghold', {
    x: x + 56,
    y: y - 13,
    size: 18,
    font: titleFont,
    color: rgb(0.07, 0.13, 0.27),
  });
  page.drawText('Executive Financial Resilience Report', {
    x: x + 56,
    y: y - 29,
    size: 8.5,
    font: subtitleFont,
    color: rgb(0.4, 0.45, 0.5),
  });
}

function drawKpiCard(options: {
  page: any;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  value: string;
  subtitle: string;
  valueColor: ReturnType<typeof rgb>;
  titleFont: any;
  valueFont: any;
  bodyFont: any;
}) {
  const { page, x, y, width, height, title, value, subtitle, valueColor, titleFont, valueFont, bodyFont } = options;
  page.drawRectangle({
    x,
    y: y - height,
    width,
    height,
    color: rgb(0.98, 0.985, 0.995),
    borderColor: rgb(0.87, 0.9, 0.94),
    borderWidth: 1,
  });
  page.drawText(title, {
    x: x + 10,
    y: y - 18,
    size: 8.5,
    font: titleFont,
    color: rgb(0.32, 0.36, 0.4),
  });
  page.drawText(value, {
    x: x + 10,
    y: y - 40,
    size: 15,
    font: valueFont,
    color: valueColor,
  });
  page.drawText(subtitle, {
    x: x + 10,
    y: y - 55,
    size: 7.5,
    font: bodyFont,
    color: rgb(0.42, 0.46, 0.5),
  });
}

function drawRiskProtectionChart(options: {
  page: any;
  x: number;
  y: number;
  width: number;
  height: number;
  currency: string;
  withoutPlan: number;
  projectedAle: number;
  remediationCost: number;
  titleFont: any;
  bodyFont: any;
}) {
  const {
    page,
    x,
    y,
    width,
    height,
    currency,
    withoutPlan,
    projectedAle,
    remediationCost,
    titleFont,
    bodyFont,
  } = options;

  page.drawRectangle({
    x,
    y: y - height,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.87, 0.9, 0.94),
    borderWidth: 1,
  });

  page.drawText('Cost of Risk vs Cost of Protection', {
    x: x + 10,
    y: y - 16,
    size: 10,
    font: titleFont,
    color: rgb(0.18, 0.2, 0.24),
  });

  const chartTop = y - 32;
  const chartBottom = y - height + 34;
  const chartHeight = chartTop - chartBottom;
  const leftBarX = x + 70;
  const rightBarX = x + 220;
  const barWidth = 78;
  const combinedWithPlan = projectedAle + remediationCost;
  const maxValue = Math.max(1, withoutPlan, combinedWithPlan);

  const withoutHeight = (withoutPlan / maxValue) * chartHeight;
  const projectedHeight = (projectedAle / maxValue) * chartHeight;
  const remediationHeight = (remediationCost / maxValue) * chartHeight;

  page.drawRectangle({
    x: leftBarX,
    y: chartBottom,
    width: barWidth,
    height: withoutHeight,
    color: rgb(0.89, 0.17, 0.15),
  });

  page.drawRectangle({
    x: rightBarX,
    y: chartBottom,
    width: barWidth,
    height: projectedHeight,
    color: rgb(0.16, 0.72, 0.47),
  });
  page.drawRectangle({
    x: rightBarX,
    y: chartBottom + projectedHeight,
    width: barWidth,
    height: remediationHeight,
    color: rgb(0.46, 0.5, 0.58),
  });

  page.drawText('Without DR Plan', {
    x: leftBarX - 6,
    y: chartBottom - 14,
    size: 8,
    font: bodyFont,
    color: rgb(0.35, 0.37, 0.42),
  });
  page.drawText('With Stronghold', {
    x: rightBarX - 2,
    y: chartBottom - 14,
    size: 8,
    font: bodyFont,
    color: rgb(0.35, 0.37, 0.42),
  });

  page.drawText(formatCurrencyValue(withoutPlan, currency), {
    x: leftBarX - 10,
    y: chartBottom + withoutHeight + 6,
    size: 8,
    font: bodyFont,
    color: rgb(0.29, 0.31, 0.35),
  });
  page.drawText(formatCurrencyValue(combinedWithPlan, currency), {
    x: rightBarX - 10,
    y: chartBottom + projectedHeight + remediationHeight + 6,
    size: 8,
    font: bodyFont,
    color: rgb(0.29, 0.31, 0.35),
  });

  const reduction =
    withoutPlan > 0 ? ((withoutPlan - projectedAle) / withoutPlan) * 100 : 0;
  page.drawText(
    `Estimated risk reduction: ${reduction.toFixed(1)}%`,
    {
      x: x + 10,
      y: y - height + 12,
      size: 8.5,
      font: bodyFont,
      color: rgb(0.25, 0.28, 0.32),
    },
  );
}

export async function renderFinancialExecutiveSummaryPdf(options: {
  organizationName: string;
  generatedAt: string;
  currency: string;
  annualRisk: number;
  potentialSavings: number;
  roiPercent: number;
  paybackMonths: number;
  projectedAle: number;
  annualRemediationCost: number;
  topSpofs: Array<{
    nodeName: string;
    nodeType: string;
    dependentsCount: number;
    costPerHour: number;
    ale: number;
  }>;
  sources: string[];
  disclaimer: string;
}) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const page = pdfDoc.addPage([595.28, 841.89]);
  const margin = 32;

  drawStrongholdLogo({
    page,
    x: margin,
    y: 802,
    titleFont: fontBold,
    subtitleFont: fontRegular,
  });

  page.drawText(`Organization: ${options.organizationName}`, {
    x: 360,
    y: 795,
    size: 9,
    font: fontBold,
    color: rgb(0.2, 0.23, 0.28),
  });
  page.drawText(
    `Generated: ${new Date(options.generatedAt).toLocaleDateString('fr-FR')}`,
    {
      x: 360,
      y: 781,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.35, 0.38, 0.42),
    },
  );

  const kpiY = 748;
  const cardWidth = 124;
  const cardHeight = 64;
  const gap = 8;

  drawKpiCard({
    page,
    x: margin,
    y: kpiY,
    width: cardWidth,
    height: cardHeight,
    title: 'Annual Risk (ALE)',
    value: formatCurrencyValue(options.annualRisk, options.currency),
    subtitle: 'Expected annual loss',
    valueColor: rgb(0.86, 0.18, 0.13),
    titleFont: fontBold,
    valueFont: fontBold,
    bodyFont: fontRegular,
  });
  drawKpiCard({
    page,
    x: margin + cardWidth + gap,
    y: kpiY,
    width: cardWidth,
    height: cardHeight,
    title: 'Potential Savings',
    value: formatCurrencyValue(options.potentialSavings, options.currency),
    subtitle: 'If recommendations are applied',
    valueColor: rgb(0.16, 0.62, 0.37),
    titleFont: fontBold,
    valueFont: fontBold,
    bodyFont: fontRegular,
  });
  drawKpiCard({
    page,
    x: margin + (cardWidth + gap) * 2,
    y: kpiY,
    width: cardWidth,
    height: cardHeight,
    title: 'Estimated ROI',
    value: formatPercent(options.roiPercent),
    subtitle: 'Annual net return',
    valueColor: rgb(0.11, 0.43, 0.83),
    titleFont: fontBold,
    valueFont: fontBold,
    bodyFont: fontRegular,
  });
  drawKpiCard({
    page,
    x: margin + (cardWidth + gap) * 3,
    y: kpiY,
    width: cardWidth,
    height: cardHeight,
    title: 'Payback',
    value: `${options.paybackMonths.toFixed(1)} months`,
    subtitle: 'Investment return horizon',
    valueColor: rgb(0.73, 0.35, 0.03),
    titleFont: fontBold,
    valueFont: fontBold,
    bodyFont: fontRegular,
  });

  drawRiskProtectionChart({
    page,
    x: margin,
    y: 666,
    width: 531,
    height: 182,
    currency: options.currency,
    withoutPlan: options.annualRisk,
    projectedAle: options.projectedAle,
    remediationCost: options.annualRemediationCost,
    titleFont: fontBold,
    bodyFont: fontRegular,
  });

  const tableX = margin;
  const tableTopY = 468;
  const rowHeight = 18;
  const columns = [
    { key: 'rank', label: '#', width: 22 },
    { key: 'nodeName', label: 'Component', width: 145 },
    { key: 'nodeType', label: 'Type', width: 86 },
    { key: 'dependentsCount', label: 'Dependents', width: 70 },
    { key: 'costPerHour', label: 'Cost/h', width: 92 },
    { key: 'ale', label: 'Risk/year', width: 110 },
  ] as const;

  page.drawText('Top 5 Most Costly SPOFs', {
    x: tableX,
    y: tableTopY + 14,
    size: 10,
    font: fontBold,
    color: rgb(0.18, 0.2, 0.24),
  });

  page.drawRectangle({
    x: tableX,
    y: tableTopY - rowHeight,
    width: 525,
    height: rowHeight,
    color: rgb(0.95, 0.97, 0.99),
    borderColor: rgb(0.85, 0.88, 0.93),
    borderWidth: 1,
  });

  let runningX = tableX + 6;
  for (const column of columns) {
    page.drawText(column.label, {
      x: runningX,
      y: tableTopY - 12,
      size: 8,
      font: fontBold,
      color: rgb(0.35, 0.38, 0.42),
    });
    runningX += column.width;
  }

  options.topSpofs.slice(0, 5).forEach((spof, index) => {
    const y = tableTopY - rowHeight * (index + 2);
    page.drawRectangle({
      x: tableX,
      y,
      width: 525,
      height: rowHeight,
      color: index % 2 === 0 ? rgb(1, 1, 1) : rgb(0.985, 0.99, 1),
      borderColor: rgb(0.9, 0.92, 0.95),
      borderWidth: 0.6,
    });

    const cells = [
      String(index + 1),
      spof.nodeName,
      spof.nodeType,
      String(spof.dependentsCount),
      formatCurrencyValue(spof.costPerHour, options.currency),
      formatCurrencyValue(spof.ale, options.currency),
    ];

    let cellX = tableX + 6;
    cells.forEach((cell, cellIndex) => {
      const column = columns[cellIndex];
      if (!column) return;
      page.drawText(cell, {
        x: cellX,
        y: y + 6,
        size: 8,
        font: cellIndex === 5 ? fontBold : fontRegular,
        color: cellIndex === 5 ? rgb(0.75, 0.13, 0.12) : rgb(0.24, 0.27, 0.32),
      });
      cellX += column.width;
    });
  });

  const footerTop = 302;
  page.drawRectangle({
    x: margin,
    y: footerTop - 110,
    width: 531,
    height: 110,
    color: rgb(0.98, 0.985, 0.995),
    borderColor: rgb(0.86, 0.89, 0.93),
    borderWidth: 1,
  });

  page.drawText('Sources & Disclaimer', {
    x: margin + 10,
    y: footerTop - 16,
    size: 9.5,
    font: fontBold,
    color: rgb(0.18, 0.2, 0.24),
  });

  const sourcesLine = `Sources: ${options.sources.slice(0, 6).join(' | ')}`;
  const wrappedSources = wrapPdfLine(sourcesLine, 510, fontRegular, 7.2).slice(0, 3);
  wrappedSources.forEach((line, idx) => {
    page.drawText(line, {
      x: margin + 10,
      y: footerTop - 30 - idx * 10,
      size: 7.2,
      font: fontRegular,
      color: rgb(0.36, 0.39, 0.44),
    });
  });

  const wrappedDisclaimer = wrapPdfLine(options.disclaimer, 510, fontRegular, 7.2).slice(0, 4);
  wrappedDisclaimer.forEach((line, idx) => {
    page.drawText(line, {
      x: margin + 10,
      y: footerTop - 64 - idx * 10,
      size: 7.2,
      font: fontMono,
      color: rgb(0.4, 0.43, 0.48),
    });
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
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
    if (!req.tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    return await handleReportGeneration(req, res);
  } catch (error) {
    appLogger.error('Error generating PRA/PCA report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Compatibility route for frontend report generator
router.post('/generate', reportRateLimit, async (req: TenantRequest, res) => {
  try {
    if (!req.tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    req.body = { ...req.body, format: req.body?.format ?? 'pdf' };
    return await handleReportGeneration(req, res);
  } catch (error) {
    appLogger.error('Error generating PRA/PCA report (compat):', error);
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
    appLogger.error('Error fetching report metadata:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

async function handleReportPreview(req: TenantRequest, res: Response) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const nodeCount = await prisma.infraNode.count({ where: { tenantId } });
    if (nodeCount === 0) {
      return res.json({ html: '<p>Aucune donnee d\'infrastructure disponible. Lancez un scan de decouverte.</p>' });
    }

    const report = await generatePraPcaReport(prisma, tenantId, { format: 'json' });
    const textReport = formatReportAsText(report);
    const html = renderPreviewHtml(textReport);

    return res.json({ html });
  } catch (error) {
    appLogger.error('Error generating report preview:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// HTML preview of the report (used by frontend ReportGenerator)
router.get('/preview', async (req: TenantRequest, res) => {
  return await handleReportPreview(req, res);
});

router.post('/preview', reportRateLimit, async (req: TenantRequest, res) => {
  return await handleReportPreview(req, res);
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
    appLogger.error('Error fetching report prerequisites:', error);
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
    appLogger.error('Error generating executive summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Board-ready financial executive export used by ROI & Finance dashboard
router.post('/executive-financial', reportRateLimit, async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const summary = await buildFinancialSummaryPayload(prisma, tenantId, {
      currency: req.body?.currency,
    });

    const pdfBuffer = await renderFinancialExecutiveSummaryPdf({
      organizationName: summary.organization.name,
      generatedAt: summary.generatedAt,
      currency: summary.currency,
      annualRisk: summary.metrics.annualRisk,
      potentialSavings: summary.metrics.potentialSavings,
      roiPercent: summary.metrics.roiPercent,
      paybackMonths: summary.metrics.paybackMonths,
      projectedAle: summary.roi.projectedALE,
      annualRemediationCost: summary.roi.annualRemediationCost,
      topSpofs: summary.topSPOFs.map((spof) => ({
        nodeName: spof.nodeName,
        nodeType: spof.nodeType,
        dependentsCount: spof.dependentsCount,
        costPerHour: spof.costPerHour,
        ale: spof.ale,
      })),
      sources: summary.sources,
      disclaimer: summary.disclaimer,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=\"executive-financial-summary.pdf\"');
    return res.send(pdfBuffer);
  } catch (error) {
    appLogger.error('Error generating executive financial summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
