import type { PrismaClient } from "@prisma/client";

type CoverageBreakdown = {
  bia: number;
  risks: number;
  incidents: number;
  exercises: number;
};

export type ComplianceIndicators = {
  coverage: CoverageBreakdown;
  overallScore: number;
  totals: {
    services: number;
    processes: number;
    risks: number;
    incidents: number;
    exercises: number;
  };
  highlights: string[];
};

export type ComplianceTemplateChapter = {
  id: string;
  title: string;
  requiredFields: string[];
  summary?: string;
};

export type ComplianceTemplate = {
  id: string;
  label: string;
  framework: string;
  version: string;
  description: string;
  chapters: ComplianceTemplateChapter[];
};

export type ComplianceChecklistItem = {
  id: string;
  clause: string;
  title: string;
  description: string;
  requiredFields: string[];
  guidance?: string;
};

export type ComplianceChecklist = {
  id: string;
  framework: string;
  version: string;
  label: string;
  items: ComplianceChecklistItem[];
};

export type StatementOfApplicabilityItem = {
  id: string;
  clause: string;
  title: string;
  applicability: "applicable" | "not_applicable";
  justification: string | null;
  status: "implemented" | "partial" | "missing";
  evidence: string[];
};

export type StatementOfApplicability = {
  meta: {
    tenantId: string;
    generatedAt: string;
    framework: string;
    version: string;
  };
  items: StatementOfApplicabilityItem[];
};

export type ComplianceReportField = {
  key: string;
  label: string;
  description: string;
  value: string | number | null;
};

export type ComplianceReportChapter = ComplianceTemplateChapter & {
  fields: ComplianceReportField[];
  missingFields: string[];
  status: "complete" | "partial" | "missing";
};

export type ComplianceReport = {
  meta: {
    tenantId: string;
    generatedAt: string;
    templateId: string;
  };
  template: ComplianceTemplate;
  indicators: ComplianceIndicators;
  chapters: ComplianceReportChapter[];
};

const COMPLIANCE_FIELD_DEFINITIONS: Record<string, { label: string; description: string }> = {
  "organization.scope": {
    label: "Périmètre de continuité",
    description: "Périmètre organisationnel couvert par le SMSI/SMCA.",
  },
  "organization.owner": {
    label: "Responsable de la continuité",
    description: "Sponsor ou responsable identifié pour le programme de continuité.",
  },
  "bia.process.count": {
    label: "Processus BIA recensés",
    description: "Nombre total de processus métiers évalués.",
  },
  "bia.service.coverage": {
    label: "Couverture BIA des services",
    description: "Part des services rattachés à un processus BIA.",
  },
  "bia.last.review": {
    label: "Dernière revue BIA",
    description: "Date de dernière mise à jour d'un processus BIA.",
  },
  "risk.count": {
    label: "Risques recensés",
    description: "Nombre total de risques dans le registre.",
  },
  "risk.high.count": {
    label: "Risques élevés",
    description: "Nombre de risques classés high/critical.",
  },
  "risk.mitigation.coverage": {
    label: "Couverture des plans de traitement",
    description: "Part des risques disposant d'au moins une mitigation.",
  },
  "incidents.count": {
    label: "Incidents recensés",
    description: "Nombre total d'incidents traités.",
  },
  "incidents.resolution.rate": {
    label: "Taux de résolution incidents",
    description: "Part des incidents résolus ou clos.",
  },
  "incidents.meanResolutionHours": {
    label: "Délai moyen de résolution",
    description: "Temps moyen de résolution des incidents (heures).",
  },
  "exercises.count": {
    label: "Exercices réalisés",
    description: "Nombre total d'exercices de continuité.",
  },
  "exercises.last12Months": {
    label: "Exercices sur 12 mois",
    description: "Nombre d'exercices réalisés sur les 12 derniers mois.",
  },
  "exercises.completion.rate": {
    label: "Taux d'exercices finalisés",
    description: "Part des exercices clôturés/complets.",
  },
  "exercises.lastDate": {
    label: "Date du dernier exercice",
    description: "Date du dernier exercice de continuité.",
  },
  "improvements.keyActions": {
    label: "Actions d'amélioration",
    description: "Synthèse des actions prioritaires issues des analyses.",
  },
};

