const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

const SEED_PLANS = {
  STARTER: {
    maxUsers: 5,
    maxStorage: BigInt(1 * 1024 * 1024 * 1024), // 1 GB
    maxScansMonth: 100,
    maxDocuments: 500,
    features: ["discovery", "inventory", "basic_reports"],
  },
  PRO: {
    maxUsers: 25,
    maxStorage: BigInt(10 * 1024 * 1024 * 1024), // 10 GB
    maxScansMonth: 1000,
    maxDocuments: 5000,
    features: [
      "discovery",
      "inventory",
      "bia",
      "pra",
      "reports",
      "exports",
      "api_access",
    ],
  },
  ENTERPRISE: {
    maxUsers: -1,
    maxStorage: BigInt(100 * 1024 * 1024 * 1024), // 100 GB
    maxScansMonth: -1,
    maxDocuments: -1,
    features: ["*"],
  },
};

const seedPlanKey = (process.env.SEED_PLAN || "PRO").toUpperCase();
const seedPlan = SEED_PLANS[seedPlanKey] ?? SEED_PLANS.PRO;

async function main() {
  const apiKey = process.env.SEED_API_KEY;
  if (!apiKey) {
    throw new Error("SEED_API_KEY is required");
  }
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
        plan: seedPlanKey in SEED_PLANS ? seedPlanKey : "PRO",
        status: "ACTIVE",
        maxUsers: seedPlan.maxUsers,
        maxStorage: seedPlan.maxStorage,
        maxScansMonth: seedPlan.maxScansMonth,
        maxDocuments: seedPlan.maxDocuments,
        features: seedPlan.features,
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
