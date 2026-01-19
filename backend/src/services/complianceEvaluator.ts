import type { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

type EvidenceKey = "bia" | "risks" | "incidents" | "runbooks" | "exercises";
export type ComplianceStatus = "ok" | "partial" | "missing";

export type ComplianceClause = {
  id: string;
  standard: string;
  label: string;
  domain?: string;
  evidence: EvidenceKey[];
  status: ComplianceStatus;
  recommendation: string;
};

export type ComplianceReport = {
  meta: {
    tenantId: string;
    generatedAt: string;
  };
  totals: {
    processes: number;
    risks: number;
    incidents: number;
    runbooks: number;
    exercises: number;
    completedExercises: number;
    runbooksPublished: number;
    risksWithMitigation: number;
    incidentsWithActions: number;
  };
  evidenceStatus: Record<EvidenceKey, ComplianceStatus>;
  counts: {
    ok: number;
    partial: number;
    missing: number;
    total: number;
  };
  overallScore: number;
  standards: {
    iso22301: {
      standard: string;
      version: string;
      clauses: ComplianceClause[];
    };
    secNumCloud: {
      standard: string;
      version: string;
      criteria: ComplianceClause[];
    };
  };
  gaps: ComplianceClause[];
  correctiveActions: string[];
};

type IsoReferential = {
  standard: string;
  version: string;
  clauses: Array<{
    id: string;
    title: string;
    description?: string;
    evidence: EvidenceKey[];
  }>;
};

type SecNumCloudReferential = {
  standard: string;
  version: string;
  criteria: Array<{
    id: string;
    label: string;
    domain: string;
    description?: string;
    evidence: EvidenceKey[];
  }>;
};

const STATUS_SCORE: Record<ComplianceStatus, number> = {
  ok: 1,
  partial: 0.5,
  missing: 0,
};

const RECOMMENDATIONS: Record<EvidenceKey, string> = {
  bia: "Compléter les BIA pour les processus critiques et formaliser les impacts.",
  risks: "Actualiser la cartographie des risques et suivre les plans de traitement.",
  incidents: "Tracer les incidents, leurs actions correctives et les leçons apprises.",
  runbooks: "Formaliser les runbooks, plans de continuité et procédures opérationnelles.",
  exercises: "Planifier des exercices PRA réguliers et tracer les résultats.",
};

const COMPLIANCE_FILES = {
  iso22301: "complianceReferentials/iso22301.json",
  secNumCloud: "complianceReferentials/secnumcloud.json",
};

let cachedReferentials:
  | {
      iso: IsoReferential;
      sec: SecNumCloudReferential;
    }
  | null = null;

async function loadReferentials() {
  if (cachedReferentials) return cachedReferentials;
  const baseDir = dirname(fileURLToPath(import.meta.url));
  const [isoRaw, secRaw] = await Promise.all([
    readFile(resolve(baseDir, COMPLIANCE_FILES.iso22301), "utf-8"),
    readFile(resolve(baseDir, COMPLIANCE_FILES.secNumCloud), "utf-8"),
  ]);
  cachedReferentials = {
    iso: JSON.parse(isoRaw) as IsoReferential,
    sec: JSON.parse(secRaw) as SecNumCloudReferential,
  };
  return cachedReferentials;
}

function statusFromEvidence(statuses: ComplianceStatus[]): ComplianceStatus {
  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("partial")) return "partial";
  return "ok";
}

function summarizeRecommendation(evidence: EvidenceKey[], evidenceStatus: Record<EvidenceKey, ComplianceStatus>) {
  const recommendations = evidence
    .filter((key) => evidenceStatus[key] !== "ok")
    .map((key) => RECOMMENDATIONS[key]);
  if (recommendations.length === 0) {
    return "Conforme aux attentes sur les preuves disponibles.";
  }
  return Array.from(new Set(recommendations)).join(" ");
}