const COMPLIANCE_TEMPLATES: ComplianceTemplate[] = [
  {
    id: "iso22301",
    label: "Rapport de conformité ISO 22301",
    framework: "ISO 22301",
    version: "2019",
    description: "Structure orientée management de la continuité et exigences principales de l'ISO 22301.",
    chapters: [
      {
        id: "context",
        title: "Contexte & gouvernance",
        summary: "Contexte organisationnel et responsabilités clés.",
        requiredFields: ["organization.scope", "organization.owner"],
      },
      {
        id: "bia",
        title: "Analyse d'impact (BIA)",
        summary: "Identification des processus critiques et objectifs de reprise.",
        requiredFields: ["bia.process.count", "bia.service.coverage", "bia.last.review"],
      },
      {
        id: "risk",
        title: "Gestion des risques",
        summary: "Registre des risques et plans de traitement.",
        requiredFields: ["risk.count", "risk.high.count", "risk.mitigation.coverage"],
      },
      {
        id: "incident-exercise",
        title: "Incidents & exercices",
        summary: "Traitement des incidents et exercices de continuité.",
        requiredFields: [
          "incidents.count",
          "incidents.resolution.rate",
          "exercises.last12Months",
        ],
      },
      {
        id: "improvement",
        title: "Amélioration continue",
        summary: "Actions d'amélioration et suivi.",
        requiredFields: ["improvements.keyActions"],
      },
    ],
  },
  {
    id: "secnumcloud",
    label: "Rapport de conformité SecNumCloud",
    framework: "SecNumCloud",
    version: "v3",
    description: "Synthèse alignée sur les contrôles SecNumCloud liés à la résilience et au PRA.",
    chapters: [
      {
        id: "scope",
        title: "Périmètre & responsabilités",
        summary: "Délimitation du périmètre et responsables clés.",
        requiredFields: ["organization.scope", "organization.owner"],
      },
      {
        id: "continuity",
        title: "Préparation & continuité",
        summary: "Capacité de continuité basée sur BIA et objectifs.",
        requiredFields: ["bia.process.count", "bia.service.coverage"],
      },
      {
        id: "risk-incident",
        title: "Gestion des risques & incidents",
        summary: "Suivi des risques et traitement des incidents.",
        requiredFields: ["risk.count", "risk.mitigation.coverage", "incidents.resolution.rate"],
      },
      {
        id: "testing",
        title: "Tests & exercices",
        summary: "Planification et réalisation des tests de continuité.",
        requiredFields: ["exercises.last12Months", "exercises.completion.rate", "exercises.lastDate"],
      },
      {
        id: "improvement",
        title: "Améliorations",
        summary: "Actions de progrès et retour d'expérience.",
        requiredFields: ["improvements.keyActions"],
      },
    ],
  },
  {
    id: "dora",
    label: "Rapport de conformité DORA",
    framework: "DORA",
    version: "2024",
    description: "Synthèse alignée sur la résilience opérationnelle numérique (DORA).",
    chapters: [
      {
        id: "governance",
        title: "Gouvernance & résilience",
        summary: "Organisation de la gouvernance et périmètre.",
        requiredFields: ["organization.scope", "organization.owner"],
      },
      {
        id: "risk",
        title: "Gestion des risques ICT",
        summary: "Inventaire et mitigation des risques ICT.",
        requiredFields: ["risk.count", "risk.high.count", "risk.mitigation.coverage"],
      },
      {
        id: "bia",
        title: "BIA & objectifs de reprise",
        summary: "Couverture BIA et objectifs de reprise.",
        requiredFields: ["bia.process.count", "bia.service.coverage", "bia.last.review"],
      },
      {
        id: "incident",
        title: "Incidents ICT",
        summary: "Taux de résolution et délais.",
        requiredFields: ["incidents.count", "incidents.resolution.rate", "incidents.meanResolutionHours"],
      },
      {
        id: "testing",
        title: "Tests de résilience",
        summary: "Exercices et retours d'expérience.",
        requiredFields: ["exercises.count", "exercises.last12Months", "exercises.completion.rate"],
      },
    ],
  },
];

