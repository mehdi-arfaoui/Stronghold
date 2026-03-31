import { PrismaClient } from '@prisma/client';

import type { ServerConfig } from './env.js';

export function createPrismaClient(config: ServerConfig): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: config.databaseUrl,
      },
    },
  });
}

export async function checkDatabaseConnection(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
