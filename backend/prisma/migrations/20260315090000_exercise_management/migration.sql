-- AlterTable: Make scenarioId NOT NULL (update existing NULL values first if any)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'Exercise') THEN
        UPDATE "Exercise" SET "scenarioId" = (SELECT "id" FROM "Scenario" LIMIT 1) WHERE "scenarioId" IS NULL;
        ALTER TABLE "Exercise" ALTER COLUMN "scenarioId" SET NOT NULL;
        ALTER TABLE "Exercise" ALTER COLUMN "scheduledAt" DROP DEFAULT;
        ALTER TABLE "Exercise" ALTER COLUMN "scheduledAt" SET NOT NULL;
        ALTER TABLE "Exercise" ALTER COLUMN "status" SET DEFAULT 'PLANNED';
        
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Exercise_scenarioId_idx') THEN
            CREATE INDEX "Exercise_scenarioId_idx" ON "Exercise"("scenarioId");
        END IF;
    END IF;
END $$;

-- CreateTable: ExerciseRunbook (only if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ExerciseRunbook') THEN
        CREATE TABLE "ExerciseRunbook" (
            "id" TEXT NOT NULL,
            "tenantId" TEXT NOT NULL,
            "exerciseId" TEXT NOT NULL,
            "runbookId" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT "ExerciseRunbook_pkey" PRIMARY KEY ("id")
        );
        
        CREATE INDEX "ExerciseRunbook_tenantId_exerciseId_idx" ON "ExerciseRunbook"("tenantId", "exerciseId");
        CREATE UNIQUE INDEX "ExerciseRunbook_tenantId_exerciseId_runbookId_key" ON "ExerciseRunbook"("tenantId", "exerciseId", "runbookId");
    ELSE
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ExerciseRunbook_tenantId_exerciseId_idx') THEN
            CREATE INDEX "ExerciseRunbook_tenantId_exerciseId_idx" ON "ExerciseRunbook"("tenantId", "exerciseId");
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ExerciseRunbook_tenantId_exerciseId_runbookId_key') THEN
            CREATE UNIQUE INDEX "ExerciseRunbook_tenantId_exerciseId_runbookId_key" ON "ExerciseRunbook"("tenantId", "exerciseId", "runbookId");
        END IF;
    END IF;
END $$;

-- AlterTable: Modify ExerciseChecklistItem if it exists, otherwise create it
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ExerciseChecklistItem') THEN
        -- Table exists, alter it
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseChecklistItem' AND column_name = 'status') THEN
            ALTER TABLE "ExerciseChecklistItem" DROP COLUMN "status";
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseChecklistItem' AND column_name = 'isCompleted') THEN
            ALTER TABLE "ExerciseChecklistItem" ADD COLUMN "isCompleted" BOOLEAN NOT NULL DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseChecklistItem' AND column_name = 'notes') THEN
            ALTER TABLE "ExerciseChecklistItem" ADD COLUMN "notes" TEXT;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseChecklistItem' AND column_name = 'completedAt') THEN
            ALTER TABLE "ExerciseChecklistItem" ADD COLUMN "completedAt" TIMESTAMP(3);
        END IF;
        -- Make runbookStepId nullable if it's not already
        ALTER TABLE "ExerciseChecklistItem" ALTER COLUMN "runbookStepId" DROP NOT NULL;
    ELSE
        -- Table doesn't exist, create it
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
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ExerciseChecklistItem_tenantId_exerciseId_idx') THEN
        CREATE INDEX "ExerciseChecklistItem_tenantId_exerciseId_idx" ON "ExerciseChecklistItem"("tenantId", "exerciseId");
    END IF;
END $$;

-- AlterTable: Modify ExerciseResult if it exists, otherwise create it
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ExerciseResult') THEN
        -- Table exists, alter it
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'summary') THEN
            ALTER TABLE "ExerciseResult" DROP COLUMN "summary";
        END IF;
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'findings') THEN
            ALTER TABLE "ExerciseResult" DROP COLUMN "findings";
        END IF;
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'improvementPlan') THEN
            ALTER TABLE "ExerciseResult" DROP COLUMN "improvementPlan";
        END IF;
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'analysis') THEN
            ALTER TABLE "ExerciseResult" DROP COLUMN "analysis";
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'status') THEN
            ALTER TABLE "ExerciseResult" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'rtoObservedHours') THEN
            ALTER TABLE "ExerciseResult" ADD COLUMN "rtoObservedHours" INTEGER;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'comments') THEN
            ALTER TABLE "ExerciseResult" ADD COLUMN "comments" TEXT;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'startedAt') THEN
            ALTER TABLE "ExerciseResult" ADD COLUMN "startedAt" TIMESTAMP(3);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'completedAt') THEN
            ALTER TABLE "ExerciseResult" ADD COLUMN "completedAt" TIMESTAMP(3);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ExerciseResult' AND column_name = 'updatedAt') THEN
            ALTER TABLE "ExerciseResult" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
        END IF;
    ELSE
        -- Table doesn't exist, create it
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
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ExerciseResult_tenantId_exerciseId_idx') THEN
        CREATE INDEX "ExerciseResult_tenantId_exerciseId_idx" ON "ExerciseResult"("tenantId", "exerciseId");
    END IF;
