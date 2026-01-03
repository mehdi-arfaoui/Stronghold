const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

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
