-- CreateTable: BusinessFlow
CREATE TABLE "BusinessFlow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "annualRevenue" DOUBLE PRECISION,
    "transactionsPerHour" DOUBLE PRECISION,
    "revenuePerTransaction" DOUBLE PRECISION,
    "estimatedCostPerHour" DOUBLE PRECISION,
    "calculatedCostPerHour" DOUBLE PRECISION,
    "costCalculationMethod" TEXT,
    "peakHoursMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "peakHoursStart" INTEGER,
    "peakHoursEnd" INTEGER,
    "operatingDaysPerWeek" INTEGER NOT NULL DEFAULT 5,
    "operatingHoursPerDay" INTEGER NOT NULL DEFAULT 10,
    "slaUptimePercent" DOUBLE PRECISION,
    "slaPenaltyPerHour" DOUBLE PRECISION,
    "slaPenaltyFlat" DOUBLE PRECISION,
    "contractualRTO" INTEGER,
    "estimatedCustomerChurnPerHour" DOUBLE PRECISION,
    "customerLifetimeValue" DOUBLE PRECISION,
    "reputationImpactCategory" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "aiConfidence" DOUBLE PRECISION,
    "validatedByUser" BOOLEAN NOT NULL DEFAULT false,
    "validatedAt" TIMESTAMP(3),
    "mutualExclusionGroup" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BusinessFlowNode
CREATE TABLE "BusinessFlowNode" (
    "id" TEXT NOT NULL,
    "businessFlowId" TEXT NOT NULL,
    "infraNodeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "role" TEXT,
    "isCritical" BOOLEAN NOT NULL DEFAULT true,
    "hasAlternativePath" BOOLEAN NOT NULL DEFAULT false,
    "alternativeNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessFlowNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: BusinessFlow
CREATE INDEX "BusinessFlow_tenantId_idx" ON "BusinessFlow"("tenantId");
CREATE INDEX "BusinessFlow_tenantId_validatedByUser_idx" ON "BusinessFlow"("tenantId", "validatedByUser");
CREATE INDEX "BusinessFlow_tenantId_source_idx" ON "BusinessFlow"("tenantId", "source");

-- CreateIndex: BusinessFlowNode
CREATE UNIQUE INDEX "BusinessFlowNode_businessFlowId_infraNodeId_key" ON "BusinessFlowNode"("businessFlowId", "infraNodeId");
CREATE INDEX "BusinessFlowNode_tenantId_idx" ON "BusinessFlowNode"("tenantId");
CREATE INDEX "BusinessFlowNode_infraNodeId_idx" ON "BusinessFlowNode"("infraNodeId");

-- AddForeignKey: BusinessFlow -> Tenant
ALTER TABLE "BusinessFlow" ADD CONSTRAINT "BusinessFlow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: BusinessFlowNode -> BusinessFlow
ALTER TABLE "BusinessFlowNode" ADD CONSTRAINT "BusinessFlowNode_businessFlowId_fkey" FOREIGN KEY ("businessFlowId") REFERENCES "BusinessFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: BusinessFlowNode -> Tenant
ALTER TABLE "BusinessFlowNode" ADD CONSTRAINT "BusinessFlowNode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
