-- AlterTable: Add auto-detection columns to Risk
ALTER TABLE "Risk" ADD COLUMN "autoDetected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Risk" ADD COLUMN "detectionMethod" TEXT;

-- CreateTable: InfraNode
CREATE TABLE "InfraNode" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "region" TEXT,
    "availabilityZone" TEXT,
    "tags" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "criticalityScore" DOUBLE PRECISION,
    "redundancyScore" DOUBLE PRECISION,
    "blastRadius" INTEGER,
    "isSPOF" BOOLEAN NOT NULL DEFAULT false,
    "betweennessCentrality" DOUBLE PRECISION,
    "suggestedRTO" INTEGER,
    "suggestedRPO" INTEGER,
    "suggestedMTPD" INTEGER,
    "validatedRTO" INTEGER,
    "validatedRPO" INTEGER,
    "validatedMTPD" INTEGER,
    "impactCategory" TEXT,
    "financialImpactPerHour" DOUBLE PRECISION,
    "tenantId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfraNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InfraEdge
CREATE TABLE "InfraEdge" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "inferenceMethod" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfraEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GraphAnalysis
CREATE TABLE "GraphAnalysis" (
    "id" TEXT NOT NULL,
    "resilienceScore" INTEGER NOT NULL,
    "totalNodes" INTEGER NOT NULL,
    "totalEdges" INTEGER NOT NULL,
    "spofCount" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BIAReport2
CREATE TABLE "BIAReport2" (
    "id" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "summary" JSONB NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BIAReport2_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BIAProcess2
CREATE TABLE "BIAProcess2" (
    "id" TEXT NOT NULL,
    "serviceNodeId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "suggestedMAO" INTEGER,
    "suggestedMTPD" INTEGER,
    "suggestedRTO" INTEGER,
    "suggestedRPO" INTEGER,
    "suggestedMBCO" INTEGER,
    "validatedRTO" INTEGER,
    "validatedRPO" INTEGER,
    "validatedMTPD" INTEGER,
    "impactCategory" TEXT NOT NULL,
    "criticalityScore" DOUBLE PRECISION NOT NULL,
    "recoveryTier" INTEGER NOT NULL,
    "dependencyChain" JSONB NOT NULL,
    "weakPoints" JSONB NOT NULL,
    "financialImpact" JSONB NOT NULL,
    "validationStatus" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "biaReportId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BIAProcess2_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RiskNodeLink
CREATE TABLE "RiskNodeLink" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,

    CONSTRAINT "RiskNodeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Simulation
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "scenarioType" TEXT NOT NULL,
    "scenarioParams" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "totalNodesAffected" INTEGER NOT NULL,
    "percentageAffected" DOUBLE PRECISION NOT NULL,
    "estimatedDowntime" INTEGER NOT NULL,
    "estimatedFinancialLoss" DOUBLE PRECISION,
    "postIncidentScore" INTEGER NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ScanJob
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "progress" JSONB,
    "result" JSONB,
    "error" TEXT,
    "tenantId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ScanSchedule
CREATE TABLE "ScanSchedule" (
    "id" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: InfraNode
CREATE UNIQUE INDEX "InfraNode_tenantId_externalId_key" ON "InfraNode"("tenantId", "externalId");
CREATE INDEX "InfraNode_tenantId_idx" ON "InfraNode"("tenantId");
CREATE INDEX "InfraNode_type_idx" ON "InfraNode"("type");
CREATE INDEX "InfraNode_provider_region_idx" ON "InfraNode"("provider", "region");

-- CreateIndex: InfraEdge
CREATE UNIQUE INDEX "InfraEdge_sourceId_targetId_type_key" ON "InfraEdge"("sourceId", "targetId", "type");
CREATE INDEX "InfraEdge_tenantId_idx" ON "InfraEdge"("tenantId");

-- CreateIndex: GraphAnalysis
CREATE INDEX "GraphAnalysis_tenantId_idx" ON "GraphAnalysis"("tenantId");

-- CreateIndex: BIAReport2
CREATE INDEX "BIAReport2_tenantId_idx" ON "BIAReport2"("tenantId");

-- CreateIndex: BIAProcess2
CREATE INDEX "BIAProcess2_tenantId_idx" ON "BIAProcess2"("tenantId");
CREATE INDEX "BIAProcess2_biaReportId_idx" ON "BIAProcess2"("biaReportId");

-- CreateIndex: RiskNodeLink
CREATE UNIQUE INDEX "RiskNodeLink_riskId_nodeId_key" ON "RiskNodeLink"("riskId", "nodeId");

-- CreateIndex: Simulation
CREATE INDEX "Simulation_tenantId_idx" ON "Simulation"("tenantId");
CREATE INDEX "Simulation_scenarioType_idx" ON "Simulation"("scenarioType");

-- CreateIndex: ScanJob
CREATE INDEX "ScanJob_tenantId_status_idx" ON "ScanJob"("tenantId", "status");

-- CreateIndex: ScanSchedule
CREATE INDEX "ScanSchedule_tenantId_idx" ON "ScanSchedule"("tenantId");

-- AddForeignKey: InfraNode -> Tenant
ALTER TABLE "InfraNode" ADD CONSTRAINT "InfraNode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: InfraEdge -> InfraNode (source)
ALTER TABLE "InfraEdge" ADD CONSTRAINT "InfraEdge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "InfraNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: InfraEdge -> InfraNode (target)
ALTER TABLE "InfraEdge" ADD CONSTRAINT "InfraEdge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "InfraNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: GraphAnalysis -> Tenant
ALTER TABLE "GraphAnalysis" ADD CONSTRAINT "GraphAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: BIAReport2 -> Tenant
ALTER TABLE "BIAReport2" ADD CONSTRAINT "BIAReport2_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: BIAProcess2 -> BIAReport2
ALTER TABLE "BIAProcess2" ADD CONSTRAINT "BIAProcess2_biaReportId_fkey" FOREIGN KEY ("biaReportId") REFERENCES "BIAReport2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: BIAProcess2 -> Tenant
ALTER TABLE "BIAProcess2" ADD CONSTRAINT "BIAProcess2_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: RiskNodeLink -> Risk
ALTER TABLE "RiskNodeLink" ADD CONSTRAINT "RiskNodeLink_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: RiskNodeLink -> InfraNode
ALTER TABLE "RiskNodeLink" ADD CONSTRAINT "RiskNodeLink_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "InfraNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Simulation -> Tenant
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ScanJob -> Tenant
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ScanSchedule -> Tenant
ALTER TABLE "ScanSchedule" ADD CONSTRAINT "ScanSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
