CREATE TABLE "LicenseBinding" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LicenseBinding_licenseId_key" ON "LicenseBinding"("licenseId");
