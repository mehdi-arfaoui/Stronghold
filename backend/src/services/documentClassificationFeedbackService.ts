import prisma from "../prismaClient.js";

export class DocumentClassificationDocumentNotFoundError extends Error {
  status = 404;
  constructor() {
    super("Document not found for tenant");
  }
}

function normalizeDocType(value: string): string {
  return value.trim().toUpperCase();
}

export async function recordDocumentClassificationFeedback(params: {
  tenantId: string;
  documentId: string;
  correctedType: string;
  notes?: string | null;
}) {
  const document = await prisma.document.findFirst({
    where: { id: params.documentId, tenantId: params.tenantId },
  });

  if (!document) {
    throw new DocumentClassificationDocumentNotFoundError();
  }

  const correctedType = normalizeDocType(params.correctedType);

  const feedback = await prisma.documentClassificationFeedback.create({
    data: {
      tenantId: params.tenantId,
      documentId: params.documentId,
      predictedType: document.detectedDocType ?? null,
      predictedConfidence: null,
      correctedType,
      modelName: process.env.DOC_CLASSIFICATION_MODEL ?? null,
      notes: params.notes ?? null,
    },
  });

  await prisma.document.updateMany({
    where: { id: params.documentId, tenantId: params.tenantId },
    data: { docType: correctedType },
  });

  return feedback;
}

export const __test__ = {
  normalizeDocType,
};
