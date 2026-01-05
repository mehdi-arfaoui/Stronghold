export type MaturityScoreLevel = "low" | "medium" | "high";

export type MaturityScoreBreakdown = {
  key: "rto_rpo" | "dependencies" | "scenarios" | "runbooks" | "backups";
  label: string;
  score: number;
  maxScore: number;
  coverage: number;
  details: string;
};

export type MaturityScoreMetrics = {
  totalServices: number;
  servicesWithContinuity: number;
  servicesWithDependencies: number;
  dependencyLinks: number;
  scenarioCount: number;
  runbookCount: number;
  servicesWithBackups: number;
  backupStrategies: number;
};

export type MaturityScoreResult = {
  score: number;
  maxScore: number;
  level: MaturityScoreLevel;
  breakdown: MaturityScoreBreakdown[];
  recommendations: string[];
  metrics: MaturityScoreMetrics;
};

export type MaturityScoreInputs = MaturityScoreMetrics;

const DEFAULT_WEIGHT = 20;

const toCoverage = (count: number, total: number) => {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, count / total));
};

const toScore = (coverage: number, weight: number) => Math.round(weight * coverage);

const toLevel = (score: number, maxScore: number): MaturityScoreLevel => {
  const ratio = maxScore === 0 ? 0 : score / maxScore;
  if (ratio >= 0.8) return "high";
  if (ratio >= 0.5) return "medium";
  return "low";
};

const pluralize = (value: number, singular: string, plural = `${singular}s`) =>
  value > 1 ? plural : singular;

export const buildMaturityScore = (input: MaturityScoreInputs): MaturityScoreResult => {
  const continuityCoverage = toCoverage(input.servicesWithContinuity, input.totalServices);
  const dependencyCoverage = toCoverage(input.servicesWithDependencies, input.totalServices);
  const backupCoverage = toCoverage(input.servicesWithBackups, input.totalServices);
  const scenarioCoverage = input.scenarioCount > 0 ? 1 : 0;
  const runbookCoverage = input.runbookCount > 0 ? 1 : 0;

  const breakdown: MaturityScoreBreakdown[] = [
    {
      key: "rto_rpo",
      label: "RTO/RPO définis",
      coverage: continuityCoverage,
      maxScore: DEFAULT_WEIGHT,
      score: toScore(continuityCoverage, DEFAULT_WEIGHT),
      details: `${input.servicesWithContinuity}/${input.totalServices} services couverts`,
    },
    {
      key: "dependencies",
      label: "Dépendances cartographiées",
      coverage: dependencyCoverage,
      maxScore: DEFAULT_WEIGHT,
      score: toScore(dependencyCoverage, DEFAULT_WEIGHT),
      details: `${input.servicesWithDependencies}/${input.totalServices} services liés`,
    },
    {
      key: "scenarios",
      label: "Scénarios PRA",
      coverage: scenarioCoverage,
      maxScore: DEFAULT_WEIGHT,
      score: toScore(scenarioCoverage, DEFAULT_WEIGHT),
      details: `${input.scenarioCount} scénario${input.scenarioCount > 1 ? "s" : ""}`,
    },
    {
      key: "runbooks",
      label: "Runbooks opérationnels",
      coverage: runbookCoverage,
      maxScore: DEFAULT_WEIGHT,
      score: toScore(runbookCoverage, DEFAULT_WEIGHT),
      details: `${input.runbookCount} runbook${input.runbookCount > 1 ? "s" : ""}`,
    },
    {
      key: "backups",
      label: "Sauvegardes définies",
      coverage: backupCoverage,
      maxScore: DEFAULT_WEIGHT,
      score: toScore(backupCoverage, DEFAULT_WEIGHT),
      details: `${input.servicesWithBackups}/${input.totalServices} services protégés`,
    },
  ];

  const maxScore = breakdown.reduce((sum, item) => sum + item.maxScore, 0);
  const score = breakdown.reduce((sum, item) => sum + item.score, 0);
  const level = toLevel(score, maxScore);

  const recommendations: string[] = [];
  if (input.totalServices === 0) {
    recommendations.push("Ajouter des services pour établir une base de maturité PRA.");
  }

  if (continuityCoverage < 0.8 && input.totalServices > 0) {
    const missing = input.totalServices - input.servicesWithContinuity;
    recommendations.push(
      `Renseigner les objectifs RTO/RPO pour ${missing} ${pluralize(missing, "service")} manquant${
        missing > 1 ? "s" : ""
      }.`
    );
  }

  if (dependencyCoverage < 0.7 && input.totalServices > 0) {
    const missing = input.totalServices - input.servicesWithDependencies;
    recommendations.push(
      `Cartographier les dépendances pour ${missing} ${pluralize(missing, "service")} afin d'anticiper les impacts.`
    );
  }

  if (input.scenarioCount === 0) {
    recommendations.push("Créer au moins un scénario PRA critique (perte région, cyberattaque, corruption data).");
  }

  if (input.runbookCount === 0) {
    recommendations.push("Formaliser des runbooks de reprise alignés avec vos scénarios principaux.");
  }

  if (backupCoverage < 0.8 && input.totalServices > 0) {
    const missing = input.totalServices - input.servicesWithBackups;
    recommendations.push(
      `Définir une stratégie de sauvegarde pour ${missing} ${pluralize(missing, "service")} critique${
        missing > 1 ? "s" : ""
      }.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push("Maintenir la couverture et planifier des tests PRA réguliers.");
  }

  return {
    score,
    maxScore,
    level,
    breakdown,
    recommendations,
    metrics: input,
  };
};
