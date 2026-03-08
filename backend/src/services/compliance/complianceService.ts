import type { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePersistedRecommendationState } from "../landing-zone-financial.service.js";
import { appLogger } from "../../utils/logger.js";
import type {
  ComplianceCheckResult,
  ComplianceFramework,
  ComplianceFrameworkRequirement,
  ComplianceFrameworkSummary,
  ComplianceReport,
  ComplianceStatus,
} from "./types.js";

const FRAMEWORK_FILE_BY_ID: Record<string, string> = {
  iso22301: "iso22301.json",
  nis2: "nis2.json",
};

const COMPOSITE_DEPENDENCIES: Record<string, string[]> = {
  biaAndDrPlansInPlace: ["biaCompleted", "recommendationsAccepted"],
  drPlansValidated: ["recommendationsAccepted", "exerciseCompleted"],
  vulnerabilityManagement: ["scheduledScanActive", "driftDetectionActive"],
};

const UNAVAILABLE_RESULT: ComplianceCheckResult = {
  status: "unavailable",
  details: "Verification impossible",
};

export const COMPLIANCE_DISCLAIMER =
  "Ce score est un indicateur interne base sur les donnees collectees par Stronghold. " +
  "Il ne constitue pas un audit de certification. La conformite a ISO 22301 ou NIS 2 " +
  "doit etre validee par un organisme accredite. Stronghold facilite la preparation " +
  "a l audit mais ne remplace pas l audit lui-meme.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasRecommendationMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false;
  return "landingZoneRecommendation" in metadata || "landingZoneAccepted" in metadata;
}

function parseFramework(raw: string): ComplianceFramework {
  const parsed = JSON.parse(raw) as ComplianceFramework;
  if (!parsed?.id || !Array.isArray(parsed.requirements)) {
    throw new Error("Invalid compliance framework definition");
  }
  return parsed;
}

function formatUnavailableDetails(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `Verification impossible : ${error.message}`;
  }
  return "Verification impossible : erreur inconnue";
}

export class UnknownComplianceFrameworkError extends Error {
  constructor(public readonly frameworkId: string) {
    super(`Unsupported compliance framework: ${frameworkId}`);
    this.name = "UnknownComplianceFrameworkError";
  }
}

