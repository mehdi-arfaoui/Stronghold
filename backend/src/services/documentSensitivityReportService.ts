import type { Prisma, PrismaClient } from "@prisma/client";
import { scanSensitiveText, type SensitiveFinding } from "./sensitiveDataScanService.js";

export type SensitivityReport = {
  findings: Awaited<ReturnType<typeof scanSensitiveText>>;
  totalFindings: number;
  hasFindings: boolean;
  scannedAt: Date;
};

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

// Helper to access documentSensitivityReport on both PrismaClient and TransactionClient
function getDocumentSensitivityReportClient(client: PrismaClientOrTx) {
  return (client as any).documentSensitivityReport;
}

function getDocumentClient(client: PrismaClientOrTx) {
  return (client as any).document;
}

async function updateDocumentProtectionStatus(options: {
  prismaClient: PrismaClientOrTx;
  tenantId: string;
  documentId: string;
  isSensitive: boolean;
}) {
  const documentClient = getDocumentClient(options.prismaClient);
  const protectionStatus = options.isSensitive ? "PROTECTED" : "NONE";
  await documentClient.updateMany({
    where: { id: options.documentId, tenantId: options.tenantId },
    data: { isSensitive: options.isSensitive, protectionStatus },
  });
}

export async function upsertDocumentSensitivityReport(options: {
  tenantId: string;
  documentId: string;
  text: string;
  prismaClient: PrismaClientOrTx;
}) {
  const findings = await scanSensitiveText(options.text || "");
  const totalFindings = findings.reduce((sum: number, finding: SensitiveFinding) => sum + finding.count, 0);
  const scannedAt = new Date();
  const isSensitive = totalFindings > 0;

  const reportClient = getDocumentSensitivityReportClient(options.prismaClient);
  const existing = await reportClient.findFirst({
    where: { tenantId: options.tenantId, documentId: options.documentId },
  });

  if (!existing) {
    const created = await reportClient.create({
      data: {
        tenantId: options.tenantId,
        documentId: options.documentId,
        status: "COMPLETED",
        findings,
        totalFindings,
        scannedAt,
      },
    });
    await updateDocumentProtectionStatus({
      prismaClient: options.prismaClient,
      tenantId: options.tenantId,
      documentId: options.documentId,
      isSensitive,
    });
    return created;
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

  await updateDocumentProtectionStatus({
    prismaClient: options.prismaClient,
    tenantId: options.tenantId,
    documentId: options.documentId,
    isSensitive,
  });

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
