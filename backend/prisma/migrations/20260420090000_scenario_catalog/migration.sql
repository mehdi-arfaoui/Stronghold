-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN "catalogScenarioId" TEXT;

-- CreateTable
CREATE TABLE "ScenarioCatalog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "impactLevel" TEXT,
    "rtoTargetHours" INTEGER,
    "recoveryStrategy" TEXT NOT NULL,
    "estimatedCostLevel" TEXT,
    "estimatedCostMin" DOUBLE PRECISION,
    "estimatedCostMax" DOUBLE PRECISION,
    "estimatedCostCurrency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioCatalog_tenantId_sourceKey_key" ON "ScenarioCatalog"("tenantId", "sourceKey");

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_catalogScenarioId_fkey" FOREIGN KEY ("catalogScenarioId") REFERENCES "ScenarioCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioCatalog" ADD CONSTRAINT "ScenarioCatalog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
