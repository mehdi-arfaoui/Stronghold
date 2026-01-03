"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDependencyRisks = buildDependencyRisks;
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
function riskLevelFromFlags(flags) {
    if (flags >= 3)
        return "high";
    if (flags >= 1)
        return "medium";
    return "low";
}
function buildDependencyRisks(services, dependencies) {
    const serviceById = new Map(services.map((s) => [s.id, s]));
    return dependencies.map((dep) => {
        const from = serviceById.get(dep.fromServiceId);
        const to = dep.toService ?? serviceById.get(dep.toServiceId);
        const risks = [];
        const recommendations = [];
        let flags = 0;
        if (!from || !to) {
            return {
                id: dep.id,
                fromServiceId: dep.fromServiceId,
                toServiceId: dep.toServiceId,
                fromServiceName: from?.name ?? "Service inconnu",
                toServiceName: to?.name ?? "Service inconnu",
                dependencyType: dep.dependencyType ?? null,
                riskLevel: "low",
                risks: ["Dépendance incomplète : service manquant dans le catalogue."],
                recommendations: ["Vérifier la CMDB et compléter les services référencés."],
            };
        }
        const fromCrit = normalizeCriticality(from.criticality);
        const toCrit = normalizeCriticality(to.criticality);
        if (from.continuity?.rtoHours != null && to.continuity?.rtoHours != null) {
            if (from.continuity.rtoHours < to.continuity.rtoHours) {
                risks.push(`RTO du service ${from.name} (${from.continuity.rtoHours}h) inférieur au dépendant ${to.name} (${to.continuity.rtoHours}h).`);
                recommendations.push("Aligner les objectifs RTO ou renforcer la reprise sur le service dépendant.");
                flags += 1;
            }
        }
        else {
            risks.push("RTO manquant pour au moins un service dépendant.");
            recommendations.push("Compléter les RTO/RPO pour fiabiliser les choix de stratégie PRA.");
            flags += 1;
        }
        if (from.continuity?.rpoMinutes != null && to.continuity?.rpoMinutes != null) {
            if (from.continuity.rpoMinutes < to.continuity.rpoMinutes) {
                risks.push(`RPO du service ${from.name} (${from.continuity.rpoMinutes} min) inférieur à ${to.name} (${to.continuity.rpoMinutes} min).`);
                recommendations.push("Mettre en cohérence les politiques de sauvegarde/replication.");
                flags += 1;
            }
        }
        if (fromCrit === "critical" && (toCrit === "medium" || toCrit === "low")) {
            risks.push("Service critique dépendant d'un composant à criticité plus faible.");
            recommendations.push("Revoir la criticité ou renforcer la résilience du service dépendant.");
            flags += 1;
        }
        if ((dep.dependencyType || "").toLowerCase().includes("fort")) {
            risks.push("Dépendance forte : impact direct en cas d'indisponibilité.");
            recommendations.push("Prévoir un plan de bascule dédié (Pilot Light/Warm Standby/Multi-AZ).");
            flags += 1;
        }
        if (risks.length === 0) {
            risks.push("Aucun risque majeur détecté.");
            recommendations.push("Continuer les tests PRA réguliers.");
        }
        return {
            id: dep.id,
            fromServiceId: from.id,
            toServiceId: to.id,
            fromServiceName: from.name,
            toServiceName: to.name,
            dependencyType: dep.dependencyType ?? null,
            riskLevel: riskLevelFromFlags(flags),
            risks,
            recommendations,
        };
    });
}
//# sourceMappingURL=dependencyRiskEngine.js.map