import type { Prisma, PrismaClient } from "@prisma/client";
import { scanSensitiveText } from "./sensitiveDataScanService";

export type SensitivityReport = {
  findings: ReturnType<typeof scanSensitiveText>;
  totalFindings: number;
  hasFindings: boolean;
  scannedAt: Date;
};

export async function upsertDocumentSensitivityReport(options: {
  tenantId: string;
  documentId: string;
  text: string;
  prismaClient: Prisma.TransactionClient | PrismaClient;
}) {
  const findings = scanSensitiveText(options.text || "");
  const totalFindings = findings.reduce((sum, finding) => sum + finding.count, 0);
  const scannedAt = new Date();

  const existing = await options.prismaClient.documentSensitivityReport.findFirst({
    where: { tenantId: options.tenantId, documentId: options.documentId },
  });

  if (!existing) {
    return options.prismaClient.documentSensitivityReport.create({
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

  const updateResult = await options.prismaClient.documentSensitivityReport.updateMany({
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

  return options.prismaClient.documentSensitivityReport.findFirst({
    where: { tenantId: options.tenantId, documentId: options.documentId },
  });
}

export async function getDocumentSensitivityReport(options: {
  tenantId: string;
  documentId: string;
  prismaClient: Prisma.TransactionClient | PrismaClient;
}) {
  return options.prismaClient.documentSensitivityReport.findFirst({
    where: { tenantId: options.tenantId, documentId: options.documentId },
  });
}