const ISO22301_CHECKLIST: ComplianceChecklist = {
  id: "iso22301-checklist",
  framework: "ISO 22301",
  version: "2019",
  label: "Checklist ISO 22301 (continuité d'activité)",
  items: [
    {
      id: "iso22301-4.1",
      clause: "4.1",
      title: "Contexte de l'organisation",
      description: "Définir le périmètre et les parties intéressées.",
      requiredFields: ["organization.scope"],
    },
    {
      id: "iso22301-5.3",
      clause: "5.3",
      title: "Rôles et responsabilités",
      description: "Nommer un responsable de la continuité.",
      requiredFields: ["organization.owner"],
    },
    {
      id: "iso22301-8.2",
      clause: "8.2",
      title: "BIA et impacts",
      description: "Documenter les processus critiques et objectifs RTO/RPO.",
      requiredFields: ["bia.process.count", "bia.service.coverage", "bia.last.review"],
    },
    {
      id: "iso22301-8.3",
      clause: "8.3",
      title: "Évaluation des risques",
      description: "Maintenir un registre des risques et plans de traitement.",
      requiredFields: ["risk.count", "risk.high.count", "risk.mitigation.coverage"],
    },
    {
      id: "iso22301-8.4",
      clause: "8.4",
      title: "Stratégies de continuité",
      description: "Définir des stratégies de continuité alignées au BIA.",
      requiredFields: ["bia.service.coverage"],
    },
    {
      id: "iso22301-8.5",
      clause: "8.5",
      title: "Procédures de continuité",
      description: "Décrire les procédures de réponse et reprise.",
      requiredFields: ["incidents.count"],
    },
    {
      id: "iso22301-8.6",
      clause: "8.6",
      title: "Exercices et tests",
      description: "Planifier et réaliser des exercices réguliers.",
      requiredFields: ["exercises.last12Months", "exercises.completion.rate", "exercises.lastDate"],
    },
    {
      id: "iso22301-9.1",
      clause: "9.1",
      title: "Suivi et mesure",
      description: "Suivre l'efficacité du SMSCA.",
      requiredFields: ["incidents.resolution.rate", "exercises.completion.rate"],
    },
    {
      id: "iso22301-10.1",
      clause: "10.1",
      title: "Amélioration continue",
      description: "Planifier les actions d'amélioration.",
      requiredFields: ["improvements.keyActions"],
    },
  ],
};

export function listComplianceChecklists(): ComplianceChecklist[] {
  return [ISO22301_CHECKLIST];
}

function hasFieldValue(value: string | number | null): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return true;
  return value.toString().trim().length > 0;
}

export async function buildStatementOfApplicability(
  prisma: PrismaClient,
  tenantId: string,
  checklistId = ISO22301_CHECKLIST.id
): Promise<StatementOfApplicability> {
  const checklist =
    checklistId === ISO22301_CHECKLIST.id ? ISO22301_CHECKLIST : ISO22301_CHECKLIST;
  const report = await buildComplianceReport(prisma, tenantId, "iso22301");
  const fieldMap = new Map(report.chapters.flatMap((chapter) => chapter.fields.map((f) => [f.key, f])));

  const items = checklist.items.map((item) => {
    const evidence = item.requiredFields.filter((field) => hasFieldValue(fieldMap.get(field)?.value ?? null));
    const status =
      evidence.length === 0
        ? "missing"
        : evidence.length === item.requiredFields.length
          ? "implemented"
          : "partial";
    return {
      id: item.id,
      clause: item.clause,
      title: item.title,
      applicability: "applicable",
      justification: null,
      status,
      evidence,
    } as StatementOfApplicabilityItem;
  });

  return {
    meta: {
      tenantId,
      generatedAt: new Date().toISOString(),
      framework: checklist.framework,
      version: checklist.version,
    },
    items,
  };
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(2));
}

