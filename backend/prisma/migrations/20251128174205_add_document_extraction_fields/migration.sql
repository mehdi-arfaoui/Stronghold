-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "docType" TEXT,
    "description" TEXT,
    "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "extractionError" TEXT,
    "textContent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("createdAt", "description", "docType", "id", "mimeType", "originalName", "size", "storagePath", "storedName", "tenantId", "updatedAt") SELECT "createdAt", "description", "docType", "id", "mimeType", "originalName", "size", "storagePath", "storedName", "tenantId", "updatedAt" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
