import { Router } from "express";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { reportRateLimit } from "../middleware/rateLimitMiddleware.js";
import { appLogger } from "../utils/logger.js";
import { requireValidLicense, requireFeature } from "../middleware/licenseMiddleware.js";
import {
  buildValidationError,
  parseOptionalString,
  parseRequiredNumber,
  parseRequiredString,
  parseStringArray,
  type ValidationIssue,
} from "../validation/common.js";
import {
  buildBiaSummary,
  scoreCriticality,
  scoreImpact,
  scoreTimeSensitivity,
} from "../services/biaSummary.js";
import { buildBiaDashboard } from "../services/biaDashboard.js";
import { generateBiaReport, type ReportFormat, type ReportType } from "../services/biaReportGenerator.js";
import {
  getBiaIntegrationSummary,
  getProcessIntegration,
  linkRiskToProcess,
  createRiskForProcess,
} from "../services/biaIntegrationService.js";
import {
  getBiaSettings,
  addProcessTemplate,
  deleteProcessTemplate,
  updateCriticalityThresholds,
  updateAlertConfigurations,
  updateDisplayPreferences,
  toggleTemplateActive,
  resetToDefaults,
} from "../services/biaSettingsService.js";

const router = Router();

// Apply license validation to all BIA routes
router.use(requireValidLicense());
router.use(requireFeature("bia"));

const IMPACT_LEVEL_MIN = 1;
const IMPACT_LEVEL_MAX = 5;

const ensureImpactLevel = (
  value: unknown,
  field: string,
  issues: ValidationIssue[]
) => {
  const parsed = parseRequiredNumber(value, field, issues, {
    min: IMPACT_LEVEL_MIN,
  });
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed > IMPACT_LEVEL_MAX) {
    issues.push({
      field,
      message: `doit être inférieur ou égal à ${IMPACT_LEVEL_MAX}`,
    });
    return undefined;
  }
  return parsed;
};

export const __test__ = {
  scoreImpact,
  scoreTimeSensitivity,
  scoreCriticality,
};

