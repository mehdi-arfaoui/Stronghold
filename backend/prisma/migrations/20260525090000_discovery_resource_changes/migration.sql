-- CreateTable
CREATE TABLE "DiscoveryResourceChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "previousFingerprint" TEXT,
    "newFingerprint" TEXT,
    "metadata" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryResourceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryResourceChange_tenantId_detectedAt_idx" ON "DiscoveryResourceChange"("tenantId", "detectedAt");

-- CreateIndex
CREATE INDEX "DiscoveryResourceChange_tenantId_changeType_idx" ON "DiscoveryResourceChange"("tenantId", "changeType");

-- CreateIndex
CREATE INDEX "DiscoveryResourceChange_tenantId_source_externalId_idx" ON "DiscoveryResourceChange"("tenantId", "source", "externalId");

-- AddForeignKey
ALTER TABLE "DiscoveryResourceChange" ADD CONSTRAINT "DiscoveryResourceChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryResourceChange" ADD CONSTRAINT "DiscoveryResourceChange_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
