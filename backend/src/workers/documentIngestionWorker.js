"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDocumentIngestionWorker = startDocumentIngestionWorker;
const bullmq_1 = require("bullmq");
const prismaClient_1 = require("../prismaClient");
const documentIngestionQueue_1 = require("../queues/documentIngestionQueue");
const documentIngestionService_1 = require("../services/documentIngestionService");
async function markDocumentProcessing(documentId, tenantId) {
    await prismaClient_1.default.document.updateMany({
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
async function processDocumentJob(job) {
    const { documentId, tenantId } = job.data;
    await markDocumentProcessing(documentId, tenantId);
    return (0, documentIngestionService_1.ingestDocumentText)(documentId, tenantId);
}
function startDocumentIngestionWorker() {
    const connection = (0, documentIngestionQueue_1.createDocumentIngestionConnection)();
    const worker = new bullmq_1.Worker("documentIngestionQueue", async (job) => {
        try {
            await processDocumentJob(job);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Document ingestion worker error";
            await prismaClient_1.default.document.updateMany({
                where: { id: job.data.documentId, tenantId: job.data.tenantId },
                data: {
                    ingestionStatus: "ERROR",
                    ingestionError: message.slice(0, 255),
                },
            });
            throw error;
        }
    }, { connection });
    worker.on("failed", (job, err) => {
        console.error("Document ingestion worker failed", job?.id, err);
    });
    return worker;
}
