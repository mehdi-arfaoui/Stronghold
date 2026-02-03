import type { PrismaClient } from "@prisma/client";
import { buildBiaSummary } from "./biaSummary.js";
import { buildBiaDashboard } from "./biaDashboard.js";

export type ReportFormat = "markdown" | "json" | "html";
export type ReportType = "full" | "summary" | "scenario";

export type ReportOptions = {
  format: ReportFormat;
  type: ReportType;
  includeCharts: boolean;
  includeRecommendations: boolean;
  scenarioType?: "site_disaster" | "cyberattack" | "infrastructure_failure";
  processIds?: string[];
  templateId?: string;
};

export type GeneratedReport = {
  title: string;
  type: ReportType;
  format: ReportFormat;
  generatedAt: string;
  content: string;
  metadata: {
    tenantId: string;
    processCount: number;
    criticalCount: number;
    avgCriticality: number;
  };
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getCriticalityLabel(score: number): string {
  if (score >= 4) return "Critique";
  if (score >= 3) return "Élevé";
  if (score >= 2) return "Modéré";
  return "Faible";
}

function getImpactLabel(level: number): string {
  const labels: Record<number, string> = {
    1: "Négligeable",
    2: "Faible",
    3: "Modéré",
    4: "Élevé",
    5: "Critique",
  };
  return labels[level] || "Non défini";
}

async function generateFullReportMarkdown(
  prisma: PrismaClient,
  tenantId: string,
  options: ReportOptions
): Promise<string> {
  const [processes, summary, dashboard] = await Promise.all([
    prisma.businessProcess.findMany({
      where: tenantId ? { tenantId } : undefined,
      include: { services: { include: { service: true } } },
      orderBy: { criticalityScore: "desc" },
    }),
    buildBiaSummary(prisma, tenantId),
    buildBiaDashboard(prisma, tenantId),
  ]);

  const criticalProcesses = processes.filter((p) => p.criticalityScore >= 4);
  const now = new Date();

  let md = `# Rapport BIA Complet\n\n`;
  md += `**Date de génération :** ${formatDateTime(now)}\n\n`;
  md += `---\n\n`;

  // Executive Summary
  md += `## Résumé exécutif\n\n`;
  md += `Ce rapport présente l'analyse d'impact sur l'activité (BIA) de l'organisation.\n\n`;
  md += `### Indicateurs clés\n\n`;
  md += `| Indicateur | Valeur |\n`;
  md += `|------------|--------|\n`;
  md += `| Processus analysés | ${processes.length} |\n`;
  md += `| Processus critiques | ${criticalProcesses.length} |\n`;
  md += `| Criticité moyenne | ${summary.averages.criticalityScore.toFixed(2)} |\n`;
  md += `| Services liés | ${summary.totals.linkedServices} |\n\n`;

  // Critical Processes
  if (criticalProcesses.length > 0) {
    md += `### Processus critiques nécessitant une attention immédiate\n\n`;
    md += `| Processus | Criticité | RTO | RPO | MTPD |\n`;
    md += `|-----------|-----------|-----|-----|------|\n`;
    for (const p of criticalProcesses.slice(0, 10)) {
      md += `| ${p.name} | ${p.criticalityScore.toFixed(1)} | ${p.rtoHours}h | ${p.rpoMinutes}min | ${p.mtpdHours}h |\n`;
    }
    md += `\n`;
  }

  // Alerts
  if (dashboard.alerts.length > 0) {
    md += `### Alertes et recommandations\n\n`;
    for (const alert of dashboard.alerts.slice(0, 5)) {
      md += `- **${alert.severity.toUpperCase()}** - ${alert.title}: ${alert.description}\n`;
      md += `  - *Recommandation:* ${alert.recommendation}\n`;
    }
    md += `\n`;
  }

  // Detailed Process List
  md += `---\n\n`;
  md += `## Analyse détaillée des processus\n\n`;

  for (const process of processes) {
    md += `### ${process.name}\n\n`;

    if (process.description) {
      md += `${process.description}\n\n`;
    }

    md += `**Propriétaire(s) :** ${process.owners || "Non défini"}\n\n`;

    md += `#### Évaluation des impacts\n\n`;
    md += `| Type d'impact | Niveau | Description |\n`;
    md += `|---------------|--------|-------------|\n`;
    md += `| Financier | ${process.financialImpactLevel}/5 | ${getImpactLabel(process.financialImpactLevel)} |\n`;
    md += `| Réglementaire | ${process.regulatoryImpactLevel}/5 | ${getImpactLabel(process.regulatoryImpactLevel)} |\n\n`;

    md += `#### Objectifs de reprise\n\n`;
    md += `| Objectif | Valeur | Statut |\n`;
    md += `|----------|--------|--------|\n`;
    md += `| RTO | ${process.rtoHours} heures | ${process.rtoHours > process.mtpdHours ? "⚠️ Dépasse MTPD" : "✓"} |\n`;
    md += `| RPO | ${process.rpoMinutes} minutes | ✓ |\n`;
    md += `| MTPD | ${process.mtpdHours} heures | - |\n\n`;

    md += `#### Scores calculés\n\n`;
    md += `- **Score d'impact :** ${process.impactScore.toFixed(2)}/5\n`;
    md += `- **Score de criticité :** ${process.criticalityScore.toFixed(2)}/5 (${getCriticalityLabel(process.criticalityScore)})\n\n`;

    if (process.services.length > 0) {
      md += `#### Services et dépendances\n\n`;
      for (const link of process.services) {
        md += `- ${link.service.name} (${link.service.criticality})\n`;
      }
      md += `\n`;
    }

    if (process.interdependencies) {
      md += `#### Interdépendances\n\n`;
      md += `${process.interdependencies}\n\n`;
    }

    md += `---\n\n`;
  }

  // Recommendations
  if (options.includeRecommendations) {
    md += `## Recommandations\n\n`;
    md += `### Priorité haute\n\n`;
    for (const p of criticalProcesses.slice(0, 5)) {
      md += `1. **${p.name}** : Mettre en place une stratégie de reprise multi-site avec RTO de ${p.rtoHours}h.\n`;
    }
    md += `\n`;

    md += `### Priorité moyenne\n\n`;
    md += `- Documenter les procédures de reprise pour tous les processus critiques.\n`;
    md += `- Planifier des exercices de continuité réguliers.\n`;
    md += `- Mettre à jour les analyses BIA tous les 6 mois.\n\n`;
  }

  // Footer
  md += `---\n\n`;
  md += `*Rapport généré automatiquement par Stronghold BIA - ${formatDateTime(now)}*\n`;

  return md;
}

async function generateSummaryReportMarkdown(
  prisma: PrismaClient,
  tenantId: string,
  options: ReportOptions
): Promise<string> {
  const [processes, summary] = await Promise.all([
    prisma.businessProcess.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { criticalityScore: "desc" },
      take: 10,
    }),
    buildBiaSummary(prisma, tenantId),
  ]);

  const criticalCount = processes.filter((p) => p.criticalityScore >= 4).length;
  const now = new Date();

  let md = `# Rapport BIA Synthétique - Direction\n\n`;
  md += `**Date :** ${formatDate(now)}\n\n`;
  md += `---\n\n`;

  md += `## Vue d'ensemble\n\n`;
  md += `L'analyse d'impact sur l'activité a permis d'identifier et d'évaluer **${summary.totals.processes} processus métiers**.\n\n`;

  md += `### Chiffres clés\n\n`;
  md += `| Métrique | Valeur |\n`;
  md += `|----------|--------|\n`;
  md += `| Processus analysés | ${summary.totals.processes} |\n`;
  md += `| Processus critiques | ${criticalCount} |\n`;
  md += `| Criticité moyenne | ${summary.averages.criticalityScore.toFixed(1)}/5 |\n`;
  md += `| Services impactés | ${summary.totals.linkedServices} |\n\n`;

  md += `## Processus prioritaires\n\n`;
  md += `Les processus suivants nécessitent une attention particulière :\n\n`;

  const topProcesses = processes.slice(0, 5);
  for (let i = 0; i < topProcesses.length; i++) {
    const p = topProcesses[i];
    md += `${i + 1}. **${p.name}**\n`;
    md += `   - Criticité : ${p.criticalityScore.toFixed(1)}/5\n`;
    md += `   - RTO : ${p.rtoHours}h | RPO : ${p.rpoMinutes}min\n\n`;
  }

  md += `## Investissements recommandés\n\n`;
  md += `Pour améliorer la résilience de l'organisation, les investissements suivants sont recommandés :\n\n`;
  md += `1. **Infrastructure de secours** - Mise en place d'un site de reprise pour les ${criticalCount} processus critiques.\n`;
  md += `2. **Sauvegardes renforcées** - Augmentation de la fréquence des sauvegardes pour respecter les RPO définis.\n`;
  md += `3. **Documentation** - Création de runbooks détaillés pour chaque processus critique.\n`;
  md += `4. **Tests réguliers** - Organisation d'exercices de continuité trimestriels.\n\n`;

  md += `---\n\n`;
  md += `*Document confidentiel - Généré par Stronghold BIA*\n`;

  return md;
}

