-- CreateTable
CREATE TABLE "InfraComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT,
    "location" TEXT,
    "criticality" TEXT,
    "isSingleAz" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "ServiceInfraLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "infraId" TEXT NOT NULL,
    CONSTRAINT "ServiceInfraLink_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceInfraLink_infraId_fkey" FOREIGN KEY ("infraId") REFERENCES "InfraComponent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
