-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

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
    "runbookStepId" TEXT,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rtoObservedHours" INTEGER,
    "comments" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseAnalysis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "gaps" JSONB NOT NULL,
    "correctiveActions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exercise_tenantId_idx" ON "Exercise"("tenantId");

-- CreateIndex
CREATE INDEX "Exercise_scenarioId_idx" ON "Exercise"("scenarioId");

-- CreateIndex
CREATE INDEX "ExerciseRunbook_tenantId_exerciseId_idx" ON "ExerciseRunbook"("tenantId", "exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseRunbook_tenantId_exerciseId_runbookId_key" ON "ExerciseRunbook"("tenantId", "exerciseId", "runbookId");

-- CreateIndex
CREATE INDEX "ExerciseChecklistItem_tenantId_exerciseId_idx" ON "ExerciseChecklistItem"("tenantId", "exerciseId");

-- CreateIndex
CREATE INDEX "ExerciseResult_tenantId_exerciseId_idx" ON "ExerciseResult"("tenantId", "exerciseId");

-- CreateIndex
CREATE INDEX "ExerciseAnalysis_tenantId_exerciseId_idx" ON "ExerciseAnalysis"("tenantId", "exerciseId");

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "ExerciseChecklistItem" ADD CONSTRAINT "ExerciseChecklistItem_runbookStepId_fkey" FOREIGN KEY ("runbookStepId") REFERENCES "RunbookStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseResult" ADD CONSTRAINT "ExerciseResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseResult" ADD CONSTRAINT "ExerciseResult_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAnalysis" ADD CONSTRAINT "ExerciseAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAnalysis" ADD CONSTRAINT "ExerciseAnalysis_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
