-- Add ingestion tracking fields and file hashing
ALTER TABLE "Document" ADD COLUMN "fileHash" TEXT;
ALTER TABLE "Document" ADD COLUMN "textExtractedAt" TIMESTAMP;
ALTER TABLE "Document" ADD COLUMN "ingestionStatus" TEXT NOT NULL DEFAULT 'FILE_STORED';
ALTER TABLE "Document" ADD COLUMN "ingestionQueuedAt" TIMESTAMP;
ALTER TABLE "Document" ADD COLUMN "ingestionError" TEXT;

-- Adjust uniqueness to be scoped by tenant and cover file hashes
DROP INDEX IF EXISTS "Document_textHash_key";
CREATE UNIQUE INDEX "Document_tenantId_textHash_key" ON "Document"("tenantId", "textHash");
CREATE UNIQUE INDEX "Document_tenantId_fileHash_key" ON "Document"("tenantId", "fileHash");