END $$;

-- CreateTable: ExerciseAnalysis (only if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ExerciseAnalysis') THEN
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
        
        CREATE INDEX "ExerciseAnalysis_tenantId_exerciseId_idx" ON "ExerciseAnalysis"("tenantId", "exerciseId");
    ELSE
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ExerciseAnalysis_tenantId_exerciseId_idx') THEN
            CREATE INDEX "ExerciseAnalysis_tenantId_exerciseId_idx" ON "ExerciseAnalysis"("tenantId", "exerciseId");
        END IF;
    END IF;
END $$;

-- AddForeignKey: Update Exercise scenarioId constraint if needed
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'Exercise_scenarioId_fkey' 
        AND contype = 'f'
    ) THEN
        ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_scenarioId_fkey" 
            FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ELSE
        -- Update existing constraint to RESTRICT instead of SET NULL
        ALTER TABLE "Exercise" DROP CONSTRAINT "Exercise_scenarioId_fkey";
        ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_scenarioId_fkey" 
            FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: ExerciseRunbook constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseRunbook_tenantId_fkey') THEN
        ALTER TABLE "ExerciseRunbook" ADD CONSTRAINT "ExerciseRunbook_tenantId_fkey" 
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseRunbook_exerciseId_fkey') THEN
        ALTER TABLE "ExerciseRunbook" ADD CONSTRAINT "ExerciseRunbook_exerciseId_fkey" 
            FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseRunbook_runbookId_fkey') THEN
        ALTER TABLE "ExerciseRunbook" ADD CONSTRAINT "ExerciseRunbook_runbookId_fkey" 
            FOREIGN KEY ("runbookId") REFERENCES "Runbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: ExerciseChecklistItem constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseChecklistItem_tenantId_fkey') THEN
        ALTER TABLE "ExerciseChecklistItem" ADD CONSTRAINT "ExerciseChecklistItem_tenantId_fkey" 
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseChecklistItem_exerciseId_fkey') THEN
        ALTER TABLE "ExerciseChecklistItem" ADD CONSTRAINT "ExerciseChecklistItem_exerciseId_fkey" 
            FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseChecklistItem_runbookStepId_fkey') THEN
        ALTER TABLE "ExerciseChecklistItem" ADD CONSTRAINT "ExerciseChecklistItem_runbookStepId_fkey" 
            FOREIGN KEY ("runbookStepId") REFERENCES "RunbookStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: ExerciseResult constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseResult_tenantId_fkey') THEN
        ALTER TABLE "ExerciseResult" ADD CONSTRAINT "ExerciseResult_tenantId_fkey" 
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseResult_exerciseId_fkey') THEN
        ALTER TABLE "ExerciseResult" ADD CONSTRAINT "ExerciseResult_exerciseId_fkey" 
            FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: ExerciseAnalysis constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseAnalysis_tenantId_fkey') THEN
        ALTER TABLE "ExerciseAnalysis" ADD CONSTRAINT "ExerciseAnalysis_tenantId_fkey" 
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseAnalysis_exerciseId_fkey') THEN
        ALTER TABLE "ExerciseAnalysis" ADD CONSTRAINT "ExerciseAnalysis_exerciseId_fkey" 
            FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
