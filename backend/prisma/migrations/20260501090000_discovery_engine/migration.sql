-- CreateTable
CREATE TABLE "DiscoveryResource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "hostname" TEXT,
    "tags" JSONB,
    "metadata" JSONB,
    "fingerprint" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryResourceMatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryResourceMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ipRanges" JSONB NOT NULL,
    "cloudProviders" JSONB NOT NULL,
    "frequency" TEXT NOT NULL,
    "scheduleConfig" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryFlow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT,
    "sourceResourceId" TEXT,
    "targetResourceId" TEXT,
    "sourceIp" TEXT,
    "targetIp" TEXT,
    "sourcePort" INTEGER,
    "targetPort" INTEGER,
    "protocol" TEXT,
    "bytes" INTEGER,
    "packets" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryResource_tenantId_externalId_idx" ON "DiscoveryResource"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "DiscoveryResource_tenantId_ip_idx" ON "DiscoveryResource"("tenantId", "ip");

-- CreateIndex
CREATE INDEX "DiscoveryResource_tenantId_hostname_idx" ON "DiscoveryResource"("tenantId", "hostname");

-- CreateIndex
CREATE INDEX "DiscoveryResourceMatch_tenantId_resourceId_idx" ON "DiscoveryResourceMatch"("tenantId", "resourceId");

-- CreateIndex
CREATE INDEX "DiscoveryFlow_tenantId_observedAt_idx" ON "DiscoveryFlow"("tenantId", "observedAt");

-- AddForeignKey
ALTER TABLE "DiscoveryResource" ADD CONSTRAINT "DiscoveryResource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryResource" ADD CONSTRAINT "DiscoveryResource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryResourceMatch" ADD CONSTRAINT "DiscoveryResourceMatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryResourceMatch" ADD CONSTRAINT "DiscoveryResourceMatch_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "DiscoveryResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverySchedule" ADD CONSTRAINT "DiscoverySchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFlow" ADD CONSTRAINT "DiscoveryFlow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFlow" ADD CONSTRAINT "DiscoveryFlow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFlow" ADD CONSTRAINT "DiscoveryFlow_sourceResourceId_fkey" FOREIGN KEY ("sourceResourceId") REFERENCES "DiscoveryResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFlow" ADD CONSTRAINT "DiscoveryFlow_targetResourceId_fkey" FOREIGN KEY ("targetResourceId") REFERENCES "DiscoveryResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
