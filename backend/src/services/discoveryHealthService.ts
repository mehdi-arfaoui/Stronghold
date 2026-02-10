import type { PrismaClient } from '@prisma/client';
import { EdgeType } from '../graph/types.js';

export type ScanHealthStatus = 'connected' | 'partial' | 'error' | 'not_configured';

export interface ScanHealthProviderReport {
  name: string;
  status: ScanHealthStatus;
  lastScanAt: string | null;
  resourceCounts: Record<string, number>;
  errors: Array<{ code: string; message: string; severity: 'warning' | 'error' }>;
  coveragePercentage: number;
}

export interface ScanHealthReport {
  providers: ScanHealthProviderReport[];
  graphConsistency: {
    orphanNodes: number;
    missingReverseEdges: number;
    staleNodes: number;
    totalNodes: number;
    totalEdges: number;
  };
}

export interface ScanValidationReport {
  orphanNodes: number;
  missingContainsRelations: number;
  duplicateExternalIds: number;
  staleNodes: number;
}

const LOGGER_SCOPE = 'discovery.health';

const logInfo = (event: string, metadata: Record<string, unknown> = {}) => {
  console.info(JSON.stringify({ level: 'info', scope: LOGGER_SCOPE, event, ...metadata }));
};

export async function buildScanHealthReport(
  prisma: PrismaClient,
  tenantId: string
): Promise<ScanHealthReport> {
  const providerNames = ['AWS', 'AZURE', 'GCP'];
  const providers = await Promise.all(
    providerNames.map(async (providerName) => {
      const [lastScan, resources, failedScans] = await Promise.all([
        prisma.discoveryJob.findFirst({
          where: {
            tenantId,
            status: 'COMPLETED',
            parameters: { contains: providerName },
          },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true },
        }),
        prisma.discoveryResource.groupBy({
          by: ['kind'],
          where: { tenantId, source: providerName },
          _count: { _all: true },
        }),
        prisma.discoveryJob.findMany({
          where: {
            tenantId,
            status: 'FAILED',
            parameters: { contains: providerName },
          },
          orderBy: { completedAt: 'desc' },
          take: 3,
          select: { errorMessage: true },
        }),
      ]);

      const resourceCounts = resources.reduce<Record<string, number>>((acc, item) => {
        acc[item.kind] = item._count._all;
        return acc;
      }, {});

      const totalResources = Object.values(resourceCounts).reduce((sum, count) => sum + count, 0);
      const errors = failedScans.map((scan) => ({
        code: 'DISCOVERY_SCAN_FAILED',
        message: scan.errorMessage || `${providerName} scan failed`,
        severity: 'error' as const,
      }));

      let status: ScanHealthStatus = 'not_configured';
      if (lastScan && totalResources > 0) {
        status = errors.length > 0 ? 'partial' : 'connected';
      } else if (errors.length > 0) {
        status = 'error';
      }

      const coveragePercentage = Math.min(100, Math.round((totalResources / 50) * 100));

      return {
        name: providerName,
        status,
        lastScanAt: lastScan?.completedAt?.toISOString() ?? null,
        resourceCounts,
        errors,
        coveragePercentage,
      } satisfies ScanHealthProviderReport;
    })
  );

  const graphConsistency = await computeGraphConsistency(prisma, tenantId);

  return {
    providers,
    graphConsistency,
  };
}

async function computeGraphConsistency(prisma: PrismaClient, tenantId: string) {
  const staleLimit = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalNodes, totalEdges, staleNodes, orphanNodes, reverseEdgesMissing] = await Promise.all([
    prisma.infraNode.count({ where: { tenantId } }),
    prisma.infraEdge.count({ where: { tenantId } }),
    prisma.infraNode.count({ where: { tenantId, lastSeenAt: { lt: staleLimit } } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "InfraNode" n
      LEFT JOIN "InfraEdge" e1 ON e1."sourceId" = n.id AND e1."tenantId" = n."tenantId"
      LEFT JOIN "InfraEdge" e2 ON e2."targetId" = n.id AND e2."tenantId" = n."tenantId"
      WHERE n."tenantId" = ${tenantId}
        AND e1.id IS NULL
        AND e2.id IS NULL
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "InfraEdge" e
      LEFT JOIN "InfraEdge" reverse
        ON reverse."sourceId" = e."targetId"
       AND reverse."targetId" = e."sourceId"
       AND reverse.type = e.type
       AND reverse."tenantId" = e."tenantId"
      WHERE e."tenantId" = ${tenantId}
        AND reverse.id IS NULL
    `,
  ]);

  return {
    orphanNodes: Number(orphanNodes[0]?.count ?? 0),
    missingReverseEdges: Number(reverseEdgesMissing[0]?.count ?? 0),
    staleNodes,
    totalNodes,
    totalEdges,
  };
}

export async function validateScanConsistency(
  prisma: PrismaClient,
  tenantId: string
): Promise<ScanValidationReport> {
  const staleLimit = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [orphanNodes, missingContainsRelations, duplicateExternalIds, staleNodes] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "InfraNode" n
      LEFT JOIN "InfraEdge" e1 ON e1."sourceId" = n.id AND e1."tenantId" = n."tenantId"
      LEFT JOIN "InfraEdge" e2 ON e2."targetId" = n.id AND e2."tenantId" = n."tenantId"
      WHERE n."tenantId" = ${tenantId}
        AND e1.id IS NULL
        AND e2.id IS NULL
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "InfraNode" child
      LEFT JOIN "InfraEdge" c
        ON c."targetId" = child.id
       AND c.type = ${EdgeType.CONTAINS}
       AND c."tenantId" = child."tenantId"
      WHERE child."tenantId" = ${tenantId}
        AND child.type <> 'REGION'
        AND c.id IS NULL
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT "externalId"
        FROM "InfraNode"
        WHERE "tenantId" = ${tenantId}
          AND "externalId" IS NOT NULL
        GROUP BY "externalId"
        HAVING COUNT(*) > 1
      ) duplicates
    `,
    prisma.infraNode.count({ where: { tenantId, lastSeenAt: { lt: staleLimit } } }),
  ]);

  const report = {
    orphanNodes: Number(orphanNodes[0]?.count ?? 0),
    missingContainsRelations: Number(missingContainsRelations[0]?.count ?? 0),
    duplicateExternalIds: Number(duplicateExternalIds[0]?.count ?? 0),
    staleNodes,
  };

  logInfo('scan.validation.completed', {
    tenantId,
    ...report,
  });

  return report;
}
