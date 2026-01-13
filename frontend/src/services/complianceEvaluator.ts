import { COMPLIANCE_REFERENTIAL, type EvidenceKey } from "../constants/complianceReferential";
import type { BusinessProcess, ExerciseFront, Risk, RunbookFront } from "../types";

export type ComplianceStatus = "ok" | "partial" | "missing";

export type ComplianceItem = {
  id: string;
  label: string;
  standard: string;
  domain?: string;
  evidence: EvidenceKey;
  status: ComplianceStatus;
  recommendation: string;
};

export type ComplianceSummary = {
  overallScore: number;
  counts: {
    ok: number;
    partial: number;
    missing: number;
    total: number;
  };
  evidenceStatus: Record<EvidenceKey, ComplianceStatus>;
  isoChecklist: Array<{
    chapterId: string;
    title: string;
    requirements: ComplianceItem[];
  }>;
  secNumCloudChecklist: ComplianceItem[];
  gaps: ComplianceItem[];
  recommendedActions: string[];
};

const STATUS_SCORE: Record<ComplianceStatus, number> = {
  ok: 1,
  partial: 0.5,
  missing: 0,
};

const RECOMMENDATIONS: Record<EvidenceKey, string> = {
  bia: "Compléter les BIA pour les processus critiques et formaliser les impacts.",
  risks: "Actualiser la cartographie des risques et suivre les plans de traitement.",
  runbooks: "Formaliser les runbooks, plans de continuité et procédures opérationnelles.",
  exercises: "Planifier des exercices PRA réguliers et tracer les résultats.",
};

const evidenceStatusFromCounts = (
  evidence: EvidenceKey,
  {
    count,
    completed,
  }: {
    count: number;
    completed?: number;
  }
): ComplianceStatus => {
  switch (evidence) {
    case "bia":
      return count >= 5 ? "ok" : count > 0 ? "partial" : "missing";
    case "risks":
      return count >= 5 ? "ok" : count > 0 ? "partial" : "missing";
    case "runbooks":
      return count >= 3 ? "ok" : count > 0 ? "partial" : "missing";
    case "exercises": {
      const completedCount = completed ?? 0;
      if (completedCount >= 2) return "ok";
      return count > 0 ? "partial" : "missing";
    }
    default:
      return "missing";
  }
};

export function evaluateCompliance({
  processes,
  risks,
  runbooks,
  exercises,
}: {
  processes: BusinessProcess[];
  risks: Risk[];
  runbooks: RunbookFront[];
  exercises: ExerciseFront[];
}): ComplianceSummary {
  const completedExercises = exercises.filter((exercise) =>
    exercise.status ? exercise.status.toUpperCase() === "COMPLETED" : false
  ).length;

  const evidenceStatus: Record<EvidenceKey, ComplianceStatus> = {
    bia: evidenceStatusFromCounts("bia", { count: processes.length }),
    risks: evidenceStatusFromCounts("risks", { count: risks.length }),
    runbooks: evidenceStatusFromCounts("runbooks", { count: runbooks.length }),
    exercises: evidenceStatusFromCounts("exercises", {
      count: exercises.length,
      completed: completedExercises,
    }),
  };

  const isoChecklist = COMPLIANCE_REFERENTIAL.iso22301.chapters.map((chapter) => {
    const requirements = chapter.requirements.map((requirement) => {
      const status = evidenceStatus[requirement.evidence];
      return {
        id: requirement.id,
        label: requirement.text,
        standard: COMPLIANCE_REFERENTIAL.iso22301.standard,
        domain: chapter.title,
        evidence: requirement.evidence,
        status,
        recommendation: RECOMMENDATIONS[requirement.evidence],
      };
    });
    return {
      chapterId: chapter.id,
      title: chapter.title,
      requirements,
    };
  });

  const secNumCloudChecklist = COMPLIANCE_REFERENTIAL.secNumCloud.criteria.map((criterion) => {
    const status = evidenceStatus[criterion.evidence];
    return {
      id: criterion.id,
      label: criterion.label,
      standard: COMPLIANCE_REFERENTIAL.secNumCloud.standard,
      domain: criterion.domain,
      evidence: criterion.evidence,
      status,
      recommendation: RECOMMENDATIONS[criterion.evidence],
    };
  });

  const allItems = [
    ...isoChecklist.flatMap((chapter) => chapter.requirements),
    ...secNumCloudChecklist,
  ];

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
  const recommendedActions = (Object.keys(evidenceStatus) as EvidenceKey[])
    .filter((key) => evidenceStatus[key] !== "ok")
    .map((key) => RECOMMENDATIONS[key]);

  return {
    overallScore,
    counts,
    evidenceStatus,
    isoChecklist,
    secNumCloudChecklist,
    gaps,
    recommendedActions,
  };
}
