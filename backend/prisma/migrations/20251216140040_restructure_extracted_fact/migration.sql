/*
  Warnings:

  - You are about to drop the column `key` on the `ExtractedFact` table. All the data in the column will be lost.
  - You are about to drop the column `linkedInfraId` on the `ExtractedFact` table. All the data in the column will be lost.
  - You are about to drop the column `linkedServiceId` on the `ExtractedFact` table. All the data in the column will be lost.
  - You are about to drop the column `sourceType` on the `ExtractedFact` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `ExtractedFact` table. All the data in the column will be lost.
  - Added the required column `category` to the `ExtractedFact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `data` to the `ExtractedFact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `label` to the `ExtractedFact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `ExtractedFact` table without a default value. This is not possible if the table is not empty.
  - Made the column `documentId` on table `ExtractedFact` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExtractedFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "source" TEXT,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExtractedFact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExtractedFact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ExtractedFact" ("confidence", "createdAt", "documentId", "id", "tenantId", "updatedAt") SELECT "confidence", "createdAt", "documentId", "id", "tenantId", "updatedAt" FROM "ExtractedFact";
DROP TABLE "ExtractedFact";
ALTER TABLE "new_ExtractedFact" RENAME TO "ExtractedFact";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
