-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ANALYST', 'VIEWER');

-- DropForeignKey
ALTER TABLE "ApiKey" DROP CONSTRAINT "ApiKey_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "CyberExercise" DROP CONSTRAINT "CyberExercise_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "DiscoveryScanAudit" DROP CONSTRAINT "DiscoveryScanAudit_jobId_fkey";

-- DropForeignKey
ALTER TABLE "ExerciseChecklistItem" DROP CONSTRAINT "ExerciseChecklistItem_runbookStepId_fkey";

-- DropForeignKey
ALTER TABLE "RunbookStep" DROP CONSTRAINT "RunbookStep_scenarioId_fkey";

-- DropIndex
DROP INDEX "AuditLog_correlationId_idx";

-- DropIndex
DROP INDEX "AuditLog_tenantId_createdAt_idx";

-- DropIndex
DROP INDEX "DiscoveryJob_tenantId_jobType_idx";

-- DropIndex
DROP INDEX "DiscoveryJob_tenantId_status_idx";

-- DropIndex
DROP INDEX "DiscoveryScanAudit_tenantId_jobId_idx";

-- DropIndex
DROP INDEX "Exercise_scenarioId_idx";

-- DropIndex
DROP INDEX "Exercise_tenantId_idx";

-- DropIndex
DROP INDEX "Exercise_tenantId_scheduledAt_idx";

-- DropIndex
DROP INDEX "ExerciseAnalysis_tenantId_exerciseId_idx";

-- DropIndex
DROP INDEX "ExerciseChecklistItem_tenantId_exerciseId_idx";

-- DropIndex
DROP INDEX "ExerciseChecklistItem_tenantId_runbookStepId_idx";

-- DropIndex
DROP INDEX "ExerciseResult_tenantId_exerciseId_idx";

-- DropIndex
DROP INDEX "ExerciseRunbook_tenantId_exerciseId_idx";

-- DropIndex
DROP INDEX "ExerciseRunbook_tenantId_runbookId_idx";

-- DropIndex
DROP INDEX "Risk_serviceId_idx";

-- DropIndex
DROP INDEX "Risk_tenantId_idx";

-- DropIndex
DROP INDEX "RiskMitigation_tenantId_riskId_idx";

-- AlterTable
ALTER TABLE "BusinessProcessService" ADD COLUMN     "riskMitigationId" TEXT;

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "resilienceSimulationId" TEXT;

-- AlterTable
ALTER TABLE "ExerciseResult" ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RunbookStep" ALTER COLUMN "scenarioId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId", "role");

-- CreateIndex
CREATE INDEX "User_tenantId_isActive_idx" ON "User"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_tenantId_userId_idx" ON "RefreshToken"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "RefreshToken_tenantId_expiresAt_idx" ON "RefreshToken"("tenantId", "expiresAt");

-- AddForeignKey
ALTER TABLE "BusinessProcessService" ADD CONSTRAINT "BusinessProcessService_riskMitigationId_fkey" FOREIGN KEY ("riskMitigationId") REFERENCES "RiskMitigation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunbookStep" ADD CONSTRAINT "RunbookStep_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseChecklistItem" ADD CONSTRAINT "ExerciseChecklistItem_runbookStepId_fkey" FOREIGN KEY ("runbookStepId") REFERENCES "RunbookStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CyberExercise" ADD CONSTRAINT "CyberExercise_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryScanAudit" ADD CONSTRAINT "DiscoveryScanAudit_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
