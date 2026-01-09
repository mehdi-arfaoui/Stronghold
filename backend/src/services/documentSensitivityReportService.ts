import type { Prisma, PrismaClient } from "@prisma/client";
import { scanSensitiveText } from "./sensitiveDataScanService";

export type SensitivityReport = {
  findings: ReturnType<typeof scanSensitiveText>;
  totalFindings: number;
  hasFindings: boolean;
  scannedAt: Date;
};

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

// Helper to access documentSensitivityReport on both PrismaClient and TransactionClient
function getDocumentSensitivityReportClient(client: PrismaClientOrTx) {
  return (client as any).documentSensitivityReport;
}

export async function upsertDocumentSensitivityReport(options: {
  tenantId: string;
  documentId: string;
  text: string;
  prismaClient: PrismaClientOrTx;
}) {
  const findings = scanSensitiveText(options.text || "");
  const totalFindings = findings.reduce((sum, finding) => sum + finding.count, 0);
  const scannedAt = new Date();

  const reportClient = getDocumentSensitivityReportClient(options.prismaClient);
  const existing = await reportClient.findFirst({
    where: { tenantId: options.tenantId, documentId: options.documentId },
  });

  if (!existing) {
    return reportClient.create({
      data: {
        tenantId: options.tenantId,
        documentId: options.documentId,
        status: "COMPLETED",
        findings,
        totalFindings,
        scannedAt,
      },
    });
  }

  const updateResult = await reportClient.updateMany({
    where: { id: existing.id, tenantId: options.tenantId },
    data: {
      status: "COMPLETED",
      findings,
      totalFindings,
      scannedAt,
    },
  });

  if (updateResult.count !== 1) {
    throw new Error("Failed to update sensitivity report for this tenant");
  }

  return reportClient.findFirst({
    where: { tenantId: options.tenantId, documentId: options.documentId },
  });
}

export async function getDocumentSensitivityReport(options: {
  tenantId: string;
  documentId: string;
  prismaClient: PrismaClientOrTx;
}) {
  const reportClient = getDocumentSensitivityReportClient(options.prismaClient);
  return reportClient.findFirst({
    where: { tenantId: options.tenantId, documentId: options.documentId },
  });
}
