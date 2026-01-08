-- CreateTable
CREATE TABLE "DiscoveryJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "parameters" TEXT,
    "resultSummary" TEXT,
    "errorMessage" TEXT,
    "credentialsCiphertext" TEXT,
    "credentialsIv" TEXT,
    "credentialsTag" TEXT,
    "requestedByApiKeyId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryScanAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "ipRange" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryScanAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryJob_tenantId_status_idx" ON "DiscoveryJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DiscoveryJob_tenantId_jobType_idx" ON "DiscoveryJob"("tenantId", "jobType");

-- CreateIndex
CREATE INDEX "DiscoveryScanAudit_tenantId_jobId_idx" ON "DiscoveryScanAudit"("tenantId", "jobId");

-- AddForeignKey
ALTER TABLE "DiscoveryJob" ADD CONSTRAINT "DiscoveryJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryJob" ADD CONSTRAINT "DiscoveryJob_requestedByApiKeyId_fkey" FOREIGN KEY ("requestedByApiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryScanAudit" ADD CONSTRAINT "DiscoveryScanAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryScanAudit" ADD CONSTRAINT "DiscoveryScanAudit_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryScanAudit" ADD CONSTRAINT "DiscoveryScanAudit_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
