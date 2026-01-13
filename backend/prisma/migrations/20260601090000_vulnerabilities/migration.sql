-- CreateTable
CREATE TABLE "Vulnerability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "cveId" TEXT NOT NULL,
    "source" TEXT,
    "summary" TEXT,
    "severityScore" DOUBLE PRECISION NOT NULL,
    "severityLabel" TEXT NOT NULL,
    "packageName" TEXT,
    "packageVersion" TEXT,
    "fixedVersion" TEXT,
    "references" JSONB,
    "remediation" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "metadata" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vulnerability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vulnerability_tenantId_serviceId_idx" ON "Vulnerability"("tenantId", "serviceId");

-- CreateIndex
CREATE INDEX "Vulnerability_tenantId_cveId_idx" ON "Vulnerability"("tenantId", "cveId");

-- CreateIndex
CREATE UNIQUE INDEX "Vulnerability_tenantId_fingerprint_key" ON "Vulnerability"("tenantId", "fingerprint");

-- AddForeignKey
ALTER TABLE "Vulnerability" ADD CONSTRAINT "Vulnerability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vulnerability" ADD CONSTRAINT "Vulnerability_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
