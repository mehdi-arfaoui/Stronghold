-- AlterTable: Runbook (operational PRA fields)
ALTER TABLE "Runbook"
  ADD COLUMN "simulationId" TEXT,
  ADD COLUMN "recommendationId" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "steps" JSONB,
  ADD COLUMN "responsible" TEXT,
  ADD COLUMN "accountable" TEXT,
  ADD COLUMN "consulted" TEXT,
  ADD COLUMN "informed" TEXT,
  ADD COLUMN "lastTestedAt" TIMESTAMP(3),
  ADD COLUMN "testResult" TEXT;

ALTER TABLE "Runbook"
  ALTER COLUMN "status" SET DEFAULT 'draft';

-- CreateIndex: Runbook
CREATE INDEX "Runbook_tenantId_idx" ON "Runbook"("tenantId");
CREATE INDEX "Runbook_simulationId_idx" ON "Runbook"("simulationId");
CREATE INDEX "Runbook_tenantId_status_idx" ON "Runbook"("tenantId", "status");

-- AddForeignKey: Runbook -> Simulation
ALTER TABLE "Runbook"
  ADD CONSTRAINT "Runbook_simulationId_fkey"
  FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: RemediationTask
CREATE TABLE "RemediationTask" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "recommendationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'todo',
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "assignee" TEXT,
  "dueDate" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "estimatedCost" DOUBLE PRECISION,
  "actualCost" DOUBLE PRECISION,
  "riskReduction" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RemediationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: RemediationTask
CREATE INDEX "RemediationTask_tenantId_status_idx" ON "RemediationTask"("tenantId", "status");
CREATE INDEX "RemediationTask_tenantId_priority_idx" ON "RemediationTask"("tenantId", "priority");
CREATE INDEX "RemediationTask_recommendationId_idx" ON "RemediationTask"("recommendationId");

-- AddForeignKey: RemediationTask -> Tenant
ALTER TABLE "RemediationTask"
  ADD CONSTRAINT "RemediationTask_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: PRAExercise
CREATE TABLE "PRAExercise" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "runbookId" TEXT,
  "simulationId" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "executedAt" TIMESTAMP(3),
  "duration" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "outcome" TEXT,
  "actualRTO" INTEGER,
  "actualRPO" INTEGER,
  "findings" JSONB,
  "predictedRTO" INTEGER,
  "predictedRPO" INTEGER,
  "deviationRTO" INTEGER,
  "deviationRPO" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PRAExercise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: PRAExercise
CREATE INDEX "PRAExercise_tenantId_status_idx" ON "PRAExercise"("tenantId", "status");
CREATE INDEX "PRAExercise_runbookId_idx" ON "PRAExercise"("runbookId");
CREATE INDEX "PRAExercise_simulationId_idx" ON "PRAExercise"("simulationId");

-- AddForeignKey: PRAExercise -> Tenant
ALTER TABLE "PRAExercise"
  ADD CONSTRAINT "PRAExercise_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: PRAExercise -> Runbook
ALTER TABLE "PRAExercise"
  ADD CONSTRAINT "PRAExercise_runbookId_fkey"
  FOREIGN KEY ("runbookId") REFERENCES "Runbook"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: PRAExercise -> Simulation
ALTER TABLE "PRAExercise"
  ADD CONSTRAINT "PRAExercise_simulationId_fkey"
  FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;