import type { PrismaClient } from "@prisma/client";

export type NextActionKey =
  | "services_without_rto"
  | "scenarios_without_steps"
  | "documents_without_extraction";

export type NextActionItem = {
  key: NextActionKey;
  label: string;
  count: number;
  description: string;
};

export type NextActionsResponse = {
  items: NextActionItem[];
  totalPending: number;
};

export async function buildNextActions(
  prisma: PrismaClient,
  tenantId: string
): Promise<NextActionsResponse> {
  const [servicesWithoutContinuity, scenariosWithoutSteps, documentsWithoutExtraction] =
    await Promise.all([
      prisma.service.count({
        where: { tenantId, continuity: { is: null } },
      }),
      prisma.scenario.count({
        where: { tenantId, steps: { none: {} } },
      }),
      prisma.document.count({
        where: { tenantId, extractionStatus: { not: "SUCCESS" } },
      }),
    ]);

  const items: NextActionItem[] = [
    {
      key: "services_without_rto",
      label: "services sans RTO/RPO",
      count: servicesWithoutContinuity,
      description: "Renseigner les objectifs de continuité manquants dans le catalogue.",
    },
    {
      key: "scenarios_without_steps",
      label: "scénarios sans steps",
      count: scenariosWithoutSteps,
      description: "Documenter les étapes de reprise pour sécuriser les scénarios.",
    },
    {
      key: "documents_without_extraction",
      label: "documents sans extraction",
      count: documentsWithoutExtraction,
      description: "Lancer ou relancer l'extraction pour enrichir le RAG.",
    },
  ];

  return {
    items,
    totalPending: items.reduce((sum, item) => sum + item.count, 0),
  };
}
