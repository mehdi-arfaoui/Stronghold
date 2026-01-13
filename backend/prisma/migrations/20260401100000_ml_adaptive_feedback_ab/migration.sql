-- CreateTable
CREATE TABLE "EntityFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "documentId" TEXT,
    "action" TEXT NOT NULL,
    "originalValue" JSONB,
    "correctedValue" JSONB,
    "notes" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recommendationType" TEXT NOT NULL,
    "recommendationId" TEXT,
    "rating" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "comment" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagExperimentAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "experimentKey" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagExperimentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagTuningConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fusionAlpha" DOUBLE PRECISION NOT NULL,
    "lexicalChunksPerDoc" INTEGER NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "normalizationStats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagTuningConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlTrainingRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "classificationSampleSize" INTEGER,
    "entitySampleSize" INTEGER,
    "recommendationSampleSize" INTEGER,
    "ragTuningSnapshot" JSONB,
    "metrics" JSONB,

    CONSTRAINT "MlTrainingRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityFeedback_tenantId_entityType_idx" ON "EntityFeedback"("tenantId", "entityType");

-- CreateIndex
CREATE INDEX "EntityFeedback_tenantId_entityId_idx" ON "EntityFeedback"("tenantId", "entityId");

-- CreateIndex
CREATE INDEX "EntityFeedback_tenantId_documentId_idx" ON "EntityFeedback"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "RecommendationFeedback_tenantId_recommendationType_idx" ON "RecommendationFeedback"("tenantId", "recommendationType");

-- CreateIndex
CREATE INDEX "RecommendationFeedback_tenantId_recommendationId_idx" ON "RecommendationFeedback"("tenantId", "recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "RagExperimentAssignment_tenantId_experimentKey_subjectId_key" ON "RagExperimentAssignment"("tenantId", "experimentKey", "subjectId");

-- CreateIndex
CREATE INDEX "RagExperimentAssignment_tenantId_experimentKey_idx" ON "RagExperimentAssignment"("tenantId", "experimentKey");

-- CreateIndex
CREATE UNIQUE INDEX "RagTuningConfig_tenantId_key" ON "RagTuningConfig"("tenantId");

-- CreateIndex
CREATE INDEX "MlTrainingRun_tenantId_startedAt_idx" ON "MlTrainingRun"("tenantId", "startedAt");

-- AddForeignKey
ALTER TABLE "EntityFeedback" ADD CONSTRAINT "EntityFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagExperimentAssignment" ADD CONSTRAINT "RagExperimentAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagTuningConfig" ADD CONSTRAINT "RagTuningConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlTrainingRun" ADD CONSTRAINT "MlTrainingRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
