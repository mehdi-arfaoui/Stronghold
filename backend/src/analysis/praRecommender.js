"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRA_PATTERNS = void 0;
exports.recommendPraOptions = recommendPraOptions;
exports.PRA_PATTERNS = [
    {
        id: "BACKUP_RESTORE_COLD_SITE",
        name: "Backup & Restore vers site secondaire / cloud",
        description: "Sauvegardes régulières vers un site secondaire ou un cloud. En cas de sinistre, restauration manuelle ou semi-automatisée.",
        typicalRtoRangeHours: [24, 72],
        typicalRpoRangeMinutes: [60, 1440],
        suitableCriticality: ["low", "medium"],
        costLevel: "low",
        complexityLevel: "low",
        bestForEnvironments: ["onprem", "cloud", "hybrid"],
        pros: [
            "Coût faible",
            "Facile à mettre en place",
            "Convient aux applications non critiques",
        ],
        cons: [
            "RTO long (un ou plusieurs jours)",
            "RPO élevé (perte de données possible)",
            "Restauration souvent manuelle",
        ],
        typicalUseCases: [
            "Applications internes peu critiques",
            "Systèmes batch tolérants à une interruption longue",
        ],
        notRecommendedWhen: [
            "RTO < 12h",
            "RPO < 60 min",
            "Criticité métier HIGH",
        ],
    },
    {
        id: "LOCAL_HA_ONLY",
        name: "Haute disponibilité locale (intra-DC / intra-région)",
        description: "Redondance locale (cluster, multi-nœuds, multi-AZ dans une même région ou multi-châssis dans un DC unique). Gère les pannes matérielles locales mais pas la perte de site.",
        typicalRtoRangeHours: [0.1, 4],
        typicalRpoRangeMinutes: [1, 60],
        suitableCriticality: ["medium", "high"],
        costLevel: "medium",
        complexityLevel: "medium",
        bestForEnvironments: ["onprem", "cloud"],
        pros: [
            "Très bon RTO/RPO pour les incidents locaux",
            "Bien supporté par la plupart des bases/services managés",
        ],
        cons: [
            "Ne couvre pas la perte complète de site / région",
            "Peut donner un faux sentiment de sécurité si la stratégie inter-site n’est pas définie",
        ],
        typicalUseCases: [
            "Serveurs applicatifs en cluster dans un DC",
            "Bases de données en cluster haute dispo dans une région cloud",
        ],
        notRecommendedWhen: [
            "Exigence de PRA inter-site / inter-région forte",
        ],
    },
    {
        id: "PILOT_LIGHT",
        name: "Pilot Light / Environnement minimal pré-provisionné",
        description: "Un environnement minimal (base de données, composants critiques) est déjà en place sur le site de secours. En cas de sinistre, on scale et on redéploie les composants non critiques.",
        typicalRtoRangeHours: [4, 24],
        typicalRpoRangeMinutes: [15, 120],
        suitableCriticality: ["medium", "high"],
        costLevel: "medium",
        complexityLevel: "medium",
        bestForEnvironments: ["cloud", "hybrid"],
        pros: [
            "Compromis coût / RTO intéressant",
            "Les données critiques sont déjà disponibles sur le site de secours",
        ],
        cons: [
            "Phase de montée en charge à gérer lors d’un sinistre",
            "Plus complexe qu’un simple backup & restore",
        ],
        typicalUseCases: [
            "Applications critiques mais avec quelques heures de tolérance",
            "Clients qui veulent limiter les coûts d’un site pleinement actif",
        ],
        notRecommendedWhen: [
            "RTO < 4h avec peu de marge",
            "Organisation incapable de gérer une procédure de montée en charge",
        ],
    },
    {
        id: "WARM_STANDBY",
        name: "Warm Standby / Environnement de secours partiellement actif",
        description: "Un clone partiel de la production est en fonctionnement sur le site de secours (capacité réduite). En cas de sinistre, bascule + montée en charge.",
        typicalRtoRangeHours: [1, 4],
        typicalRpoRangeMinutes: [5, 60],
        suitableCriticality: ["high"],
        costLevel: "high",
        complexityLevel: "medium",
        bestForEnvironments: ["cloud", "hybrid", "onprem"],
        pros: [
            "Très bon RTO/RPO",
            "Testable régulièrement",
        ],
        cons: [
            "Coût significatif (infra presque dupliquée)",
            "Nécessite une gouvernance solide (tests, synchronisation)",
        ],
        typicalUseCases: [
            "Applications cœur de métier avec fort besoin de continuité",
            "Portails clients critiques avec charge modérée",
        ],
        notRecommendedWhen: [
            "Budget limité (budgetLevel = low)",
        ],
    },
    {
        id: "ACTIVE_ACTIVE_MULTI_SITE",
        name: "Active/Active multi-site ou multi-région",
        description: "Plusieurs sites ou régions servent le trafic en simultané, avec réplication synchrone ou quasi temps réel des données.",
        typicalRtoRangeHours: [0, 1],
        typicalRpoRangeMinutes: [0, 5],
        suitableCriticality: ["high"],
        costLevel: "high",
        complexityLevel: "high",
        bestForEnvironments: ["cloud", "hybrid", "onprem"],
        pros: [
            "RTO/RPO quasi nuls",
            "Résilience forte à la perte d’un site complet",
        ],
        cons: [
            "Très coûteux",
            "Complexité élevée (réplication, cohérence, routage global)",
            "Contraintes fortes sur la latence entre sites",
        ],
        typicalUseCases: [
            "Systèmes financiers temps réel",
            "Plateformes e-commerce mondiales",
        ],
        notRecommendedWhen: [
            "BudgetLevel = low ou medium sans justification très forte",
            "Données difficiles à répliquer en temps réel",
        ],
    },
    {
        id: "OFFLINE_BACKUP_ONLY",
        name: "Sauvegarde offline uniquement (bande / stockage déconnecté)",
        description: "Sauvegardes régulières vers un support déconnecté (bande, coffre-fort numérique) pour se protéger surtout contre la corruption / ransomware.",
        typicalRtoRangeHours: [24, 168],
        typicalRpoRangeMinutes: [1440, 10080],
        suitableCriticality: ["low"],
        costLevel: "low",
        complexityLevel: "medium",
        bestForEnvironments: ["onprem", "hybrid"],
        pros: [
            "Très bon pour la protection contre le ransomware",
            "Coût raisonnable",
        ],
        cons: [
            "Pas une vraie stratégie de PRA (RTO très long)",
            "RPO élevé",
        ],
        typicalUseCases: [
            "Archivage légal",
            "Sauvegardes long terme",
        ],
        notRecommendedWhen: [
            "Le besoin principal est la continuité de service plutôt que l’archivage",
        ],
    },
];
function penalty(condition, weight, reasons, reason) {
    if (condition) {
        reasons.push(reason);
        return weight;
    }
    return 0;
}
function recommendPraOptions(input) {
    const recs = [];
    for (const pattern of exports.PRA_PATTERNS) {
        const reasons = [];
        let score = 0;
        const rto = input.maxRtoHours;
        const rpo = input.maxRpoMinutes;
        const [pRtoMin, pRtoMax] = pattern.typicalRtoRangeHours;
        const [pRpoMin, pRpoMax] = pattern.typicalRpoRangeMinutes;
        // Si on demande un RTO plus agressif que ce que le pattern sait faire en général
        score += penalty(rto < pRtoMin, 4, reasons, `RTO cible (${rto}h) plus ambitieux que la plage typique de ${pattern.name} (${pRtoMin}-${pRtoMax}h).`);
        // Si on demande un RTO très large alors que le pattern est plutôt "overkill"
        score += penalty(rto > pRtoMax * 2, 1, reasons, `RTO cible (${rto}h) très large par rapport au pattern, qui risque d'être surdimensionné.`);
        // RPO
        score += penalty(rpo < pRpoMin, 4, reasons, `RPO cible (${rpo} min) plus ambitieux que la plage typique de ${pattern.name} (${pRpoMin}-${pRpoMax} min).`);
        score += penalty(rpo > pRpoMax * 2, 1, reasons, `RPO cible (${rpo} min) très large par rapport au pattern, qui risque d'être surdimensionné.`);
        // Criticité
        score += penalty(!pattern.suitableCriticality.includes(input.criticality), 2, reasons, `Le niveau de criticité (${input.criticality}) n'est pas idéal pour ce pattern (plutôt ${pattern.suitableCriticality.join(", ")}).`);
        // Budget
        const cost = pattern.costLevel;
        if (input.budgetLevel === "low" && cost === "high") {
            score += penalty(true, 4, reasons, `Coût estimé du pattern (${cost}) trop élevé pour un budget LOW.`);
        }
        else if (input.budgetLevel === "medium" && cost === "high") {
            score += penalty(true, 2, reasons, `Coût estimé du pattern (${cost}) potentiellement élevé pour un budget MEDIUM.`);
        }
        // Complexité
        const complexity = pattern.complexityLevel;
        if (input.complexityTolerance === "low" && complexity === "high") {
            score += penalty(true, 4, reasons, `Complexité du pattern (${complexity}) trop élevée pour une tolérance LOW.`);
        }
        else if (input.complexityTolerance === "low" &&
            complexity === "medium") {
            score += penalty(true, 2, reasons, `Complexité du pattern (${complexity}) peut être difficile à opérer pour une tolérance LOW.`);
        }
        else if (input.complexityTolerance === "medium" &&
            complexity === "high") {
            score += penalty(true, 2, reasons, `Complexité du pattern (${complexity}) exige une forte maturité opérationnelle.`);
        }
        // Environnement
        score += penalty(!pattern.bestForEnvironments.includes(input.environment), 2, reasons, `Ce pattern n'est pas optimisé pour l'environnement ${input.environment}.`);
        const suitability = score <= 2 ? "good" : score <= 6 ? "acceptable" : "poor";
        recs.push({
            patternId: pattern.id,
            name: pattern.name,
            score,
            suitability,
            reasons,
            pros: pattern.pros,
            cons: pattern.cons,
            pattern,
        });
    }
    // On classe du meilleur (score faible) au moins adapté
    recs.sort((a, b) => a.score - b.score);
    return recs;
}
//# sourceMappingURL=praRecommender.js.map