import type { CostEstimate } from "./financialModels.js";
import {
  defaultBudgetForCriticality,
  formatCostEstimate,
} from "./financialModels.js";

export type CriticalityLevel = "critical" | "high" | "medium" | "low";

export type DependencyEdge = {
  from: string;
  to: string;
  type: string;
};

export type PraService = {
  id: string;
  name: string;
  type: string;
  domain?: string | null;
  criticality: CriticalityLevel | string;
  rtoHours?: number | null;
  rpoMinutes?: number | null;
};

export type DrScenario = {
  id: string;
  label: string;
  description: string;
  rtoRangeHours: [number, number];
  rpoRangeMinutes: [number, number];
  cost: CostEstimate;
  complexity: "low" | "medium" | "high";
  suitableFor: CriticalityLevel[];
  notes: string;
  source?: string;
};

export type DrRecommendation = {
  scenario: DrScenario;
  score: number;
  rationale: string[];
  justification: string;
  matchLevel: "strong" | "medium" | "weak";
};

const SCENARIOS: DrScenario[] = [
  {
    id: "backup-restore",
    label: "Backup & Restore",
    description:
      "Sauvegardes complètes ou incrémentales avec restauration après sinistre. RTO/RPO plus longs mais coût réduit.",
    rtoRangeHours: [24, 72],
    rpoRangeMinutes: [60, 1440],
    cost: { capex: 8000, opexMonthly: 700, currency: "EUR" },
    complexity: "low",
    suitableFor: ["low", "medium"],
    notes: "Adapté aux services non critiques avec tolérance aux interruptions.",
    source: "tutorialsdojo.com",
  },
  {
    id: "pilot-light",
    label: "Pilot Light",
    description:
      "Composants critiques (bases, config) toujours prêts sur le site de secours, montée en charge lors de l'incident.",
    rtoRangeHours: [4, 24],
    rpoRangeMinutes: [15, 120],
    cost: { capex: 18000, opexMonthly: 1800, currency: "EUR" },
    complexity: "medium",
    suitableFor: ["medium", "high", "critical"],
    notes: "Compromis coût/rapidité, bonne base pour workloads critiques modérées.",
    source: "tutorialsdojo.com",
  },
  {
    id: "warm-standby",
    label: "Warm Standby",
    description:
      "Environnement partiel actif avec capacité réduite, bascule rapide et scale-out durant le sinistre.",
    rtoRangeHours: [1, 4],
    rpoRangeMinutes: [5, 60],
    cost: { capex: 42000, opexMonthly: 5200, currency: "EUR" },
    complexity: "medium",
    suitableFor: ["high", "critical"],
    notes: "Restauration rapide pour services critiques avec budget significatif.",
    source: "tutorialsdojo.com",
  },
  {
    id: "active-active",
    label: "Active/Active multi-site",
    description:
      "Sites ou régions servent le trafic simultanément avec réplication synchrone ou quasi temps réel.",
    rtoRangeHours: [0, 1],
    rpoRangeMinutes: [0, 5],
    cost: { capex: 120000, opexMonthly: 15000, currency: "EUR" },
    complexity: "high",
    suitableFor: ["critical"],
    notes: "Résilience maximale, nécessite budget et expertise élevés.",
    source: "tutorialsdojo.com",
  },
  {
    id: "active-passive-geo",
    label: "Active/Passive avec géo-réplication",
    description:
      "Environnement secondaire passif répliqué en continu (bases, stockage) avec bascule orchestrée.",
    rtoRangeHours: [1, 6],
    rpoRangeMinutes: [1, 30],
    cost: { capex: 32000, opexMonthly: 3400, currency: "EUR" },
    complexity: "medium",
    suitableFor: ["high", "critical"],
    notes: "Bon compromis pour workloads critiques sans aller jusqu'à l'active-active.",
    // Source: AWS geo-replication DR patterns (tutorialsdojo.com)
    source: "tutorialsdojo.com",
  },
  {
    id: "multi-az-ha",
    label: "Multi-AZ haute disponibilité",
    description:
      "Déploiement multi-zone avec réplication synchronisée ou quasi temps réel, bascule orchestrée (active/passive).",
    rtoRangeHours: [0.25, 2],
    rpoRangeMinutes: [1, 30],
    cost: { capex: 26000, opexMonthly: 2800, currency: "EUR" },
    complexity: "medium",
    suitableFor: ["high", "critical"],
    notes:
      "Alternative moins coûteuse que l'active-active multi-région tout en réduisant fortement le RTO.",
    // Source: AWS multi-AZ HA patterns (tutorialsdojo.com)
    source: "tutorialsdojo.com",
  },
  {
    id: "continuous-data-protection",
    label: "Continuous Data Protection",
    description:
      "Capture et réplication continue des journaux/transactions pour limiter la perte de données.",
    rtoRangeHours: [1, 8],
    rpoRangeMinutes: [0, 10],
    cost: { capex: 22000, opexMonthly: 4100, currency: "EUR" },
    complexity: "high",
    suitableFor: ["high", "critical"],
    notes: "Approprié quand le RPO doit être quasi nul sur des données sensibles.",
    // Source: CDP vendor best practices (tutorialsdojo.com)
    source: "tutorialsdojo.com",
  },
];

