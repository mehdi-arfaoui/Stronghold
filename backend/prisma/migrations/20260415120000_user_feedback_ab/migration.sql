-- CreateTable
CREATE TABLE "UserFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagExperimentFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "experimentKey" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagExperimentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserFeedback_tenantId_resourceId_idx" ON "UserFeedback"("tenantId", "resourceId");

-- CreateIndex
CREATE INDEX "UserFeedback_tenantId_type_idx" ON "UserFeedback"("tenantId", "type");

-- CreateIndex
CREATE INDEX "RagExperimentFeedback_tenantId_experimentKey_idx" ON "RagExperimentFeedback"("tenantId", "experimentKey");

-- CreateIndex
CREATE INDEX "RagExperimentFeedback_tenantId_subjectId_idx" ON "RagExperimentFeedback"("tenantId", "subjectId");

-- CreateIndex
CREATE INDEX "RagExperimentFeedback_tenantId_variant_idx" ON "RagExperimentFeedback"("tenantId", "variant");

-- AddForeignKey
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagExperimentFeedback" ADD CONSTRAINT "RagExperimentFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
