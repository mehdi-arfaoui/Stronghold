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
  OWNER: {
    maxUsers: -1,
    maxStorage: BigInt(-1),
    maxScansMonth: -1,
    maxDocuments: -1,
    features: ["*"],
  },
};

const seedPlanKey = (process.env.SEED_PLAN || "PRO").toUpperCase();

function hashKey(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function upsertTenantApiKeyAndLicense(params) {
  const {
    tenantName,
    tenantApiKey,
    apiKeyLabel,
    planKey,
    metadata = null,
  } = params;
  const selectedPlan = SEED_PLANS[planKey] ?? SEED_PLANS.PRO;
  const keyHash = hashKey(tenantApiKey);

  const tenant = await prisma.tenant.upsert({
    where: { apiKey: tenantApiKey },
    update: { name: tenantName },
    create: { name: tenantName, apiKey: tenantApiKey },
  });

  await prisma.apiKey.upsert({
    where: { keyHash },
    update: {
      revokedAt: null,
      role: "ADMIN",
      tenantId: tenant.id,
      label: apiKeyLabel,
    },
    create: {
      tenantId: tenant.id,
      label: apiKeyLabel,
      keyHash,
      role: "ADMIN",
    },
  });

  const license = await prisma.license.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      plan: planKey,
      status: "ACTIVE",
      maxUsers: selectedPlan.maxUsers,
      maxStorage: selectedPlan.maxStorage,
      maxScansMonth: selectedPlan.maxScansMonth,
      maxDocuments: selectedPlan.maxDocuments,
      features: selectedPlan.features,
      expiresAt: null,
      metadata,
      usage: {
        create: {},
      },
    },
    update: {
      plan: planKey,
      status: "ACTIVE",
      maxUsers: selectedPlan.maxUsers,
      maxStorage: selectedPlan.maxStorage,
      maxScansMonth: selectedPlan.maxScansMonth,
      maxDocuments: selectedPlan.maxDocuments,
      features: selectedPlan.features,
      expiresAt: null,
      metadata,
    },
  });

  await prisma.licenseUsage.upsert({
    where: { licenseId: license.id },
    create: {
      licenseId: license.id,
      currentUsers: 1,
      currentStorage: BigInt(0),
      scansThisMonth: 0,
      documentsCount: 0,
    },
    update: {},
  });

  return { tenant, license };
}

async function seedDevTenant() {
  const apiKey = process.env.SEED_API_KEY;
  if (!apiKey) {
    throw new Error("SEED_API_KEY is required");
  }

  const planKey = seedPlanKey in SEED_PLANS ? seedPlanKey : "PRO";

  const { tenant } = await upsertTenantApiKeyAndLicense({
    tenantName: "Dev Tenant",
    tenantApiKey: apiKey,
    apiKeyLabel: "Dev API Key",
    planKey,
    metadata: {
      seededBy: "seed.cjs",
      type: "development",
    },
  });

  console.log("Seeded tenant", { id: tenant.id, name: tenant.name, plan: planKey });
  console.log("Seeded API key for tenant");
}

async function seedOwnerLicense() {
  const ownerEmail = process.env.OWNER_EMAIL || "mehdi@stronghold.io";
  const ownerApiKey =
    process.env.OWNER_API_KEY ||
    `owner_${hashKey(ownerEmail).slice(0, 40)}`;

  const { tenant, license } = await upsertTenantApiKeyAndLicense({
    tenantName: "Stronghold HQ",
    tenantApiKey: ownerApiKey,
    apiKeyLabel: `Owner API Key (${ownerEmail})`,
    planKey: "OWNER",
    metadata: {
      isFounder: true,
      ownerEmail,
      createdBy: "system-seed",
    },
  });

  console.log("Owner license seeded", {
    tenantId: tenant.id,
    tenantName: tenant.name,
    plan: license.plan,
    status: license.status,
    expiresAt: license.expiresAt,
  });
}

async function main() {
  await seedDevTenant();
  await seedOwnerLicense();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
