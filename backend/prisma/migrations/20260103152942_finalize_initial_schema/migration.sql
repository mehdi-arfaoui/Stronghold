-- DropForeignKey
ALTER TABLE "ApiKey" DROP CONSTRAINT "ApiKey_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_tenantId_fkey";

-- DropIndex
DROP INDEX "AuditLog_correlationId_idx";

-- DropIndex
DROP INDEX "AuditLog_tenantId_createdAt_idx";

-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "textExtractedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "ingestionQueuedAt" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
