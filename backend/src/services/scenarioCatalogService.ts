import prisma from "../prismaClient.js";

export type ScenarioCatalogSourceItem = {
  sourceKey: string;
  name: string;
  type: string;
  description?: string | null;
  impactLevel?: string | null;
  rtoTargetHours?: number | null;
  recoveryStrategy: string;
  estimatedCostLevel?: string | null;
  estimatedCostMin?: number | null;
  estimatedCostMax?: number | null;
  estimatedCostCurrency?: string | null;
};

const DEFAULT_CATALOG: ScenarioCatalogSourceItem[] = [
  {
    sourceKey: "region-loss-hot-site",
    name: "Perte région (hot site)",
    type: "REGION_LOSS",
    description:
      "Perte complète d'une région cloud ou d'un datacenter principal avec bascule hot site.",
    impactLevel: "high",
    rtoTargetHours: 4,
    recoveryStrategy: "Hot site multi-région",
    estimatedCostLevel: "high",
    estimatedCostMin: 25000,
    estimatedCostMax: 80000,
    estimatedCostCurrency: "EUR",
  },
  {
    sourceKey: "az-loss-warm-site",
    name: "Perte AZ (warm standby)",
    type: "AZ_LOSS",
    description:
      "Indisponibilité d'une zone de disponibilité avec reprise sur un site chaud ou warm.",
    impactLevel: "medium",
    rtoTargetHours: 8,
    recoveryStrategy: "Warm standby inter-AZ",
    estimatedCostLevel: "medium",
    estimatedCostMin: 8000,
    estimatedCostMax: 25000,
    estimatedCostCurrency: "EUR",
  },
  {
    sourceKey: "backup-restore-standard",
    name: "Backup & Restore",
    type: "BACKUP_RESTORE",
    description:
      "Restauration complète depuis sauvegardes validées avec temps de reprise plus long.",
    impactLevel: "medium",
    rtoTargetHours: 24,
    recoveryStrategy: "Backup & Restore",
    estimatedCostLevel: "low",
    estimatedCostMin: 3000,
    estimatedCostMax: 12000,
    estimatedCostCurrency: "EUR",
  },
  {
    sourceKey: "multi-site-active-active",
    name: "Multi-Site (active/active)",
    type: "MULTI_SITE",
    description:
      "Sites simultanément actifs avec réplication quasi temps réel pour assurer la continuité.",
    impactLevel: "high",
    rtoTargetHours: 1,
    recoveryStrategy: "Active/Active multi-site",
    estimatedCostLevel: "high",
    estimatedCostMin: 60000,
    estimatedCostMax: 180000,
    estimatedCostCurrency: "EUR",
  },
  {
    sourceKey: "warm-standby-core",
    name: "Warm Standby",
    type: "WARM_STANDBY",
    description:
      "Infrastructure de secours partiellement active avec montée en charge rapide en cas d'incident.",
    impactLevel: "high",
    rtoTargetHours: 6,
    recoveryStrategy: "Warm Standby",
    estimatedCostLevel: "medium",
    estimatedCostMin: 12000,
    estimatedCostMax: 40000,
    estimatedCostCurrency: "EUR",
  },
  {
    sourceKey: "db-corruption-restore",
    name: "Corruption base de données (restore)",
    type: "DB_CORRUPTION",
    description:
      "Restauration depuis backups validés avec vérification applicative.",
    impactLevel: "high",
    rtoTargetHours: 12,
    recoveryStrategy: "Restore + validation applicative",
    estimatedCostLevel: "medium",
    estimatedCostMin: 5000,
    estimatedCostMax: 15000,
    estimatedCostCurrency: "EUR",
  },
  {
    sourceKey: "ransomware-isolation",
    name: "Ransomware (isolement + restauration)",
    type: "RANSOMWARE",
    description:
      "Isolement des environnements, nettoyage et restauration contrôlée.",
    impactLevel: "high",
    rtoTargetHours: 24,
    recoveryStrategy: "Isolement + restauration progressive",
    estimatedCostLevel: "high",
    estimatedCostMin: 40000,
    estimatedCostMax: 120000,
    estimatedCostCurrency: "EUR",
  },
  {
    sourceKey: "ad-failure-failover",
    name: "Perte Active Directory",
    type: "AD_FAILURE",
    description:
      "Perte du service d'annuaire avec reprise sur contrôleurs secondaires.",
    impactLevel: "medium",
    rtoTargetHours: 6,
    recoveryStrategy: "Failover AD + durcissement",
    estimatedCostLevel: "low",
    estimatedCostMin: 2000,
    estimatedCostMax: 8000,
    estimatedCostCurrency: "EUR",
  },
];

const SCENARIO_CATALOG_URL = process.env.SCENARIO_CATALOG_SOURCE_URL;

const isValidItem = (item: any): item is ScenarioCatalogSourceItem => {
  return (
    item &&
    typeof item.sourceKey === "string" &&
    typeof item.name === "string" &&
    typeof item.type === "string" &&
    typeof item.recoveryStrategy === "string"
  );
};

export async function syncScenarioCatalog(tenantId: string) {
  let source = "default";
  let items: ScenarioCatalogSourceItem[] = DEFAULT_CATALOG;

  if (SCENARIO_CATALOG_URL) {
    const response = await fetch(SCENARIO_CATALOG_URL);
    if (!response.ok) {
      throw new Error("Failed to fetch scenario catalog source");
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Scenario catalog source must return an array");
    }
    const parsed = payload.filter(isValidItem);
    if (parsed.length === 0) {
      throw new Error("Scenario catalog source returned no valid entries");
    }
    items = parsed;
    source = "remote";
  }

  const upserts = items.map((item) =>
    prisma.scenarioCatalog.upsert({
      where: {
        tenantId_sourceKey: {
          tenantId,
          sourceKey: item.sourceKey,
        },
      },
      create: {
        tenantId,
        sourceKey: item.sourceKey,
        name: item.name,
        type: item.type,
        description: item.description ?? null,
        impactLevel: item.impactLevel ?? null,
        rtoTargetHours: item.rtoTargetHours ?? null,
        recoveryStrategy: item.recoveryStrategy,
        estimatedCostLevel: item.estimatedCostLevel ?? null,
        estimatedCostMin: item.estimatedCostMin ?? null,
        estimatedCostMax: item.estimatedCostMax ?? null,
        estimatedCostCurrency: item.estimatedCostCurrency ?? null,
      },
      update: {
        name: item.name,
        type: item.type,
        description: item.description ?? null,
        impactLevel: item.impactLevel ?? null,
        rtoTargetHours: item.rtoTargetHours ?? null,
        recoveryStrategy: item.recoveryStrategy,
        estimatedCostLevel: item.estimatedCostLevel ?? null,
        estimatedCostMin: item.estimatedCostMin ?? null,
        estimatedCostMax: item.estimatedCostMax ?? null,
        estimatedCostCurrency: item.estimatedCostCurrency ?? null,
      },
    })
  );

  await prisma.$transaction(upserts);

  return {
    source,
    count: items.length,
  };
}

export async function listScenarioCatalog(tenantId: string) {
  return prisma.scenarioCatalog.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
  });
}
