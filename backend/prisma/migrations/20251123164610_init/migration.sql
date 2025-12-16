-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "criticality" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Dependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromServiceId" TEXT NOT NULL,
    "toServiceId" TEXT NOT NULL,
    "dependencyType" TEXT,
    CONSTRAINT "Dependency_fromServiceId_fkey" FOREIGN KEY ("fromServiceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dependency_toServiceId_fkey" FOREIGN KEY ("toServiceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContinuityCriteria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "rtoHours" INTEGER NOT NULL,
    "rpoMinutes" INTEGER NOT NULL,
    "mtpdHours" INTEGER NOT NULL,
    "notes" TEXT,
    CONSTRAINT "ContinuityCriteria_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ContinuityCriteria_serviceId_key" ON "ContinuityCriteria"("serviceId");
