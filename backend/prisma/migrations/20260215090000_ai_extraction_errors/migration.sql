-- CreateTable
CREATE TABLE "AiExtractionError" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "errorName" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiExtractionError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiExtractionError_tenantId_documentId_idx" ON "AiExtractionError"("tenantId", "documentId");

-- AddForeignKey
ALTER TABLE "AiExtractionError" ADD CONSTRAINT "AiExtractionError_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExtractionError" ADD CONSTRAINT "AiExtractionError_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
