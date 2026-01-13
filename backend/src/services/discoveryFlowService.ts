import prisma from "../prismaClient.js";

export type FlowImportRecord = {
  sourceIp: string;
  targetIp: string;
  sourcePort?: number | null;
  targetPort?: number | null;
  protocol?: string | null;
  bytes?: number | null;
  packets?: number | null;
  observedAt?: Date | null;
};

export async function importDiscoveryFlows(
  tenantId: string,
  jobId: string | null,
  flows: FlowImportRecord[]
) {
  const resources = await prisma.discoveryResource.findMany({
    where: { tenantId },
    select: { id: true, ip: true },
  });
  const resourceByIp = new Map<string, string>();
  resources.forEach((resource) => {
    if (resource.ip) {
      resourceByIp.set(resource.ip, resource.id);
    }
  });

  for (const flow of flows) {
    await prisma.discoveryFlow.create({
      data: {
        tenantId,
        jobId,
        sourceResourceId: flow.sourceIp ? resourceByIp.get(flow.sourceIp) ?? null : null,
        targetResourceId: flow.targetIp ? resourceByIp.get(flow.targetIp) ?? null : null,
        sourceIp: flow.sourceIp,
        targetIp: flow.targetIp,
        sourcePort: flow.sourcePort ?? null,
        targetPort: flow.targetPort ?? null,
        protocol: flow.protocol ?? null,
        bytes: flow.bytes ?? null,
        packets: flow.packets ?? null,
        observedAt: flow.observedAt ?? new Date(),
      },
    });
  }

  return { importedFlows: flows.length };
}
