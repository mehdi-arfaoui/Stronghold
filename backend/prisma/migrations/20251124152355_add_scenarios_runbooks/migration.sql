-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "impactLevel" TEXT,
    "rtoTargetHours" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Scenario_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunbookStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "estimatedDurationMinutes" INTEGER,
    "role" TEXT,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunbookStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RunbookStep_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScenarioService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    CONSTRAINT "ScenarioService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScenarioService_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScenarioService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
