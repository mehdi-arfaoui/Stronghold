-- DropIndex
DROP INDEX "AuditLog_correlationId_idx";

-- DropIndex
DROP INDEX "AuditLog_tenantId_createdAt_idx";

-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "textExtractedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "ingestionQueuedAt" SET DATA TYPE TIMESTAMP(3);

