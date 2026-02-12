-- CreateTable: InfraSnapshot
CREATE TABLE "InfraSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scanId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nodeCount" INTEGER NOT NULL,
    "edgeCount" INTEGER NOT NULL,
    "nodesHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "InfraSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DriftEvent
CREATE TABLE "DriftEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "nodeId" TEXT,
    "nodeName" TEXT,
    "nodeType" TEXT,
    "description" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "affectsBIA" BOOLEAN NOT NULL DEFAULT false,
    "affectsRTO" BOOLEAN NOT NULL DEFAULT false,
    "affectsSPOF" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DriftSchedule
CREATE TABLE "DriftSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cronExpr" TEXT NOT NULL DEFAULT '0 6 * * 1',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "alertEmail" TEXT,
    "alertWebhook" TEXT,
    "alertOnCritical" BOOLEAN NOT NULL DEFAULT true,
    "alertOnHigh" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriftSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: InfraSnapshot
CREATE INDEX "InfraSnapshot_tenantId_capturedAt_idx" ON "InfraSnapshot"("tenantId", "capturedAt");

-- CreateIndex: DriftEvent
CREATE INDEX "DriftEvent_tenantId_status_idx" ON "DriftEvent"("tenantId", "status");
CREATE INDEX "DriftEvent_tenantId_severity_idx" ON "DriftEvent"("tenantId", "severity");
CREATE INDEX "DriftEvent_snapshotId_idx" ON "DriftEvent"("snapshotId");

-- CreateIndex: DriftSchedule
CREATE UNIQUE INDEX "DriftSchedule_tenantId_key" ON "DriftSchedule"("tenantId");

-- AddForeignKey: InfraSnapshot -> Tenant
ALTER TABLE "InfraSnapshot" ADD CONSTRAINT "InfraSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: DriftEvent -> Tenant
ALTER TABLE "DriftEvent" ADD CONSTRAINT "DriftEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: DriftEvent -> InfraSnapshot
ALTER TABLE "DriftEvent" ADD CONSTRAINT "DriftEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "InfraSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DriftSchedule -> Tenant
ALTER TABLE "DriftSchedule" ADD CONSTRAINT "DriftSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
