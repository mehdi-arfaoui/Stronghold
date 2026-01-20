import prisma from "../prismaClient.js";
import { recommendPraOptions } from "../analysis/praRecommender.js";
import * as crypto from "crypto";
import { buildRagPrompt, recommendScenariosWithRag, retrieveRagContext } from "../ai/ragService.js";
import { resolveRagRuntimeConfig } from "./ragTuningService.js";
import type { RunbookTemplate } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { applyPlaceholders, loadTemplateText } from "./runbookTemplateService.js";
import { buildObjectKey, getTenantBucketName, uploadObjectToBucket } from "../clients/s3Client.js";
import { buildBiaSummary } from "./biaSummary.js";
import { buildRiskSummary } from "./riskSummary.js";
import { defaultBudgetForCriticality, formatCostEstimate } from "../analysis/financialModels.js";

export interface RunbookGenerationOptions {
  scenarioId?: string | null;
  title?: string;
  summary?: string;
  owner?: string;
  templateId?: string | null;
}

function toMarkdownList(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

function describeBackup(type: string) {
  const normalized = type.toLowerCase();
  if (normalized === "full") {
    return "Full backup : stockage élevé, restauration rapide, idéal quand la fenêtre de sauvegarde est acceptée.";
  }
  if (normalized === "differential") {
    return "Differential : compromis, stockage modéré, restauration plus rapide qu'incrémentale.";
  }
  if (normalized === "incremental") {
    return "Incremental : sauvegarde rapide et peu volumineuse, restauration plus lente (chaînage).";
  }
  if (normalized === "continuous") {
    return "Continuous/streaming : capture quasi temps réel, excellente RPO mais coûts plus élevés.";
  }
  if (normalized === "snapshot") {
    return "Snapshot : copies rapides, utiles pour PRA IaaS/PaaS, vérifier la rétention.";
  }
  return "Stratégie personnalisée.";
}

function buildBackupComparison(strategies: any[]) {
  if (strategies.length === 0) return "Aucune stratégie de sauvegarde renseignée.";
  const lines = strategies.map((s) => {
    const freq = `${s.frequencyMinutes} min`;
    const ret = `${s.retentionDays} j`;
    const base = `${s.service?.name || "Global"} -> ${s.type.toUpperCase()} (${freq} / rétention ${ret})`;
    const impact = [
      s.rtoImpactHours ? `RTO cible ${s.rtoImpactHours}h` : null,
      s.rpoImpactMinutes ? `RPO cible ${s.rpoImpactMinutes} min` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    return `- ${base} ${impact ? `| ${impact}` : ""} — ${describeBackup(s.type)}`;
  });
  return lines.join("\n");
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

type DocxModule = typeof import("docx");

async function loadDocx(): Promise<DocxModule> {
  try {
    return await import("docx");
  } catch (err) {
    const error = new Error(
      "Module 'docx' requis pour générer les runbooks DOCX. Installez les dépendances backend (npm install)."
    );
    (error as any).cause = err;
    throw error;
  }
}

function toDocxParagraph(docx: DocxModule, line: string) {
  if (line.startsWith("# ")) {
    return new docx.Paragraph({
      text: line.replace(/^#\s*/, "").trim(),
      heading: docx.HeadingLevel.HEADING_1,
    });
  }
  if (line.startsWith("## ")) {
    return new docx.Paragraph({
      text: line.replace(/^##\s*/, "").trim(),
      heading: docx.HeadingLevel.HEADING_2,
    });
  }
  return new docx.Paragraph({
    children: [new docx.TextRun(line)],
  });
}

async function renderDocx(content: string): Promise<Buffer> {
  const docx = await loadDocx();
  const lines = splitLines(content);
  const doc = new docx.Document({
    sections: [
      {
        properties: {},
        children: lines.map((line) => toDocxParagraph(docx, line || " ")),
      },
    ],
  });
  return docx.Packer.toBuffer(doc);
}

async function renderPdf(content: string, title: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const lines = splitLines(`${title}\n\n${content}`);
  let page = pdfDoc.addPage();
  const fontSize = 11;
  const margin = 40;
  const lineHeight = fontSize * 1.4;
  let y = page.getHeight() - margin;

  const drawLine = (text: string) => {
    page.drawText(text, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  };

  for (const line of lines) {
    if (y <= margin) {
      page = pdfDoc.addPage();
      y = page.getHeight() - margin;
    }
    drawLine(line);
    y -= lineHeight;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function buildFindingsSummary(ragContext: any): string {
  const factLines =
    ragContext.extractedFacts && ragContext.extractedFacts.length > 0
      ? ragContext.extractedFacts
          .slice(0, 6)
          .map((f: any) => `- ${f.label} (${f.category}) ${f.dataPreview ? `→ ${f.dataPreview}` : ""}`)
          .join("\n")
      : "- Aucun fait extrait trouvé.";

  const chunkLines =
    ragContext.chunks && ragContext.chunks.length > 0
      ? ragContext.chunks
          .slice(0, 3)
          .map((c: any) => `- ${c.documentName} : ${c.text}`)
          .join("\n")
      : "- Aucun extrait textuel utilisé.";

  return ["Faits extraits:", factLines, "Extraits RAG:", chunkLines].join("\n");
}

function buildPlaceholderValues(params: {
  servicesList: string;
  depsList: string;
  cycleList: string;
  targetRto: number;
  targetRpo: number;
  backupComparison: string;
  policiesList: string;
  scenarioSteps: string;
  ragFindings: string;
  biaSummary: string;
  riskSummary: string;
  financialSummary: string;
}) {
  const depsCombined = [params.depsList || "", params.cycleList ? `Cycles critiques:\n${params.cycleList}` : ""]
    .filter((part) => part && part.trim().length > 0)
    .join("\n");

  return {
    SERVICES: params.servicesList || "Aucun service enregistré.",
    DEPENDANCES: depsCombined || "Pas de dépendances renseignées.",
    "RTO/RPO": `Cible RTO: ${params.targetRto}h | Cible RPO: ${params.targetRpo} minutes`,
    RTO_RPO: `Cible RTO: ${params.targetRto}h | Cible RPO: ${params.targetRpo} minutes`,
    SAUVEGARDES: params.backupComparison || "Aucune stratégie de sauvegarde renseignée.",
    POLITIQUES: params.policiesList || "Aucune politique de sécurité liée.",
    ETAPES: params.scenarioSteps || "Pas d'étapes spécifiques.",
    FINDINGS: params.ragFindings || "Aucun élément RAG disponible.",
    BIA: params.biaSummary || "Aucune synthèse BIA disponible.",
    RISQUES: params.riskSummary || "Aucune synthèse des risques disponible.",
    FINANCES: params.financialSummary || "Aucune estimation financière disponible.",
  };
}

async function mergeTemplateWithPlaceholders(template: RunbookTemplate, placeholders: Record<string, string>) {
  const rawContent = await loadTemplateText(template);
  return applyPlaceholders(rawContent || "", placeholders);
}

export async function generateRunbook(tenantId: string, options: RunbookGenerationOptions) {
  const scenario = options.scenarioId
    ? await prisma.scenario.findFirst({
        where: { id: options.scenarioId, tenantId },
        include: { services: { include: { service: true } }, steps: true },
      })
    : null;

  const [tenant, services, dependencies, backupStrategies, policies, cycles, template, biaSummary, riskSummary] =
    await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.service.findMany({
      where: { tenantId },
      include: { continuity: true },
      orderBy: { recoveryPriority: "asc" },
    }),
    prisma.serviceDependency.findMany({
      where: { tenantId },
      include: { fromService: true, toService: true },
    }),
    prisma.backupStrategy.findMany({ where: { tenantId }, include: { service: true } }),
    prisma.securityPolicy.findMany({
      where: { tenantId },
      include: { services: { include: { service: true } } },
    }),
    prisma.dependencyCycle.findMany({
      where: { tenantId },
      include: { services: { include: { service: true } } },
    }),
    options.templateId
      ? prisma.runbookTemplate.findFirst({ where: { id: options.templateId, tenantId } })
      : null,
    buildBiaSummary(prisma, tenantId),
    buildRiskSummary(prisma, tenantId),
  ]);

  const highCrit = services.filter((s) => s.criticality === "high" && s.continuity);
  const targetRto = Math.min(...highCrit.map((s) => s.continuity?.rtoHours || 24), 24);
  const targetRpo = Math.min(...highCrit.map((s) => s.continuity?.rpoMinutes || 60), 60);
  const budget = defaultBudgetForCriticality(highCrit.length > 0 ? "high" : "medium");
  const praRecs = recommendPraOptions({
    environment: "cloud",
    maxRtoHours: Number.isFinite(targetRto) ? targetRto : 4,
    maxRpoMinutes: Number.isFinite(targetRpo) ? targetRpo : 60,
    criticality: highCrit.length > 0 ? "high" : "medium",
    budgetCapex: budget.capex,
    budgetOpexMonthly: budget.opexMonthly,
    budgetCurrency: budget.currency,
    complexityTolerance: "medium",
  });

  const topRec = praRecs[0];
  const servicesList = services
    .map(
      (s) =>
        `- ${s.name} (${s.type}) — Criticité ${s.criticality?.toUpperCase() ?? "?"} | RTO ${
          s.continuity?.rtoHours ?? "?"
        }h | RPO ${s.continuity?.rpoMinutes ?? "?"}min | MTPD ${s.continuity?.mtpdHours ?? "?"}h`
    )
    .join("\n");

  const depsList = dependencies
    .map((d) => `- ${d.fromService?.name} → ${d.toService?.name} (${d.dependencyType})`)
    .join("\n");

  const cycleList = cycles
    .map((c) => {
      const members = c.services.map((s) => s.service?.name).filter(Boolean).join(", ");
      return `- ${c.label} [${c.severity || ""}] : ${members}`;
    })
    .join("\n");

  const policiesList = policies
    .map((p) => {
      const linked = p.services.map((s) => s.service?.name).filter(Boolean).join(", ");
      return `- ${p.name} (${p.policyType})${linked ? ` — ${linked}` : ""}`;
    })
    .join("\n");

  const ragQuestion = scenario
    ? `Préparer un runbook PRA/PCA pour le scénario ${scenario.name} (${scenario.type})`
    : "Préparer un runbook PRA/PCA multi-services pour ce tenant";

  const { runtimeConfig } = await resolveRagRuntimeConfig({
    tenantId,
    trigger: "runbook-generator",
  });

  const ragContextResult = await retrieveRagContext({
    tenantId,
    question: ragQuestion,
    maxChunks: 3,
    maxFacts: 5,
    ragRuntimeConfig: runtimeConfig,
  });

  const ragPrompt = buildRagPrompt({
    question: `${ragQuestion}. Utilise le contexte pour prioriser les actions.`,
    context: ragContextResult.context,
    maxTotalLength: 3600,
  });

  const ragScenarioRecommendations = await recommendScenariosWithRag({
    tenantId,
    question: ragQuestion,
    services,
    ...(scenario ? { scenarios: [scenario as any] } : {}),
    context: ragContextResult.context,
    maxResults: 5,
  });

  const scenarioSteps =
    scenario && scenario.steps.length > 0
      ? scenario.steps
          .sort((a, b) => a.order - b.order)
          .map((s) => `- [${s.order}] ${s.title}${s.role ? ` (${s.role})` : ""}`)
          .join("\n")
      : "";

  const ragFindings = buildFindingsSummary(ragContextResult.context);
  const biaSummaryLines =
    biaSummary.priorities.length > 0
      ? biaSummary.priorities
          .map(
            (process) =>
              `- ${process.name} (score ${process.criticalityScore}) — RTO ${process.rtoHours}h / RPO ${process.rpoMinutes}min`
          )
          .join("\n")
      : "- Aucun processus prioritaire identifié.";
  const riskSummaryLines =
    riskSummary.priorities.length > 0
      ? riskSummary.priorities
          .map(
            (risk) =>
              `- ${risk.title} (score ${risk.score}, niveau ${risk.level})` +
              `${risk.serviceName ? ` — service ${risk.serviceName}` : ""}`
          )
          .join("\n")
      : "- Aucun risque prioritaire identifié.";
  const financialSummary = [
    `Budget de référence : ${formatCostEstimate(budget)}`,
    topRec
      ? `Option prioritaire : ${topRec.name} — ${formatCostEstimate(topRec.pattern.costEstimate)}`
      : "Option prioritaire : aucune recommandation calculée.",
  ].join("\n");

  const placeholderValues = buildPlaceholderValues({
    servicesList,
    depsList,
    cycleList,
    targetRto,
    targetRpo,
    backupComparison: buildBackupComparison(backupStrategies),
    policiesList,
    scenarioSteps,
    ragFindings,
    biaSummary: [
      `Processus recensés : ${biaSummary.totals.processes}`,
      `Score criticité moyen : ${biaSummary.averages.criticalityScore}`,
      "Priorités BIA :",
      biaSummaryLines,
    ].join("\n"),
    riskSummary: [
      `Risques recensés : ${riskSummary.totals.count}`,
      `Couverture mitigation : ${Math.round(riskSummary.totals.mitigationCoverage * 100)}%`,
      "Priorités risques :",
      riskSummaryLines,
    ].join("\n"),
    financialSummary,
  });

  const baseMarkdown = [
    `# ${options.title || "Runbook PRA/PCA"}`,
    "",
    options.summary || "Synthèse générée automatiquement à partir des services, dépendances et stratégies PRA.",
    "",
    `Tenant : ${tenant?.name || tenantId}`,
    scenario ? `Scénario ciblé : ${scenario.name} (${scenario.type})` : "Scénario : général",
    "",
    "## Catalogue des services (priorité métier)",
    placeholderValues.SERVICES,
    "",
    "## Dépendances et cycles critiques",
    placeholderValues.DEPENDANCES,
    cycleList ? `\nCycles circulaires :\n${cycleList}` : "",
    "",
    "## Stratégies de sauvegarde",
    placeholderValues.SAUVEGARDES,
    "",
    "## Politiques de sécurité associées",
    placeholderValues.POLITIQUES,
    "",
    "## Synthèse BIA",
    placeholderValues.BIA,
    "",
    "## Synthèse des risques",
    placeholderValues.RISQUES,
    "",
    "## Volet financier (estimations)",
    placeholderValues.FINANCES,
    "",
    "## Recommandation PRA priorisée",
    topRec
      ? toMarkdownList([`${topRec.name} (score ${topRec.score})`, ...topRec.reasons.slice(0, 3)])
      : "Pas de recommandation calculée.",
    "",
    "## Plan d'action",
    "- Vérifier que les dépendances respectent le RTO/RPO cibles (voir cycles circulaires).",
    "- Tester la restauration sur échantillon et consigner les résultats.",
    "- Consolider le runbook avec les contacts et validations métiers.",
    scenarioSteps ? scenarioSteps : "- Aucun step spécifique au scénario n'est renseigné.",
    "",
    "## Synthèse RTO/RPO",
    placeholderValues["RTO/RPO"],
    "",
    "## Contexte RAG",
    ragFindings,
  ]
    .filter((block) => block !== "")
    .join("\n");

  const mergedContent =
    template && template.id
      ? await mergeTemplateWithPlaceholders(template, placeholderValues)
      : baseMarkdown;

  const finalContent = mergedContent && mergedContent.trim().length > 0 ? mergedContent : baseMarkdown;

  const runbookId = crypto.randomUUID();
  const bucket = getTenantBucketName(tenantId);
  const markdownKey = buildObjectKey(tenantId, `runbooks/${runbookId}.md`);
  const pdfKey = buildObjectKey(tenantId, `runbooks/${runbookId}.pdf`);
  const docxKey = buildObjectKey(tenantId, `runbooks/${runbookId}.docx`);

  await uploadObjectToBucket({
    bucket,
    key: markdownKey,
    body: Buffer.from(finalContent, "utf8"),
    contentType: "text/markdown",
  });

  const pdfBuffer = await renderPdf(finalContent, options.title || "Runbook PRA/PCA");
  await uploadObjectToBucket({
    bucket,
    key: pdfKey,
    body: pdfBuffer,
    contentType: "application/pdf",
  });

  const docxBuffer = await renderDocx(finalContent);
  await uploadObjectToBucket({
    bucket,
    key: docxKey,
    body: docxBuffer,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const runbookRecord = await prisma.runbook.create({
    data: {
      id: runbookId,
      tenantId,
      scenarioId: scenario?.id || null,
      title: options.title || "Runbook PRA/PCA",
      status: "READY",
      summary: options.summary || null,
      markdownPath: `s3://${bucket}/${markdownKey}`,
      pdfPath: `s3://${bucket}/${pdfKey}`,
      docxPath: `s3://${bucket}/${docxKey}`,
      generatedForServices: JSON.stringify(services.map((s) => s.id)),
      templateId: template?.id || null,
      templateNameSnapshot: template?.originalName || null,
    },
  });

  return {
    runbook: runbookRecord,
    markdown: finalContent,
    pdfPath: runbookRecord.pdfPath,
    docxPath: runbookRecord.docxPath,
    markdownPath: runbookRecord.markdownPath,
    ragContext: ragContextResult.context,
    llmPrompt: ragPrompt.prompt,
    ragScenarioRecommendations,
  };
}
