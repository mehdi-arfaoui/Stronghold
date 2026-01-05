import { Router } from "express";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";
import { recommendPraOptions } from "../analysis/praRecommender";
import {
  DR_SCENARIOS,
  getSuggestedDRStrategy,
  summarizeScenarioForTable,
} from "../analysis/drStrategyEngine";
import { buildDependencyRisks } from "../analysis/dependencyRiskEngine";
import { buildMaturityScore } from "../analysis/maturityScore";
import { buildNextActions } from "../analysis/nextActions";
import {
  DocumentNotFoundError,
  MissingExtractedTextError,
  getOrCreateExtractedFacts,
} from "../services/extractedFactService";
import {
  buildComplianceIndicators,
  buildComplianceReport,
  listComplianceTemplates,
} from "../services/complianceReporting";
import {
  buildRagPrompt,
  draftAnswerFromContext,
  generatePraReport,
  generateRunbookDraft,
  recommendScenariosWithRag,
  retrieveRagContext,
} from "../ai/ragService";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const router = Router();

/* ========= Helpers d'analyse applicative ========= */

// Analyse basique de cohérence RTO/RPO/criticité
function buildAppContinuityWarnings(services: any[]) {
  const warnings: any[] = [];

  for (const service of services) {
    const sName = service.name;
    const sCrit = service.criticality;
    const sRto = service.continuity?.rtoHours ?? null;
    const sRpo = service.continuity?.rpoMinutes ?? null;

    for (const dep of service.dependenciesFrom) {
      const target = dep.toService;
      if (!target) continue;

      const tName = target.name;
      const tRto = target.continuity?.rtoHours ?? null;
      const tRpo = target.continuity?.rpoMinutes ?? null;

      if (sRto != null && tRto != null && sRto < tRto) {
        warnings.push({
          type: "RTO_INCONSISTENCY",
          service: sName,
          dependsOn: tName,
          details: {
            serviceRto: sRto,
            dependsOnRto: tRto,
          },
          message: `RTO du service ${sName} (${sRto}h) est inférieur à celui de ${tName} (${tRto}h).`,
        });
      }

      if (sRpo != null && tRpo != null && sRpo < tRpo) {
        warnings.push({
          type: "RPO_INCONSISTENCY",
          service: sName,
          dependsOn: tName,
          details: {
            serviceRpo: sRpo,
            dependsOnRpo: tRpo,
          },
          message: `RPO du service ${sName} (${sRpo} min) est inférieur à celui de ${tName} (${tRpo} min).`,
        });
      }
    }

    if (sCrit === "high" && sRto != null && sRto > 24) {
      warnings.push({
        type: "HIGH_CRITICALITY_LONG_RTO",
        service: sName,
        dependsOn: null,
        details: { serviceRto: sRto, criticality: sCrit },
        message: `Le service ${sName} est de criticité HIGH mais a un RTO de ${sRto}h.`,
      });
    }
  }

  return warnings;
}

async function buildPraReportText(tenantId: string) {
  const [services, infra] = await Promise.all([
    prisma.service.findMany({
      where: { tenantId },
      include: {
        continuity: true,
        dependenciesFrom: {
          include: {
            toService: {
              include: { continuity: true },
            },
          },
        },
        dependenciesTo: true,
      },
    }),
    prisma.infraComponent.findMany({
      where: { tenantId },
      include: {
        services: {
          include: { service: true },
        },
      },
    }),
  ]);

  const depsWarnings = buildAppContinuityWarnings(services);
  const infraFindings = buildInfraFindings(infra);

  let text = "=== Rapport PRA/PCA – Synthèse technique ===\n\n";

  text += `Nombre de services recensés : ${services.length}\n`;
  const depCount = services.reduce((sum, s) => sum + s.dependenciesFrom.length, 0);
  text += `Nombre de dépendances : ${depCount}\n\n`;

  text += "1. Catalogue des services\n";
  text += "-------------------------\n";
  for (const s of services) {
    text += `- ${s.name} [${s.type}] (criticité : ${s.criticality}`;
    if (s.businessPriority) {
      text += ` | priorité métier : ${s.businessPriority}`;
    }
    text += ")\n";
    if (s.continuity) {
      text += `  RTO : ${s.continuity.rtoHours} h | RPO : ${s.continuity.rpoMinutes} min | MTPD : ${s.continuity.mtpdHours} h\n`;
    }
    if (s.description) {
      text += `  Description : ${s.description}\n`;
    }
    text += "\n";
  }

  text += "\n2. Chaînes de dépendances\n";
  text += "-------------------------\n";
  for (const s of services) {
    for (const dep of s.dependenciesFrom) {
      const target = dep.toService;
      if (!target) continue;
      text += `- ${s.name} dépend de ${target.name} (type de dépendance : ${dep.dependencyType}) \n`;
    }
  }

  text += "\n3. Analyse de cohérence PRA\n";
  text += "---------------------------\n";
  if (depsWarnings.length === 0) {
    text += "Aucune incohérence PRA détectée.\n";
  } else {
    text += "Les incohérences suivantes ont été détectées :\n\n";
    for (const w of depsWarnings) {
      text += `- ${w.message}\n`;
    }
  }

  text += "\n4. Synthèse Landing Zone / Infra\n";
  text += "--------------------------------\n";
  for (const f of infraFindings) {
    text += `- ${f.message}\n`;
  }

  return text;
}

