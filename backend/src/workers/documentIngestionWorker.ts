import { appLogger } from "../utils/logger.js";
import { Job, Worker } from "bullmq";
import prisma from "../prismaClient.js";
import { createDocumentIngestionConnection } from "../queues/documentIngestionQueue.js";
import { ingestDocumentText } from "../services/documentIngestionService.js";

export type DocumentIngestionQueuePayload = {
  documentId: string;
  tenantId: string;
};

async function markDocumentProcessing(documentId: string, tenantId: string) {
  await prisma.document.updateMany({
    where: { id: documentId, tenantId },
    data: {
      ingestionStatus: "PROCESSING",
      ingestionQueuedAt: null,
      ingestionError: null,
      extractionStatus: "PENDING",
      extractionError: null,
    },
  });
}

async function processDocumentJob(job: Job<DocumentIngestionQueuePayload>) {
  const { documentId, tenantId } = job.data;
  await markDocumentProcessing(documentId, tenantId);
  return ingestDocumentText(documentId, tenantId);
}

export function startDocumentIngestionWorker() {
  const connection = createDocumentIngestionConnection();
  const worker = new Worker<DocumentIngestionQueuePayload>(
    "documentIngestionQueue",
    async (job) => {
      try {
        await processDocumentJob(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Document ingestion worker error";
        await prisma.document.updateMany({
          where: { id: job.data.documentId, tenantId: job.data.tenantId },
          data: {
            ingestionStatus: "ERROR",
            ingestionError: message.slice(0, 255),
          },
        });
        throw error;
      }
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    appLogger.error("Document ingestion worker failed", job?.id, err);
  });

  return worker;
}
