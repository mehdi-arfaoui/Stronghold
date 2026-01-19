import prisma from "../src/prismaClient.js";
import { ensureMlTrainingIfDue, runMlTrainingForTenant } from "../src/services/mlTrainingService.js";

const trigger = process.env.ML_TRAINING_TRIGGER ?? "cron";
const force = String(process.env.ML_TRAINING_FORCE ?? "false").toLowerCase() === "true";

async function retrainForTenant(tenantId: string) {
  if (force) {
    await runMlTrainingForTenant(tenantId, trigger);
    return;
  }
  await ensureMlTrainingIfDue(tenantId, trigger);
}

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });

  for (const tenant of tenants) {
    await retrainForTenant(tenant.id);
  }
}

main()
  .catch((error) => {
    console.error("[retrainModels] failed", {
      errorName: error?.name,
      message: error?.message,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
