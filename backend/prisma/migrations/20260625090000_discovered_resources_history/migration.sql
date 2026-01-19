-- CreateTable
CREATE TABLE "DiscoveredResource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "hostname" TEXT,
    "tags" JSONB,
    "metadata" JSONB,
    "serviceId" TEXT,
    "infraId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveredResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" TEXT NOT NULL,
    "jobType" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "summary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredResource_tenantId_source_externalId_key" ON "DiscoveredResource"("tenantId", "source", "externalId");

-- CreateIndex
CREATE INDEX "DiscoveredResource_tenantId_lastSeenAt_idx" ON "DiscoveredResource"("tenantId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "DiscoveredResource_tenantId_kind_idx" ON "DiscoveredResource"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "DiscoveryHistory_tenantId_createdAt_idx" ON "DiscoveryHistory"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryHistory_tenantId_status_idx" ON "DiscoveryHistory"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "DiscoveredResource" ADD CONSTRAINT "DiscoveredResource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredResource" ADD CONSTRAINT "DiscoveredResource_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredResource" ADD CONSTRAINT "DiscoveredResource_infraId_fkey" FOREIGN KEY ("infraId") REFERENCES "InfraComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryHistory" ADD CONSTRAINT "DiscoveryHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryHistory" ADD CONSTRAINT "DiscoveryHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
