/**
 * CLI entrypoint for ShopMax demo seed.
 *
 * Usage:
 *   npx tsx prisma/seed-demo.ts
 *   npm run seed:demo
 */

import { PrismaClient } from "@prisma/client";
import { getDemoSeedGuard, runDemoOnboarding } from "../src/services/demoOnboardingService.js";

const prisma = new PrismaClient();

async function main() {
  const guard = getDemoSeedGuard();
  if (!guard.allowed) {
    console.error(`Demo onboarding blocked: ${guard.reason}`);
    process.exit(1);
  }

  const seedApiKey = process.env.SEED_API_KEY;
  if (!seedApiKey) {
    console.error("SEED_API_KEY is required");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findFirst({
    where: { apiKey: seedApiKey },
  });

  if (!tenant) {
    console.error(
      "No dev tenant found. Run the base seed first: npm run db:seed"
    );
    process.exit(1);
  }

  console.log(`Using tenant: ${tenant.name} (${tenant.id})`);
  const summary = await runDemoOnboarding(prisma, tenant.id);

  console.log("");
  console.log("Demo onboarding summary:");
  console.log(`  Nodes:          ${summary.nodes}`);
  console.log(`  Total edges:    ${summary.totalEdges}`);
  console.log(`  BIA processes:  ${summary.biaProcesses}`);
  console.log(`  Risks detected: ${summary.risksDetected}`);
  console.log(`  Simulations:    ${summary.simulationsSeeded}`);
  console.log(`  Runbooks:       ${summary.runbooksSeeded}`);
  console.log(`  PRA exercises:  ${summary.praExercisesSeeded}`);
  console.log(`  Duration:       ${summary.durationMs} ms`);
  console.log(`  Budget (10s):   ${summary.withinPerformanceBudget ? "OK" : "EXCEEDED"}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