function wrapPdfLines(
  text: string,
  font: any,
  fontSize: number,
  maxWidth: number
) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const wrapped: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      wrapped.push("");
      continue;
    }
    const words = line.split(" ");
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
      } else {
        if (current) {
          wrapped.push(current);
        }
        current = word;
      }
    }
    if (current) {
      wrapped.push(current);
    }
  }

  return wrapped;
}

async function renderReportPdf(text: string) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const margin = 40;
  const lineHeight = fontSize * 1.4;

  let page = pdfDoc.addPage();
  let y = page.getHeight() - margin;

  const maxWidth = page.getWidth() - margin * 2;
  const lines = wrapPdfLines(text, font, fontSize, maxWidth);

  for (const line of lines) {
    if (y <= margin) {
      page = pdfDoc.addPage();
      y = page.getHeight() - margin;
    }

    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/* ========= Helpers d'analyse infra ========= */

function buildInfraFindings(infraList: any[]) {
  const findings: any[] = [];

  for (const infra of infraList) {
    const compName = infra.name;
    const compType = infra.type;
    const location = infra.location;
    const servicesCount = infra.services?.length ?? 0;
    const highCritCount =
      infra.services?.filter((link: any) => link.service?.criticality === "high")
        .length ?? 0;

    findings.push({
      type: "INFRA_SUMMARY",
      infra: compName,
      infraType: compType,
      location,
      details: {
        totalServices: servicesCount,
        highCritCount,
      },
      message: `Le composant ${compName} (${compType}) héberge ${servicesCount} services dont ${highCritCount} à criticité HIGH.`,
    });

    if (infra.isSingleAz && highCritCount > 0) {
      findings.push({
        type: "SINGLE_AZ_HIGH_CRIT",
        infra: compName,
        infraType: compType,
        location,
        details: {
          highCritServices: highCritCount,
        },
        message: `Le composant ${compName} est en single-AZ et héberge ${highCritCount} service(s) HIGH : risque de SPOF.`,
      });
    }
  }

  return findings;
}

function normalizeCrit(value: string | null | undefined): "critical" | "high" | "medium" | "low" {
  const v = (value || "").toLowerCase();
  if (v === "critical") return "critical";
  if (v === "high") return "high";
  if (v === "medium") return "medium";
  return "low";
}

function computeTargetObjectives(services: any[]) {
  const globalCriticality: "critical" | "high" | "medium" | "low" = (() => {
    const critical = services.some((s) => normalizeCrit(s.criticality) === "critical");
    if (critical) return "critical";
    const high = services.some((s) => normalizeCrit(s.criticality) === "high");
    if (high) return "high";
    return "medium";
  })();

  const targetRtoHours =
    services
      .map((s) => s.continuity?.rtoHours)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b)[0] ?? (globalCriticality === "critical" ? 2 : 8);
  const targetRpoMinutes =
    services
      .map((s) => s.continuity?.rpoMinutes)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b)[0] ?? (globalCriticality === "critical" ? 15 : 120);

  return { globalCriticality, targetRtoHours, targetRpoMinutes };
}

