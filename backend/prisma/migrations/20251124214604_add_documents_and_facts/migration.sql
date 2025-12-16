-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "docType" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExtractedFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT,
    "sourceType" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" REAL,
    "linkedServiceId" TEXT,
    "linkedInfraId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExtractedFact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExtractedFact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
