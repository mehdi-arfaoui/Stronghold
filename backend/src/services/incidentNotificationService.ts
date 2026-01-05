import prisma from "../prismaClient";

type IncidentEventPayload = {
  event: "incident.created" | "incident.updated";
  tenantId: string;
  incidentId: string;
  changeSummary?: string[];
};

export async function notifyIncidentEvent(payload: IncidentEventPayload) {
  const { tenantId, incidentId, event, changeSummary } = payload;

  const channels = await prisma.notificationChannel.findMany({
    where: {
      tenantId,
      isEnabled: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (channels.length === 0) return;

  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, tenantId },
    include: {
      services: { include: { service: true } },
      documents: { include: { document: true } },
    },
  });

  if (!incident) return;

  const payloadBody = {
    event,
    tenantId,
    incident: {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      detectedAt: incident.detectedAt,
      responsibleTeam: incident.responsibleTeam,
      services: incident.services.map((link) => ({
        id: link.service.id,
        name: link.service.name,
        criticality: link.service.criticality,
        type: link.service.type,
      })),
      documents: incident.documents.map((link) => ({
        id: link.document.id,
        name: link.document.originalName,
        docType: link.document.docType,
      })),
    },
    changeSummary: changeSummary ?? [],
  };

  await Promise.all(
    channels.map(async (channel) => {
      if (!channel.n8nWebhookUrl) return;
      try {
        const res = await fetch(channel.n8nWebhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...payloadBody,
            channel: {
              id: channel.id,
              type: channel.type,
              label: channel.label,
              configuration: channel.configuration ?? {},
            },
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          console.warn("Incident notification failed", {
            channelId: channel.id,
            status: res.status,
            body: text.slice(0, 200),
          });
        }
      } catch (error: any) {
        console.warn("Incident notification error", {
          channelId: channel.id,
          message: error?.message,
        });
      }
    })
  );
}
