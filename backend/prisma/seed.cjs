const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const apiKey = "dev-key";

  const tenant = await prisma.tenant.upsert({
    where: { apiKey },
    update: {},
    create: { name: "Dev Tenant", apiKey },
  });

  console.log("Seeded tenant", { id: tenant.id, name: tenant.name });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