function toIsoDate(value?: Date | null) {
  if (!value) return null;
  return value.toISOString().split("T")[0];
}

function normalizeIncidentStatus(status: string) {
  return status.trim().toUpperCase();
}

function buildHighlights(coverage: CoverageBreakdown) {
  const highlights: string[] = [];
  if (coverage.bia < 0.6) {
    highlights.push("Renforcer la couverture BIA sur les services critiques.");
  }
  if (coverage.risks < 0.6) {
    highlights.push("Accélérer la définition des plans de traitement des risques.");
  }
  if (coverage.incidents < 0.6) {
    highlights.push("Documenter davantage les actions post-incident.");
  }
  if (coverage.exercises < 0.6) {
    highlights.push("Planifier davantage d'exercices de continuité.");
  }
  if (highlights.length === 0) {
    highlights.push("Maintenir la dynamique de conformité actuelle.");
  }
  return highlights;
}

export function listComplianceTemplates() {
  return COMPLIANCE_TEMPLATES;
}

export async function buildComplianceIndicators(
  prisma: PrismaClient,
  tenantId: string,
  options?: { totalServices?: number; serviceIds?: string[] }
): Promise<ComplianceIndicators> {
  const serviceIds = options?.serviceIds;
  const [totalServices, processes, processLinks, risks, incidents, exercises] = await Promise.all([
    options?.totalServices ?? prisma.service.count({ where: { tenantId } }),
    prisma.businessProcess.findMany({
      where: { tenantId },
      select: { id: true, updatedAt: true },
    }),
    prisma.businessProcessService.findMany({
      where: {
        tenantId,
        ...(serviceIds ? { serviceId: { in: serviceIds } } : {}),
      },
      select: { serviceId: true },
    }),
    prisma.risk.findMany({
      where: { tenantId },
      include: { mitigations: true },
    }),
    prisma.incident.findMany({
      where: { tenantId },
      include: { actions: true },
    }),
    prisma.exercise.findMany({
      where: { tenantId },
    }),
  ]);

  const uniqueServicesWithBia = new Set(processLinks.map((link) => link.serviceId)).size;
  const risksWithMitigation = risks.filter((risk) => risk.mitigations.length > 0).length;
  const incidentsWithActions = incidents.filter((incident) => incident.actions.length > 0).length;

  const completedExercises = exercises.filter(
    (exercise) => exercise.status.toUpperCase() === "COMPLETED"
  );
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const exercisesLast12Months = exercises.filter((exercise) => {
    const referenceDate = exercise.scheduledAt ?? exercise.createdAt;
    return referenceDate >= twelveMonthsAgo;
  }).length;

  const coverage: CoverageBreakdown = {
    bia: ratio(uniqueServicesWithBia, totalServices),
    risks: ratio(risksWithMitigation, risks.length),
    incidents: ratio(incidentsWithActions, incidents.length),
    exercises: ratio(exercisesLast12Months, exercises.length),
  };

  const overallScore = Number(
    (
      (coverage.bia + coverage.risks + coverage.incidents + coverage.exercises) /
      4
    ).toFixed(2)
  );

  return {
    coverage,
    overallScore,
    totals: {
      services: totalServices,
      processes: processes.length,
      risks: risks.length,
      incidents: incidents.length,
      exercises: exercises.length,
    },
    highlights: buildHighlights(coverage),
  };
}

