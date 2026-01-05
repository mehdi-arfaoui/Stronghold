-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN "scenarioId" TEXT;
ALTER TABLE "Exercise" ADD COLUMN "description" TEXT;
ALTER TABLE "Exercise" ADD COLUMN "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Exercise" DROP COLUMN "type";
ALTER TABLE "Exercise" DROP COLUMN "scope";
ALTER TABLE "Exercise" DROP COLUMN "scenario";
ALTER TABLE "Exercise" DROP COLUMN "conductedAt";
ALTER TABLE "Exercise" DROP COLUMN "findings";
ALTER TABLE "Exercise" DROP COLUMN "improvementPlan";

-- CreateTable
CREATE TABLE "ExerciseRunbook" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "runbookId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseRunbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseChecklistItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "runbookStepId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "summary" TEXT,
    "findings" TEXT,
    "improvementPlan" TEXT,
    "analysis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exercise_tenantId_scheduledAt_idx" ON "Exercise"("tenantId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ExerciseRunbook_tenantId_exerciseId_idx" ON "ExerciseRunbook"("tenantId", "exerciseId");

-- CreateIndex
CREATE INDEX "ExerciseRunbook_tenantId_runbookId_idx" ON "ExerciseRunbook"("tenantId", "runbookId");

-- CreateIndex
CREATE INDEX "ExerciseChecklistItem_tenantId_exerciseId_idx" ON "ExerciseChecklistItem"("tenantId", "exerciseId");

-- CreateIndex
CREATE INDEX "ExerciseChecklistItem_tenantId_runbookStepId_idx" ON "ExerciseChecklistItem"("tenantId", "runbookStepId");

-- CreateIndex
CREATE INDEX "ExerciseResult_tenantId_exerciseId_idx" ON "ExerciseResult"("tenantId", "exerciseId");

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseRunbook" ADD CONSTRAINT "ExerciseRunbook_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseRunbook" ADD CONSTRAINT "ExerciseRunbook_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseRunbook" ADD CONSTRAINT "ExerciseRunbook_runbookId_fkey" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseChecklistItem" ADD CONSTRAINT "ExerciseChecklistItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseChecklistItem" ADD CONSTRAINT "ExerciseChecklistItem_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseChecklistItem" ADD CONSTRAINT "ExerciseChecklistItem_runbookStepId_fkey" FOREIGN KEY ("runbookStepId") REFERENCES "RunbookStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseResult" ADD CONSTRAINT "ExerciseResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseResult" ADD CONSTRAINT "ExerciseResult_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
