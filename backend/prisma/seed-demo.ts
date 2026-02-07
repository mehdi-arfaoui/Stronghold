/**
 * CLI entrypoint for ShopMax demo seed.
 *
 * Usage:
 *   npx tsx prisma/seed-demo.ts
 *   npm run seed:demo
 */

import { PrismaClient } from "@prisma/client";
import { runDemoSeed } from "../src/services/demoSeedService.js";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { apiKey: "dev-key" },
  });

  if (!tenant) {
    console.error(
      "No dev tenant found. Run the base seed first: npm run db:seed"
    );
    process.exit(1);
  }

  console.log(`Using tenant: ${tenant.name} (${tenant.id})`);
  await runDemoSeed(prisma, tenant.id);

  console.log("");
  console.log("Next steps:");
  console.log("  1. Run graph analysis:  POST /analysis/resilience/graph");
  console.log("  2. Generate BIA:        POST /bia-resilience/auto-generate");
  console.log("  3. Detect risks:        POST /risks-resilience/auto-detect");
  console.log("  4. Try a simulation:    POST /simulations");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