async function generateScenarioReportMarkdown(
  prisma: PrismaClient,
  tenantId: string,
  options: ReportOptions
): Promise<string> {
  const processes = await prisma.businessProcess.findMany({
    where: tenantId ? { tenantId } : undefined,
    include: { services: { include: { service: true } } },
    orderBy: { criticalityScore: "desc" },
  });

  const now = new Date();
  const scenarioLabels: Record<string, { title: string; description: string }> = {
    site_disaster: {
      title: "Sinistre site principal",
      description: "Perte totale du site principal nécessitant une bascule vers le site de secours.",
    },
    cyberattack: {
      title: "Cyberattaque majeure",
      description: "Compromission des systèmes nécessitant une isolation et une restauration complète.",
    },
    infrastructure_failure: {
      title: "Panne infrastructure critique",
      description: "Défaillance d'un composant infrastructure majeur impactant plusieurs services.",
    },
  };

  const scenario = scenarioLabels[options.scenarioType || "site_disaster"];

  let md = `# Rapport de scénario BIA\n\n`;
  md += `## ${scenario.title}\n\n`;
  md += `**Date :** ${formatDate(now)}\n\n`;
  md += `---\n\n`;

  md += `## Description du scénario\n\n`;
  md += `${scenario.description}\n\n`;

  md += `## Impacts estimés\n\n`;

  const criticalProcesses = processes.filter((p) => p.criticalityScore >= 4);
  const highProcesses = processes.filter((p) => p.criticalityScore >= 3 && p.criticalityScore < 4);

  md += `### Processus impactés de manière critique (${criticalProcesses.length})\n\n`;
  if (criticalProcesses.length > 0) {
    md += `| Processus | Impact | Temps de reprise estimé |\n`;
    md += `|-----------|--------|-------------------------|\n`;
    for (const p of criticalProcesses) {
      md += `| ${p.name} | ${getCriticalityLabel(p.criticalityScore)} | ${p.rtoHours}h |\n`;
    }
  } else {
    md += `Aucun processus critique identifié.\n`;
  }
  md += `\n`;

  md += `### Processus impactés de manière significative (${highProcesses.length})\n\n`;
  if (highProcesses.length > 0) {
    for (const p of highProcesses) {
      md += `- ${p.name} (RTO: ${p.rtoHours}h)\n`;
    }
  } else {
    md += `Aucun processus à impact élevé.\n`;
  }
  md += `\n`;

  md += `## Chronologie de reprise\n\n`;
  const sortedByRto = [...processes].sort((a, b) => a.rtoHours - b.rtoHours);

  md += `| Phase | Délai | Processus à restaurer |\n`;
  md += `|-------|-------|----------------------|\n`;

  const phase1 = sortedByRto.filter((p) => p.rtoHours <= 4);
  const phase2 = sortedByRto.filter((p) => p.rtoHours > 4 && p.rtoHours <= 24);
  const phase3 = sortedByRto.filter((p) => p.rtoHours > 24);

  md += `| Phase 1 (Critique) | 0-4h | ${phase1.map((p) => p.name).join(", ") || "Aucun"} |\n`;
  md += `| Phase 2 (Prioritaire) | 4-24h | ${phase2.map((p) => p.name).join(", ") || "Aucun"} |\n`;
  md += `| Phase 3 (Standard) | >24h | ${phase3.map((p) => p.name).join(", ") || "Aucun"} |\n\n`;

  md += `## Actions recommandées\n\n`;

  if (options.scenarioType === "cyberattack") {
    md += `1. Activer le plan de réponse aux incidents cyber\n`;
    md += `2. Isoler les systèmes compromis\n`;
    md += `3. Notifier les autorités compétentes (ANSSI, CNIL si données personnelles)\n`;
    md += `4. Restaurer à partir des sauvegardes immuables\n`;
    md += `5. Vérifier l'intégrité des données restaurées\n`;
  } else if (options.scenarioType === "site_disaster") {
    md += `1. Activer le site de reprise\n`;
    md += `2. Basculer les services critiques (Phase 1)\n`;
    md += `3. Notifier les parties prenantes\n`;
    md += `4. Restaurer progressivement les services Phase 2 et 3\n`;
    md += `5. Évaluer les dommages sur le site principal\n`;
  } else {
    md += `1. Identifier le composant défaillant\n`;
    md += `2. Activer les redondances disponibles\n`;
    md += `3. Restaurer les services impactés par priorité\n`;
    md += `4. Analyser la cause racine\n`;
    md += `5. Mettre à jour les procédures si nécessaire\n`;
  }

  md += `\n---\n\n`;
  md += `*Rapport de scénario généré par Stronghold BIA - ${formatDateTime(now)}*\n`;

  return md;
}

