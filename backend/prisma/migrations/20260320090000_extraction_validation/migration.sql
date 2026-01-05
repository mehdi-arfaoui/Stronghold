-- CreateTable
CREATE TABLE "DocumentExtractionSuggestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "suggestionType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentExtractionSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "exerciseType" TEXT,
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentExtractionSuggestion_tenantId_documentId_idx" ON "DocumentExtractionSuggestion"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "DocumentExtractionSuggestion_tenantId_status_idx" ON "DocumentExtractionSuggestion"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ExerciseEvidence_tenantId_documentId_idx" ON "ExerciseEvidence"("tenantId", "documentId");

-- AddForeignKey
ALTER TABLE "DocumentExtractionSuggestion" ADD CONSTRAINT "DocumentExtractionSuggestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtractionSuggestion" ADD CONSTRAINT "DocumentExtractionSuggestion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseEvidence" ADD CONSTRAINT "ExerciseEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseEvidence" ADD CONSTRAINT "ExerciseEvidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