function resolveCategory(domain: string | null, type: string | null): string {
  const normalizedDomain = (domain || "").toUpperCase();
  const normalizedType = (type || "").toUpperCase();

  if (normalizedDomain.includes("NETWORK") || normalizedType.includes("NETWORK")) {
    return "Network";
  }
  if (normalizedDomain.includes("SECURITY") || normalizedDomain.includes("GOV")) {
    return "Foundation";
  }
  if (normalizedDomain.includes("DATA") || normalizedDomain.includes("DB")) {
    return "Platform";
  }
  if (normalizedDomain.includes("IAC") || normalizedDomain.includes("PLATFORM")) {
    return "Platform";
  }
  if (normalizedDomain.includes("APP")) {
    return "Application";
  }
  return "Application";
}

router.get("/pra-dashboard", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const [services, infra] = await Promise.all([
      prisma.service.findMany({
        where: { tenantId },
        include: {
          continuity: true,
          dependenciesFrom: {
            include: { toService: { include: { continuity: true } } },
          },
          dependenciesTo: true,
        },
      }),
      prisma.infraComponent.findMany({
        where: { tenantId },
        include: { services: { include: { service: true } } },
      }),
    ]);

    const warnings = buildAppContinuityWarnings(services);
    const infraFindings = buildInfraFindings(infra);
    const compliance = await buildComplianceIndicators(prisma, tenantId, {
      totalServices: services.length,
      serviceIds: services.map((service) => service.id),
    });

    const drServices = services.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      domain: s.domain,
      criticality: s.criticality,
      rtoHours: s.continuity?.rtoHours ?? undefined,
      rpoMinutes: s.continuity?.rpoMinutes ?? undefined,
    }));
    const dependencies = services.flatMap((s) =>
      s.dependenciesFrom.map((d) => ({
        from: d.fromServiceId,
        to: d.toServiceId,
        type: d.dependencyType,
      }))
    );

    const { globalCriticality, targetRtoHours, targetRpoMinutes } = computeTargetObjectives(services);

    const drRecommendations = getSuggestedDRStrategy(
      drServices,
      dependencies,
      targetRtoHours,
      targetRpoMinutes,
      globalCriticality
    );

    const scenarioComparison = drRecommendations.map((rec) => summarizeScenarioForTable(rec));

    const categories = services.reduce<Record<string, { count: number; scoreSum: number }>>((acc, s) => {
      const category = resolveCategory(s.domain, s.type);
      const crit = normalizeCrit(s.criticality);
      if (!acc[category]) acc[category] = { count: 0, scoreSum: 0 };
      acc[category].count += 1;
      acc[category].scoreSum += crit === "critical" ? 4 : crit === "high" ? 3 : crit === "medium" ? 2 : 1;
      return acc;
    }, {});

    const categoryView = Object.entries(categories).map(([category, stats]) => {
      const average = stats.scoreSum / Math.max(1, stats.count);
      const normalizedAverage =
        average >= 3.5 ? "critical" : average >= 2.5 ? "high" : average >= 1.5 ? "medium" : "low";
      return { category, count: stats.count, averageCriticality: normalizedAverage };
    });

    const ragQuestion =
      req.query?.question && typeof req.query.question === "string"
        ? (req.query.question as string)
        : `Recommandations PRA pour ${tenantId}`;

    const ragReport = await generatePraReport({
      tenantId,
      question: ragQuestion,
      documentTypes: Array.isArray(req.query?.docTypes) ? (req.query.docTypes as string[]) : undefined,
      serviceFilter: typeof req.query?.service === "string" ? (req.query.service as string) : null,
      maxChunks: 6,
      maxFacts: 8,
    });

    return res.json({
      meta: { tenantId, targetRtoHours, targetRpoMinutes, globalCriticality },
      warnings,
      infraFindings,
      compliance,
      dr: {
        recommendations: drRecommendations,
        comparison: scenarioComparison,
      },
      categories: categoryView,
      rag: ragReport,
    });
  } catch (error) {
    console.error("Error in /analysis/pra-dashboard:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/compliance/templates", requireRole("READER"), async (_req: TenantRequest, res) => {
  return res.json(listComplianceTemplates());
});

router.get("/compliance/report", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const templateId =
      req.query?.templateId && typeof req.query.templateId === "string"
        ? req.query.templateId
        : undefined;

    const report = await buildComplianceReport(prisma, tenantId, templateId);
    return res.json(report);
  } catch (error) {
    console.error("Error in /analysis/compliance/report:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/maturity-score", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const [
      totalServices,
      continuityCount,
      dependencies,
      scenarioCount,
      runbookCount,
      backupStrategies,
    ] = await Promise.all([
      prisma.service.count({ where: { tenantId } }),
      prisma.serviceContinuity.count({ where: { service: { tenantId } } }),
      prisma.serviceDependency.findMany({
        where: { tenantId },
        select: { fromServiceId: true, toServiceId: true },
      }),
      prisma.scenario.count({ where: { tenantId } }),
      prisma.runbook.count({ where: { tenantId } }),
      prisma.backupStrategy.findMany({
        where: { tenantId, serviceId: { not: null } },
        select: { serviceId: true },
      }),
    ]);

    const dependencyServices = new Set<string>();
    dependencies.forEach((dependency) => {
      dependencyServices.add(dependency.fromServiceId);
      dependencyServices.add(dependency.toServiceId);
    });

    const backupServiceIds = new Set<string>();
    backupStrategies.forEach((backup) => {
      if (backup.serviceId) {
        backupServiceIds.add(backup.serviceId);
      }
    });

    const maturityScore = buildMaturityScore({
      totalServices,
      servicesWithContinuity: continuityCount,
      servicesWithDependencies: dependencyServices.size,
      dependencyLinks: dependencies.length,
      scenarioCount,
      runbookCount,
      servicesWithBackups: backupServiceIds.size,
      backupStrategies: backupStrategies.length,
    });

    return res.json({
      meta: { tenantId },
      ...maturityScore,
    });
  } catch (error) {
    console.error("Error in /analysis/maturity-score:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/next-actions", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const nextActions = await buildNextActions(prisma, tenantId);

    return res.json({
      meta: { tenantId },
      ...nextActions,
    });
  } catch (error) {
    console.error("Error in /analysis/next-actions:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/risk-heatmap", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const services = await prisma.service.findMany({
      where: { tenantId },
      include: { continuity: true },
    });

    const { globalCriticality, targetRtoHours, targetRpoMinutes } = computeTargetObjectives(services);

    const metrics = [
      { key: "rto", label: "RTO gap (h)", unit: "hours" },
      { key: "rpo", label: "RPO gap (min)", unit: "minutes" },
    ] as const;

    const criticalityWeights: Record<"critical" | "high" | "medium" | "low", number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    const data = services.flatMap((service) => {
      const criticality = normalizeCrit(service.criticality);
      const weight = criticalityWeights[criticality];
      const rtoGapRaw = service.continuity ? service.continuity.rtoHours - targetRtoHours : null;
      const rpoGapRaw = service.continuity ? service.continuity.rpoMinutes - targetRpoMinutes : null;
      const rtoGap = rtoGapRaw == null ? null : Math.max(0, rtoGapRaw);
      const rpoGap = rpoGapRaw == null ? null : Math.max(0, rpoGapRaw);

      return [
        {
          serviceId: service.id,
          serviceName: service.name,
          criticality,
          metric: "rto",
          gap: rtoGapRaw,
          gapRisk: rtoGap,
          score: rtoGap == null ? 0 : rtoGap * weight,
        },
        {
          serviceId: service.id,
          serviceName: service.name,
          criticality,
          metric: "rpo",
          gap: rpoGapRaw,
          gapRisk: rpoGap,
          score: rpoGap == null ? 0 : rpoGap * weight,
        },
      ];
    });

    return res.json({
      meta: { tenantId, targetRtoHours, targetRpoMinutes, globalCriticality },
      metrics,
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        criticality: normalizeCrit(service.criticality),
      })),
      data,
    });
  } catch (error) {
    console.error("Error in /analysis/risk-heatmap:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ========= Service RAG simple ========= */

router.post("/rag-query", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { question, documentIds, documentTypes, serviceFilter, maxChunks, maxFacts } = req.body || {};
    if (!question || typeof question !== "string" || question.trim().length < 4) {
      return res.status(400).json({ error: "Question manquante ou trop courte" });
    }

    const ragResult = await retrieveRagContext({
      tenantId,
      question,
      documentIds: Array.isArray(documentIds) ? documentIds : undefined,
      documentTypes: Array.isArray(documentTypes) ? documentTypes : undefined,
      serviceFilter: typeof serviceFilter === "string" ? serviceFilter : null,
      maxChunks: typeof maxChunks === "number" ? maxChunks : undefined,
      maxFacts: typeof maxFacts === "number" ? maxFacts : undefined,
    });

    const prompt = buildRagPrompt({ question, context: ragResult.context });
    const answerHint = draftAnswerFromContext(question, ragResult.context);

    return res.json({
      question: question.trim(),
      context: ragResult.context,
      prompt: prompt.prompt,
      promptSize: prompt.totalChars,
      draftAnswer: answerHint,
      usedDocumentIds: ragResult.usedDocumentIds,
    });
  } catch (error) {
    console.error("Error in /analysis/rag-query:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pra-rag-report", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { question, documentIds, documentTypes, serviceFilter } = req.body || {};
    if (!question || typeof question !== "string" || question.trim().length < 4) {
      return res.status(400).json({ error: "Question manquante ou trop courte" });
    }

    const report = await generatePraReport({
      tenantId,
      question,
      documentIds: Array.isArray(documentIds) ? documentIds : undefined,
      documentTypes: Array.isArray(documentTypes) ? documentTypes : undefined,
      serviceFilter: typeof serviceFilter === "string" ? serviceFilter : null,
      maxChunks: 8,
      maxFacts: 10,
    });

    return res.json(report);
  } catch (error) {
    console.error("Error in /analysis/pra-rag-report:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/runbook-draft", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }
    const { question, documentIds, documentTypes, serviceFilter } = req.body || {};

    const draft = await generateRunbookDraft({
      tenantId,
      question: typeof question === "string" && question.trim().length > 0 ? question : undefined,
      documentIds: Array.isArray(documentIds) ? documentIds : undefined,
      documentTypes: Array.isArray(documentTypes) ? documentTypes : undefined,
      serviceFilter: typeof serviceFilter === "string" ? serviceFilter : null,
    });

    return res.json(draft);
  } catch (error) {
    console.error("Error in /analysis/runbook-draft:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ========= 1. Analyse simple applicative ========= */

router.get("/basic", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const services = await prisma.service.findMany({
      where: { tenantId },
      include: {
        continuity: true,
        dependenciesFrom: {
          include: {
            toService: {
              include: { continuity: true },
            },
          },
        },
        dependenciesTo: true,
      },
    });

    const warnings = buildAppContinuityWarnings(services);
    return res.json(warnings);
  } catch (error) {
    console.error("Error in /analysis/basic:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ========= 2. Analyse simple infra ========= */

router.get("/infra-basic", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const infra = await prisma.infraComponent.findMany({
      where: { tenantId },
      include: {
        services: {
          include: {
            service: true,
          },
        },
      },
    });

    const findings = buildInfraFindings(infra);
    return res.json(findings);
  } catch (error) {
    console.error("Error in /analysis/infra-basic:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ========= 3. Rapport texte simple ========= */

router.get("/report", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).send("Tenant not resolved");
    }
    const text = await buildPraReportText(tenantId);
    res.type("text/plain").send(text);
  } catch (error) {
    console.error("Error in /analysis/report:", error);
    return res.status(500).send("Internal server error");
  }
});

router.get("/report/pdf", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).send("Tenant not resolved");
    }
    const text = await buildPraReportText(tenantId);
    const pdfBuffer = await renderReportPdf(text);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"rapport-pra.pdf\"");
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error in /analysis/report/pdf:", error);
    return res.status(500).send("Internal server error");
  }
});

/* ========= 4. Moteur de reco PRA (endpoint direct) ========= */

router.post("/pra-options", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const {
      environment,
      maxRtoHours,
      maxRpoMinutes,
      criticality,
      budgetLevel,
      complexityTolerance,
    } = req.body || {};

    const env =
      environment === "onprem" || environment === "hybrid" ? environment : "cloud";

    const crit: "low" | "medium" | "high" =
      criticality === "low" || criticality === "medium" || criticality === "high"
        ? criticality
        : "high";

    const budget: "low" | "medium" | "high" =
      budgetLevel === "low" || budgetLevel === "medium" || budgetLevel === "high"
        ? budgetLevel
        : "medium";

    const cxTol: "low" | "medium" | "high" =
      complexityTolerance === "low" ||
      complexityTolerance === "medium" ||
      complexityTolerance === "high"
        ? complexityTolerance
        : "medium";

    const rto = maxRtoHours != null ? Number(maxRtoHours) : 4;
    const rpo = maxRpoMinutes != null ? Number(maxRpoMinutes) : 60;

    const input = {
      environment: env,
      maxRtoHours: rto,
      maxRpoMinutes: rpo,
      criticality: crit,
      budgetLevel: budget,
      complexityTolerance: cxTol,
    } as const;

    const recs = recommendPraOptions(input);

    return res.json({
      input,
      recommendations: recs,
    });
  } catch (error) {
    console.error("Error in /analysis/pra-options:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ========= 5. Rapport JSON complet ========= */

router.get("/full-report-json", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const [tenant, services, infra, scenarios] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.service.findMany({
        where: { tenantId },
        include: {
          continuity: true,
          dependenciesFrom: {
            include: {
              toService: {
                include: { continuity: true },
              },
            },
          },
          dependenciesTo: {
            include: {
              fromService: {
                include: { continuity: true },
              },
            },
          },
          infraLinks: {
            include: {
              infra: true,
            },
          },
        },
      }),
      prisma.infraComponent.findMany({
        where: { tenantId },
        include: {
          services: {
            include: {
              service: true,
            },
          },
        },
      }),
      prisma.scenario.findMany({
        where: { tenantId },
        include: {
          services: {
            include: {
              service: true,
            },
          },
          steps: {
            orderBy: {
              order: "asc",
            },
          },
        },
      }),
    ]);

    const appWarnings = buildAppContinuityWarnings(services);
    const infraFindings = buildInfraFindings(infra);

    // Couverture scénarios
    const allServiceIds = services.map((s) => s.id);
    const serviceIdsWithScenario = new Set<string>();
    for (const sc of scenarios) {
      for (const link of sc.services) {
        if (link.serviceId) {
          serviceIdsWithScenario.add(link.serviceId);
        }
      }
    }
    const servicesWithoutScenario = allServiceIds.filter(
      (id) => !serviceIdsWithScenario.has(id)
    );

    // Input global pour les recos PRA (basé sur les services high crit)
    const highCritServices = services.filter((s) => s.criticality === "high");

    const effectiveRto =
      highCritServices.length > 0
        ? (() => {
            const vals = highCritServices
              .map((s) => s.continuity?.rtoHours)
              .filter((v): v is number => v != null);
            return vals.length > 0 ? Math.min(...vals) : 4;
          })()
        : 4;

    const effectiveRpo =
      highCritServices.length > 0
        ? (() => {
            const vals = highCritServices
              .map((s) => s.continuity?.rpoMinutes)
              .filter((v): v is number => v != null);
            return vals.length > 0 ? Math.min(...vals) : 60;
          })()
        : 60;

    const hasCloud = infra.some((i) =>
      (i.provider || "").toLowerCase().match(/aws|azure|gcp|cloud/)
    );
    const hasOnPrem = infra.some((i) =>
      (i.provider || "").toLowerCase().match(/onprem|on-prem|datacenter|dc/)
    );

    let env: "cloud" | "onprem" | "hybrid" = "cloud";
    if (hasCloud && hasOnPrem) env = "hybrid";
    else if (!hasCloud && hasOnPrem) env = "onprem";

    const praInput = {
      environment: env,
      maxRtoHours: effectiveRto,
      maxRpoMinutes: effectiveRpo,
      criticality: highCritServices.length > 0 ? "high" : "medium",
      budgetLevel: "medium",
      complexityTolerance: "medium",
    } as const;

    const praRecs = recommendPraOptions(praInput);

    const drStrategyInputServices = services.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      domain: s.domain,
      criticality: s.criticality,
      rtoHours: s.continuity?.rtoHours,
      rpoMinutes: s.continuity?.rpoMinutes,
    }));

    const drStrategyDeps = services.flatMap((s) =>
      s.dependenciesFrom.map((d) => ({
        from: d.fromServiceId,
        to: d.toServiceId,
        type: d.dependencyType,
      }))
    );

    const drSuggestions = getSuggestedDRStrategy(
      drStrategyInputServices,
      drStrategyDeps,
      praInput.maxRtoHours,
      praInput.maxRpoMinutes,
      praInput.criticality
    );

    const ragQuestion =
      tenant?.name && tenant.name.length > 0
        ? `Synthèse PRA/PCA pour ${tenant.name} (tenant ${tenantId})`
        : `Synthèse PRA/PCA pour le tenant ${tenantId}`;

    const ragContextResult = await retrieveRagContext({
      tenantId,
      question: ragQuestion,
      maxChunks: 4,
      maxFacts: 6,
    });

    const ragPrompt = buildRagPrompt({
      question: `${ragQuestion} avec rappel des risques et services prioritaires.`,
      context: ragContextResult.context,
      maxTotalLength: 3800,
    });

    const ragScenarioRecs = await recommendScenariosWithRag({
      tenantId,
      question: ragQuestion,
      services: drStrategyInputServices,
      scenarios,
      context: ragContextResult.context,
      maxResults: 5,
    });

    const report = {
      meta: {
        tenantId,
        tenantName: tenant?.name ?? null,
        generatedAt: new Date().toISOString(),
      },
      catalog: {
        serviceCount: services.length,
        infraCount: infra.length,
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          description: s.description,
          criticality: s.criticality,
          businessPriority: s.businessPriority,
          recoveryPriority: s.recoveryPriority,
          domain: s.domain,
          continuity: s.continuity
            ? {
                rtoHours: s.continuity.rtoHours,
                rpoMinutes: s.continuity.rpoMinutes,
                mtpdHours: s.continuity.mtpdHours,
                notes: s.continuity.notes,
              }
            : null,
          dependencies: {
            dependsOn: s.dependenciesFrom.map((d: any) => ({
              id: d.toService?.id,
              name: d.toService?.name,
              type: d.toService?.type,
              dependencyType: d.dependencyType,
            })),
            usedBy: s.dependenciesTo.map((d: any) => ({
              id: d.fromService?.id,
              name: d.fromService?.name,
              type: d.fromService?.type,
              dependencyType: d.dependencyType,
            })),
          },
          infra: s.infraLinks.map((link: any) => ({
            id: link.infra.id,
            name: link.infra.name,
            type: link.infra.type,
            provider: link.infra.provider,
            location: link.infra.location,
            isSingleAz: link.infra.isSingleAz,
          })),
        })),
      },
      continuityAnalysis: {
        warningCount: appWarnings.length,
        warnings: appWarnings,
      },
      landingZone: {
        componentCount: infra.length,
        components: infra.map((i) => ({
          id: i.id,
          name: i.name,
          type: i.type,
          provider: i.provider,
          location: i.location,
          criticality: i.criticality,
          isSingleAz: i.isSingleAz,
          services: i.services.map((link: any) => ({
            id: link.service.id,
            name: link.service.name,
            criticality: link.service.criticality,
          })),
        })),
        findings: infraFindings,
      },
      scenarios: {
        count: scenarios.length,
        items: scenarios.map((sc) => ({
          id: sc.id,
          name: sc.name,
          type: sc.type,
          description: sc.description,
          impactLevel: sc.impactLevel,
          rtoTargetHours: sc.rtoTargetHours,
          services: sc.services.map((link: any) => ({
            id: link.service.id,
            name: link.service.name,
            criticality: link.service.criticality,
          })),
          steps: sc.steps.map((st) => ({
            id: st.id,
            order: st.order,
            title: st.title,
            description: st.description,
            estimatedDurationMinutes: st.estimatedDurationMinutes,
            role: st.role,
            blocking: st.blocking,
          })),
        })),
        coverage: {
          servicesWithScenario: serviceIdsWithScenario.size,
          servicesWithoutScenario: servicesWithoutScenario.length,
          serviceIdsWithoutScenario: servicesWithoutScenario,
        },
      },
      praOptions: {
        input: praInput,
        recommendations: praRecs,
        drStrategies: {
          scenarios: DR_SCENARIOS,
          suggestions: drSuggestions.map((rec) => ({
            id: rec.scenario.id,
            label: rec.scenario.label,
            score: rec.score,
            rationale: rec.rationale,
            summary: summarizeScenarioForTable(rec),
          })),
        },
      },
      ragSupport: {
        question: ragQuestion,
        prompt: ragPrompt.prompt,
        promptSize: ragPrompt.totalChars,
        context: ragContextResult.context,
        scenarioRecommendations: ragScenarioRecs,
      },
    };

    return res.json(report);
  } catch (error) {
    console.error("Error in /analysis/full-report-json:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ========= 6. Analyse IA d'un document ========= */

router.post(
  "/documents/:id/extracted-facts",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const { id } = req.params;
      const force = String(req.query.force ?? "false").toLowerCase() === "true";

      const result = await getOrCreateExtractedFacts(id, tenantId, force);

      return res.json(result);
    } catch (error) {
      if (error instanceof DocumentNotFoundError) {
        return res.status(error.status).json({ error: error.message });
      }
      if (error instanceof MissingExtractedTextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Error in POST /analysis/documents/:id/extracted-facts:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
