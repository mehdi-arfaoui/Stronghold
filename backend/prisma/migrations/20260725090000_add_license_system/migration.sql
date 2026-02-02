-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('STARTER', 'PRO', 'ENTERPRISE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plan" "PlanType" NOT NULL DEFAULT 'STARTER',
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "maxUsers" INTEGER NOT NULL DEFAULT 5,
    "maxStorage" BIGINT NOT NULL DEFAULT 1073741824,
    "maxScansMonth" INTEGER NOT NULL DEFAULT 100,
    "maxDocuments" INTEGER NOT NULL DEFAULT 500,
    "features" TEXT[] DEFAULT ARRAY['discovery', 'inventory']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseUsage" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "currentUsers" INTEGER NOT NULL DEFAULT 0,
    "currentStorage" BIGINT NOT NULL DEFAULT 0,
    "scansThisMonth" INTEGER NOT NULL DEFAULT 0,
    "documentsCount" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "License_tenantId_key" ON "License"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseUsage_licenseId_key" ON "LicenseUsage"("licenseId");

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseUsage" ADD CONSTRAINT "LicenseUsage_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE CASCADE ON UPDATE CASCADE;
