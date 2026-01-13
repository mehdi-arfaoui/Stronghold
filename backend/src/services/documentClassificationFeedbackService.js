"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__test__ = void 0;
exports.recordDocumentClassificationFeedback = recordDocumentClassificationFeedback;
exports.DocumentClassificationDocumentNotFoundError = void 0;
const prismaClient_1 = require("../prismaClient");
class DocumentClassificationDocumentNotFoundError extends Error {
    status = 404;
    constructor() {
        super("Document not found for tenant");
    }
}
exports.DocumentClassificationDocumentNotFoundError = DocumentClassificationDocumentNotFoundError;
function normalizeDocType(value) {
    return value.trim().toUpperCase();
}
async function recordDocumentClassificationFeedback(params) {
    const document = await prismaClient_1.default.document.findFirst({
        where: { id: params.documentId, tenantId: params.tenantId },
    });
    if (!document) {
        throw new DocumentClassificationDocumentNotFoundError();
    }
    const correctedType = normalizeDocType(params.correctedType);
    const feedback = await prismaClient_1.default.documentClassificationFeedback.create({
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
    await prismaClient_1.default.document.updateMany({
        where: { id: params.documentId, tenantId: params.tenantId },
        data: { docType: correctedType },
    });
    return feedback;
}
exports.__test__ = {
    normalizeDocType,
};
