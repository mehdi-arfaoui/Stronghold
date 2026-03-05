import {
  DescribeContinuousBackupsCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { appLogger } from "../../utils/logger.js";
import type { Enricher, EnrichmentResult } from "./types.js";
import {
  getNodeMetadata,
  isAccessDeniedError,
  readString,
  resolveNodeRegion,
  setNodeMetadata,
  toErrorMessage,
} from "./types.js";

function resolveAwsClientCredentials(credentials: unknown, region: string): unknown {
  const awsCredentials =
    credentials && typeof credentials === "object"
      ? (credentials as Record<string, unknown>)
      : {};

  const roleArn = readString(awsCredentials.roleArn);
  const externalId = readString(awsCredentials.externalId);
  if (roleArn) {
    return fromTemporaryCredentials({
      params: {
        RoleArn: roleArn,
        RoleSessionName: "stronghold-enrichment-dynamodb",
        ...(externalId ? { ExternalId: externalId } : {}),
      },
      clientConfig: { region },
    });
  }

  const accessKeyId = readString(awsCredentials.accessKeyId);
  const secretAccessKey = readString(awsCredentials.secretAccessKey);
  const sessionToken = readString(awsCredentials.sessionToken);
  if (accessKeyId && secretAccessKey) {
    return {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
  }

  return undefined;
}

function resolveDynamoTableName(metadata: Record<string, unknown>, fallback: string): string | null {
  return readString(metadata.tableName) || readString(metadata.dbIdentifier) || readString(fallback);
}

export const awsDynamoDbPitrEnricher: Enricher = {
  name: "aws-dynamodb-pitr",
  provider: "aws",
  appliesTo: (node) => {
    if (node.provider !== "aws" || node.type !== "DATABASE") return false;
    const metadata = getNodeMetadata(node);
    const sourceType = String(metadata.sourceType || "").toLowerCase();
    const awsService = String(metadata.awsService || "").toLowerCase();
    const engine = String(metadata.engine || "").toLowerCase();
    return (
      sourceType.includes("dynamodb") ||
      awsService.includes("dynamodb") ||
      engine.includes("dynamodb")
    );
  },

  enrich: async (
    nodes,
    credentials,
    region,
  ): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;
    let failed = 0;
    let skipped = 0;

    const clients = new Map<string, DynamoDBClient>();
    const getClient = (awsRegion: string): DynamoDBClient => {
      const existing = clients.get(awsRegion);
      if (existing) return existing;

      const clientCredentials = resolveAwsClientCredentials(credentials, awsRegion);
      const client = new DynamoDBClient({
        region: awsRegion,
        ...(clientCredentials ? { credentials: clientCredentials as any } : {}),
      });
      clients.set(awsRegion, client);
      return client;
    };

    for (const node of nodes) {
      const metadata = getNodeMetadata(node);
      const tableName = resolveDynamoTableName(metadata, node.name);
      if (!tableName) {
        skipped += 1;
        setNodeMetadata(node, {
          pointInTimeRecovery: null,
          pointInTimeRecoveryStatus: null,
        });
        continue;
      }

      const awsRegion = resolveNodeRegion(node, region);
      if (!awsRegion) {
        failed += 1;
        setNodeMetadata(node, {
          pointInTimeRecovery: null,
          pointInTimeRecoveryStatus: null,
        });
        continue;
      }

      try {
        const response = await getClient(awsRegion).send(
          new DescribeContinuousBackupsCommand({ TableName: tableName }),
        );
        const pitrStatus =
          response.ContinuousBackupsDescription?.PointInTimeRecoveryDescription
            ?.PointInTimeRecoveryStatus;
        const status = String(pitrStatus || "DISABLED").toUpperCase();
        setNodeMetadata(node, {
          pointInTimeRecovery: status === "ENABLED" || status === "ENABLING",
          pointInTimeRecoveryStatus: status,
        });
        enriched += 1;
      } catch (error) {
        failed += 1;
        setNodeMetadata(node, {
          pointInTimeRecovery: null,
          pointInTimeRecoveryStatus: null,
        });
        appLogger.debug("[MetadataEnrichment] aws-dynamodb-pitr failed", {
          tableName,
          region: awsRegion,
          accessDenied: isAccessDeniedError(error),
          message: toErrorMessage(error),
        });
      }
    }

    return {
      enriched,
      failed,
      skipped,
      durationMs: Date.now() - start,
    };
  },
};
