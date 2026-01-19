-- CreateTable
CREATE TABLE "CyberExercise" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "participants" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "runbook" JSONB,
    "report" JSONB,
    "logs" JSONB,
    "simulator" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CyberExercise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CyberExercise_tenantId_scenarioId_idx" ON "CyberExercise"("tenantId", "scenarioId");

-- CreateIndex
CREATE INDEX "CyberExercise_tenantId_date_idx" ON "CyberExercise"("tenantId", "date");

-- AddForeignKey
ALTER TABLE "CyberExercise" ADD CONSTRAINT "CyberExercise_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
