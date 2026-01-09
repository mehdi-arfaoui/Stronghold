-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "ocrStatus" TEXT DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "ocrProvider" TEXT,
ADD COLUMN     "ocrStartedAt" TIMESTAMP(3),
ADD COLUMN     "ocrCompletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DocumentSensitivityReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "findings" JSONB NOT NULL,
    "totalFindings" INTEGER NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSensitivityReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSensitivityReport_documentId_key" ON "DocumentSensitivityReport"("documentId");

-- CreateIndex
CREATE INDEX "DocumentSensitivityReport_tenantId_documentId_idx" ON "DocumentSensitivityReport"("tenantId", "documentId");

-- AddForeignKey
ALTER TABLE "DocumentSensitivityReport" ADD CONSTRAINT "DocumentSensitivityReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSensitivityReport" ADD CONSTRAINT "DocumentSensitivityReport_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
