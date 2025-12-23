import { Router } from "express";
import { ApiRole } from "@prisma/client";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";
import { recommendPraOptions } from "../analysis/praRecommender";
import {
  DR_SCENARIOS,
  getSuggestedDRStrategy,
  summarizeScenarioForTable,
} from "../analysis/drStrategyEngine";
import {
  DocumentNotFoundError,
  MissingExtractedTextError,
  getOrCreateExtractedFacts,
} from "../services/extractedFactService";
import {
  buildRagPrompt,
  draftAnswerFromContext,
  recommendScenariosWithRag,
  retrieveRagContext,
} from "../ai/ragService";

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

/* ========= Service RAG simple ========= */

router.post("/rag-query", requireRole(ApiRole.READER), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { question, documentIds, maxChunks, maxFacts } = req.body || {};
    if (!question || typeof question !== "string" || question.trim().length < 4) {
      return res.status(400).json({ error: "Question manquante ou trop courte" });
    }

    const ragResult = await retrieveRagContext({
      tenantId,
      question,
      documentIds: Array.isArray(documentIds) ? documentIds : undefined,
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
    const depCount = services.reduce(
      (sum, s) => sum + s.dependenciesFrom.length,
      0
    );
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

    res.type("text/plain").send(text);
  } catch (error) {
    console.error("Error in /analysis/report:", error);
    return res.status(500).send("Internal server error");
  }
});

/* ========= 4. Moteur de reco PRA (endpoint direct) ========= */

router.post("/pra-options", requireRole(ApiRole.READER), async (req: TenantRequest, res) => {
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
  requireRole(ApiRole.OPERATOR),
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
