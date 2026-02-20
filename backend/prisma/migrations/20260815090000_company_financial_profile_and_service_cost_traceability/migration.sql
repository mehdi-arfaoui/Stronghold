-- AlterTable: OrganizationProfile
ALTER TABLE "OrganizationProfile"
  ADD COLUMN "profileSource" TEXT NOT NULL DEFAULT 'inferred',
  ADD COLUMN "profileConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
  ADD COLUMN "annualRevenue" DOUBLE PRECISION,
  ADD COLUMN "industrySector" TEXT,
  ADD COLUMN "annualITBudget" DOUBLE PRECISION,
  ADD COLUMN "drBudgetPercent" DOUBLE PRECISION,
  ADD COLUMN "hourlyDowntimeCost" DOUBLE PRECISION,
  ADD COLUMN "profileMetadata" JSONB;

-- AlterTable: InfraNode
ALTER TABLE "InfraNode"
  ADD COLUMN "estimatedMonthlyCost" DOUBLE PRECISION,
  ADD COLUMN "estimatedMonthlyCostCurrency" TEXT,
  ADD COLUMN "estimatedMonthlyCostSource" TEXT,
  ADD COLUMN "estimatedMonthlyCostConfidence" DOUBLE PRECISION,
  ADD COLUMN "estimatedMonthlyCostUpdatedAt" TIMESTAMP(3);