function markdownToHtml(markdown: string): string {
  // Simple markdown to HTML conversion
  let html = markdown
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/---/g, "<hr>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  // Wrap in basic HTML structure
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport BIA</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 0.5rem; }
    h2 { color: #374151; margin-top: 2rem; }
    h3 { color: #4b5563; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #e5e7eb; padding: 0.75rem; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    tr:nth-child(even) { background: #f9fafb; }
    strong { color: #1f2937; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0; }
    li { margin: 0.25rem 0; }
    .critical { color: #dc2626; }
    .warning { color: #d97706; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}

export async function generateBiaReport(
  prisma: PrismaClient,
  tenantId: string,
  options: ReportOptions
): Promise<GeneratedReport> {
  const processes = await prisma.businessProcess.findMany({
    where: tenantId ? { tenantId } : undefined,
  });

  const criticalCount = processes.filter((p) => p.criticalityScore >= 4).length;
  const avgCriticality =
    processes.length > 0
      ? processes.reduce((sum, p) => sum + p.criticalityScore, 0) / processes.length
      : 0;

  let content: string;
  let title: string;

  switch (options.type) {
    case "full":
      title = "Rapport BIA Complet";
      content = await generateFullReportMarkdown(prisma, tenantId, options);
      break;
    case "summary":
      title = "Rapport BIA Synthétique";
      content = await generateSummaryReportMarkdown(prisma, tenantId, options);
      break;
    case "scenario":
      title = `Rapport de scénario - ${options.scenarioType || "site_disaster"}`;
      content = await generateScenarioReportMarkdown(prisma, tenantId, options);
      break;
    default:
      throw new Error(`Unknown report type: ${options.type}`);
  }

  // Convert format if needed
  if (options.format === "html") {
    content = markdownToHtml(content);
  } else if (options.format === "json") {
    content = JSON.stringify({
      title,
      type: options.type,
      generatedAt: new Date().toISOString(),
      processes: processes.map((p) => ({
        id: p.id,
        name: p.name,
        criticalityScore: p.criticalityScore,
        impactScore: p.impactScore,
        rtoHours: p.rtoHours,
        rpoMinutes: p.rpoMinutes,
        mtpdHours: p.mtpdHours,
      })),
      summary: {
        totalProcesses: processes.length,
        criticalCount,
        avgCriticality,
      },
    }, null, 2);
  }

  return {
    title,
    type: options.type,
    format: options.format,
    generatedAt: new Date().toISOString(),
    content,
    metadata: {
      tenantId,
      processCount: processes.length,
      criticalCount,
      avgCriticality,
    },
  };
}