function normalizeCriticality(value: string | null | undefined): CriticalityLevel {
  const normalized = (value || "").toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function scoreRtoRpo(targetRto: number, targetRpo: number, scenario: DrScenario): number {
  const [rtoMin, rtoMax] = scenario.rtoRangeHours;
  const [rpoMin, rpoMax] = scenario.rpoRangeMinutes;

  let score = 0;
  if (targetRto < rtoMin) score += 3;
  if (targetRto > rtoMax * 1.5) score += 1;
  if (targetRpo < rpoMin) score += 3;
  if (targetRpo > rpoMax * 2) score += 1;
  return score;
}

function costPenalty(
  criticity: CriticalityLevel,
  cost: DrScenario["cost"],
  budget?: CostEstimate
): number {
  const target = budget ?? defaultBudgetForCriticality(criticity);
  const capexRatio = target.capex > 0 ? cost.capex / target.capex : 0;
  const opexRatio = target.opexMonthly > 0 ? cost.opexMonthly / target.opexMonthly : 0;

  if (capexRatio > 1.6 || opexRatio > 1.6) return 4;
  if (capexRatio > 1.3 || opexRatio > 1.3) return 2;
  return 0;
}

function complexityPenalty(complexity: DrScenario["complexity"]): number {
  if (complexity === "high") return 2;
  return complexity === "medium" ? 1 : 0;
}

function formatRationaleSummary(
  scenario: DrScenario,
  rationale: string[],
  targetRto: number,
  targetRpo: number
) {
  const base = `${scenario.label} (${scenario.rtoRangeHours[0]}-${scenario.rtoRangeHours[1]}h / ${scenario.rpoRangeMinutes[0]}-${scenario.rpoRangeMinutes[1]}min)`;
  if (rationale.length === 0) {
    return `${base} correspond aux objectifs ${targetRto}h/${targetRpo}min avec un coût ${formatCostEstimate(
      scenario.cost
    )} et une complexité ${scenario.complexity}.`;
  }
  return `${base} : ${rationale.join("; ")}`;
}

function resolveMatchLevel(score: number): DrRecommendation["matchLevel"] {
  if (score <= 2) return "strong";
  if (score <= 5) return "medium";
  return "weak";
}

export function getSuggestedDRStrategy(
  services: PraService[],
  dependencies: DependencyEdge[],
  targetRtoHours: number,
  targetRpoMinutes: number,
  globalCriticality: CriticalityLevel,
  budget?: CostEstimate
): DrRecommendation[] {
  const critCounts: Record<CriticalityLevel, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  services.forEach((s) => {
    const c = normalizeCriticality(s.criticality);
    critCounts[c] += 1;
  });

  const hasStrongDependencies = dependencies.some((d) => (d.type || "").toLowerCase().includes("fort"));

  return SCENARIOS.map((scenario) => {
    const rationale: string[] = [];
    let score = 0;

    const rtoRpoScore = scoreRtoRpo(targetRtoHours, targetRpoMinutes, scenario);
    if (rtoRpoScore > 0) {
      rationale.push(
        `RTO/RPO cibles (${targetRtoHours}h / ${targetRpoMinutes}min) en tension avec la plage ${scenario.label}.`
      );
      score += rtoRpoScore;
    }

    if (!scenario.suitableFor.includes(globalCriticality)) {
      rationale.push(`Criticité ${globalCriticality.toUpperCase()} moins alignée avec ${scenario.label}.`);
      score += 2;
    }

    const costScore = costPenalty(globalCriticality, scenario.cost, budget);
    if (costScore > 0) {
      rationale.push(`Coût ${formatCostEstimate(scenario.cost)} potentiellement surdimensionné.`);
      score += costScore;
    }

    const cxScore = complexityPenalty(scenario.complexity);
    if (cxScore > 0) {
      rationale.push(`Complexité ${scenario.complexity} à prévoir (orchestration, réplication).`);
      score += cxScore;
    }

    if (hasStrongDependencies && scenario.id === "backup-restore") {
      rationale.push("Dépendances fortes détectées : backup/restore risque d'être trop lent.");
      score += 2;
    }

    if (scenario.id === "continuous-data-protection" && targetRpoMinutes <= 10) {
      rationale.push("RPO très serré : CDP appropriée pour limiter la perte de données.");
      score = Math.max(0, score - 1);
    }

    if (scenario.id === "active-active" && critCounts.critical + critCounts.high < 1) {
      rationale.push("Peu de services critiques : active/active peut être disproportionné.");
      score += 3;
    }

    if (rationale.length === 0) {
      rationale.push("Scénario cohérent avec les objectifs PRA fournis.");
    }

    const justification = formatRationaleSummary(scenario, rationale, targetRtoHours, targetRpoMinutes);
    const matchLevel = resolveMatchLevel(score);

    return {
      scenario,
      score,
      rationale,
      justification,
      matchLevel,
    };
  }).sort((a, b) => a.score - b.score);
}

export function summarizeScenarioForTable(rec: DrRecommendation) {
  const { scenario } = rec;
    return {
      id: scenario.id,
      label: scenario.label,
      rto: `${scenario.rtoRangeHours[0]}-${scenario.rtoRangeHours[1]} h`,
      rpo: `${scenario.rpoRangeMinutes[0]}-${scenario.rpoRangeMinutes[1]} min`,
      cost: scenario.cost,
    complexity: scenario.complexity,
    description: scenario.description,
    notes: scenario.notes,
  };
}

export const DR_SCENARIOS = SCENARIOS;
