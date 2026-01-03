"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DR_SCENARIOS = void 0;
exports.getSuggestedDRStrategy = getSuggestedDRStrategy;
exports.summarizeScenarioForTable = summarizeScenarioForTable;
const SCENARIOS = [
    {
        id: "backup-restore",
        label: "Backup & Restore",
        description: "Sauvegardes complètes ou incrémentales avec restauration après sinistre. RTO/RPO plus longs mais coût réduit.",
        rtoRangeHours: [24, 72],
        rpoRangeMinutes: [60, 1440],
        cost: "low",
        complexity: "low",
        suitableFor: ["low", "medium"],
        notes: "Adapté aux services non critiques avec tolérance aux interruptions.",
        source: "tutorialsdojo.com",
    },
    {
        id: "pilot-light",
        label: "Pilot Light",
        description: "Composants critiques (bases, config) toujours prêts sur le site de secours, montée en charge lors de l'incident.",
        rtoRangeHours: [4, 24],
        rpoRangeMinutes: [15, 120],
        cost: "medium",
        complexity: "medium",
        suitableFor: ["medium", "high", "critical"],
        notes: "Compromis coût/rapidité, bonne base pour workloads critiques modérées.",
        source: "tutorialsdojo.com",
    },
    {
        id: "warm-standby",
        label: "Warm Standby",
        description: "Environnement partiel actif avec capacité réduite, bascule rapide et scale-out durant le sinistre.",
        rtoRangeHours: [1, 4],
        rpoRangeMinutes: [5, 60],
        cost: "high",
        complexity: "medium",
        suitableFor: ["high", "critical"],
        notes: "Restauration rapide pour services critiques avec budget significatif.",
        source: "tutorialsdojo.com",
    },
    {
        id: "active-active",
        label: "Active/Active multi-site",
        description: "Sites ou régions servent le trafic simultanément avec réplication synchrone ou quasi temps réel.",
        rtoRangeHours: [0, 1],
        rpoRangeMinutes: [0, 5],
        cost: "high",
        complexity: "high",
        suitableFor: ["critical"],
        notes: "Résilience maximale, nécessite budget et expertise élevés.",
        source: "tutorialsdojo.com",
    },
    {
        id: "active-passive-geo",
        label: "Active/Passive avec géo-réplication",
        description: "Environnement secondaire passif répliqué en continu (bases, stockage) avec bascule orchestrée.",
        rtoRangeHours: [1, 6],
        rpoRangeMinutes: [1, 30],
        cost: "medium",
        complexity: "medium",
        suitableFor: ["high", "critical"],
        notes: "Bon compromis pour workloads critiques sans aller jusqu'à l'active-active.",
        // Source: AWS geo-replication DR patterns (tutorialsdojo.com)
        source: "tutorialsdojo.com",
    },
    {
        id: "multi-az-ha",
        label: "Multi-AZ haute disponibilité",
        description: "Déploiement multi-zone avec réplication synchronisée ou quasi temps réel, bascule orchestrée (active/passive).",
        rtoRangeHours: [0.25, 2],
        rpoRangeMinutes: [1, 30],
        cost: "medium",
        complexity: "medium",
        suitableFor: ["high", "critical"],
        notes: "Alternative moins coûteuse que l'active-active multi-région tout en réduisant fortement le RTO.",
        // Source: AWS multi-AZ HA patterns (tutorialsdojo.com)
        source: "tutorialsdojo.com",
    },
    {
        id: "continuous-data-protection",
        label: "Continuous Data Protection",
        description: "Capture et réplication continue des journaux/transactions pour limiter la perte de données.",
        rtoRangeHours: [1, 8],
        rpoRangeMinutes: [0, 10],
        cost: "medium",
        complexity: "high",
        suitableFor: ["high", "critical"],
        notes: "Approprié quand le RPO doit être quasi nul sur des données sensibles.",
        // Source: CDP vendor best practices (tutorialsdojo.com)
        source: "tutorialsdojo.com",
    },
];
function normalizeCriticality(value) {
    const normalized = (value || "").toLowerCase();
    if (normalized === "critical")
        return "critical";
    if (normalized === "high")
        return "high";
    if (normalized === "medium")
        return "medium";
    return "low";
}
function scoreRtoRpo(targetRto, targetRpo, scenario) {
    const [rtoMin, rtoMax] = scenario.rtoRangeHours;
    const [rpoMin, rpoMax] = scenario.rpoRangeMinutes;
    let score = 0;
    if (targetRto < rtoMin)
        score += 3;
    if (targetRto > rtoMax * 1.5)
        score += 1;
    if (targetRpo < rpoMin)
        score += 3;
    if (targetRpo > rpoMax * 2)
        score += 1;
    return score;
}
function costPenalty(criticity, cost) {
    if ((criticity === "low" || criticity === "medium") && cost === "high")
        return 2;
    return 0;
}
function complexityPenalty(complexity) {
    if (complexity === "high")
        return 2;
    return complexity === "medium" ? 1 : 0;
}
function formatRationaleSummary(scenario, rationale, targetRto, targetRpo) {
    const base = `${scenario.label} (${scenario.rtoRangeHours[0]}-${scenario.rtoRangeHours[1]}h / ${scenario.rpoRangeMinutes[0]}-${scenario.rpoRangeMinutes[1]}min)`;
    if (rationale.length === 0) {
        return `${base} correspond aux objectifs ${targetRto}h/${targetRpo}min avec un coût ${scenario.cost} et une complexité ${scenario.complexity}.`;
    }
    return `${base} : ${rationale.join("; ")}`;
}
function resolveMatchLevel(score) {
    if (score <= 2)
        return "strong";
    if (score <= 5)
        return "medium";
    return "weak";
}
function getSuggestedDRStrategy(services, dependencies, targetRtoHours, targetRpoMinutes, globalCriticality) {
    const critCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    services.forEach((s) => {
        const c = normalizeCriticality(s.criticality);
        critCounts[c] += 1;
    });
    const hasStrongDependencies = dependencies.some((d) => (d.type || "").toLowerCase().includes("fort"));
    return SCENARIOS.map((scenario) => {
        const rationale = [];
        let score = 0;
        const rtoRpoScore = scoreRtoRpo(targetRtoHours, targetRpoMinutes, scenario);
        if (rtoRpoScore > 0) {
            rationale.push(`RTO/RPO cibles (${targetRtoHours}h / ${targetRpoMinutes}min) en tension avec la plage ${scenario.label}.`);
            score += rtoRpoScore;
        }
        if (!scenario.suitableFor.includes(globalCriticality)) {
            rationale.push(`Criticité ${globalCriticality.toUpperCase()} moins alignée avec ${scenario.label}.`);
            score += 2;
        }
        const costScore = costPenalty(globalCriticality, scenario.cost);
        if (costScore > 0) {
            rationale.push(`Coût ${scenario.cost} potentiellement surdimensionné.`);
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
function summarizeScenarioForTable(rec) {
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
exports.DR_SCENARIOS = SCENARIOS;
//# sourceMappingURL=drStrategyEngine.js.map