function evidenceStatusFromMetrics({
  processes,
  risks,
  risksWithMitigation,
  incidents,
  incidentsWithActions,
  runbooks,
  runbooksPublished,
  exercises,
  completedExercises,
}: {
  processes: number;
  risks: number;
  risksWithMitigation: number;
  incidents: number;
  incidentsWithActions: number;
  runbooks: number;
  runbooksPublished: number;
  exercises: number;
  completedExercises: number;
}): Record<EvidenceKey, ComplianceStatus> {
  const biaStatus = processes >= 5 ? "ok" : processes > 0 ? "partial" : "missing";

  const risksCoverage = risks > 0 ? risksWithMitigation / risks : 0;
  const riskStatus =
    risks === 0 ? "missing" : risksCoverage >= 0.6 ? "ok" : "partial";

  const incidentsCoverage = incidents > 0 ? incidentsWithActions / incidents : 0;
  const incidentStatus =
    incidents === 0 ? "missing" : incidentsCoverage >= 0.6 ? "ok" : "partial";

  const runbookCoverage = runbooks > 0 ? runbooksPublished / runbooks : 0;
  const runbookStatus =
    runbooks === 0 ? "missing" : runbookCoverage >= 0.6 ? "ok" : "partial";

  const exerciseStatus =
    exercises === 0 ? "missing" : completedExercises >= 1 ? "ok" : "partial";

  return {
    bia: biaStatus,
    risks: riskStatus,
    incidents: incidentStatus,
    runbooks: runbookStatus,
    exercises: exerciseStatus,
  };
}

export async function evaluateCompliance(
  prisma: PrismaClient,
  tenantId: string
): Promise<ComplianceReport> {
  const [referentials, processes, risks, incidents, runbooks, exercises] = await Promise.all([
    loadReferentials(),
    prisma.businessProcess.findMany({ where: { tenantId }, select: { id: true } }),
    prisma.risk.findMany({ where: { tenantId }, include: { mitigations: true } }),
    prisma.incident.findMany({ where: { tenantId }, include: { actions: true } }),
    prisma.runbook.findMany({ where: { tenantId }, select: { id: true, status: true } }),
    prisma.exercise.findMany({ where: { tenantId }, select: { id: true, status: true } }),
  ]);

  const risksWithMitigation = risks.filter((risk) => risk.mitigations.length > 0).length;
  const incidentsWithActions = incidents.filter((incident) => incident.actions.length > 0).length;
  const runbooksPublished = runbooks.filter((runbook) => runbook.status.toUpperCase() !== "DRAFT").length;
  const completedExercises = exercises.filter(
    (exercise) => exercise.status.toUpperCase() === "COMPLETED"
  ).length;

  const totals = {
    processes: processes.length,
    risks: risks.length,
    incidents: incidents.length,
    runbooks: runbooks.length,
    exercises: exercises.length,
    completedExercises,
    runbooksPublished,
    risksWithMitigation,
    incidentsWithActions,
  };

  const evidenceStatus = evidenceStatusFromMetrics({
    processes: totals.processes,
    risks: totals.risks,
    risksWithMitigation,
    incidents: totals.incidents,
    incidentsWithActions,
    runbooks: totals.runbooks,
    runbooksPublished,
    exercises: totals.exercises,
    completedExercises,
  });

  const isoClauses: ComplianceClause[] = referentials.iso.clauses.map((clause) => {
    const status = statusFromEvidence(clause.evidence.map((key) => evidenceStatus[key]));
    return {
      id: clause.id,
      standard: referentials.iso.standard,
      label: clause.title,
      evidence: clause.evidence,
      status,
      recommendation: summarizeRecommendation(clause.evidence, evidenceStatus),
    };
  });

  const secCriteria: ComplianceClause[] = referentials.sec.criteria.map((criterion) => {
    const status = statusFromEvidence(criterion.evidence.map((key) => evidenceStatus[key]));
    return {
      id: criterion.id,
      standard: referentials.sec.standard,
      label: criterion.label,
      domain: criterion.domain,
      evidence: criterion.evidence,
      status,
      recommendation: summarizeRecommendation(criterion.evidence, evidenceStatus),
    };
  });

  const allItems = [...isoClauses, ...secCriteria];
  const totalScore = allItems.reduce((sum, item) => sum + STATUS_SCORE[item.status], 0);
  const overallScore = allItems.length > 0 ? totalScore / allItems.length : 0;

  const counts = allItems.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      acc.total += 1;
      return acc;
    },
    { ok: 0, partial: 0, missing: 0, total: 0 }
  );

  const gaps = allItems.filter((item) => item.status !== "ok");
  const correctiveActions = Array.from(
    new Set(
      (Object.keys(evidenceStatus) as EvidenceKey[])
        .filter((key) => evidenceStatus[key] !== "ok")
        .map((key) => RECOMMENDATIONS[key])
    )
  );

  return {
    meta: { tenantId, generatedAt: new Date().toISOString() },
    totals,
    evidenceStatus,
    counts,
    overallScore,
    standards: {
      iso22301: {
        standard: referentials.iso.standard,
        version: referentials.iso.version,
        clauses: isoClauses,
      },
      secNumCloud: {
        standard: referentials.sec.standard,
        version: referentials.sec.version,
        criteria: secCriteria,
      },
    },
    gaps,
    correctiveActions,
  };
}
