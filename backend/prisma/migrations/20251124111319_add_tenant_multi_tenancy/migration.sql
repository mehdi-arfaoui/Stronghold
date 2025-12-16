/*
  Warnings:

  - Added the required column `tenantId` to the `InfraComponent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Service` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InfraComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT,
    "location" TEXT,
    "criticality" TEXT,
    "isSingleAz" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    CONSTRAINT "InfraComponent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InfraComponent" ("criticality", "id", "isSingleAz", "location", "name", "notes", "provider", "type") SELECT "criticality", "id", "isSingleAz", "location", "name", "notes", "provider", "type" FROM "InfraComponent";
DROP TABLE "InfraComponent";
ALTER TABLE "new_InfraComponent" RENAME TO "InfraComponent";
CREATE TABLE "new_Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "criticality" TEXT NOT NULL,
    "recoveryPriority" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Service_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Service" ("createdAt", "criticality", "description", "id", "name", "recoveryPriority", "type", "updatedAt") SELECT "createdAt", "criticality", "description", "id", "name", "recoveryPriority", "type", "updatedAt" FROM "Service";
DROP TABLE "Service";
ALTER TABLE "new_Service" RENAME TO "Service";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_apiKey_key" ON "Tenant"("apiKey");