export class ComplianceService {
  private readonly frameworksDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "frameworks",
  );

  private readonly frameworkCache = new Map<string, ComplianceFramework>();

  constructor(private readonly prismaClient: PrismaClient) {}

  listSupportedFrameworks(): string[] {
    return Object.keys(FRAMEWORK_FILE_BY_ID);
  }

  async evaluateAll(tenantId: string): Promise<ComplianceReport[]> {
    const frameworkIds = this.listSupportedFrameworks();
    const reports = await Promise.all(frameworkIds.map((frameworkId) => this.evaluate(frameworkId, tenantId)));
    return reports;
  }

  async evaluate(frameworkId: string, tenantId: string): Promise<ComplianceReport> {
    const normalizedFrameworkId = frameworkId.trim().toLowerCase();
    const framework = await this.loadFramework(normalizedFrameworkId);

    const requiredChecks = framework.requirements.map((requirement) => requirement.check);
    const atomicChecks = this.collectAtomicChecks(requiredChecks);
    const evaluatedAtomicResults = await Promise.all(
      atomicChecks.map(async (checkName) => [checkName, await this.evaluateCheck(checkName, tenantId)] as const),
    );
    const atomicResults = new Map<string, ComplianceCheckResult>(evaluatedAtomicResults);

    let totalPoints = 0;
    let maxPoints = 0;
    const checks = framework.requirements.map((requirement) => {
      const result = this.resolveRequirementResult(requirement.check, atomicResults);
      const score =
        result.status === "compliant"
          ? requirement.weight
          : result.status === "partial"
            ? Number((requirement.weight * 0.5).toFixed(2))
            : 0;
      const countInMaximum = result.status !== "unavailable";

      totalPoints += score;
      if (countInMaximum) {
        maxPoints += requirement.weight;
      }

      return {
        requirementId: requirement.id,
        clause: requirement.clause,
        title: requirement.title,
        description: requirement.description,
        status: result.status,
        score,
        maxScore: requirement.weight,
        details: result.details,
        actionUrl: this.getActionUrl(requirement.dataSource),
      };
    });

    const overallScore = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;

    return {
      frameworkId: framework.id,
      frameworkName: framework.name,
      frameworkVersion: framework.version ?? "",
      overallScore,
      totalPoints: Number(totalPoints.toFixed(2)),
      maxPoints,
      checks,
      generatedAt: new Date().toISOString(),
      disclaimer: COMPLIANCE_DISCLAIMER,
    };
  }

  static toFrameworkSummary(report: ComplianceReport): ComplianceFrameworkSummary {
    const compliant = report.checks.filter((check) => check.status === "compliant").length;
    const partial = report.checks.filter((check) => check.status === "partial").length;
    const nonCompliant = report.checks.filter((check) => check.status === "non_compliant").length;
    const unavailable = report.checks.filter((check) => check.status === "unavailable").length;

    return {
      id: report.frameworkId,
      name: report.frameworkName,
      score: report.overallScore,
      compliant,
      partial,
      nonCompliant,
      unavailable,
    };
  }

  private collectAtomicChecks(requiredChecks: string[]): string[] {
    const names = new Set<string>();
    for (const check of requiredChecks) {
      const dependencies = COMPOSITE_DEPENDENCIES[check];
      if (dependencies) {
        dependencies.forEach((dependency) => names.add(dependency));
      } else {
        names.add(check);
      }
    }
    return [...names];
  }

  private resolveRequirementResult(
    checkName: string,
    atomicResults: Map<string, ComplianceCheckResult>,
  ): ComplianceCheckResult {
    if (COMPOSITE_DEPENDENCIES[checkName]) {
      return this.resolveCompositeCheck(checkName, atomicResults);
    }
    return atomicResults.get(checkName) ?? {
      status: "unavailable",
      details: `Verification "${checkName}" non implementee`,
    };
  }

  private resolveCompositeCheck(
    checkName: string,
    atomicResults: Map<string, ComplianceCheckResult>,
  ): ComplianceCheckResult {
    const dependencies = COMPOSITE_DEPENDENCIES[checkName] ?? [];
    const dependencyResults = dependencies.map((dependencyName) =>
      atomicResults.get(dependencyName) ?? {
        status: "unavailable",
        details: `Dependance "${dependencyName}" non evaluee`,
      },
    );

    if (dependencyResults.some((result) => result.status === "unavailable")) {
      return {
        status: "unavailable",
        details: "Verification composite impossible : au moins une dependance est indisponible.",
      };
    }

    const getStatus = (dependencyName: string): ComplianceStatus => {
      const result = atomicResults.get(dependencyName);
      return result?.status ?? "unavailable";
    };

    if (checkName === "biaAndDrPlansInPlace") {
      const bia = getStatus("biaCompleted");
      const recommendations = getStatus("recommendationsAccepted");

      if (bia === "compliant" && recommendations === "compliant") {
        return { status: "compliant", details: "BIA et plans DR en place." };
      }
      if (bia !== "non_compliant" || recommendations !== "non_compliant") {
        return { status: "partial", details: "BIA ou plans DR partiellement en place." };
      }
      return { status: "non_compliant", details: "Ni BIA ni plans DR en place." };
    }

    if (checkName === "drPlansValidated") {
      const recommendations = getStatus("recommendationsAccepted");
      const exercises = getStatus("exerciseCompleted");

      if (recommendations === "compliant" && exercises === "compliant") {
        return { status: "compliant", details: "Plans DR acceptes et testes." };
      }
      if (recommendations !== "non_compliant" || exercises !== "non_compliant") {
        return { status: "partial", details: "Plans DR partiellement valides." };
      }
      return { status: "non_compliant", details: "Aucun plan DR valide." };
    }

    if (checkName === "vulnerabilityManagement") {
      const scans = getStatus("scheduledScanActive");
      const drift = getStatus("driftDetectionActive");

      if (scans === "compliant" && drift === "compliant") {
        return { status: "compliant", details: "Scans et detection de derive actifs." };
      }
      if (scans !== "non_compliant" || drift !== "non_compliant") {
        return { status: "partial", details: "Surveillance automatisee partiellement active." };
      }
      return { status: "non_compliant", details: "Aucune surveillance automatisee active." };
    }

    return {
      status: "unavailable",
      details: `Verification composite "${checkName}" non implementee`,
    };
  }

  private async evaluateCheck(checkName: string, tenantId: string): Promise<ComplianceCheckResult> {
    try {
      return await this.evaluateAtomicCheck(checkName, tenantId);
    } catch (error) {
      appLogger.warn("compliance.check_failed", {
        check: checkName,
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        status: "unavailable",
        details: formatUnavailableDetails(error),
      };
    }
  }

  private async evaluateAtomicCheck(checkName: string, tenantId: string): Promise<ComplianceCheckResult> {
    switch (checkName) {
      case "biaCompleted": {
        const latestReport = await this.prismaClient.bIAReport2.findFirst({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          include: {
            processes: {
              select: {
                validationStatus: true,
              },
            },
          },
        });

        if (latestReport) {
          const validatedCount = latestReport.processes.filter(
            (process) => process.validationStatus === "validated",
          ).length;
          if (validatedCount > 0) {
            return {
              status: "compliant",
              details: `BIA realisee avec ${validatedCount} processus valides.`,
            };
          }
          return {
            status: "partial",
            details: "BIA generee mais non validee manuellement.",
          };
        }

        const businessProcessCount = await this.prismaClient.businessProcess.count({
          where: { tenantId },
        });
        if (businessProcessCount > 0) {
          return {
            status: "partial",
            details: `${businessProcessCount} processus BIA saisis, mais aucun rapport BIA publie.`,
          };
        }

        return { status: "non_compliant", details: "Aucune BIA realisee." };
      }

      case "spofIdentified": {
        const latestAnalysis = await this.prismaClient.graphAnalysis.findFirst({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          select: {
            spofCount: true,
            totalNodes: true,
          },
        });

        if (!latestAnalysis) {
          return {
            status: "non_compliant",
            details: "Aucune analyse de resilience effectuee.",
          };
        }

        if (latestAnalysis.spofCount > 0) {
          return {
            status: "compliant",
            details: `${latestAnalysis.spofCount} SPOF identifies et analyses.`,
          };
        }

        if (latestAnalysis.totalNodes > 0) {
          return {
            status: "compliant",
            details: "Analyse realisee, aucun SPOF detecte.",
          };
        }

        return {
          status: "partial",
          details: "Analyse executee mais graphe vide.",
        };
      }

      case "recommendationsAccepted": {
        const states = await this.getRecommendationStates(tenantId);
        const total = states.length;
        if (total === 0) {
          return {
            status: "non_compliant",
            details: "Aucune recommandation generee.",
          };
        }

        const accepted = states.filter((status) => status === "validated").length;
        const ratio = accepted / total;
        if (ratio >= 0.5) {
          return {
            status: "compliant",
            details: `${accepted}/${total} recommandations acceptees.`,
          };
        }
        if (accepted > 0) {
          return {
            status: "partial",
            details: `${accepted}/${total} recommandations acceptees.`,
          };
        }
        return {
          status: "non_compliant",
          details: "Aucune recommandation acceptee.",
        };
      }

      case "businessFlowsDefined": {
        const count = await this.prismaClient.businessFlow.count({
          where: { tenantId },
        });
        if (count > 0) {
          return {
            status: "compliant",
            details: `${count} flux metier definis.`,
          };
        }
        return {
          status: "non_compliant",
          details: "Aucun flux metier defini.",
        };
      }

      case "rtoRpoDefined": {
        const latestReport = await this.prismaClient.bIAReport2.findFirst({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          include: {
            processes: {
              select: {
                suggestedRTO: true,
                suggestedRPO: true,
                validatedRTO: true,
                validatedRPO: true,
              },
            },
          },
        });

        const processes = latestReport?.processes ?? [];
        if (processes.length === 0) {
          return { status: "non_compliant", details: "Aucun RTO/RPO defini." };
        }

        const withTargets = processes.filter((process) => {
          const rto = process.validatedRTO ?? process.suggestedRTO;
          const rpo = process.validatedRPO ?? process.suggestedRPO;
          const hasRto = typeof rto === "number" && Number.isFinite(rto);
          const hasRpo = typeof rpo === "number" && Number.isFinite(rpo);
          return hasRto && hasRpo;
        }).length;

        if (withTargets === processes.length) {
          return {
            status: "compliant",
            details: "RTO/RPO definis pour tous les services critiques.",
          };
        }
        if (withTargets > 0) {
          return {
            status: "partial",
            details: `RTO/RPO definis pour ${withTargets}/${processes.length} services.`,
          };
        }
        return {
          status: "non_compliant",
          details: "Aucun RTO/RPO defini.",
        };
      }

      case "exerciseCompleted": {
        const [classicCompleted, classicTotal, praCompleted, praTotal] = await Promise.all([
          this.prismaClient.exercise.count({
            where: { tenantId, status: "COMPLETED" },
          }),
          this.prismaClient.exercise.count({
            where: { tenantId },
          }),
          this.prismaClient.pRAExercise.count({
            where: { tenantId, status: "completed" },
          }),
          this.prismaClient.pRAExercise.count({
            where: { tenantId },
          }),
        ]);

        const completed = classicCompleted + praCompleted;
        const total = classicTotal + praTotal;

        if (completed > 0) {
          return {
            status: "compliant",
            details: `${completed} exercice(s) realise(s).`,
          };
        }
        if (total > 0) {
          return {
            status: "partial",
            details: `${total} exercice(s) existe(nt), mais aucun n est termine.`,
          };
        }
        return {
          status: "non_compliant",
          details: "Aucun exercice DR realise.",
        };
      }

      case "scheduledScanActive": {
        const [activeScanSchedules, totalScanSchedules, activeDiscoverySchedules, totalDiscoverySchedules] =
          await Promise.all([
            this.prismaClient.scanSchedule.count({
              where: { tenantId, isActive: true },
            }),
            this.prismaClient.scanSchedule.count({
              where: { tenantId },
            }),
            this.prismaClient.discoverySchedule.count({
              where: { tenantId, active: true },
            }),
            this.prismaClient.discoverySchedule.count({
              where: { tenantId },
            }),
          ]);

        if (activeScanSchedules > 0 || activeDiscoverySchedules > 0) {
          return {
            status: "compliant",
            details: "Scan planifie actif.",
          };
        }

        if (totalScanSchedules > 0 || totalDiscoverySchedules > 0) {
          return {
            status: "partial",
            details: "Des scans planifies existent mais sont inactifs.",
          };
        }

        return {
          status: "non_compliant",
          details: "Aucun scan planifie.",
        };
      }

      case "driftDetectionActive": {
        const schedule = await this.prismaClient.driftSchedule.findUnique({
          where: { tenantId },
          select: { enabled: true },
        });

        if (schedule?.enabled) {
          return { status: "compliant", details: "Detection de derive active." };
        }

        if (schedule) {
          return { status: "partial", details: "Detection de derive desactivee." };
        }

        return {
          status: "partial",
          details: "Detection de derive non configuree.",
        };
      }

      case "pendingRecommendationsReviewed": {
        const states = await this.getRecommendationStates(tenantId);
        const total = states.length;
        if (total === 0) {
          return {
            status: "non_compliant",
            details: "Aucune recommandation a revoir.",
          };
        }

        const pending = states.filter((status) => status === "pending").length;
        if (pending === 0) {
          return {
            status: "compliant",
            details: "Toutes les recommandations ont ete traitees.",
          };
        }
        if (pending < total) {
          return {
            status: "partial",
            details: `${pending} recommandation(s) en attente de revue.`,
          };
        }
        return {
          status: "non_compliant",
          details: "Toutes les recommandations sont encore en attente de revue.",
        };
      }

      case "dependenciesMapped": {
        const edgeCount = await this.prismaClient.infraEdge.count({
          where: { tenantId },
        });
        if (edgeCount > 0) {
          return {
            status: "compliant",
            details: `${edgeCount} dependances identifiees dans le graphe.`,
          };
        }

        const nodeCount = await this.prismaClient.infraNode.count({
          where: { tenantId },
        });
        if (nodeCount > 0) {
          return {
            status: "non_compliant",
            details: "Aucune dependance cartographiee.",
          };
        }

        return {
          status: "non_compliant",
          details: "Graphe d infrastructure non disponible.",
        };
      }

      case "incidentProcessDefined":
        return {
          status: "unavailable",
          details: "Module de gestion des incidents non disponible dans cette version.",
        };

      default:
        return {
          ...UNAVAILABLE_RESULT,
          details: `Verification "${checkName}" non implementee`,
        };
    }
  }

  private async getRecommendationStates(
    tenantId: string,
  ): Promise<Array<"pending" | "validated" | "rejected">> {
    const nodes = await this.prismaClient.infraNode.findMany({
      where: { tenantId },
      select: { metadata: true },
    });

    const statuses: Array<"pending" | "validated" | "rejected"> = [];
    for (const node of nodes) {
      if (!hasRecommendationMetadata(node.metadata)) continue;
      const state = parsePersistedRecommendationState(node.metadata);
      statuses.push(state.status);
    }
    return statuses;
  }

  private getActionUrl(dataSource: string): string {
    const normalized = dataSource.replace(/\s+/g, "").toLowerCase();
    if (normalized.includes("bia")) return "/analysis";
    if (normalized.includes("analysis")) return "/analysis";
    if (normalized.includes("recommendations")) return "/recommendations";
    if (normalized.includes("businessflows")) return "/business-flows";
    if (normalized.includes("exercises")) return "/simulations/pra-exercises";
    if (normalized.includes("scans")) return "/discovery";
    if (normalized.includes("graph")) return "/discovery";
    if (normalized.includes("drift")) return "/drift";
    if (normalized.includes("incidents")) return "/incidents";
    return "/settings";
  }

  private async loadFramework(frameworkId: string): Promise<ComplianceFramework> {
    const cached = this.frameworkCache.get(frameworkId);
    if (cached) return cached;

    const fileName = FRAMEWORK_FILE_BY_ID[frameworkId];
    if (!fileName) {
      throw new UnknownComplianceFrameworkError(frameworkId);
    }

    const filePath = path.resolve(this.frameworksDir, fileName);
    const raw = await readFile(filePath, "utf-8");
    const framework = parseFramework(raw);

    for (const requirement of framework.requirements) {
      this.validateRequirement(requirement);
    }

    this.frameworkCache.set(framework.id, framework);
    if (framework.id !== frameworkId) {
      this.frameworkCache.set(frameworkId, framework);
    }
    return framework;
  }

  private validateRequirement(requirement: ComplianceFrameworkRequirement): void {
    if (!requirement.id || !requirement.check || !Number.isFinite(requirement.weight)) {
      throw new Error(`Invalid requirement in framework definition: ${JSON.stringify(requirement)}`);
    }
  }
}
