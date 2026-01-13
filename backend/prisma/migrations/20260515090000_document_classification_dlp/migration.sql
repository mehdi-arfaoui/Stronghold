-- Add sensitivity flags to documents
ALTER TABLE "Document" ADD COLUMN "isSensitive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Document" ADD COLUMN "protectionStatus" TEXT NOT NULL DEFAULT 'NONE';

-- Add document classification feedback
CREATE TABLE "DocumentClassificationFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "predictedType" TEXT,
    "predictedConfidence" DOUBLE PRECISION,
    "correctedType" TEXT NOT NULL,
    "modelName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentClassificationFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentClassificationFeedback_tenantId_documentId_idx" ON "DocumentClassificationFeedback"("tenantId", "documentId");

ALTER TABLE "DocumentClassificationFeedback" ADD CONSTRAINT "DocumentClassificationFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentClassificationFeedback" ADD CONSTRAINT "DocumentClassificationFeedback_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
