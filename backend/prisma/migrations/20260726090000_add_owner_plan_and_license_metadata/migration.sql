-- Add new license statuses/plans
ALTER TYPE "LicenseStatus" ADD VALUE IF NOT EXISTS 'TRIAL';
ALTER TYPE "PlanType" ADD VALUE IF NOT EXISTS 'OWNER';

-- Extend License model for production checks and metadata
ALTER TABLE "License"
  ADD COLUMN IF NOT EXISTS "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;
