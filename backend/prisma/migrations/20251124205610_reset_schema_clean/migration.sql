/*
  Warnings:

  - You are about to drop the `ContinuityCriteria` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Dependency` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `updatedAt` to the `InfraComponent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `ServiceInfraLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `ServiceInfraLink` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "ContinuityCriteria_serviceId_key";

-- AlterTable
ALTER TABLE "Service" ADD COLUMN "domain" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ContinuityCriteria";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Dependency";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "ServiceContinuity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "rtoHours" INTEGER NOT NULL,
    "rpoMinutes" INTEGER NOT NULL,
    "mtpdHours" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceContinuity_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "fromServiceId" TEXT NOT NULL,
    "toServiceId" TEXT NOT NULL,
    "dependencyType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceDependency_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceDependency_fromServiceId_fkey" FOREIGN KEY ("fromServiceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceDependency_toServiceId_fkey" FOREIGN KEY ("toServiceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InfraComponent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InfraComponent" ("criticality", "id", "isSingleAz", "location", "name", "notes", "provider", "tenantId", "type") SELECT "criticality", "id", "isSingleAz", "location", "name", "notes", "provider", "tenantId", "type" FROM "InfraComponent";
DROP TABLE "InfraComponent";
ALTER TABLE "new_InfraComponent" RENAME TO "InfraComponent";
CREATE TABLE "new_ServiceInfraLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "infraId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceInfraLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceInfraLink_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceInfraLink_infraId_fkey" FOREIGN KEY ("infraId") REFERENCES "InfraComponent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ServiceInfraLink" ("id", "infraId", "serviceId") SELECT "id", "infraId", "serviceId" FROM "ServiceInfraLink";
DROP TABLE "ServiceInfraLink";
ALTER TABLE "new_ServiceInfraLink" RENAME TO "ServiceInfraLink";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceContinuity_serviceId_key" ON "ServiceContinuity"("serviceId");
