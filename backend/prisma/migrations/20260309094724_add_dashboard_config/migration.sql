-- CreateTable
CREATE TABLE "DashboardConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DashboardConfig_organizationId_idx" ON "DashboardConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardConfig_userId_organizationId_key" ON "DashboardConfig"("userId", "organizationId");

-- AddForeignKey
ALTER TABLE "DashboardConfig" ADD CONSTRAINT "DashboardConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardConfig" ADD CONSTRAINT "DashboardConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
