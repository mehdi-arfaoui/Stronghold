-- CreateTable: OrganizationProfile
CREATE TABLE "OrganizationProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sizeCategory" TEXT NOT NULL DEFAULT 'midMarket',
    "verticalSector" TEXT,
    "employeeCount" INTEGER,
    "annualRevenueUSD" DOUBLE PRECISION,
    "customDowntimeCostPerHour" DOUBLE PRECISION,
    "customCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "strongholdPlanId" TEXT,
    "strongholdMonthlyCost" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable: NodeFinancialOverride
CREATE TABLE "NodeFinancialOverride" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customCostPerHour" DOUBLE PRECISION NOT NULL,
    "justification" TEXT,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeFinancialOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: OrganizationProfile
CREATE UNIQUE INDEX "OrganizationProfile_tenantId_key" ON "OrganizationProfile"("tenantId");

-- CreateIndex: NodeFinancialOverride
CREATE UNIQUE INDEX "NodeFinancialOverride_nodeId_tenantId_key" ON "NodeFinancialOverride"("nodeId", "tenantId");
CREATE INDEX "NodeFinancialOverride_tenantId_idx" ON "NodeFinancialOverride"("tenantId");

-- AddForeignKey: OrganizationProfile -> Tenant
ALTER TABLE "OrganizationProfile" ADD CONSTRAINT "OrganizationProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: NodeFinancialOverride -> InfraNode
ALTER TABLE "NodeFinancialOverride" ADD CONSTRAINT "NodeFinancialOverride_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "InfraNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: NodeFinancialOverride -> Tenant
ALTER TABLE "NodeFinancialOverride" ADD CONSTRAINT "NodeFinancialOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

