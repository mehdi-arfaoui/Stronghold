-- CreateTable
CREATE TABLE "ExerciseSimulation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "simulator" TEXT NOT NULL,
    "connectorType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "configuration" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseSimulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExerciseSimulation_tenantId_exerciseId_idx" ON "ExerciseSimulation"("tenantId", "exerciseId");

-- AddForeignKey
ALTER TABLE "ExerciseSimulation" ADD CONSTRAINT "ExerciseSimulation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSimulation" ADD CONSTRAINT "ExerciseSimulation_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
