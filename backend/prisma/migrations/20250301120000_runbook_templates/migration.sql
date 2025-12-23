-- Runbook template store and template linkage
ALTER TABLE "Runbook" ADD COLUMN "docxPath" TEXT;
ALTER TABLE "Runbook" ADD COLUMN "templateId" TEXT;
ALTER TABLE "Runbook" ADD COLUMN "templateNameSnapshot" TEXT;

-- New table for tenant-scoped runbook templates
CREATE TABLE "RunbookTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "description" TEXT,
    "fileHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunbookTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RunbookTemplate_tenantId_fileHash_key" ON "RunbookTemplate"("tenantId", "fileHash");

-- Foreign keys
ALTER TABLE "RunbookTemplate" ADD CONSTRAINT "RunbookTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Runbook" ADD CONSTRAINT "Runbook_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RunbookTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
