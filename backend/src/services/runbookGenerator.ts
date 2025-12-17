import fs from "fs";
import path from "path";
import prisma from "../prismaClient";
import { recommendPraOptions } from "../analysis/praRecommender";
import * as crypto from "crypto";

export interface RunbookGenerationOptions {
  scenarioId?: string | null;
  title?: string;
  summary?: string;
  owner?: string;
}

const RUNBOOK_DIR = path.join(__dirname, "..", "..", "uploads", "runbooks");

function ensureRunbookDir() {
  if (!fs.existsSync(RUNBOOK_DIR)) {
    fs.mkdirSync(RUNBOOK_DIR, { recursive: true });
  }
}

function toMarkdownList(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

function describeBackup(type: string) {
  const normalized = type.toLowerCase();
  if (normalized === "full") {
    return "Full backup : stockage élevé, restauration rapide, idéal quand la fenêtre de sauvegarde est acceptée.";
  }
  if (normalized === "differential") {
    return "Differential : compromis, stockage modéré, restauration plus rapide qu'incrémentale.";
  }
  if (normalized === "incremental") {
    return "Incremental : sauvegarde rapide et peu volumineuse, restauration plus lente (chaînage).";
  }
  if (normalized === "continuous") {
    return "Continuous/streaming : capture quasi temps réel, excellente RPO mais coûts plus élevés.";
  }
  if (normalized === "snapshot") {
    return "Snapshot : copies rapides, utiles pour PRA IaaS/PaaS, vérifier la rétention.";
  }
  return "Stratégie personnalisée.";
}

function buildBackupComparison(strategies: any[]) {
  if (strategies.length === 0) return "Aucune stratégie de sauvegarde renseignée.";
  const lines = strategies.map((s) => {
    const freq = `${s.frequencyMinutes} min`;
    const ret = `${s.retentionDays} j`;
    const base = `${s.service?.name || "Global"} -> ${s.type.toUpperCase()} (${freq} / rétention ${ret})`;
    const impact = [
      s.rtoImpactHours ? `RTO cible ${s.rtoImpactHours}h` : null,
      s.rpoImpactMinutes ? `RPO cible ${s.rpoImpactMinutes} min` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    return `- ${base} ${impact ? `| ${impact}` : ""} — ${describeBackup(s.type)}`;
  });
  return lines.join("\n");
}

async function renderPdf(markdownContent: string, targetPath: string, title: string) {
  // Sans dépendance externe, on produit un export texte sobre avec extension .pdf.
  const header = `${title}\n=====================\n`;
  await fs.promises.writeFile(targetPath, `${header}${markdownContent}`);
}

export async function generateRunbook(tenantId: string, options: RunbookGenerationOptions) {
  ensureRunbookDir();

  const scenario = options.scenarioId
    ? await prisma.scenario.findFirst({ where: { id: options.scenarioId, tenantId }, include: { services: { include: { service: true } }, steps: true } })
    : null;

  const [tenant, services, dependencies, backupStrategies, policies, cycles] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.service.findMany({
      where: { tenantId },
      include: { continuity: true },
      orderBy: { recoveryPriority: "asc" },
    }),
    prisma.serviceDependency.findMany({
      where: { tenantId },
      include: { fromService: true, toService: true },
    }),
    prisma.backupStrategy.findMany({ where: { tenantId }, include: { service: true } }),
    prisma.securityPolicy.findMany({
      where: { tenantId },
      include: { services: { include: { service: true } } },
    }),
    prisma.dependencyCycle.findMany({
      where: { tenantId },
      include: { services: { include: { service: true } } },
    }),
  ]);

  const highCrit = services.filter((s) => s.criticality === "high" && s.continuity);
  const targetRto = Math.min(...highCrit.map((s) => s.continuity?.rtoHours || 24), 24);
  const targetRpo = Math.min(...highCrit.map((s) => s.continuity?.rpoMinutes || 60), 60);
  const praRecs = recommendPraOptions({
    environment: "cloud",
    maxRtoHours: Number.isFinite(targetRto) ? targetRto : 4,
    maxRpoMinutes: Number.isFinite(targetRpo) ? targetRpo : 60,
    criticality: highCrit.length > 0 ? "high" : "medium",
    budgetLevel: "medium",
    complexityTolerance: "medium",
  });

  const topRec = praRecs[0];
  const servicesList = services
    .map((s) => `- ${s.name} (${s.type}) — Criticité ${s.criticality.toUpperCase()} | RTO ${s.continuity?.rtoHours ?? "?"}h | RPO ${s.continuity?.rpoMinutes ?? "?"}min | MTPD ${s.continuity?.mtpdHours ?? "?"}h`)
    .join("\n");

  const depsList = dependencies
    .map((d) => `- ${d.fromService?.name} → ${d.toService?.name} (${d.dependencyType})`)
    .join("\n");

  const cycleList = cycles
    .map((c) => {
      const members = c.services.map((s) => s.service?.name).filter(Boolean).join(", ");
      return `- ${c.label} [${c.severity || ""}] : ${members}`;
    })
    .join("\n");

  const policiesList = policies
    .map((p) => {
      const linked = p.services.map((s) => s.service?.name).filter(Boolean).join(", ");
      return `- ${p.name} (${p.policyType})${linked ? ` — ${linked}` : ""}`;
    })
    .join("\n");

  const markdown = [
    `# ${options.title || "Runbook PRA/PCA"}`,
    ``,
    options.summary || "Synthèse générée automatiquement à partir des services, dépendances et stratégies PRA.",
    ``,
    `Tenant : ${tenant?.name || tenantId}`,
    scenario ? `Scénario ciblé : ${scenario.name} (${scenario.type})` : "Scénario : général", 
    ``,
    "## Définitions clés",
    "- RTO : durée maximale d'interruption acceptable avant reprise du service.",
    "- RPO : perte de données maximale acceptable.",
    "- MTPD : durée maximale de perturbation tolérée avant impact majeur.",
    "- Types de backup : full (rapide à restaurer, volumineux), differential (compromis), incremental (rapide à sauvegarder, restauration plus longue).",
    ``,
    "## Catalogue des services (priorité métier)",
    servicesList || "Aucun service enregistré.",
    ``,
    "## Dépendances et cycles critiques",
    depsList || "Pas de dépendances renseignées.",
    cycleList ? `\nCycles circulaires :\n${cycleList}` : "",
    ``,
    "## Stratégies de sauvegarde",
    buildBackupComparison(backupStrategies),
    ``,
    "## Politiques de sécurité associées",
    policiesList || "Aucune politique de sécurité liée.",
    ``,
    "## Recommandation PRA priorisée",
    topRec
      ? toMarkdownList([
          `${topRec.name} (score ${topRec.score})`,
          ...topRec.reasons.slice(0, 3),
        ])
      : "Pas de recommandation calculée.",
    ``,
    "## Plan d'action",
    "- Vérifier que les dépendances respectent le RTO/RPO cibles (voir cycles circulaires).",
    "- Tester la restauration sur échantillon (n8n/CI) et consigner les résultats.",
    "- Consolider le runbook avec les contacts et validations métiers.",
    scenario && scenario.steps.length > 0
      ? `- Étapes du scénario :\n${scenario.steps
          .sort((a, b) => a.order - b.order)
          .map((s) => `  - [${s.order}] ${s.title} (${s.role || ""})`)
          .join("\n")}`
      : "- Aucun step spécifique au scénario n'est renseigné.",
    ``,
    "## Tests de reprise et post-mortem",
    "- Planifier un test semestriel de restauration (échantillon + volumétrie).",
    "- Vérifier les temps mesurés vs RTO/RPO/MTPD et ajuster les stratégies.",
    "- Documenter les écarts et mettre à jour ce runbook (versionner).",
  ]
    .filter((block) => block !== "")
    .join("\n");

  const runbookId = crypto.randomUUID();
  const markdownPath = path.join(RUNBOOK_DIR, `${runbookId}.md`);
  const pdfPath = path.join(RUNBOOK_DIR, `${runbookId}.pdf`);
  await fs.promises.writeFile(markdownPath, markdown, "utf8");
  await renderPdf(markdown, pdfPath, options.title || "Runbook PRA/PCA");

  const runbookRecord = await prisma.runbook.create({
    data: {
      id: runbookId,
      tenantId,
      scenarioId: scenario?.id || null,
      title: options.title || "Runbook PRA/PCA",
      status: "READY",
      summary: options.summary || null,
      markdownPath: path.relative(process.cwd(), markdownPath),
      pdfPath: path.relative(process.cwd(), pdfPath),
      generatedForServices: JSON.stringify(services.map((s) => s.id)),
    },
  });

  return {
    runbook: runbookRecord,
    markdown,
    pdfPath: runbookRecord.pdfPath,
    markdownPath: runbookRecord.markdownPath,
  };
}