router.get("/summary", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const summary = await buildBiaSummary(prisma, tenantId);
    return res.json(summary);
  } catch (error) {
    appLogger.error("Error fetching BIA summary", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const dashboard = await buildBiaDashboard(prisma, tenantId);
    return res.json(dashboard);
  } catch (error) {
    appLogger.error("Error fetching BIA dashboard", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/processes", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: ValidationIssue[] = [];
    const name = parseRequiredString(payload.name, "name", issues, { minLength: 2 });
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const owners = parseOptionalString(payload.owners, "owners", issues, { allowNull: true });
    const interdependencies = parseOptionalString(
      payload.interdependencies,
      "interdependencies",
      issues,
      { allowNull: true }
    );

    const financialImpactLevel = ensureImpactLevel(
      payload.financialImpactLevel,
      "financialImpactLevel",
      issues
    );
    const regulatoryImpactLevel = ensureImpactLevel(
      payload.regulatoryImpactLevel,
      "regulatoryImpactLevel",
      issues
    );
    const rtoHours = parseRequiredNumber(payload.rtoHours, "rtoHours", issues, { min: 0 });
    const rpoMinutes = parseRequiredNumber(payload.rpoMinutes, "rpoMinutes", issues, { min: 0 });
    const mtpdHours = parseRequiredNumber(payload.mtpdHours, "mtpdHours", issues, { min: 0 });

    const serviceIds = parseStringArray(payload.serviceIds, "serviceIds", issues) ?? [];

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const services = await prisma.service.findMany({
      where: { tenantId, id: { in: serviceIds } },
      select: { id: true },
    });
    if (services.length !== serviceIds.length) {
      return res
        .status(400)
        .json({ error: "Certaines références de services sont invalides" });
    }

    const impactScore = scoreImpact(financialImpactLevel!, regulatoryImpactLevel!);
    const timeScore = scoreTimeSensitivity(rtoHours!, rpoMinutes!, mtpdHours!);
    const criticalityScore = scoreCriticality(impactScore, timeScore);

    const process = await prisma.businessProcess.create({
      data: {
        tenantId,
        name: name!,
        ...(description !== undefined ? { description } : {}),
        ...(owners !== undefined ? { owners } : {}),
        financialImpactLevel: financialImpactLevel!,
        regulatoryImpactLevel: regulatoryImpactLevel!,
        ...(interdependencies !== undefined ? { interdependencies } : {}),
        rtoHours: rtoHours!,
        rpoMinutes: rpoMinutes!,
        mtpdHours: mtpdHours!,
        impactScore,
        criticalityScore,
        services: {
          create: services.map((service) => ({
            tenantId,
            serviceId: service.id,
          })),
        },
      },
      include: {
        services: {
          include: { service: true },
        },
      },
    });

    return res.status(201).json(process);
  } catch (error) {
    appLogger.error("Error creating business process", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/processes", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const processes = await prisma.businessProcess.findMany({
      where: { tenantId },
      include: {
        services: {
          include: { service: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return res.json(processes);
  } catch (error) {
    appLogger.error("Error fetching business processes", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reports/generate", reportRateLimit, requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { type, format, includeCharts, includeRecommendations, scenarioType, processIds } = req.body;

    const validTypes: ReportType[] = ["full", "summary", "scenario"];
    const validFormats: ReportFormat[] = ["markdown", "json", "html"];

    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid report type. Must be: full, summary, or scenario" });
    }

    if (!format || !validFormats.includes(format)) {
      return res.status(400).json({ error: "Invalid format. Must be: markdown, json, or html" });
    }

    const report = await generateBiaReport(prisma, tenantId, {
      type,
      format,
      includeCharts: includeCharts ?? true,
      includeRecommendations: includeRecommendations ?? true,
      scenarioType: scenarioType ?? "site_disaster",
      processIds: processIds ?? [],
    });

    return res.json(report);
  } catch (error) {
    appLogger.error("Error generating BIA report", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Integration endpoints
router.get("/integration/summary", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const summary = await getBiaIntegrationSummary(prisma, tenantId);
    return res.json(summary);
  } catch (error) {
    appLogger.error("Error fetching BIA integration summary", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/integration/process/:processId", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { processId } = req.params;
    if (!processId) {
      return res.status(400).json({ error: "processId est requis" });
    }

    const integration = await getProcessIntegration(prisma, tenantId, processId);
    if (!integration) {
      return res.status(404).json({ error: "Processus introuvable" });
    }

    return res.json(integration);
  } catch (error) {
    appLogger.error("Error fetching process integration", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/integration/process/:processId/link-risk", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { processId } = req.params;
    const { riskId } = req.body;

    if (!processId || !riskId) {
      return res.status(400).json({ error: "processId et riskId sont requis" });
    }

    const process = await prisma.businessProcess.findFirst({
      where: { id: processId, tenantId },
    });

    if (!process) {
      return res.status(404).json({ error: "Processus introuvable" });
    }

    const success = await linkRiskToProcess(prisma, tenantId, riskId, process.name);
    if (!success) {
      return res.status(404).json({ error: "Risque introuvable" });
    }

    return res.json({ success: true, message: "Risque lié au processus" });
  } catch (error) {
    appLogger.error("Error linking risk to process", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/integration/process/:processId/create-risk", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { processId } = req.params;
    const { title, description, threatType, probability, impact } = req.body;

    if (!processId) {
      return res.status(400).json({ error: "processId est requis" });
    }

    const issues: ValidationIssue[] = [];
    const validTitle = parseRequiredString(title, "title", issues, { minLength: 3 });
    const validThreatType = parseRequiredString(threatType, "threatType", issues);
    const validProbability = parseRequiredNumber(probability, "probability", issues, { min: 1 });
    const validImpact = parseRequiredNumber(impact, "impact", issues, { min: 1 });

    if (validProbability !== undefined && validProbability > 5) {
      issues.push({ field: "probability", message: "doit être inférieur ou égal à 5" });
    }
    if (validImpact !== undefined && validImpact > 5) {
      issues.push({ field: "impact", message: "doit être inférieur ou égal à 5" });
    }

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const risk = await createRiskForProcess(prisma, tenantId, processId, {
      title: validTitle!,
      description: description || undefined,
      threatType: validThreatType!,
      probability: validProbability!,
      impact: validImpact!,
    });

    if (!risk) {
      return res.status(404).json({ error: "Processus introuvable" });
    }

    return res.status(201).json(risk);
  } catch (error) {
    appLogger.error("Error creating risk for process", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Settings endpoints
router.get("/settings", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const settings = await getBiaSettings(prisma, tenantId);
    return res.json(settings);
  } catch (error) {
    appLogger.error("Error fetching BIA settings", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/templates", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const issues: ValidationIssue[] = [];
    const name = parseRequiredString(req.body.name, "name", issues, { minLength: 2 });
    const category = parseRequiredString(req.body.category, "category", issues);
    const defaultRtoHours = parseRequiredNumber(req.body.defaultRtoHours, "defaultRtoHours", issues, { min: 0 });
    const defaultRpoMinutes = parseRequiredNumber(req.body.defaultRpoMinutes, "defaultRpoMinutes", issues, { min: 0 });
    const defaultMtpdHours = parseRequiredNumber(req.body.defaultMtpdHours, "defaultMtpdHours", issues, { min: 0 });

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const template = await addProcessTemplate(prisma, tenantId, {
      name: name!,
      description: req.body.description || null,
      category: category!,
      defaultRtoHours: defaultRtoHours!,
      defaultRpoMinutes: defaultRpoMinutes!,
      defaultMtpdHours: defaultMtpdHours!,
      suggestedFinancialImpact: req.body.suggestedFinancialImpact || 3,
      suggestedRegulatoryImpact: req.body.suggestedRegulatoryImpact || 3,
      isActive: req.body.isActive !== false,
    });

    return res.status(201).json(template);
  } catch (error) {
    appLogger.error("Error creating process template", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/settings/templates/:templateId", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { templateId } = req.params;
    if (!templateId) {
      return res.status(400).json({ error: "templateId est requis" });
    }

    const success = await deleteProcessTemplate(prisma, tenantId, templateId);
    if (!success) {
      return res.status(400).json({ error: "Impossible de supprimer ce template (built-in ou introuvable)" });
    }

    return res.status(204).send();
  } catch (error) {
    appLogger.error("Error deleting process template", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/settings/templates/:templateId/toggle", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { templateId } = req.params;
    const { isActive } = req.body;

    if (!templateId) {
      return res.status(400).json({ error: "templateId est requis" });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive doit être un booléen" });
    }

    const template = await toggleTemplateActive(prisma, tenantId, templateId, isActive);
    if (!template) {
      return res.status(404).json({ error: "Template introuvable" });
    }

    return res.json(template);
  } catch (error) {
    appLogger.error("Error toggling template", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/settings/thresholds", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { thresholds } = req.body;
    if (!Array.isArray(thresholds)) {
      return res.status(400).json({ error: "thresholds doit être un tableau" });
    }

    const updated = await updateCriticalityThresholds(prisma, tenantId, thresholds);
    return res.json(updated);
  } catch (error) {
    appLogger.error("Error updating thresholds", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/settings/alerts", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { configs } = req.body;
    if (!Array.isArray(configs)) {
      return res.status(400).json({ error: "configs doit être un tableau" });
    }

    const updated = await updateAlertConfigurations(prisma, tenantId, configs);
    return res.json(updated);
  } catch (error) {
    appLogger.error("Error updating alert configurations", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/settings/display", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const preferences = req.body;
    const updated = await updateDisplayPreferences(prisma, tenantId, preferences);
    return res.json(updated);
  } catch (error) {
    appLogger.error("Error updating display preferences", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/reset", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { section } = req.body;
    const validSections = ["templates", "thresholds", "alerts", "display"];

    if (section && !validSections.includes(section)) {
      return res.status(400).json({ error: `section doit être: ${validSections.join(", ")}` });
    }

    const settings = await resetToDefaults(prisma, tenantId, section);
    return res.json(settings);
  } catch (error) {
    appLogger.error("Error resetting settings", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