export async function buildComplianceReport(
  prisma: PrismaClient,
  tenantId: string,
  templateId?: string
): Promise<ComplianceReport> {
  const template = COMPLIANCE_TEMPLATES.find((item) => item.id === templateId) ?? COMPLIANCE_TEMPLATES[0];

  const [tenant, indicators, risks, incidents, exercises, processes] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    buildComplianceIndicators(prisma, tenantId),
    prisma.risk.findMany({ where: { tenantId }, include: { mitigations: true } }),
    prisma.incident.findMany({ where: { tenantId }, include: { actions: true } }),
    prisma.exercise.findMany({ where: { tenantId } }),
    prisma.businessProcess.findMany({ where: { tenantId } }),
  ]);

  const processUpdatedAt = processes.reduce<Date | null>((latest, process) => {
    if (!latest || process.updatedAt > latest) return process.updatedAt;
    return latest;
  }, null);

  const riskScores = risks.map((risk) => risk.probability * risk.impact);
  const highRisks = riskScores.filter((score) => score >= 10).length;
  const risksWithMitigation = risks.filter((risk) => risk.mitigations.length > 0).length;

  const resolvedIncidents = incidents.filter((incident) => {
    const status = normalizeIncidentStatus(incident.status);
    return status === "RESOLVED" || status === "CLOSED";
  });
  const resolutionRate = ratio(resolvedIncidents.length, incidents.length);
  const resolutionHours = resolvedIncidents.map((incident) => {
    const diffMs = incident.updatedAt.getTime() - incident.detectedAt.getTime();
    return diffMs / (1000 * 60 * 60);
  });
  const meanResolution = resolutionHours.length
    ? Number((resolutionHours.reduce((acc, value) => acc + value, 0) / resolutionHours.length).toFixed(2))
    : null;

  const exerciseLastDate = exercises.reduce<Date | null>((latest, exercise) => {
    const referenceDate = exercise.scheduledAt ?? exercise.createdAt;
    if (!latest || referenceDate > latest) return referenceDate;
    return latest;
  }, null);
  const completedExercises = exercises.filter((exercise) => exercise.status.toUpperCase() === "COMPLETED");
  const exerciseCompletionRate = ratio(completedExercises.length, exercises.length);

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const exercisesLast12Months = exercises.filter((exercise) => {
    const referenceDate = exercise.scheduledAt ?? exercise.createdAt;
    return referenceDate >= twelveMonthsAgo;
  }).length;

  const fieldValues: Record<string, string | number | null> = {
    "organization.scope": tenant ? `Tenant ${tenant.name}` : null,
    "organization.owner": null,
    "bia.process.count": processes.length,
    "bia.service.coverage": indicators.coverage.bia,
    "bia.last.review": toIsoDate(processUpdatedAt),
    "risk.count": risks.length,
    "risk.high.count": highRisks,
    "risk.mitigation.coverage": indicators.coverage.risks,
    "incidents.count": incidents.length,
    "incidents.resolution.rate": resolutionRate,
    "incidents.meanResolutionHours": meanResolution,
    "exercises.count": exercises.length,
    "exercises.last12Months": exercisesLast12Months,
    "exercises.completion.rate": exerciseCompletionRate,
    "exercises.lastDate": toIsoDate(exerciseLastDate),
    "improvements.keyActions": indicators.highlights.join(" "),
  };

  const chapters: ComplianceReportChapter[] = template.chapters.map((chapter) => {
    const fields = chapter.requiredFields.map((key) => {
      const definition = COMPLIANCE_FIELD_DEFINITIONS[key];
      return {
        key,
        label: definition?.label ?? key,
        description: definition?.description ?? "",
        value: fieldValues[key] ?? null,
      };
    });

    const missingFields = fields.filter((field) => field.value === null || field.value === "").map((field) => field.key);
    const status =
      missingFields.length === 0
        ? "complete"
        : missingFields.length === fields.length
        ? "missing"
        : "partial";

    return {
      ...chapter,
      fields,
      missingFields,
      status,
    };
  });

  return {
    meta: {
      tenantId,
      generatedAt: new Date().toISOString(),
      templateId: template.id,
    },
    template,
    indicators,
    chapters,
  };
}
