const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

// Default plan configuration for STARTER
const STARTER_PLAN = {
  maxUsers: 5,
  maxStorage: BigInt(1 * 1024 * 1024 * 1024), // 1 GB
  maxScansMonth: 100,
  maxDocuments: 500,
  features: ["discovery", "inventory", "basic_reports"],
};

async function main() {
  const apiKey = "dev-key";
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  const tenant = await prisma.tenant.upsert({
    where: { apiKey },
    update: {},
    create: { name: "Dev Tenant", apiKey },
  });

  // Create ApiKey entry for the tenant
  await prisma.apiKey.upsert({
    where: { keyHash: apiKeyHash },
    update: {
      revokedAt: null, // Ensure it's not revoked
    },
    create: {
      tenantId: tenant.id,
      label: "Dev API Key",
      keyHash: apiKeyHash,
      role: "ADMIN",
    },
  });

  // Create License for the tenant
  const existingLicense = await prisma.license.findUnique({
    where: { tenantId: tenant.id },
  });

  if (!existingLicense) {
    await prisma.license.create({
      data: {
        tenantId: tenant.id,
        plan: "STARTER",
        status: "ACTIVE",
        maxUsers: STARTER_PLAN.maxUsers,
        maxStorage: STARTER_PLAN.maxStorage,
        maxScansMonth: STARTER_PLAN.maxScansMonth,
        maxDocuments: STARTER_PLAN.maxDocuments,
        features: STARTER_PLAN.features,
        usage: {
          create: {}, // Create LicenseUsage with defaults
        },
      },
    });
    console.log("Seeded license for tenant");
  } else {
    console.log("License already exists for tenant");
  }

  console.log("Seeded tenant", { id: tenant.id, name: tenant.name });
  console.log("Seeded API key for tenant");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
